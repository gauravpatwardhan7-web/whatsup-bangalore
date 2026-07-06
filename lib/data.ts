"use client";

import { MOCK_MODE, supabaseBrowser } from "./supabase/client";
import { MOCK_COMMENTS, MOCK_PLACES } from "./mock-data";
import { compressImage } from "./image";
import type { NewPlaceInput, Place, PlaceComment, SessionUser } from "./types";

// ── mock state (in-memory, session only) ────────────────────────────────────
let mockPlaces: Place[] = MOCK_PLACES.map((p) => ({ ...p }));
let mockComments: PlaceComment[] = MOCK_COMMENTS.map((c) => ({ ...c }));
const MOCK_USER: SessionUser = { id: "mock-user", name: "You (demo)", avatarUrl: null, isAdmin: true };

// ── session ──────────────────────────────────────────────────────────────────
export async function getSessionUser(): Promise<SessionUser | null> {
  if (MOCK_MODE) return MOCK_USER;
  const sb = supabaseBrowser();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from("profiles").select("display_name, avatar_url, is_admin").eq("id", user.id).single();
  return {
    id: user.id,
    name: profile?.display_name ?? user.email ?? "User",
    avatarUrl: profile?.avatar_url ?? null,
    isAdmin: profile?.is_admin ?? false,
  };
}

export async function signInWithGoogle(): Promise<void> {
  if (MOCK_MODE) return;
  const sb = supabaseBrowser();
  await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
}

export async function signOut(): Promise<void> {
  if (MOCK_MODE) return;
  await supabaseBrowser().auth.signOut();
}

// ── places ───────────────────────────────────────────────────────────────────
export async function fetchPlaces(): Promise<Place[]> {
  if (MOCK_MODE) return mockPlaces.filter((p) => p.status === "approved");
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("places_with_stats")
    .select("*")
    .eq("status", "approved")
    .order("trending_score", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Place[];
}

// Fresh live counts for a single place (used by the realtime refresh).
export interface PlaceStats {
  vote_count: number;
  comment_count: number;
  my_vote: -1 | 0 | 1;
  trending_score: number;
}

export async function fetchPlaceStats(placeId: string): Promise<PlaceStats | null> {
  if (MOCK_MODE) {
    const p = mockPlaces.find((x) => x.id === placeId);
    return p ? { vote_count: p.vote_count, comment_count: p.comment_count, my_vote: p.my_vote, trending_score: p.trending_score } : null;
  }
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("places_with_stats")
    .select("vote_count, comment_count, my_vote, trending_score")
    .eq("id", placeId)
    .single();
  if (error) return null;
  return data as PlaceStats;
}

// Subscribe to all vote/comment changes; calls back with the affected place_id.
// Returns an unsubscribe function. No-op in mock mode.
export function subscribeToActivity(onChange: (placeId: string) => void): () => void {
  if (MOCK_MODE) return () => {};
  const sb = supabaseBrowser();
  // On DELETE, payload.new is an empty object (not null), so `new ?? old`
  // wrongly picks it — read place_id from whichever side actually has it.
  const placeIdOf = (payload: { new?: unknown; old?: unknown }): string | undefined => {
    const n = payload.new as { place_id?: string } | undefined;
    const o = payload.old as { place_id?: string } | undefined;
    return n?.place_id ?? o?.place_id;
  };
  const channel = sb
    .channel("activity")
    .on("postgres_changes", { event: "*", schema: "public", table: "votes" },
      (payload) => { const id = placeIdOf(payload); if (id) onChange(id); })
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" },
      (payload) => { const id = placeIdOf(payload); if (id) onChange(id); })
    .subscribe();
  return () => { sb.removeChannel(channel); };
}

// Cast a vote in `direction` (1 = up, -1 = down). Clicking the same direction
// again toggles it off (back to no vote).
export async function setVote(place: Place, direction: 1 | -1): Promise<void> {
  if (MOCK_MODE) {
    mockPlaces = mockPlaces.map((p) => {
      if (p.id !== place.id) return p;
      const next: -1 | 0 | 1 = p.my_vote === direction ? 0 : direction;
      return { ...p, my_vote: next, vote_count: p.vote_count + (next - p.my_vote) };
    });
    return;
  }
  const sb = supabaseBrowser();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("not signed in");
  if (place.my_vote === direction) {
    // Toggle off.
    const { error } = await sb.from("votes").delete().eq("place_id", place.id).eq("user_id", user.id);
    if (error) throw error;
  } else {
    // Set/flip direction (upsert on the (place_id, user_id) primary key).
    const { error } = await sb.from("votes").upsert(
      { place_id: place.id, user_id: user.id, value: direction },
      { onConflict: "place_id,user_id" }
    );
    if (error) throw error;
  }
}

// Places within ~radiusM of a point (bounding-box approximation), used for
// duplicate detection on submit. Excludes rejected; RLS already limits which
// pending rows are visible.
export interface NearbyPlace {
  id: string;
  title: string;
  lat: number;
  lng: number;
  status: Place["status"];
}

