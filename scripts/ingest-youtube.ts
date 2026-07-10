/**
 * YouTube ingestion — same shape as the Reddit pipeline (scripts/ingest-reddit.ts):
 * fetch recent Bengaluru-related videos → Gemini extracts specific named places →
 * geocode inside BLR → match existing or create a `pending` place (`source='youtube'`)
 * → upsert `mentions` (platform 'youtube'), which feeds `trending_score`.
 *
 * Videos come from the YouTube Data API v3 (search.list + videos.list for view
 * counts). Needs a YouTube API key (free tier: 10,000 units/day; one run here
 * costs ~100 units per search query).
 *
 * Local dry run (no writes):
 *   npx tsx scripts/ingest-youtube.ts --dry-run
 *
 * Env: YOUTUBE_API_KEY (required), SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL),
 *      SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY (or GOOGLE_API_KEY),
 *      optional GEMINI_MODEL, YOUTUBE_QUERIES (comma-separated search terms),
 *      optional MISTRAL_API_KEY (fallback when Gemini's daily quota is hit —
 *      see scripts/llm-extract.ts), optional MISTRAL_MODEL.
 *
 * Requires migration 0008 (adds 'youtube' to the mentions.platform and
 * places.source check constraints).
 */

import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { createClient, type WebSocketLikeConstructor } from "@supabase/supabase-js";
import ws from "ws"; // realtime transport: Node 20 lacks native WebSocket (unused here, but the client insists)
import { CATEGORIES, type Category } from "../lib/ds";
import { findNearbyMatch } from "../lib/guardrails";
import { photoUrlFor } from "./ingest-reddit";
import { chunk, extractCandidates, type Candidate } from "./llm-extract";
import { geocodeInBlr, enrichNewPlace } from "./resolve-place";
import { storePlacePhotos } from "./place-photos";

const YT_BASE = "https://www.googleapis.com/youtube/v3";
const QUERIES = (process.env.YOUTUBE_QUERIES?.split(",").map((s) => s.trim()).filter(Boolean)) ?? [
  "bangalore food",
  "bangalore new cafe restaurant",
  "bangalore things to do weekend",
  "bengaluru hidden gems",
];
const LOOKBACK_DAYS = 7; // videos published in the last week
const MAX_PER_QUERY = 25;
const HOT_LIMIT = 40; // top-by-views videos to actually analyze
const CHUNK_SIZE = 10;
// "-latest" alias, not a pinned snapshot — see ingest-reddit.ts for why.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
// See ingest-reddit.ts — a new place must clear this source-engagement bar;
// linking to an existing place has no floor. Env-tunable.
const MIN_CREATE_ENGAGEMENT = Number(process.env.MIN_CREATE_ENGAGEMENT ?? 3.0);
const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

interface Video {
  id: string;
  title: string;
  description: string;
  url: string;
  channel: string;
  views: number;
  likes: number;
  comments: number;
  publishedAt: string; // ISO
}

// Views dwarf Reddit scores, so compress harder; same 0–6 range the trending
// view expects. Likes/comments signal genuine interest more than raw views.
export function normalizeYtEngagement(views: number, likes: number, comments: number): number {
  const raw = Math.max(0, views) / 50 + 2 * Math.max(0, likes) + 5 * Math.max(0, comments);
  const scaled = Math.min(Math.log10(raw + 1) * 1.4, 6);
  return Math.round(scaled * 1000) / 1000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ytGet(path: string, params: Record<string, string>, key: string): Promise<unknown> {
  const qs = new URLSearchParams({ ...params, key });
  const res = await fetch(`${YT_BASE}/${path}?${qs}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API ${path} failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchVideos(key: string): Promise<Video[]> {
  const publishedAfter = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
  const byId = new Map<string, Video>();
  for (const q of QUERIES) {
    let items: { id?: { videoId?: string }; snippet?: { title?: string; description?: string; channelTitle?: string; publishedAt?: string } }[] = [];
    try {
      const search = await ytGet("search", {
        part: "snippet", type: "video", q, publishedAfter,
        regionCode: "IN", relevanceLanguage: "en", maxResults: String(MAX_PER_QUERY), order: "relevance",
      }, key) as { items?: typeof items };
      items = search.items ?? [];
    } catch (err) {
      console.warn(`  query "${q}" failed — skipping: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    console.log(`  "${q}": ${items.length} video(s)`);
    for (const it of items) {
      const id = it.id?.videoId;
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        id,
        title: (it.snippet?.title ?? "").trim(),
        description: (it.snippet?.description ?? "").slice(0, 600),
        url: `https://www.youtube.com/watch?v=${id}`,
        channel: it.snippet?.channelTitle ?? "",
        views: 0, likes: 0, comments: 0,
        publishedAt: it.snippet?.publishedAt ?? new Date().toISOString(),
      });
    }
    await sleep(300);
  }

  // Fill in view/like/comment counts (videos.list allows 50 ids per call).
  const ids = [...byId.keys()];
  for (const group of chunk(ids, 50)) {
    try {
      const stats = await ytGet("videos", { part: "statistics", id: group.join(",") }, key) as {
        items?: { id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[];
      };
      for (const it of stats.items ?? []) {
        const v = byId.get(it.id);
        if (!v) continue;
        v.views = Number(it.statistics?.viewCount ?? 0);
        v.likes = Number(it.statistics?.likeCount ?? 0);
        v.comments = Number(it.statistics?.commentCount ?? 0);
      }
    } catch (err) {
      console.warn(`  stats fetch failed for a batch: ${err instanceof Error ? err.message : err}`);
    }
  }

  const videos = [...byId.values()].filter((v) => v.title);
  videos.sort((a, b) => normalizeYtEngagement(b.views, b.likes, b.comments) - normalizeYtEngagement(a.views, a.likes, a.comments));
  return videos.slice(0, HOT_LIMIT);
}

