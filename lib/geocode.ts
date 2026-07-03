// Free OSM geocoding via Nominatim, restricted to the Bengaluru region.
// Nominatim usage policy: max 1 req/sec — callers must debounce.

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

// viewbox = lng1,lat1,lng2,lat2 (left,top,right,bottom) around greater Bengaluru
const BLR_VIEWBOX = "77.35,13.20,77.85,12.75";

export async function searchBangalore(query: string): Promise<GeocodeResult[]> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&bounded=1` +
    `&viewbox=${BLR_VIEWBOX}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const rows: { display_name: string; lat: string; lon: string }[] = await res.json();
  return rows.map((r) => ({
    label: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}
