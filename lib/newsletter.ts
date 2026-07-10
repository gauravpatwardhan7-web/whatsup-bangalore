// Shared newsletter curation — used by both the weekly email
// (scripts/send-newsletter.ts) and the on-site /newsletter page, so the two
// never drift. Pure logic only (no Node or browser APIs, no LLM calls).

// The minimal shape curation needs. Both the app's `Place` and the email
// script's `TrendingPlace` satisfy this structurally.
export interface CuratablePlace {
  id: string;
  title: string;
  description: string;
  category: string;
  area: string | null;
  image_url: string | null;
  rating?: number | null;
  vote_count: number;
  trending_score: number;
  event_start: string | null;
  event_end: string | null;
}

export type Section = "eat" | "drink" | "do" | "see";

export const SECTIONS: Record<Section, { label: string; categories: string[]; lede: string }> = {
  eat:   { label: "Eat",   categories: ["food"],                              lede: "Where to point your appetite" },
  drink: { label: "Drink", categories: ["drinks", "nightlife"],               lede: "For the evening" },
  do:    { label: "Do",    categories: ["outdoors", "experience", "shopping"], lede: "Get out of the house" },
  see:   { label: "See",   categories: ["art_culture"],                        lede: "Culture fix" },
};

export function isRealDescription(p: CuratablePlace): boolean {
  return p.description.trim().length >= 60;
}

// A place qualifies only if there's something to say (a real description) and a
// reason to trust it (community signal or a solid Google rating).
export function qualifies(p: CuratablePlace): boolean {
  const trusted = p.trending_score > 0 || p.vote_count > 0 || (p.rating ?? 0) >= 4.2;
  return isRealDescription(p) && trusted;
}

export interface Curation<T extends CuratablePlace> {
  picks: { place: T; section: Section }[];
  runnersUp: Partial<Record<Section, T[]>>;
  events: T[];
}

// One headline pick per section plus up to two compact runners-up — not a
// ranked dump — plus upcoming events sorted by start.
export function curate<T extends CuratablePlace>(places: T[]): Curation<T> {
  const now = Date.now();
  const events = places
    .filter((p) => p.category === "event" && new Date(p.event_end ?? p.event_start ?? 0).getTime() > now)
    .sort((a, b) => new Date(a.event_start ?? 0).getTime() - new Date(b.event_start ?? 0).getTime())
    .slice(0, 3);

  const picks: { place: T; section: Section }[] = [];
  const runnersUp: Partial<Record<Section, T[]>> = {};
  for (const [section, def] of Object.entries(SECTIONS) as [Section, (typeof SECTIONS)[Section]][]) {
    const pool = places
      .filter((p) => def.categories.includes(p.category) && qualifies(p))
      // trending first; among the quiet ones, let Google ratings break the tie
      .sort((a, b) => b.trending_score - a.trending_score || (b.rating ?? 0) - (a.rating ?? 0));
    // prefer a pick with a photo — a headline card without one falls flat
    const best = pool.find((p) => p.image_url) ?? pool[0];
    if (best) {
      picks.push({ place: best, section });
      runnersUp[section] = pool.filter((p) => p.id !== best.id).slice(0, 2);
    }
  }
  return { picks, runnersUp, events };
}
