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

const SECTION_ORDER: Section[] = ["eat", "drink", "do", "see"];

// How many headline picks the letter aims for, and how much of it any one
// section may take (food outnumbers everything else, so it needs a ceiling).
export const TARGET_PICKS = 10;
export const MAX_PER_SECTION = 4;
export const MAX_EVENTS = 5;

export function isRealDescription(p: CuratablePlace): boolean {
  return p.description.trim().length >= 60;
}

// A place qualifies only if there's something to say (a real description) and a
// reason to trust it (community signal or a solid Google rating).
export function qualifies(p: CuratablePlace): boolean {
  const trusted = p.trending_score > 0 || p.vote_count > 0 || (p.rating ?? 0) >= 4.2;
  return isRealDescription(p) && trusted;
}

export interface Pick<T extends CuratablePlace> {
  place: T;
  section: Section;
  /** First pick of its section — renders the full section header. */
  lead: boolean;
  /** Compact "also on the radar" names; only ever set on a section's last pick. */
  alternates: T[];
}

export interface Curation<T extends CuratablePlace> {
  picks: Pick<T>[];
  events: T[];
}

/**
 * Builds a varied letter rather than a ranked dump: picks are drawn
 * round-robin across Eat / Drink / Do / See so consecutive cards change mood,
 * and within a section we avoid repeating an area until the area pool runs out.
 * Aims for `target` picks (default 10) and caps any one section at
 * MAX_PER_SECTION. Upcoming events follow as a compact list.
 */
export function curate<T extends CuratablePlace>(
  places: T[],
  { target = TARGET_PICKS, maxPerSection = MAX_PER_SECTION }: { target?: number; maxPerSection?: number } = {},
): Curation<T> {
  const now = Date.now();
  const events = places
    .filter((p) => p.category === "event" && new Date(p.event_end ?? p.event_start ?? 0).getTime() > now)
    .sort((a, b) => new Date(a.event_start ?? 0).getTime() - new Date(b.event_start ?? 0).getTime())
    .slice(0, MAX_EVENTS);

  const pools = new Map<Section, T[]>();
  for (const section of SECTION_ORDER) {
    pools.set(
      section,
      places
        .filter((p) => SECTIONS[section].categories.includes(p.category) && qualifies(p))
        // trending first; among the quiet ones, let Google ratings break the tie
        .sort((a, b) => b.trending_score - a.trending_score || (b.rating ?? 0) - (a.rating ?? 0)),
    );
  }

  const taken = new Set<string>();
  const usedAreas = new Set<string>();
  const picks: Pick<T>[] = [];
  const countBySection = new Map<Section, number>(SECTION_ORDER.map((s) => [s, 0]));

  // Round 0 fills one lead per section, then later rounds deepen each section.
  for (let round = 0; round < maxPerSection && picks.length < target; round++) {
    for (const section of SECTION_ORDER) {
      if (picks.length >= target) break;
      const pool = pools.get(section)!.filter((p) => !taken.has(p.id));
      if (pool.length === 0) continue;

      const fresh = pool.filter((p) => !p.area || !usedAreas.has(p.area));
      const candidates = fresh.length > 0 ? fresh : pool;
      // A lead card is mostly photo — prefer one that has an image.
      const best = (round === 0 ? candidates.find((p) => p.image_url) : undefined) ?? candidates[0];

      taken.add(best.id);
      if (best.area) usedAreas.add(best.area);
      const lead = countBySection.get(section) === 0;
      countBySection.set(section, countBySection.get(section)! + 1);
      picks.push({ place: best, section, lead, alternates: [] });
    }
  }

  // Runners-up hang off each section's last pick, so no name appears twice.
  for (const section of SECTION_ORDER) {
    const last = [...picks].reverse().find((p) => p.section === section);
    if (!last) continue;
    last.alternates = pools.get(section)!.filter((p) => !taken.has(p.id)).slice(0, 2);
  }

  return { picks, events };
}
