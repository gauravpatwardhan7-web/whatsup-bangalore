/**
 * Phase 2 — Reddit ingestion ("the map lights up on its own").
 *
 * Pulls hot posts from r/bangalore, uses Claude to extract specific named
 * places/events, geocodes them inside Bengaluru, matches against existing
 * places (or creates a `pending` one), and records a row in `mentions` — which
 * feeds `trending_score` via the time-decayed view in 0001_init.sql.
 *
 * Runs daily from .github/workflows/ingest-reddit.yml. Writes with the Supabase
 * service-role key (mentions/places RLS only allows service-role inserts).
 *
 * Local dry run (no writes, no keys needed — exercises the fetch/filter path):
 *   npx tsx scripts/ingest-reddit.ts --dry-run
 *
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 *      ANTHROPIC_API_KEY.
 */

import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { CATEGORIES, type Category } from "../lib/ds";
import { searchBangalore } from "../lib/geocode";
import { isInBengaluru, findDuplicate } from "../lib/guardrails";

const SUBREDDIT = "bangalore";
const HOT_LIMIT = 40;
const CHUNK_SIZE = 8; // posts per LLM call
const MATCH_RADIUS_M = 200; // an extracted place within this of an existing one, same-ish name → merge
const USER_AGENT = "whatsup-bangalore-ingest/1.0 (https://github.com/gauravpatwardhan7-web/whatsup-bangalore)";
const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

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
  const children = (json as { data?: { children?: unknown[] } })?.data?.children ?? [];
  const posts: RedditPost[] = [];
  for (const child of children) {
    const d = (child as { data?: Record<string, unknown> })?.data;
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

// Reddit blocks the anonymous public .json endpoint from many data-center IPs
// (including CI runners). With REDDIT_CLIENT_ID/SECRET set (a free "script" app
// → userless client-credentials token), we hit the authenticated API instead,
// which is reliable. Without them we fall back to the public endpoint.
async function redditToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Reddit auth failed: ${res.status} ${res.statusText}`);
  return (await res.json()).access_token as string;
}

async function fetchHotPosts(): Promise<RedditPost[]> {
  const token = await redditToken();
  const base = token ? "https://oauth.reddit.com" : "https://www.reddit.com";
  const url = `${base}/r/${SUBREDDIT}/hot.json?limit=${HOT_LIMIT}&raw_json=1`;
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const hint = res.status === 403 && !token
      ? " — the public endpoint is IP-blocked here; set REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET"
      : "";
    throw new Error(`Reddit fetch failed: ${res.status} ${res.statusText}${hint}`);
  }
  return parseRedditPosts(await res.json());
}

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    places: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          post_number: { type: "integer" },
          name: { type: "string" },
          category: { type: "string", enum: CATEGORY_KEYS },
          reason: { type: "string" },
          is_event: { type: "boolean" },
        },
        required: ["post_number", "name", "category", "reason", "is_event"],
      },
    },
  },
  required: ["places"],
} as const;

const SYSTEM_PROMPT = `You extract specific, real, visitable places and events in Bengaluru (Bangalore), India from Reddit posts, to plot on a local map.

Extract ONLY a place/event when the post names a specific venue a person could go to: a named restaurant, cafe, bar, brewery, park, market, shop, museum, gallery, venue, or a specific dated event/festival. The name must be specific enough to geocode ("Toit", "Cubbon Park", "VV Puram Food Street", "Lollapalooza India at Bangalore Palace").

Do NOT extract: general city discussion, complaints, traffic/civic rants, questions with no named place, memes, politics, apartments/PGs/real-estate, generic areas or neighborhoods alone ("Indiranagar", "Koramangala"), companies/offices, or vague references ("a nice cafe near me").

For each, choose the single best category from the allowed list, write a one-sentence reason drawn from the post about why it's notable, and set is_event=true only for time-bound events. post_number is the number shown before the post. If a post yields no specific place, include nothing for it. Deduplicate within a post.`;

async function extractCandidates(anthropic: Anthropic, posts: RedditPost[], baseIndex: number): Promise<Candidate[]> {
  const numbered = posts
    .map((p, i) => `[${baseIndex + i}] ${p.title}${p.selftext ? `\n${p.selftext}` : ""}`)
    .join("\n\n");

  const resp = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Posts:\n\n${numbered}` }],
    output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
  } as Anthropic.MessageCreateParamsNonStreaming);

  if (resp.stop_reason === "refusal") {
    console.warn("  extraction refused for a chunk — skipping it");
    return [];
  }
  const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { places?: Candidate[] };
    return parsed.places ?? [];
  } catch {
    console.warn("  couldn't parse extraction JSON — skipping chunk");
    return [];
  }
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
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const canWrite = Boolean(supabaseUrl && serviceKey);
  const canExtract = Boolean(anthropicKey);
  const dryRun = dryRunFlag || !canWrite || !canExtract;

  console.log(`Reddit ingestion — ${dryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  if (dryRun && !dryRunFlag) {
    if (!canExtract) console.log("  (ANTHROPIC_API_KEY unset → extraction skipped)");
    if (!canWrite) console.log("  (Supabase service-role env unset → writes skipped)");
  }

  const posts = await fetchHotPosts();
  console.log(`Fetched ${posts.length} eligible hot posts from r/${SUBREDDIT}.`);

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

  const anthropic = new Anthropic();
  const chunks = chunk(fresh, CHUNK_SIZE);
  const candidates: { cand: Candidate; post: RedditPost }[] = [];
  let base = 0;
  for (const group of chunks) {
    const extracted = await extractCandidates(anthropic, group, base);
    for (const c of extracted) {
      const post = fresh[c.post_number];
      if (post) candidates.push({ cand: c, post });
    }
    base += group.length;
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
