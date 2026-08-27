// People pick a part of town before they pick a place, so the map needs areas
// to filter by. The `area` column can't provide them — it's null on ~90% of
// rows and inconsistent where it isn't ("Lalbagh", "Outskirts", "Central
// Bengaluru" all appear) — so areas are derived from coordinates instead:
// every place has a trustworthy lat/lng, and newly ingested places get an area
// for free without a backfill or an extra LLM call.
//
// Each area is a hub point; a place belongs to the nearest hub within
// MAX_AREA_KM. Central hubs that read as one destination (MG Road, Church
// Street, Brigade Road, Cubbon Park) are deliberately merged into one.

export interface AreaHub {
  name: string;
  lat: number;
  lng: number;
}

// Only the handful of areas anyone in the city would name unprompted. Each
// one stands in for its whole side of town, so the smaller neighbourhoods fold
// into the nearest major (Chickpet into Central, Kammanahalli into
// Indiranagar, Basavanagudi and JP Nagar into Jayanagar, Hebbal into
// Malleshwaram, Marathahalli into Whitefield). Seven chips is a choice you can
// make at a glance; thirty was a list to read.
export const AREA_HUBS: AreaHub[] = [
  { name: "Central (MG Road)", lat: 12.9752, lng: 77.6055 },
  { name: "Indiranagar",       lat: 12.9784, lng: 77.6408 },
  { name: "Koramangala",       lat: 12.9352, lng: 77.6245 },
  { name: "HSR Layout",        lat: 12.9116, lng: 77.6389 },
  { name: "Jayanagar",         lat: 12.9250, lng: 77.5938 },
  { name: "Malleshwaram",      lat: 13.0033, lng: 77.5712 },
  { name: "Whitefield",        lat: 12.9698, lng: 77.7500 },
];

// Each hub now covers a whole side of the city, so the catchment is wide.
// Anything past this is genuinely out of town (Nandi Hills, Wonderla) and gets
// no area rather than a wrong one — it still shows on the map, it just isn't
// reachable from an area chip.
const MAX_AREA_KM = 8;

// Equirectangular approximation — plenty at city scale and far cheaper than
// haversine when it runs over every place on every filter change.
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const midLat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const x = (bLng - aLng) * Math.cos(midLat);
  const y = bLat - aLat;
  return Math.sqrt(x * x + y * y) * 111.32;
}

// The named area a place sits in, or null when it's outside all of them.
export function areaOf(place: { lat: number; lng: number }): string | null {
  let best: string | null = null;
  let bestKm = MAX_AREA_KM;
  for (const hub of AREA_HUBS) {
    const km = distanceKm(place.lat, place.lng, hub.lat, hub.lng);
    if (km < bestKm) {
      bestKm = km;
      best = hub.name;
    }
  }
  return best;
}
