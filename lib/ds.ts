// Design system ported from blr-neighborhood-explorer.
export const DS = {
  bg:       "#faf9f7",   // warm off-white
  card:     "#ffffff",   // pure white card surface
  border:   "#e8e0d8",   // warm gray border
  borderMd: "#d4c9be",   // medium warm border
  text:     "#1c1917",   // near-black
  textSub:  "#78716c",   // stone-500
  textMut:  "#a8a29e",   // stone-400
  accent:   "#1e40af",   // deep navy blue
  accentLt: "#3b5bd9",   // lighter navy
} as const;

export const CARD_SHADOW = "0 2px 8px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.03)";
export const FLOAT_SHADOW = "0 8px 30px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)";

export type Category =
  | "food" | "drinks" | "outdoors" | "art_culture"
  | "shopping" | "nightlife" | "experience" | "event";

export const CATEGORIES: Record<Category, { label: string; emoji: string; color: string; tint: string }> = {
  food:        { label: "Food",        emoji: "🍛", color: "#d97706", tint: "#fffbeb" },
  drinks:      { label: "Drinks",      emoji: "🍺", color: "#b45309", tint: "#faf7f2" },
  outdoors:    { label: "Outdoors",    emoji: "🌳", color: "#16a34a", tint: "#f5faf5" },
  art_culture: { label: "Art & Culture", emoji: "🎭", color: "#7c3aed", tint: "#f8f5fd" },
  shopping:    { label: "Shopping",    emoji: "🛍️", color: "#2563eb", tint: "#f3f8fd" },
  nightlife:   { label: "Nightlife",   emoji: "🌙", color: "#db2777", tint: "#fdf2f7" },
  experience:  { label: "Experience",  emoji: "✨", color: "#5e7d58", tint: "#eff3ec" },
  event:       { label: "Event",       emoji: "📅", color: "#dc2626", tint: "#fef2f2" },
};

// Live "buzz" — computed from the counts currently on screen, so the badge
// and glow always match what the user sees (no stale server snapshot).
// A comment weighs more than a vote (more effort). Server-side trending_score
// (time-decayed, + external mentions) still drives the initial fetch order;
// this drives the live visual tier and re-sort.
export function buzzScore(voteCount: number, commentCount: number): number {
  return voteCount + 1.5 * commentCount;
}

export interface BuzzTier {
  level: 0 | 1 | 2 | 3 | 4;
  label: string | null;
  badgeEmoji: string;
  color: string;      // badge text / accent
  badgeBg: string;
  badgeBorder: string;
  pinClass: string;   // css class on the pin visual
  pinColor: string;   // halo colour for the glow
}

// Five levels. Thresholds are deliberately reachable early (a young map is
// mostly quiet) but keep climbing as real activity stacks up.
const BUZZ_TIERS: (BuzzTier & { min: number })[] = [
  { min: 18, level: 4, label: "On fire",    badgeEmoji: "🔥", color: "#ffffff", badgeBg: "#dc2626", badgeBorder: "#dc2626", pinClass: "pin-l4", pinColor: "220,38,38" },
  { min: 9,  level: 3, label: "Buzzing",    badgeEmoji: "⚡", color: "#ffffff", badgeBg: "#ea580c", badgeBorder: "#ea580c", pinClass: "pin-l3", pinColor: "234,88,12" },
  { min: 4,  level: 2, label: "Trending",   badgeEmoji: "↗",  color: "#ea580c", badgeBg: "#fff7ed", badgeBorder: "#fed7aa", pinClass: "pin-l2", pinColor: "234,88,12" },
  { min: 1.5,level: 1, label: "Warming up", badgeEmoji: "•",  color: "#b45309", badgeBg: "#fffbeb", badgeBorder: "#fde68a", pinClass: "pin-l1", pinColor: "217,119,6" },
  // -Infinity floor: net score can go negative now that downvotes exist.
  { min: -Infinity, level: 0, label: null,  badgeEmoji: "",   color: "",        badgeBg: "",        badgeBorder: "",        pinClass: "",       pinColor: "" },
];

export function buzzTier(score: number): BuzzTier {
  return BUZZ_TIERS.find((t) => score >= t.min)!;
}

export function placeTier(place: { vote_count: number; comment_count: number }): BuzzTier {
  return buzzTier(buzzScore(place.vote_count, place.comment_count));
}

export const BLR_CENTER: [number, number] = [77.5946, 12.9716];
