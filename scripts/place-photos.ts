/**
 * Download a place's Google Places photos and store them in the Supabase
 * `place-images` bucket, so the app serves our own stable URLs (no Google URL
 * or API key exposed to the client). Shared by ingestion (new places) and
 * refresh-place-photos.ts (backfill).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPlacePhoto } from "../lib/places-api";

// Store up to `max` photos for a place; returns the public URLs (cover first).
// Best-effort: a photo that fails to download/upload is skipped, never throws.
export async function storePlacePhotos(
  supabase: SupabaseClient,
  placeId: string,
  photoNames: string[],
  max = 3,
): Promise<string[]> {
  const urls: string[] = [];
  for (const [i, name] of photoNames.slice(0, max).entries()) {
    try {
      const { bytes, contentType } = await fetchPlacePhoto(name);
      const ext = contentType.includes("png") ? "png" : "jpg";
      const path = `places-api/${placeId}-${i}.${ext}`;
      const { error } = await supabase.storage
        .from("place-images")
        .upload(path, bytes, { contentType, cacheControl: "31536000", upsert: true });
      if (error) throw error;
      urls.push(supabase.storage.from("place-images").getPublicUrl(path).data.publicUrl);
    } catch (err) {
      console.warn(`    photo ${i + 1} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return urls;
}
