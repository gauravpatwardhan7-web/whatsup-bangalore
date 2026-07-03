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
  image_url: string | null;
  source_url: string | null;
  event_start: string | null;
  event_end: string | null;
  status: "pending" | "approved" | "rejected";
  source: "curated" | "user" | "reddit" | "events_feed";
  created_by: string | null;
  created_at: string;
  vote_count: number;
  comment_count: number;
  voted_by_me: boolean;
  trending_score: number;
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
  source_url: string | null;
  event_start: string | null;
  event_end: string | null;
}

export type SortMode = "trending" | "newest" | "loved";
