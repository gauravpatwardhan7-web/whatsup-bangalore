/**
 * Replace placeholder images with the real venue photo from Google Places.
 *
 * For each approved place still carrying a placeholder image (picsum/loremflickr)
 * or no image: Text Search the venue on Google Places → download its top photo →
 * upload to the Supabase `place-images` bucket (so the image is permanently ours,
 * no Google URL/key exposure) → point image_url at it.
 *
 * The key is swappable: set GOOGLE_PLACES_API_KEY when you have a real one;
 * until then the PLACES_API_DEMO_KEY placeholder is picked up and requests will
 * simply fail per-place (logged, non-fatal) — run it again with a real key.
 *
 * Usage:
 *   npx tsx scripts/refresh-place-photos.ts            # live
 *   npx tsx scripts/refresh-place-photos.ts --dry-run  # look up photos, no writes
 *
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 *      GOOGLE_PLACES_API_KEY (or PLACES_API_DEMO_KEY).
 */

import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws"; // realtime transport: Node 20 lacks native WebSocket (unused here, but the client insists)
import { findPlace, fetchPlacePhoto, placesApiKey } from "../lib/places-api";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isPlaceholder(url: string | null): boolean {
  return !url || url.startsWith("https://picsum.photos/") || url.startsWith("https://loremflickr.com/");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  // --limit N: cap how many places get processed (e.g. a small cost-probe run).
  const limitArg = process.argv[process.argv.indexOf("--limit") + 1];
  const limit = process.argv.includes("--limit") ? Math.max(1, Number(limitArg) || 1) : Infinity;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!placesApiKey()) {
    console.log("No Places API key (GOOGLE_PLACES_API_KEY / PLACES_API_DEMO_KEY) — nothing to do.");
    return;
  }
  if (!supabaseUrl || !serviceKey) {
    console.log("Supabase service-role env unset — cannot read/write places.");
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false }, realtime: { transport: ws } });
  const { data: places, error } = await supabase
    .from("places")
    .select("id, title, area, image_url")
    .neq("status", "rejected");
  if (error) throw error;

  let targets = (places ?? []).filter((p) => isPlaceholder(p.image_url));
  console.log(`${targets.length} place(s) with placeholder images${dryRun ? " (dry run)" : ""}.`);
  if (targets.length > limit) {
    targets = targets.slice(0, limit);
    console.log(`Processing the first ${targets.length} (--limit).`);
  }

  let updated = 0;
  for (const place of targets) {
    try {
      const found = await findPlace(place.area ? `${place.title} ${place.area}` : place.title);
      if (!found?.photoName) {
        console.log(`  ✗ "${place.title}" — no Places match/photo`);
        continue;
      }
      if (dryRun) {
        console.log(`  ~ "${place.title}" → ${found.displayName} (photo available)`);
        continue;
      }
      const { bytes, contentType } = await fetchPlacePhoto(found.photoName);
      const ext = contentType.includes("png") ? "png" : "jpg";
      const path = `places-api/${place.id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("place-images")
        .upload(path, bytes, { contentType, cacheControl: "31536000", upsert: true });
      if (upErr) throw upErr;
      const publicUrl = supabase.storage.from("place-images").getPublicUrl(path).data.publicUrl;
      const { error: dbErr } = await supabase
        .from("places")
        .update({ image_url: publicUrl, image_urls: [publicUrl] })
        .eq("id", place.id);
      if (dbErr) throw dbErr;
      updated++;
      console.log(`  ✓ "${place.title}" — real photo set`);
    } catch (err) {
      console.log(`  ✗ "${place.title}" — ${err instanceof Error ? err.message : err}`);
    }
    await sleep(300); // gentle on the Places quota
  }
  console.log(`\nDone. ${updated} place photo(s) updated.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
