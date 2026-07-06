/**
 * Phase 2 — Reddit ingestion ("the map lights up on its own").
 *
 * Pulls recent r/bangalore posts, uses Gemini to extract specific named
 * places/events, geocodes them inside Bengaluru, matches against existing
 * places (or creates a `pending` one), and records a row in `mentions` — which
 * feeds `trending_score` via the time-decayed view in 0001_init.sql.
 *
 * Posts come from Arctic Shift (arctic-shift.photon-reddit.com), a free, keyless
 * public Reddit archive (Pushshift's successor). Unlike Reddit's own API it needs
 * no OAuth app / approval and isn't IP-blocked from CI/data-center runners — which
 * is what unblocked this pipeline. It has no "hot" listing, so we pull the recent
 * lookback window and rank by engagement ourselves.
 *
 * Runs daily from .github/workflows/ingest-reddit.yml. Writes with the Supabase
 * service-role key (mentions/places RLS only allows service-role inserts).
 *
 * Local dry run (no writes, no keys needed — exercises the fetch/filter path):
 *   npx tsx scripts/ingest-reddit.ts --dry-run
 *
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 *      GEMINI_API_KEY (or GOOGLE_API_KEY), optional GEMINI_MODEL.
 */

import { fileURLToPath } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { CATEGORIES, type Category } from "../lib/ds";
import { searchBangalore } from "../lib/geocode";
import { isInBengaluru, findDuplicate } from "../lib/guardrails";

const SUBREDDIT = "bangalore";
const ARCTIC_BASE = "https://arctic-shift.photon-reddit.com";
// Arctic Shift backfills mature vote counts, but a just-posted item still shows
// score ~1. r/bangalore also posts >100/day, so a plain "newest first" fetch only
// ever sees immature posts. We instead take a window that's aged enough to have
// real engagement (>= MIN_AGE_DAYS) but still recent (<= LOOKBACK_DAYS old).
const MIN_AGE_DAYS = 1; // let votes/comments accumulate before we rank a post
const LOOKBACK_DAYS = 4; // don't consider posts older than this
const FETCH_LIMIT = 100; // Arctic Shift max results per request
const HOT_LIMIT = 40; // top-by-engagement posts to actually analyze
const CHUNK_SIZE = 10; // posts per LLM call — smaller chunks parse more reliably than 20
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MATCH_RADIUS_M = 200; // an extracted place within this of an existing one, same-ish name → merge
const USER_AGENT = "whatsup-bangalore-ingest/1.0 (https://github.com/gauravpatwardhan7-web/whatsup-bangalore)";
const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

// Keyword photo per category (loremflickr, same service the curated seeds use)
// so auto-discovered places aren't left with just the emoji placeholder. An
// admin can swap in the real venue photo via the in-app edit sheet.
const PHOTO_KEYWORDS: Record<Category, string> = {
  food: "restaurant,food",
  drinks: "bar,beer",
  outdoors: "park,nature",
  art_culture: "art,gallery",
  shopping: "market,shopping",
  nightlife: "nightlife,bar",
  experience: "travel,experience",
  event: "festival,concert",
};

// Stable per-place image: hash the name into a loremflickr ?lock so the same
// place always resolves to the same photo (not a new random one each load).
export function photoUrlFor(category: Category, seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `https://loremflickr.com/600/400/${PHOTO_KEYWORDS[category]}?lock=${h % 100000}`;
}

// ── types ────────────────────────────────────────────────────────────────────
export interface RedditPost {
  title: string;
  selftext: string;
  permalink: string; // absolute URL
  score: number;
  numComments: number;
  createdUtc: number; // seconds
}

interface Candidate {
  post_number: number;
  name: string;
  category: string;
  reason: string;
  is_event: boolean;
}

// ── pure helpers (unit-tested) ────────────────────────────────────────────────

// Normalize Reddit engagement into the modest range the trending view expects
// (a single hot post shouldn't outweigh dozens of real votes). Comments weigh
// more than upvotes; log-compressed and capped at 6.
export function normalizeEngagement(score: number, numComments: number): number {
  const raw = Math.max(0, score) + 2 * Math.max(0, numComments);
  const scaled = Math.min(Math.log10(raw + 1) * 2.2, 6);
  return Math.round(scaled * 1000) / 1000;
}

