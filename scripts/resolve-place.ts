/**
 * Shared place resolution for the ingestion scripts: turn an extracted name
 * into a Bengaluru location, and (for new places) enrich it from Google Places.
 *
 * Geocoding: Nominatim/OpenStreetMap first (free), Google Places as a fallback
 * — OSM is thin on small local institutions (e.g. Shivaji Military Hotel), which
 * Google knows. The Places fallback needs GOOGLE_PLACES_API_KEY (or the demo
 * key); without it, we just get whatever Nominatim returns.
 *
 * Enrichment (rating, price, website, Google's editorial description, and a
 * permanently-closed check) uses one Atmosphere-tier Places call — only made
 * when creating a NEW place, so cost stays negligible.
 */

import { searchBangalore } from "../lib/geocode";
import { isInBengaluru } from "../lib/guardrails";
import { findPlace, placesApiKey } from "../lib/places-api";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ResolvedLocation {
  lat: number;
  lng: number;
  address: string | null;
}

// Geocode a name inside Bengaluru. Nominatim first; on a miss, Google Places.
// Returns null when neither finds an in-BLR match.
export async function geocodeInBlr(name: string): Promise<ResolvedLocation | null> {
  const results = await searchBangalore(name);
  await sleep(1100); // Nominatim usage policy: max 1 req/sec
  const hit = results.find((r) => isInBengaluru(r.lat, r.lng));
  if (hit) {
    return { lat: hit.lat, lng: hit.lng, address: hit.label.split(",").slice(0, 2).join(",") };
  }
  // Nominatim missed — fall back to Google Places (basic, cheaper tier).
  if (!placesApiKey()) return null;
  try {
    const found = await findPlace(name); // basic mask, no enrichment
    if (found && isInBengaluru(found.lat, found.lng)) {
      return { lat: found.lat, lng: found.lng, address: found.formattedAddress };
    }
  } catch (err) {
    console.warn(`  Places geocode fallback failed for "${name}": ${err instanceof Error ? err.message : err}`);
  }
  return null;
}

export interface Enrichment {
  description: string | null; // Google's editorial blurb, if any
  rating: number | null;
  ratingCount: number | null;
  priceLevel: number | null;
  website: string | null;
  permanentlyClosed: boolean;
  photoNames: string[]; // Places photo resource names (up to 3), for storePlacePhotos
}

// One enriched Places lookup for a place we're about to create. Non-fatal:
// returns null when there's no key, no match, or the call fails.
export async function enrichNewPlace(name: string): Promise<Enrichment | null> {
  if (!placesApiKey()) return null;
  try {
    const found = await findPlace(name, true); // enriched mask
    if (!found) return null;
    return {
      description: found.editorialSummary,
      rating: found.rating,
      ratingCount: found.ratingCount,
      priceLevel: found.priceLevel,
      website: found.website,
      permanentlyClosed: found.businessStatus === "CLOSED_PERMANENTLY",
      photoNames: found.photoNames,
    };
  } catch (err) {
    console.warn(`  Places enrichment failed for "${name}": ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
