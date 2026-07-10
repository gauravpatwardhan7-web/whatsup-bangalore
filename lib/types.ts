import type { Category } from "./ds";

export interface Place {
  id: string;
  title: string;
  description: string;
  category: Category;
  lat: number;
  lng: number;
  address: string | null;
  area: string | null;
  image_url: string | null;      // cover photo (first of image_urls)
  image_urls?: string[] | null;  // all photos; optional for pre-migration rows/mocks
  source_url: string | null;
  event_start: string | null;
  event_end: string | null;
  status: "pending" | "approved" | "rejected";
  source: "curated" | "user" | "reddit" | "youtube" | "events_feed";
  created_by: string | null;
  created_at: string;
  vote_count: number;      // net score = upvotes − downvotes
  comment_count: number;
  my_vote: -1 | 0 | 1;     // this user's vote direction (0 = none)
  trending_score: number;
  // Google Places enrichment (migration 0009) — null when unknown.
  rating?: number | null;        // Google stars 0–5
  rating_count?: number | null;  // number of Google reviews
  price_level?: number | null;   // 0 (free) – 4 (very expensive)
  website?: string | null;       // official venue website
}

export interface PlaceComment {
  id: string;
  place_id: string;
  user_id: string;
  body: string;
  created_at: string;
  author_name: string | null;
  author_avatar: string | null;
}

export interface SessionUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export interface NewPlaceInput {
  title: string;
  description: string;
  category: Category;
  lat: number;
  lng: number;
  address: string | null;
  area: string | null;
  image_url: string | null;
  image_urls: string[];
  source_url: string | null;
  event_start: string | null;
  event_end: string | null;
}

export type SortMode = "trending" | "newest" | "loved";
