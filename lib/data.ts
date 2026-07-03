"use client";

import { MOCK_MODE, supabaseBrowser } from "./supabase/client";
import { MOCK_COMMENTS, MOCK_PLACES } from "./mock-data";
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

export async function toggleVote(place: Place): Promise<void> {
  if (MOCK_MODE) {
    mockPlaces = mockPlaces.map((p) =>
      p.id === place.id
        ? { ...p, voted_by_me: !p.voted_by_me, vote_count: p.vote_count + (p.voted_by_me ? -1 : 1) }
        : p
    );
    return;
  }
  const sb = supabaseBrowser();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("not signed in");
  if (place.voted_by_me) {
    const { error } = await sb.from("votes").delete().eq("place_id", place.id).eq("user_id", user.id);
    if (error) throw error;
  } else {
    const { error } = await sb.from("votes").insert({ place_id: place.id, user_id: user.id });
    if (error && error.code !== "23505") throw error; // ignore double-tap duplicates
  }
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
      voted_by_me: false,
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

// ── images ───────────────────────────────────────────────────────────────────
export async function uploadImage(file: File, user: SessionUser): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Image too large — max 5 MB.");
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
