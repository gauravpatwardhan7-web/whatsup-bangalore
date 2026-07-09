/**
 * Google Places API (New) wrapper — SERVER-SIDE ONLY (scripts / server code).
 * Never import from client components: the key must not reach the browser.
 *
 * Key resolution is swappable by design: GOOGLE_PLACES_API_KEY (the real key,
 * when you have one) wins over PLACES_API_DEMO_KEY (the placeholder demo key
 * in .env.local — requests with it will fail, which callers must tolerate).
 */

const PLACES_BASE = "https://places.googleapis.com/v1";

export function placesApiKey(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.PLACES_API_DEMO_KEY || null;
}

export interface FoundPlace {
  id: string;
  displayName: string;
  formattedAddress: string | null;
  lat: number;
  lng: number;
  photoName: string | null; // resource name for the photo media endpoint
}

// Text Search (New) for a place in Bengaluru. Returns the top match or null.
export async function findPlace(query: string): Promise<FoundPlace | null> {
  const key = placesApiKey();
  if (!key) return null;
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.photos",
    },
    body: JSON.stringify({
      textQuery: `${query}, Bengaluru, India`,
      // Bias hard to Bengaluru so same-named venues elsewhere don't win.
      locationBias: {
        circle: { center: { latitude: 12.9716, longitude: 77.5946 }, radius: 30000 },
      },
      maxResultCount: 1,
    }),
  });
  if (!res.ok) {
    throw new Error(`Places searchText failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const json = await res.json() as {
    places?: {
      id: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
      photos?: { name: string }[];
    }[];
  };
  const p = json.places?.[0];
  if (!p) return null;
  return {
    id: p.id,
    displayName: p.displayName?.text ?? query,
    formattedAddress: p.formattedAddress ?? null,
    lat: p.location?.latitude ?? 0,
    lng: p.location?.longitude ?? 0,
    photoName: p.photos?.[0]?.name ?? null,
  };
}

// Download the photo bytes for a photo resource name (from findPlace).
// Callers should re-host the bytes (e.g. Supabase Storage) rather than serve a
// Google URL — that keeps the key out of any public URL and the image stable.
export async function fetchPlacePhoto(photoName: string, maxWidthPx = 800): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const key = placesApiKey();
  if (!key) throw new Error("No Places API key configured.");
  const res = await fetch(
    `${PLACES_BASE}/${photoName}/media?maxWidthPx=${maxWidthPx}&key=${key}`,
    { redirect: "follow" },
  );
  if (!res.ok) {
    throw new Error(`Places photo fetch failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return { bytes: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "image/jpeg" };
}
