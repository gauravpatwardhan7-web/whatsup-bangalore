// Design system ported from blr-neighborhood-explorer.
export const DS = {
  bg:       "#faf9f7",   // warm off-white
  card:     "#ffffff",   // pure white card surface
  border:   "#e8e0d8",   // warm gray border
  borderMd: "#d4c9be",   // medium warm border
  text:     "#1c1917",   // near-black
  textSub:  "#78716c",   // stone-500
  textMut:  "#a8a29e",   // stone-400
  accent:   "#c4622d",   // terracotta
  accentLt: "#e07a4a",   // lighter terracotta
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
  nightlife:   { label: "Nightlife",   emoji: "🌙", color: "#db2777", tint: "#fdf6f3" },
  experience:  { label: "Experience",  emoji: "✨", color: "#c4622d", tint: "#fdf6f3" },
  event:       { label: "Event",       emoji: "📅", color: "#dc2626", tint: "#fef2f2" },
};

// Trending tiers drive pin glow. Thresholds are on trending_score
// (time-decayed votes + comments + external buzz over 14 days).
export function trendingTier(score: number): "hot" | "warm" | "none" {
  if (score >= 6) return "hot";
  if (score >= 2) return "warm";
  return "none";
}

export const BLR_CENTER: [number, number] = [77.5946, 12.9716];