export async function fetchNearbyPlaces(lat: number, lng: number, radiusM = 75): Promise<NearbyPlace[]> {
  const dLat = radiusM / 111_320; // metres per degree latitude
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const inBox = (p: { lat: number; lng: number }) =>
    Math.abs(p.lat - lat) <= dLat && Math.abs(p.lng - lng) <= dLng;
  if (MOCK_MODE) {
    return mockPlaces.filter((p) => p.status !== "rejected" && inBox(p));
  }
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("places")
    .select("id, title, lat, lng, status")
    .neq("status", "rejected")
    .gte("lat", lat - dLat).lte("lat", lat + dLat)
    .gte("lng", lng - dLng).lte("lng", lng + dLng);
  if (error) throw error;
  return (data ?? []) as NearbyPlace[];
}

export async function submitPlace(input: NewPlaceInput, user: SessionUser): Promise<"approved" | "pending"> {
  if (MOCK_MODE) {
    mockPlaces = [{
      ...input,
      id: `mock-${Date.now()}`,
      status: "approved",
      source: "user",
      created_by: MOCK_USER.id,
      created_at: new Date().toISOString(),
      vote_count: 0,
      comment_count: 0,
      my_vote: 0,
      trending_score: 0,
    }, ...mockPlaces];
    return "approved";
  }
  const sb = supabaseBrowser();
  const status = user.isAdmin ? "approved" : "pending";
  const { error } = await sb.from("places").insert({ ...input, status, created_by: user.id });
  if (error) throw error;
  return status;
}

// Edit an existing place. Authors may edit their own; admins may edit any
// (enforced by RLS). Non-admin edits can't change moderation status (DB trigger).
export async function updatePlace(placeId: string, input: NewPlaceInput): Promise<void> {
  if (MOCK_MODE) {
    mockPlaces = mockPlaces.map((p) => (p.id === placeId ? { ...p, ...input } : p));
    return;
  }
  const sb = supabaseBrowser();
  const { error } = await sb.from("places").update(input).eq("id", placeId);
  if (error) throw error;
}

// ── images ───────────────────────────────────────────────────────────────────
export async function uploadImage(rawFile: File, user: SessionUser): Promise<string> {
  // Phone photos routinely exceed 5 MB — compress client-side before upload.
  const file = await compressImage(rawFile);
  if (MOCK_MODE) {
    // Demo mode: inline the image as a data URL (survives only this session).
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Couldn't read the image."));
      reader.readAsDataURL(file);
    });
  }
  const sb = supabaseBrowser();
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from("place-images").upload(path, file, { cacheControl: "31536000" });
  if (error) throw error;
  return sb.storage.from("place-images").getPublicUrl(path).data.publicUrl;
}

// ── comments ─────────────────────────────────────────────────────────────────
export async function fetchComments(placeId: string): Promise<PlaceComment[]> {
  if (MOCK_MODE) return mockComments.filter((c) => c.place_id === placeId);
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("comments")
    .select("id, place_id, user_id, body, created_at, profiles(display_name, avatar_url)")
    .eq("place_id", placeId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => {
    const profile = c.profiles as unknown as { display_name: string | null; avatar_url: string | null } | null;
    return {
      id: c.id, place_id: c.place_id, user_id: c.user_id, body: c.body, created_at: c.created_at,
      author_name: profile?.display_name ?? null,
      author_avatar: profile?.avatar_url ?? null,
    };
  });
}

export async function addComment(placeId: string, body: string, user: SessionUser): Promise<PlaceComment> {
  if (MOCK_MODE) {
    const comment: PlaceComment = {
      id: `mockc-${Date.now()}`, place_id: placeId, user_id: user.id, body,
      created_at: new Date().toISOString(), author_name: user.name, author_avatar: user.avatarUrl,
    };
    mockComments = [...mockComments, comment];
    mockPlaces = mockPlaces.map((p) => p.id === placeId ? { ...p, comment_count: p.comment_count + 1 } : p);
    return comment;
  }
  const sb = supabaseBrowser();
  const { data, error } = await sb
    .from("comments")
    .insert({ place_id: placeId, user_id: user.id, body })
    .select("id, place_id, user_id, body, created_at")
    .single();
  if (error) throw error;
  return { ...data, author_name: user.name, author_avatar: user.avatarUrl };
}

// ── admin ────────────────────────────────────────────────────────────────────
export async function fetchAllPlacesForAdmin(): Promise<Place[]> {
  if (MOCK_MODE) return mockPlaces;
  const sb = supabaseBrowser();
  const { data, error } = await sb.from("places_with_stats").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Place[];
}

// Cheap count of the moderation backlog (drives the header "Admin" badge).
export async function countPendingPlaces(): Promise<number> {
  if (MOCK_MODE) return mockPlaces.filter((p) => p.status === "pending").length;
  const { count, error } = await supabaseBrowser()
    .from("places")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

export async function setPlaceStatus(placeId: string, status: "approved" | "rejected"): Promise<void> {
  if (MOCK_MODE) {
    mockPlaces = mockPlaces.map((p) => (p.id === placeId ? { ...p, status } : p));
    return;
  }
  const { error } = await supabaseBrowser().from("places").update({ status }).eq("id", placeId);
  if (error) throw error;
}

export async function deletePlace(placeId: string): Promise<void> {
  if (MOCK_MODE) {
    mockPlaces = mockPlaces.filter((p) => p.id !== placeId);
    return;
  }
  const { error } = await supabaseBrowser().from("places").delete().eq("id", placeId);
  if (error) throw error;
}
