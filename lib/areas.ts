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

export const AREA_HUBS: AreaHub[] = [
  { name: "Central (MG Road)", lat: 12.9752, lng: 77.6055 },
  { name: "Indiranagar",       lat: 12.9784, lng: 77.6408 },
  { name: "Koramangala",       lat: 12.9352, lng: 77.6245 },
  { name: "HSR Layout",        lat: 12.9116, lng: 77.6389 },
  { name: "BTM Layout",        lat: 12.9166, lng: 77.6101 },
  { name: "Jayanagar",         lat: 12.9250, lng: 77.5938 },
  { name: "JP Nagar",          lat: 12.9063, lng: 77.5857 },
  { name: "Basavanagudi",      lat: 12.9422, lng: 77.5731 },
  { name: "Banashankari",      lat: 12.9250, lng: 77.5460 },
  { name: "Malleshwaram",      lat: 13.0033, lng: 77.5712 },
  { name: "Rajajinagar",       lat: 12.9915, lng: 77.5520 },
  { name: "Vijayanagar",       lat: 12.9719, lng: 77.5300 },
  { name: "Sadashivanagar",    lat: 13.0068, lng: 77.5806 },
  { name: "Hebbal",            lat: 13.0358, lng: 77.5970 },
  { name: "RT Nagar",          lat: 13.0206, lng: 77.5945 },
  { name: "Yelahanka",         lat: 13.1007, lng: 77.5963 },
  { name: "Frazer Town",       lat: 12.9985, lng: 77.6150 },
  { name: "Ulsoor",            lat: 12.9819, lng: 77.6270 },
  { name: "Domlur",            lat: 12.9610, lng: 77.6380 },
  { name: "Kammanahalli",      lat: 13.0150, lng: 77.6400 },
  { name: "Hennur",            lat: 13.0420, lng: 77.6420 },
  { name: "Whitefield",        lat: 12.9698, lng: 77.7500 },
  { name: "Marathahalli",      lat: 12.9591, lng: 77.6974 },
  { name: "Bellandur",         lat: 12.9260, lng: 77.6762 },
  { name: "Sarjapur Road",     lat: 12.9010, lng: 77.6870 },
  { name: "Electronic City",   lat: 12.8452, lng: 77.6602 },
  { name: "Bannerghatta Road", lat: 12.8900, lng: 77.5970 },
  { name: "Chickpet",          lat: 12.9700, lng: 77.5760 },
  { name: "Yeshwanthpur",      lat: 13.0230, lng: 77.5500 },
  { name: "RR Nagar",          lat: 12.9250, lng: 77.5180 },
  { name: "Kengeri",           lat: 12.9160, lng: 77.4850 },
  { name: "Nagarbhavi",        lat: 12.9600, lng: 77.5100 },
];

// Bengaluru neighbourhoods run ~2–3 km across. 5 km keeps a far-flung place
// from being filed under a hub it's nowhere near — those get no area rather
// than a wrong one.
const MAX_AREA_KM = 5;

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
