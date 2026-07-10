// Submission guardrails: location sanity, event-date sanity, duplicate matching.
// See BACKLOG.md → "Guardrails & edge cases". Policy for dupes: warn-and-allow.

// Greater Bengaluru bounding box — matches BLR_VIEWBOX in geocode.ts, padded a
// touch so edge suburbs the geocoder returns don't get rejected.
const BLR_BOUNDS = { latMin: 12.7, latMax: 13.25, lngMin: 77.3, lngMax: 77.9 };

export function isInBengaluru(lat: number, lng: number): boolean {
  return (
    lat >= BLR_BOUNDS.latMin && lat <= BLR_BOUNDS.latMax &&
    lng >= BLR_BOUNDS.lngMin && lng <= BLR_BOUNDS.lngMax
  );
}

// Returns an error message, or null if the dates are fine. Events that already
// ended, end-before-start, and absurd far-future dates are rejected.
export function validateEventDates(start: string, end: string): string | null {
  if (!start) return null; // required-ness is checked by the form
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  if (isNaN(s.getTime())) return "That start date doesn't look right.";
  if (e && isNaN(e.getTime())) return "That end date doesn't look right.";
  if (e && e < s) return "The event ends before it starts — check the dates.";
  const now = Date.now();
  if ((e ?? s).getTime() < now) return "That event is already over — events need a future (or ongoing) date.";
  const twoYears = now + 2 * 365 * 24 * 3600 * 1000;
  if (s.getTime() > twoYears) return "That start date is more than two years away — is it right?";
  return null;
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Fuzzy title match: exact after normalization, one contains the other, or
// most words overlap. Good enough to catch "La Casa" vs "La Casa Brewery".
export function titlesLookSame(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.min(ta.size, tb.size) >= 0.6;
}

// Among places already within the ~75m radius, pick the first whose title
// fuzzy-matches. Radius filtering happens in the query (fetchNearbyPlaces).
export function findDuplicate<T extends { title: string }>(title: string, nearby: T[]): T | null {
  return nearby.find((p) => titlesLookSame(title, p.title)) ?? null;
}

// Same place, same name after normalization (ignores punctuation/case/spacing).
export function titlesExactSame(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  return na.length > 0 && na === normalizeTitle(b);
}

// Ingestion dedupe. Two radii, because geocoding the same venue on different
// runs/sources can land the pins a few hundred metres apart:
//  • an EXACT normalized-name match counts as a dup within the wider radius
//    (catches geocode drift) — but stays tight enough not to merge distinct
//    branches of a chain across town;
//  • a fuzzy name match ("La Casa" vs "La Casa Brewery") only within the near
//    radius, where a loose name match is safe.
export function findNearbyMatch<T extends { title: string; lat: number; lng: number }>(
  name: string, lat: number, lng: number, places: T[],
  opts?: { fuzzyRadiusM?: number; exactRadiusM?: number },
): T | null {
  const fuzzyR = opts?.fuzzyRadiusM ?? 200;
  const exactR = opts?.exactRadiusM ?? 600;
  const within = (r: number) => {
    const dLat = r / 111_320;
    const dLng = r / (111_320 * Math.cos((lat * Math.PI) / 180));
    return places.filter((p) => Math.abs(p.lat - lat) <= dLat && Math.abs(p.lng - lng) <= dLng);
  };
  return within(exactR).find((p) => titlesExactSame(name, p.title))
    ?? findDuplicate(name, within(fuzzyR))
    ?? null;
}