const SYSTEM_PROMPT = `You extract specific, real, visitable places and events in Bengaluru (Bangalore), India from YouTube video titles and descriptions, to plot on a local map.

Extract ONLY a place/event when the video names a specific venue a person could go to: a named restaurant, cafe, bar, brewery, park, market, shop, museum, gallery, venue, or a specific dated event/festival. The name must be specific enough to geocode ("Toit", "Cubbon Park", "VV Puram Food Street").

Do NOT extract: general city discussion, vlogs with no named venue, real-estate/apartment content, generic areas alone ("Indiranagar"), companies/offices, clickbait lists with no actual venue names in the text, or places outside Bengaluru. Only extract venues the video recommends or showcases positively — skip venues that are the backdrop of news, complaints, or incidents.

For each kept place, choose the single best category from the allowed list, and set is_event=true only for time-bound events. post_number is the number shown before the video. Deduplicate within a video.

For "reason", write 2-3 informative sentences a local would find useful — what the place is, what it's known for, and why it's worth going (signature dishes, the vibe, what to order). Draw specifics from the video title/description; don't pad with generic filler. If detail is thin, keep it to what you can genuinely say.`;

function buildPrompt(videos: Video[], baseIndex: number): string {
  const numbered = videos
    .map((v, i) => `[${baseIndex + i}] ${v.title} (channel: ${v.channel})${v.description ? `\n${v.description}` : ""}`)
    .join("\n\n");
  return `Videos:\n\n${numbered}`;
}

function normalizeCategory(c: string, isEvent: boolean): Category {
  if (isEvent) return "event";
  return (CATEGORY_KEYS as string[]).includes(c) ? (c as Category) : "experience";
}

async function main() {
  const dryRunFlag = process.argv.includes("--dry-run");
  const ytKey = process.env.YOUTUBE_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!ytKey) {
    console.log("YOUTUBE_API_KEY unset — nothing to do. Add the secret to enable YouTube ingestion.");
    return;
  }
  const canWrite = Boolean(supabaseUrl && serviceKey);
  const canExtract = Boolean(geminiKey);
  const dryRun = dryRunFlag || !canWrite || !canExtract;

  console.log(`YouTube ingestion — ${dryRun ? "DRY RUN (no writes)" : "LIVE"}`);

  const videos = await fetchVideos(ytKey);
  console.log(`Fetched ${videos.length} video(s) (last ${LOOKBACK_DAYS}d, top by engagement).`);

  const supabase = canWrite ? createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false }, realtime: { transport: ws as unknown as WebSocketLikeConstructor } }) : null;

  let seenUrls = new Set<string>();
  let existingPlaces: { id: string; title: string; lat: number; lng: number }[] = [];
  if (supabase) {
    const { data: mentionRows } = await supabase.from("mentions").select("url").eq("platform", "youtube");
    seenUrls = new Set((mentionRows ?? []).map((m: { url: string | null }) => m.url).filter(Boolean) as string[]);
    const { data: placeRows } = await supabase.from("places").select("id, title, lat, lng").neq("status", "rejected");
    existingPlaces = (placeRows ?? []) as typeof existingPlaces;
  }

  const fresh = videos.filter((v) => !seenUrls.has(v.url));
  console.log(`${fresh.length} not yet processed.`);
  if (fresh.length === 0) return;

  if (!canExtract) {
    for (const v of fresh) console.log(`  • [${normalizeYtEngagement(v.views, v.likes, v.comments)}] ${v.title}`);
    return;
  }

  const ai = new GoogleGenAI({ apiKey: geminiKey });
  const candidates: { cand: Candidate; video: Video }[] = [];
  let base = 0;
  for (const group of chunk(fresh, CHUNK_SIZE)) {
    const extracted = await extractCandidates(ai, GEMINI_MODEL, SYSTEM_PROMPT, buildPrompt(group, base));
    for (const c of extracted) {
      const video = fresh[c.post_number];
      if (video) candidates.push({ cand: c, video });
    }
    base += group.length;
    await sleep(1000);
  }
  console.log(`Extracted ${candidates.length} candidate place(s).`);

  let mentionsAdded = 0;
  let placesCreated = 0;

  for (const { cand, video } of candidates) {
    const geo = await geocodeInBlr(cand.name);
    if (!geo) {
      console.log(`  ✗ "${cand.name}" — couldn't geocode inside Bengaluru`);
      continue;
    }

    const category = normalizeCategory(cand.category, cand.is_event);
    const engagement = normalizeYtEngagement(video.views, video.likes, video.comments);
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
          source_url: video.url,
          rating: enrich?.rating ?? null,
          rating_count: enrich?.ratingCount ?? null,
          price_level: enrich?.priceLevel ?? null,
          website: enrich?.website ?? null,
          status: "pending",
          source: "youtube",
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
          platform: "youtube",
          url: video.url,
          title: video.title,
          engagement_score: engagement,
          mentioned_at: video.publishedAt,
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