export function parseRedditPosts(json: unknown): RedditPost[] {
  // Arctic Shift returns a flat { data: [postObj, ...] } array of raw Reddit post
  // objects — not Reddit's own { data: { children: [{ data }] } } envelope. It can
  // be null on an upstream error/timeout, so guard for that.
  const rows = (json as { data?: unknown[] })?.data ?? [];
  const posts: RedditPost[] = [];
  for (const row of rows) {
    const d = row as Record<string, unknown>;
    if (!d) continue;
    if (d.stickied || d.over_18) continue;
    const title = String(d.title ?? "").trim();
    if (!title) continue;
    posts.push({
      title,
      selftext: String(d.selftext ?? "").slice(0, 600),
      permalink: `https://www.reddit.com${String(d.permalink ?? "")}`,
      score: Number(d.score ?? 0),
      numComments: Number(d.num_comments ?? 0),
      createdUtc: Number(d.created_utc ?? 0),
    });
  }
  return posts;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeCategory(c: string, isEvent: boolean): Category {
  if (isEvent) return "event";
  return (CATEGORY_KEYS as string[]).includes(c) ? (c as Category) : "experience";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── external steps ─────────────────────────────────────────────────────────────

// Fetch recent-but-matured r/bangalore posts from Arctic Shift and rank them by
// engagement. Arctic Shift has no "hot" endpoint, so we pull a [now-LOOKBACK,
// now-MIN_AGE] window (newest matured posts first) and sort by our own engagement
// score, taking the top HOT_LIMIT. Keyless and not IP-blocked from CI, unlike
// Reddit's own API.
async function fetchHotPosts(): Promise<RedditPost[]> {
  const now = Math.floor(Date.now() / 1000);
  const after = now - LOOKBACK_DAYS * 86400;
  const before = now - MIN_AGE_DAYS * 86400;
  const url = `${ARCTIC_BASE}/api/posts/search?subreddit=${SUBREDDIT}&after=${after}&before=${before}&sort=desc&limit=${FETCH_LIMIT}`;

  // Arctic Shift is a free hobby-run service that occasionally returns a transient
  // 422/5xx under node churn; retry a few times with backoff before giving up.
  let json: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if (res.ok) {
      json = await res.json();
      if (!(json as { error?: string })?.error) break;
      console.warn(`  Arctic Shift returned an error body (attempt ${attempt}): ${(json as { error?: string }).error}`);
    } else {
      console.warn(`  Arctic Shift fetch ${res.status} ${res.statusText} (attempt ${attempt})`);
    }
    if (attempt === 3) {
      throw new Error(`Arctic Shift fetch failed after 3 attempts: ${res.status} ${res.statusText}`);
    }
    await sleep(2000 * attempt);
  }
  const posts = parseRedditPosts(json);
  posts.sort(
    (a, b) => normalizeEngagement(b.score, b.numComments) - normalizeEngagement(a.score, a.numComments),
  );
  return posts.slice(0, HOT_LIMIT);
}

const EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    places: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          post_number: { type: Type.INTEGER },
          name: { type: Type.STRING },
          category: { type: Type.STRING, enum: CATEGORY_KEYS },
          reason: { type: Type.STRING },
          is_event: { type: Type.BOOLEAN },
        },
        required: ["post_number", "name", "category", "reason", "is_event"],
        propertyOrdering: ["post_number", "name", "category", "reason", "is_event"],
      },
    },
  },
  required: ["places"],
};

const SYSTEM_PROMPT = `You extract specific, real, visitable places and events in Bengaluru (Bangalore), India from Reddit posts, to plot on a local map.

Extract ONLY a place/event when the post names a specific venue a person could go to: a named restaurant, cafe, bar, brewery, park, market, shop, museum, gallery, venue, or a specific dated event/festival. The name must be specific enough to geocode ("Toit", "Cubbon Park", "VV Puram Food Street", "Lollapalooza India at Bangalore Palace").

Do NOT extract: general city discussion, complaints, traffic/civic rants, questions with no named place, memes, politics, apartments/PGs/real-estate, generic areas or neighborhoods alone ("Indiranagar", "Koramangala"), companies/offices, or vague references ("a nice cafe near me").

CRITICAL — intent check. Extract a place ONLY when the post recommends, reviews, or is genuinely about going there / the experience of being there (great food, good vibe, a gig, a thing to do). Do NOT extract a venue that is merely the incidental backdrop of a different story — a crime, accident, scam, arrest, complaint, traffic/toll gripe, lost-and-found, protest, or news incident. If the post's real subject is a problem or event that just happens to occur at/near a named place, return nothing for it. Examples of what to SKIP: "spotted X near Church Street, why no police action" (a complaint — skip Church Street), "BMTC charges toll at the airport" (a fare gripe — skip the airport), "accident near Toit yesterday" (skip Toit).

For each kept place, choose the single best category from the allowed list, write a one-sentence reason drawn from the post about why it's worth visiting, and set is_event=true only for time-bound events. post_number is the number shown before the post. If a post yields no specific recommended place, include nothing for it. Deduplicate within a post.`;

