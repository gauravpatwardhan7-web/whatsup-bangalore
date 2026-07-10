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
 *      GEMINI_API_KEY (or GOOGLE_API_KEY), optional GEMINI_MODEL,
 *      optional MISTRAL_API_KEY (fallback when Gemini's daily quota is hit —
 *      see scripts/llm-extract.ts), optional MISTRAL_MODEL.
 */

import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { createClient, type WebSocketLikeConstructor } from "@supabase/supabase-js";
import ws from "ws"; // realtime transport: Node 20 lacks native WebSocket (unused here, but the client insists)
import { CATEGORIES, type Category } from "../lib/ds";
import { findNearbyMatch } from "../lib/guardrails";
import { chunk, extractCandidates, type Candidate } from "./llm-extract";
import { geocodeInBlr, enrichNewPlace } from "./resolve-place";
import { storePlacePhotos } from "./place-photos";

// Broadened beyond r/bangalore to the city's food/social subs. Override with a
// comma-separated SUBREDDITS env var without touching code.
const SUBREDDITS = (process.env.SUBREDDITS?.split(",").map((s) => s.trim()).filter(Boolean)) ?? [
  "bangalore",
  "Bengaluru",
  "BangaloreFoodFreaks",
  "bangalorefood",
  "blr_drinks",
];
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
// "-latest" alias, not a pinned snapshot — Google sunsets dated model IDs
// (gemini-2.5-flash 404'd in prod on 2026-07-10) without touching aliases.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
// A brand-new place must clear this source-engagement bar (0–6 scale) to be
// created — one weak mention shouldn't mint a pin. Linking a mention to an
// existing place has no floor (every signal still feeds trending_score).
// Tunable without a code change via MIN_CREATE_ENGAGEMENT.
const MIN_CREATE_ENGAGEMENT = Number(process.env.MIN_CREATE_ENGAGEMENT ?? 3.0);
const USER_AGENT = "whatsup-bangalore-ingest/1.0 (https://github.com/gauravpatwardhan7-web/whatsup-bangalore)";
const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

// Stable per-place placeholder image so auto-discovered places aren't left with
// just the emoji placeholder. Picsum's /seed/ URLs are deterministic forever
// (loremflickr's ?lock re-indexes its pool, so images drifted day to day).
// Real venue photos come from the Google Places script (scripts/refresh-place-photos.ts)
// or an admin swap via the in-app edit sheet.
export function photoUrlFor(_category: Category, seed: string): string {
  const slug = seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "place";
  return `https://picsum.photos/seed/${slug}/600/400`;
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
async function fetchSubredditPosts(subreddit: string): Promise<RedditPost[]> {
  const now = Math.floor(Date.now() / 1000);
  const after = now - LOOKBACK_DAYS * 86400;
  const before = now - MIN_AGE_DAYS * 86400;
  const url = `${ARCTIC_BASE}/api/posts/search?subreddit=${subreddit}&after=${after}&before=${before}&sort=desc&limit=${FETCH_LIMIT}`;

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
      // One flaky sub shouldn't sink the others — skip it.
      console.warn(`  r/${subreddit}: giving up after 3 attempts`);
      return [];
    }
    await sleep(2000 * attempt);
  }
  return parseRedditPosts(json);
}

// Pull every configured subreddit, merge, dedupe, and keep the overall top
// HOT_LIMIT by engagement (the LLM budget is shared across subs).
async function fetchHotPosts(): Promise<RedditPost[]> {
  const all: RedditPost[] = [];
  for (const sub of SUBREDDITS) {
    const posts = await fetchSubredditPosts(sub);
    console.log(`  r/${sub}: ${posts.length} post(s)`);
    all.push(...posts);
    await sleep(1000); // be polite to Arctic Shift
  }
  const seen = new Set<string>();
  const deduped = all.filter((p) => !seen.has(p.permalink) && (seen.add(p.permalink), true));
  deduped.sort(
    (a, b) => normalizeEngagement(b.score, b.numComments) - normalizeEngagement(a.score, a.numComments),
  );
  return deduped.slice(0, HOT_LIMIT);
}

