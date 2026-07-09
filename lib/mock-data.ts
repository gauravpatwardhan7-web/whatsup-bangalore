import type { Place, PlaceComment } from "./types";

// Mirrors supabase/seed.sql so the app is alive before Supabase is set up.
// Vote counts / trending scores are invented to demo the glow tiers.

function daysFromNow(d: number, h = 0): string {
  const t = new Date();
  t.setDate(t.getDate() + d);
  t.setHours(h, 0, 0, 0);
  return t.toISOString();
}

// Next occurrence of a weekday (0=Sun..6=Sat), so demo events land on the coming weekend.
function nextWeekday(dow: number, h: number): string {
  const t = new Date();
  const delta = (dow - t.getDay() + 7) % 7 || 7;
  t.setDate(t.getDate() + delta);
  t.setHours(h, 0, 0, 0);
  return t.toISOString();
}

const base = {
  address: null as string | null,
  image_url: null as string | null,
  source_url: null as string | null,
  event_start: null as string | null,
  event_end: null as string | null,
  status: "approved" as const,
  source: "curated" as const,
  created_by: null,
  created_at: daysFromNow(-20),
  my_vote: 0 as -1 | 0 | 1,
};

export const MOCK_PLACES: Place[] = [
  { ...base, id: "m1", image_url: "https://picsum.photos/seed/mock-101/600/400", title: "Toit Brewpub", category: "drinks", lat: 12.9718, lng: 77.6404, area: "Indiranagar",
    description: "The Indiranagar institution. Wood-fired pizzas, the Toit Weiss, and a wait on weekends that is somehow always worth it.",
    source_url: "https://toit.in", vote_count: 42, comment_count: 8, trending_score: 9.4 },
  { ...base, id: "m2", image_url: "https://picsum.photos/seed/mock-102/600/400", title: "VV Puram Food Street", category: "food", lat: 12.9457, lng: 77.5736, area: "Basavanagudi",
    description: "Thindi Beedi — one lane, a hundred stalls. Dosa, obbattu, gulkand, congress bun. Go hungry, go after 6pm.",
    vote_count: 35, comment_count: 12, trending_score: 8.1 },
  { ...base, id: "m3", image_url: "https://picsum.photos/seed/mock-103/600/400", title: "Blossom Book House", category: "shopping", lat: 12.9757, lng: 77.6011, area: "MG Road",
    description: "Three floors of second-hand books stacked to the ceiling on Church Street. You will lose two hours here minimum.",
    vote_count: 18, comment_count: 4, trending_score: 3.2 },
  { ...base, id: "m4", image_url: "https://picsum.photos/seed/mock-104/600/400", title: "Cubbon Park", category: "outdoors", lat: 12.9763, lng: 77.5929, area: "Central Bengaluru",
    description: "300 acres of green in the middle of the city. Cubbon Reads on Saturday mornings, dog park energy on Sundays.",
    vote_count: 27, comment_count: 6, trending_score: 5.6 },
  { ...base, id: "m5", image_url: "https://picsum.photos/seed/mock-105/600/400", title: "Lalbagh Botanical Garden", category: "outdoors", lat: 12.9507, lng: 77.5848, area: "Lalbagh",
    description: "240-year-old garden with a glasshouse, a 3-billion-year-old rock, and the best sunrise walk in south Bengaluru.",
    vote_count: 14, comment_count: 2, trending_score: 1.4 },
  { ...base, id: "m6", image_url: "https://picsum.photos/seed/mock-106/600/400", title: "The Rameshwaram Cafe", category: "food", lat: 12.9698, lng: 77.6383, area: "Indiranagar",
    description: "The ghee podi idli that broke the internet. Expect a queue; it moves fast. Cash-counter chaos is part of the experience.",
    vote_count: 51, comment_count: 15, trending_score: 11.2 },
  { ...base, id: "m7", image_url: "https://picsum.photos/seed/mock-107/600/400", title: "Museum of Art & Photography (MAP)", category: "art_culture", lat: 12.9727, lng: 77.5966, area: "Central Bengaluru",
    description: "World-class private art museum on Kasturba Road. Rotating exhibitions, great rooftop café, free entry on some evenings.",
    source_url: "https://map-india.org", vote_count: 12, comment_count: 3, trending_score: 2.5 },
  { ...base, id: "m8", image_url: "https://picsum.photos/seed/mock-108/600/400", title: "Byg Brewski Brewing Company", category: "drinks", lat: 13.0459, lng: 77.6486, area: "Hennur",
    description: "One of the biggest brewpubs in Asia — lakeside seating, live gigs, and a menu longer than your weekend.",
    vote_count: 22, comment_count: 5, trending_score: 4.0 },
  { ...base, id: "m9", image_url: "https://picsum.photos/seed/mock-109/600/400", title: "Commercial Street", category: "shopping", lat: 12.9822, lng: 77.6089, area: "Shivajinagar",
    description: "The OG shopping crawl: fabric, footwear, filter coffee breaks. Bargain hard, then reward yourself at Albert Bakery nearby.",
    vote_count: 9, comment_count: 1, trending_score: 0.8 },
  { ...base, id: "m10", image_url: "https://picsum.photos/seed/mock-110/600/400", title: "Nandi Hills Sunrise", category: "experience", lat: 13.3702, lng: 77.6835, area: "Outskirts",
    description: "The 4:30am club. Ride out, catch the sea of clouds at sunrise, breakfast in Chikkaballapur on the way back.",
    vote_count: 31, comment_count: 9, trending_score: 6.8 },
  { ...base, id: "m11", image_url: "https://picsum.photos/seed/mock-111/600/400", title: "Church Street Social", category: "nightlife", lat: 12.9752, lng: 77.6047, area: "MG Road",
    description: "Church Street's living room — work-from-café by day, gigs and cocktails by night, people-watching always.",
    vote_count: 16, comment_count: 3, trending_score: 2.9 },
  { ...base, id: "m12", image_url: "https://picsum.photos/seed/mock-112/600/400", title: "The Bier Library", category: "drinks", lat: 12.9349, lng: 77.6301, area: "Koramangala",
    description: "Koramangala's craft-beer sanctuary. Belgian-style brews, open-air deck, quieter than the 100ft Road crowd.",
    vote_count: 13, comment_count: 2, trending_score: 1.9 },
  { ...base, id: "m13", image_url: "https://picsum.photos/seed/mock-113/600/400", title: "Ranga Shankara", category: "art_culture", lat: 12.9092, lng: 77.5857, area: "JP Nagar",
    description: "A play a day, 365 days a year. The heart of Bengaluru theatre — ₹200 tickets, world-class productions.",
    source_url: "https://rangashankara.org", vote_count: 11, comment_count: 4, trending_score: 2.2 },
  { ...base, id: "m14", image_url: "https://picsum.photos/seed/mock-114/600/400", title: "Sunday Soul Sante", category: "event", lat: 13.0069, lng: 77.5924, area: "Jayamahal",
    description: "Flea market carnival: 300+ indie brands, food trucks, live music. The plan-your-Sunday default.",
    source_url: "https://soulsante.in", event_start: nextWeekday(0, 10), event_end: nextWeekday(0, 20),
    vote_count: 24, comment_count: 7, trending_score: 7.3 },
  { ...base, id: "m15", image_url: "https://picsum.photos/seed/mock-115/600/400", title: "Gig Night at Fandom", category: "event", lat: 12.9337, lng: 77.6141, area: "Koramangala",
    description: "Indie and metal gigs at Gilly's Redefined rooftop. Check the lineup — someone good is always passing through.",
    source_url: "https://insider.in", event_start: nextWeekday(6, 19), event_end: nextWeekday(6, 23),
    vote_count: 19, comment_count: 5, trending_score: 6.1 },
  { ...base, id: "m16", image_url: "https://picsum.photos/seed/mock-116/600/400", title: "Corner House Ice Cream", category: "food", lat: 12.9668, lng: 77.6069, area: "Richmond Town",
    description: "Death by Chocolate. That's it. That's the description.",
    vote_count: 29, comment_count: 6, trending_score: 4.9 },
];

export const MOCK_COMMENTS: PlaceComment[] = [
  { id: "c1", place_id: "m6", user_id: "u1", body: "Went at 8am on Sunday — 20 min queue but the podi idli is genuinely worth the hype.", created_at: daysFromNow(-2), author_name: "Ananya", author_avatar: null },
  { id: "c2", place_id: "m6", user_id: "u2", body: "Pro tip: the Thindi combo is better value than ordering separately.", created_at: daysFromNow(-1), author_name: "Rohan", author_avatar: null },
  { id: "c3", place_id: "m1", user_id: "u3", body: "Weekday evenings are the move. Weekends are a 45-min wait.", created_at: daysFromNow(-3), author_name: "Priya", author_avatar: null },
  { id: "c4", place_id: "m14", user_id: "u4", body: "Last edition was great — carry cash, some stalls don't do UPI.", created_at: daysFromNow(-4), author_name: "Karthik", author_avatar: null },
];