// Parse the model's response into candidates, tolerating the ways structured
// output occasionally arrives dirty: markdown ```json fences, or leading/trailing
// prose around the object. Returns null when nothing parseable is found.
export function parseCandidates(text: string | undefined): Candidate[] | null {
  if (!text) return null;
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const tryParse = (s: string): Candidate[] | null => {
    try {
      const parsed = JSON.parse(s) as { places?: Candidate[] };
      return Array.isArray(parsed.places) ? parsed.places : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(cleaned);
  if (direct) return direct;
  // Fallback: extract the outermost {...} and try that.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(cleaned.slice(start, end + 1));
  return null;
}

async function extractCandidates(ai: GoogleGenAI, posts: RedditPost[], baseIndex: number): Promise<Candidate[]> {
  const numbered = posts
    .map((p, i) => `[${baseIndex + i}] ${p.title}${p.selftext ? `\n${p.selftext}` : ""}`)
    .join("\n\n");

  // A rate-limit (429), transient error, or an unparseable body on one chunk
  // shouldn't abort the whole run. Retry with backoff (honoring the API's
  // retryDelay when given); after the last attempt, skip the chunk so the
  // chunks that did parse still get written.
  for (let attempt = 1; attempt <= 3; attempt++) {
    let text: string | undefined;
    try {
      const resp = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Posts:\n\n${numbered}`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: EXTRACTION_SCHEMA,
          temperature: 0,
        },
      });
      text = resp.text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(msg);
      // A per-day quota can't clear by waiting — bail fast rather than burn minutes.
      const isDailyQuota = /PerDay|RequestsPerDay|free_tier_requests/i.test(msg);
      if (isDailyQuota) {
        console.warn("  Gemini daily free-tier quota exhausted — skipping remaining extraction.");
        return [];
      }
      if (attempt === 3 || !isRateLimit) {
        console.warn(`  extraction call failed (attempt ${attempt}) — skipping chunk: ${msg.slice(0, 160)}`);
        return [];
      }
      const retryMs = /"retryDelay":"(\d+)/.exec(msg)?.[1];
      const waitMs = retryMs ? Number(retryMs) * 1000 + 1000 : 5000 * attempt;
      console.warn(`  extraction rate-limited (attempt ${attempt}) — waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      continue;
    }

    const parsed = parseCandidates(text);
    if (parsed) return parsed;
    // Parseable output failed (blocked/empty/malformed) — retry a couple times
    // before giving up on this chunk, since it's often transient.
    if (attempt === 3) {
      console.warn("  couldn't parse extraction JSON after 3 attempts — skipping chunk");
      return [];
    }
    console.warn(`  couldn't parse extraction JSON (attempt ${attempt}) — retrying`);
    await sleep(1500 * attempt);
  }
  return [];
}

// Existing place matching `name` within MATCH_RADIUS_M of (lat,lng), or null.
function matchExisting(
  name: string,
  lat: number,
  lng: number,
  places: { id: string; title: string; lat: number; lng: number }[],
): { id: string; title: string } | null {
  const dLat = MATCH_RADIUS_M / 111_320;
  const dLng = MATCH_RADIUS_M / (111_320 * Math.cos((lat * Math.PI) / 180));
  const nearby = places.filter((p) => Math.abs(p.lat - lat) <= dLat && Math.abs(p.lng - lng) <= dLng);
  return findDuplicate(name, nearby);
}

// ── main ───────────────────────────────────────────────────────────────────────

async function main() {
  const dryRunFlag = process.argv.includes("--dry-run");
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  const canWrite = Boolean(supabaseUrl && serviceKey);
  const canExtract = Boolean(geminiKey);
  const dryRun = dryRunFlag || !canWrite || !canExtract;

  console.log(`Reddit ingestion — ${dryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  if (dryRun && !dryRunFlag) {
    if (!canExtract) console.log("  (GEMINI_API_KEY unset → extraction skipped)");
    if (!canWrite) console.log("  (Supabase service-role env unset → writes skipped)");
  }

  const posts = await fetchHotPosts();
  console.log(`Fetched ${posts.length} post(s) from r/${SUBREDDIT} (via Arctic Shift, ${MIN_AGE_DAYS}-${LOOKBACK_DAYS}d old).`);

  const supabase = canWrite ? createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } }) : null;

  // Skip posts we've already extracted from (dedupe work, not just rows).
  let seenUrls = new Set<string>();
  let existingPlaces: { id: string; title: string; lat: number; lng: number }[] = [];
  if (supabase) {
    const { data: mentionRows } = await supabase.from("mentions").select("url").eq("platform", "reddit");
    seenUrls = new Set((mentionRows ?? []).map((m: { url: string | null }) => m.url).filter(Boolean) as string[]);
    const { data: placeRows } = await supabase.from("places").select("id, title, lat, lng").neq("status", "rejected");
    existingPlaces = (placeRows ?? []) as typeof existingPlaces;
  }

  const fresh = posts.filter((p) => !seenUrls.has(p.permalink));
  console.log(`${fresh.length} not yet processed.`);
  if (fresh.length === 0) return;

  if (!canExtract) {
    console.log("\nPosts that would be analyzed:");
    for (const p of fresh) {
      console.log(`  • [${normalizeEngagement(p.score, p.numComments)}] ${p.title}`);
    }
    return;
  }

  const ai = new GoogleGenAI({ apiKey: geminiKey });
  const chunks = chunk(fresh, CHUNK_SIZE);
  const candidates: { cand: Candidate; post: RedditPost }[] = [];
  let base = 0;
  for (const group of chunks) {
    const extracted = await extractCandidates(ai, group, base);
    for (const c of extracted) {
      const post = fresh[c.post_number];
      if (post) candidates.push({ cand: c, post });
    }
    base += group.length;
    await sleep(1000); // stay well under free-tier RPM limits
  }
  console.log(`Extracted ${candidates.length} candidate place(s).`);

  let mentionsAdded = 0;
  let placesCreated = 0;

  for (const { cand, post } of candidates) {
    const results = await searchBangalore(cand.name);
    await sleep(1100); // Nominatim: max 1 req/sec
    const geo = results.find((r) => isInBengaluru(r.lat, r.lng));
    if (!geo) {
      console.log(`  ✗ "${cand.name}" — couldn't geocode inside Bengaluru`);
      continue;
    }

    const category = normalizeCategory(cand.category, cand.is_event);
    const engagement = normalizeEngagement(post.score, post.numComments);
    const mentionedAt = new Date(post.createdUtc * 1000).toISOString();

    if (dryRun) {
      console.log(`  ~ would record: "${cand.name}" (${category}) @ ${geo.lat.toFixed(4)},${geo.lng.toFixed(4)} eng=${engagement}`);
      continue;
    }

    const match = matchExisting(cand.name, geo.lat, geo.lng, existingPlaces);
    let placeId: string;
    if (match) {
      placeId = match.id;
    } else {
      const { data: created, error: placeErr } = await supabase!
        .from("places")
        .insert({
          title: cand.name,
          description: cand.reason,
          category,
          lat: geo.lat,
          lng: geo.lng,
          address: geo.label.split(",").slice(0, 2).join(","),
          image_url: photoUrlFor(category, cand.name),
          source_url: post.permalink,
          status: "pending", // human moderation backstop before it shows on the map
          source: "reddit",
          created_by: null,
        })
        .select("id")
        .single();
      if (placeErr || !created) {
        console.log(`  ✗ "${cand.name}" — place insert failed: ${placeErr?.message}`);
        continue;
      }
      placeId = created.id;
      placesCreated++;
      existingPlaces.push({ id: placeId, title: cand.name, lat: geo.lat, lng: geo.lng });
    }

    const { error: mErr } = await supabase!
      .from("mentions")
      .upsert(
        {
          place_id: placeId,
          platform: "reddit",
          url: post.permalink,
          title: post.title,
          engagement_score: engagement,
          mentioned_at: mentionedAt,
        },
        { onConflict: "place_id,url", ignoreDuplicates: true },
      );
    if (mErr) {
      console.log(`  ✗ mention insert failed for "${cand.name}": ${mErr.message}`);
      continue;
    }
    mentionsAdded++;
    console.log(`  ✓ ${match ? "linked" : "new"} "${cand.name}" (${category})`);
  }

  console.log(`\nDone. ${mentionsAdded} mention(s) recorded, ${placesCreated} new pending place(s).`);
}

// Only run when invoked directly (not when imported for tests). Compare decoded
// paths — import.meta.url percent-encodes chars like the space in this repo path.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