const SYSTEM_PROMPT = `You extract specific, real, visitable places and events in Bengaluru (Bangalore), India from Reddit posts, to plot on a local map.

Extract ONLY a place/event when the post names a specific venue a person could go to: a named restaurant, cafe, bar, brewery, park, market, shop, museum, gallery, venue, or a specific dated event/festival. The name must be specific enough to geocode ("Toit", "Cubbon Park", "VV Puram Food Street", "Lollapalooza India at Bangalore Palace").

Do NOT extract: general city discussion, complaints, traffic/civic rants, questions with no named place, memes, politics, apartments/PGs/real-estate, generic areas or neighborhoods alone ("Indiranagar", "Koramangala"), companies/offices, or vague references ("a nice cafe near me").

CRITICAL — intent check. Extract a place ONLY when the post recommends, reviews, or is genuinely about going there / the experience of being there (great food, good vibe, a gig, a thing to do). Do NOT extract a venue that is merely the incidental backdrop of a different story — a crime, accident, scam, arrest, complaint, traffic/toll gripe, lost-and-found, protest, or news incident. If the post's real subject is a problem or event that just happens to occur at/near a named place, return nothing for it. Examples of what to SKIP: "spotted X near Church Street, why no police action" (a complaint — skip Church Street), "BMTC charges toll at the airport" (a fare gripe — skip the airport), "accident near Toit yesterday" (skip Toit).

For each kept place, choose the single best category from the allowed list, and set is_event=true only for time-bound events. post_number is the number shown before the post. If a post yields no specific recommended place, include nothing for it. Deduplicate within a post.

For "reason", write 2-3 informative sentences a local would find useful — what the place is, what it's known for, and why it's worth going (signature dishes, the vibe, what to order, best time to visit). Draw specifics from the post; don't pad with generic filler like "a great place to visit". If the post is thin on detail, keep it to what you can genuinely say.`;

function buildPrompt(posts: RedditPost[], baseIndex: number): string {
  const numbered = posts
    .map((p, i) => `[${baseIndex + i}] ${p.title}${p.selftext ? `\n${p.selftext}` : ""}`)
    .join("\n\n");
  return `Posts:\n\n${numbered}`;
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
  console.log(`Fetched ${posts.length} post(s) from ${SUBREDDITS.map((s) => `r/${s}`).join(", ")} (via Arctic Shift, ${MIN_AGE_DAYS}-${LOOKBACK_DAYS}d old).`);

  const supabase = canWrite ? createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false }, realtime: { transport: ws as unknown as WebSocketLikeConstructor } }) : null;

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
    const extracted = await extractCandidates(ai, GEMINI_MODEL, SYSTEM_PROMPT, buildPrompt(group, base));
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
    const geo = await geocodeInBlr(cand.name);
    if (!geo) {
      console.log(`  ✗ "${cand.name}" — couldn't geocode inside Bengaluru`);
      continue;
    }

    const category = normalizeCategory(cand.category, cand.is_event);
    const engagement = normalizeEngagement(post.score, post.numComments);
    const mentionedAt = new Date(post.createdUtc * 1000).toISOString();
    const match = findNearbyMatch(cand.name, geo.lat, geo.lng, existingPlaces);

    // Floor applies only to creating a new place; linking always counts.
    if (!match && engagement < MIN_CREATE_ENGAGEMENT) {
      console.log(`  ⊘ "${cand.name}" — below trending bar (eng ${engagement} < ${MIN_CREATE_ENGAGEMENT}), not creating`);
      continue;
    }

    if (dryRun) {
      console.log(`  ~ would ${match ? "link" : "create"}: "${cand.name}" (${category}) @ ${geo.lat.toFixed(4)},${geo.lng.toFixed(4)} eng=${engagement}`);
      continue;
    }

    let placeId: string;
    if (match) {
      placeId = match.id;
    } else {
      // Enrich a brand-new place from Google Places (description/rating/etc.),
      // and skip anything Google reports as permanently closed.
      const enrich = await enrichNewPlace(cand.name);
      if (enrich?.permanentlyClosed) {
        console.log(`  ⊘ "${cand.name}" — Google reports it permanently closed, skipping`);
        continue;
      }
      const { data: created, error: placeErr } = await supabase!
        .from("places")
        .insert({
          title: cand.name,
          description: enrich?.description ?? cand.reason,
          category,
          lat: geo.lat,
          lng: geo.lng,
          address: geo.address,
          image_url: photoUrlFor(category, cand.name),
          source_url: post.permalink,
          rating: enrich?.rating ?? null,
          rating_count: enrich?.ratingCount ?? null,
          price_level: enrich?.priceLevel ?? null,
          website: enrich?.website ?? null,
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

      // Store up to 3 real Google photos; fall back to the placeholder above if none.
      const photos = await storePlacePhotos(supabase!, placeId, enrich?.photoNames ?? []);
      if (photos.length) {
        await supabase!.from("places").update({ image_url: photos[0], image_urls: photos }).eq("id", placeId);
      }
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
