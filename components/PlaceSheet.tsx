"use client";

import { useEffect, useState } from "react";
import { CATEGORIES, DS, FLOAT_SHADOW, trendingTier } from "@/lib/ds";
import { addComment, fetchComments, toggleVote } from "@/lib/data";
import { formatEventWindow, timeAgo } from "@/lib/format";
import type { Place, PlaceComment, SessionUser } from "@/lib/types";

interface Props {
  place: Place;
  user: SessionUser | null;
  isMobile: boolean;
  onClose: () => void;
  onVoteToggled: (place: Place) => void;
  onCommentAdded: (place: Place) => void;
  onSignInNeeded: () => void;
}

export default function PlaceSheet({
  place, user, isMobile, onClose, onVoteToggled, onCommentAdded, onSignInNeeded,
}: Props) {
  const cat = CATEGORIES[place.category];
  const tier = trendingTier(place.trending_score);
  // Keyed by place id so switching places shows "Loading…" without a reset call.
  const [loaded, setLoaded] = useState<{ placeId: string; rows: PlaceComment[] } | null>(null);
  const comments = loaded?.placeId === place.id ? loaded.rows : null;
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchComments(place.id).then((rows) => {
      if (!cancelled) setLoaded({ placeId: place.id, rows });
    }).catch(() => {
      if (!cancelled) setLoaded({ placeId: place.id, rows: [] });
    });
    return () => { cancelled = true; };
  }, [place.id]);

  async function handleVote() {
    if (!user) { onSignInNeeded(); return; }
    const optimistic: Place = {
      ...place,
      voted_by_me: !place.voted_by_me,
      vote_count: place.vote_count + (place.voted_by_me ? -1 : 1),
    };
    onVoteToggled(optimistic);
    try {
      await toggleVote(place);
    } catch {
      onVoteToggled(place); // revert
    }
  }

  async function handlePost() {
    if (!user) { onSignInNeeded(); return; }
    const body = draft.trim();
    if (!body || posting) return;
    setPostError(null);
    setPosting(true);
    try {
      const comment = await addComment(place.id, body, user);
      setLoaded((prev) => ({
        placeId: place.id,
        rows: [...(prev?.placeId === place.id ? prev.rows : []), comment],
      }));
      setDraft("");
      onCommentAdded({ ...place, comment_count: place.comment_count + 1 });
    } catch {
      // Never swallow a comment silently — keep the text and tell the user.
      setPostError("Couldn't post that — check your connection and try again.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div style={{
      position: "absolute",
      ...(isMobile
        ? { left: 8, right: 8, bottom: 8, maxHeight: "72dvh" }
        : { top: 74, left: 12, width: 400, maxHeight: "calc(100dvh - 90px)" }),
      background: DS.card, borderRadius: 20, boxShadow: FLOAT_SHADOW,
      border: `1px solid ${DS.border}`, zIndex: 47,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* header strip in category tint */}
      <div style={{ background: cat.tint, borderBottom: `1px solid ${DS.border}`, padding: "14px 16px 12px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontSize: 26, lineHeight: "30px" }}>{cat.emoji}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 700,
              color: DS.text, letterSpacing: "-0.01em", lineHeight: 1.25,
            }}>
              {place.title}
            </div>
            <div style={{ fontSize: 12.5, color: DS.textSub, marginTop: 3 }}>
              {cat.label}{place.area ? ` · ${place.area}` : ""}{place.address ? ` · ${place.address}` : ""}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            border: "none", background: "rgba(0,0,0,0.06)", borderRadius: 999,
            width: 28, height: 28, cursor: "pointer", color: DS.textSub, fontSize: 15, flexShrink: 0,
          }}>✕</button>
        </div>
        {(tier !== "none" || place.event_start) && (
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {tier !== "none" && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
                background: tier === "hot" ? "#dc2626" : DS.accent, color: "#fff",
              }}>
                {tier === "hot" ? "🔥 Hot right now" : "↗ Trending this week"}
              </span>
            )}
            {place.event_start && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
                background: "#fff", color: "#dc2626", border: "1px solid #fca5a5",
              }}>
                📅 {formatEventWindow(place.event_start, place.event_end)}
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ overflowY: "auto", padding: "14px 16px" }}>
        {place.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={place.image_url} alt={place.title} style={{
            width: "100%", height: 180, borderRadius: 12, marginBottom: 12, objectFit: "cover",
            border: `1px solid ${DS.border}`,
          }} />
        ) : (
          <div style={{
            width: "100%", height: 110, borderRadius: 12, marginBottom: 12,
            background: `linear-gradient(135deg, ${cat.tint}, ${cat.color}22)`,
            border: `1px solid ${DS.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontSize: 44, filter: "saturate(1.2)" }}>{cat.emoji}</span>
          </div>
        )}
        <p style={{ fontSize: 14, lineHeight: 1.55, color: DS.text, margin: 0 }}>
          {place.description}
        </p>
        {place.source_url && (
          <a href={place.source_url} target="_blank" rel="noopener noreferrer" style={{
            display: "inline-block", marginTop: 10, fontSize: 12.5, fontWeight: 600, color: DS.accent,
          }}>
            View source ↗
          </a>
        )}

        {/* vote row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
          <button onClick={handleVote} style={{
            display: "flex", alignItems: "center", gap: 7, padding: "9px 18px",
            borderRadius: 999, cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "inherit",
            border: `1.5px solid ${place.voted_by_me ? DS.accent : DS.borderMd}`,
            background: place.voted_by_me ? DS.accent : "#fff",
            color: place.voted_by_me ? "#fff" : DS.text,
          }}>
            ▲ {place.voted_by_me ? "Loved it" : "Worth it?"} · {place.vote_count}
          </button>
          <span style={{ fontSize: 12, color: DS.textMut }}>
            {place.voted_by_me ? "You vouched for this" : "Been here? Vouch for it"}
          </span>
        </div>

        {/* comments */}
        <div style={{ marginTop: 18, borderTop: `1px solid ${DS.border}`, paddingTop: 14 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 14.5, fontWeight: 700, color: DS.text, marginBottom: 10 }}>
            What people say
          </div>
          {comments === null && (
            <div style={{ fontSize: 13, color: DS.textMut }}>Loading…</div>
          )}
          {comments?.length === 0 && (
            <div style={{ fontSize: 13, color: DS.textMut }}>No remarks yet — be the first to report back.</div>
          )}
          {comments?.map((c) => (
            <div key={c.id} style={{
              background: DS.bg, border: `1px solid ${DS.border}`, borderRadius: 12,
              padding: "9px 12px", marginBottom: 8,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: DS.textSub, marginBottom: 3 }}>
                {c.author_name ?? "Someone"} <span style={{ fontWeight: 400, color: DS.textMut }}>· {timeAgo(c.created_at)}</span>
              </div>
              <div style={{ fontSize: 13.5, color: DS.text, lineHeight: 1.45 }}>{c.body}</div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handlePost(); }}
              onFocus={() => { if (!user) onSignInNeeded(); }}
              placeholder={user ? "How was it? Tips for others…" : "Sign in to leave a remark"}
              style={{
                flex: 1, padding: "10px 12px", borderRadius: 10, fontSize: 13.5,
                border: `1.5px solid ${DS.border}`, fontFamily: "inherit", color: DS.text,
                outline: "none", background: "#fff",
              }}
            />
            <button onClick={handlePost} disabled={posting || !draft.trim()} style={{
              padding: "10px 16px", borderRadius: 10, border: "none", cursor: "pointer",
              background: draft.trim() ? DS.accent : DS.border, color: "#fff",
              fontSize: 13.5, fontWeight: 700, fontFamily: "inherit",
            }}>
              Post
            </button>
          </div>
          {postError && (
            <div style={{ fontSize: 12, color: "#dc2626", marginTop: 6, fontWeight: 600 }}>
              {postError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
