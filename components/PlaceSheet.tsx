"use client";

import { useEffect, useState } from "react";
import { CATEGORIES, DS, FLOAT_SHADOW, placeTier } from "@/lib/ds";
import { addComment, fetchComments, fetchPlaceSignals, setVote, type PlaceSignal } from "@/lib/data";
import { formatEventWindow, priceLabel, timeAgo } from "@/lib/format";
import type { Place, PlaceComment, SessionUser } from "@/lib/types";
import PhotoCarousel from "./PhotoCarousel";

interface Props {
  place: Place;
  user: SessionUser | null;
  isMobile: boolean;
  onClose: () => void;
  onEdit: (place: Place) => void;
  onVoteToggled: (place: Place) => void;
  onCommentAdded: (place: Place) => void;
  onSignInNeeded: () => void;
}

// Display metadata for external-mention platforms in the "why it's trending" block.
const PLATFORM_META: Record<PlaceSignal["platform"], { label: string; emoji: string }> = {
  reddit: { label: "Reddit", emoji: "🟠" },
  instagram: { label: "Instagram", emoji: "📸" },
  x: { label: "X", emoji: "✖️" },
  news: { label: "News", emoji: "📰" },
  youtube: { label: "YouTube", emoji: "▶️" },
};

export default function PlaceSheet({
  place, user, isMobile, onClose, onEdit, onVoteToggled, onCommentAdded, onSignInNeeded,
}: Props) {
  const cat = CATEGORIES[place.category];
  // Author can edit their own; admin can edit anything (incl. curated seeds).
  const canEdit = !!user && (user.isAdmin || (!!place.created_by && place.created_by === user.id));
  const tier = placeTier(place);
  // Keyed by place id so switching places shows "Loading…" without a reset call.
  const [loaded, setLoaded] = useState<{ placeId: string; rows: PlaceComment[] } | null>(null);
  const comments = loaded?.placeId === place.id ? loaded.rows : null;
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [signalState, setSignalState] = useState<{ placeId: string; rows: PlaceSignal[] } | null>(null);
  const signals = signalState?.placeId === place.id ? signalState.rows : [];

  useEffect(() => {
    let cancelled = false;
    fetchPlaceSignals(place.id).then((rows) => {
      if (!cancelled) setSignalState({ placeId: place.id, rows });
    }).catch(() => {
      if (!cancelled) setSignalState({ placeId: place.id, rows: [] });
    });
    return () => { cancelled = true; };
  }, [place.id]);

  useEffect(() => {
    let cancelled = false;
    fetchComments(place.id).then((rows) => {
      if (!cancelled) setLoaded({ placeId: place.id, rows });
    }).catch(() => {
      if (!cancelled) setLoaded({ placeId: place.id, rows: [] });
    });
    return () => { cancelled = true; };
  }, [place.id]);

  async function handleVote(direction: 1 | -1) {
    if (!user) { onSignInNeeded(); return; }
    const next: -1 | 0 | 1 = place.my_vote === direction ? 0 : direction;
    const optimistic: Place = {
      ...place,
      my_vote: next,
      vote_count: place.vote_count + (next - place.my_vote),
    };
    onVoteToggled(optimistic);
    try {
      await setVote(place, direction);
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
      background: DS.card, borderRadius: 10, boxShadow: FLOAT_SHADOW,
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
            {(place.rating != null || priceLabel(place.price_level)) && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 5, fontSize: 12.5, fontWeight: 700 }}>
                {place.rating != null && (
                  <span style={{ color: "#b45309" }}>
                    ★ {place.rating.toFixed(1)}
                    {place.rating_count != null && (
                      <span style={{ color: DS.textMut, fontWeight: 500 }}> ({place.rating_count.toLocaleString("en-IN")})</span>
                    )}
                  </span>
                )}
                {priceLabel(place.price_level) && (
                  <span style={{ color: DS.textSub }}>{priceLabel(place.price_level)}</span>
                )}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {canEdit && (
              <button onClick={() => onEdit(place)} aria-label="Edit this spot" title="Edit" style={{
                border: "none", background: "rgba(0,0,0,0.06)", borderRadius: 5,
                height: 28, padding: "0 10px", cursor: "pointer", color: DS.textSub,
                fontSize: 12.5, fontWeight: 700, fontFamily: "inherit",
              }}>✎ Edit</button>
            )}
            <button onClick={onClose} aria-label="Close" style={{
              border: "none", background: "rgba(0,0,0,0.06)", borderRadius: 5,
              width: 28, height: 28, cursor: "pointer", color: DS.textSub, fontSize: 15,
            }}>✕</button>
          </div>
        </div>
        {(tier.label || place.event_start) && (
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {tier.label && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 5,
                background: tier.badgeBg, color: tier.color,
                border: `1px solid ${tier.badgeBorder}`,
              }}>
                {tier.badgeEmoji} {tier.label}{tier.level >= 3 ? " right now" : ""}
              </span>
            )}
            {place.event_start && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 5,
                background: "#fff", color: "#dc2626", border: "1px solid #fca5a5",
              }}>
                📅 {formatEventWindow(place.event_start, place.event_end)}
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ overflowY: "auto", padding: "14px 16px" }}>
        {/* Older rows only have image_url; newer ones carry the full set. */}
        <PhotoCarousel
          photos={place.image_urls?.length ? place.image_urls : place.image_url ? [place.image_url] : []}
          alt={place.title}
        />
        {!(place.image_urls?.length || place.image_url) && (
          <div style={{
            width: "100%", height: 110, borderRadius: 6, marginBottom: 12,
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
        <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
          {place.website && (
            <a href={place.website} target="_blank" rel="noopener noreferrer" style={{
              fontSize: 12.5, fontWeight: 600, color: DS.accent,
            }}>
              Website ↗
            </a>
          )}
          {place.source_url && (
            <a href={place.source_url} target="_blank" rel="noopener noreferrer" style={{
              fontSize: 12.5, fontWeight: 600, color: DS.accent,
            }}>
              View source ↗
            </a>
          )}
        </div>

        {/* Transparency: show what's actually driving the trending badge —
            upvotes, discussion, and external mentions (with links to the source). */}
        {(() => {
          const chips: React.ReactNode[] = [];
          const chipStyle: React.CSSProperties = {
            display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px",
            borderRadius: 999, fontSize: 12, fontWeight: 600, fontFamily: "inherit",
            border: `1px solid ${DS.border}`, background: "#fff", color: DS.text, textDecoration: "none",
          };
          if (place.vote_count > 0) {
            chips.push(<span key="v" style={chipStyle}>▲ {place.vote_count} upvote{place.vote_count === 1 ? "" : "s"}</span>);
          }
          if (place.comment_count > 0) {
            chips.push(<span key="c" style={chipStyle}>💬 {place.comment_count} comment{place.comment_count === 1 ? "" : "s"}</span>);
          }
          for (const s of signals) {
            const meta = PLATFORM_META[s.platform];
            const label = `${meta.emoji} ${meta.label} · ${s.count} mention${s.count === 1 ? "" : "s"}`;
            chips.push(s.topUrl ? (
              <a key={s.platform} href={s.topUrl} target="_blank" rel="noopener noreferrer"
                title={s.topTitle ?? undefined} style={{ ...chipStyle, color: DS.accent, borderColor: DS.accent }}>
                {label} ↗
              </a>
            ) : (
              <span key={s.platform} style={chipStyle}>{label}</span>
            ));
          }
          if (chips.length === 0) return null;
          return (
            <div style={{ marginTop: 14 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: DS.textSub, textTransform: "uppercase",
                letterSpacing: 0.4, marginBottom: 8,
              }}>
                Why it&rsquo;s {tier.label ? tier.label.toLowerCase() : "on the map"}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>{chips}</div>
            </div>
          );
        })()}

        {/* One-tap directions: opens Google Maps navigation to the pin.
            Uses coordinates so it works even when there's no street address. */}
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            marginTop: 14, padding: "12px", borderRadius: 6, textDecoration: "none",
            background: DS.accent, color: "#fff", fontSize: 14, fontWeight: 700,
          }}
        >
          🧭 Directions in Google Maps
        </a>

        {/* vote row — up = worth it, down = skip it, net score in the middle */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
          <div style={{
            display: "flex", alignItems: "center", borderRadius: 5,
            border: `1.5px solid ${DS.borderMd}`, overflow: "hidden",
          }}>
            <button onClick={() => handleVote(1)} title="Worth it" style={{
              display: "flex", alignItems: "center", gap: 6, padding: "9px 15px", border: "none",
              cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "inherit",
              background: place.my_vote === 1 ? DS.accent : "#fff",
              color: place.my_vote === 1 ? "#fff" : DS.text,
            }}>
              ▲ Worth it
            </button>
            <span style={{
              minWidth: 34, textAlign: "center", padding: "9px 4px", fontSize: 14, fontWeight: 800,
              fontFamily: "var(--font-display)", background: "#fff",
              color: place.vote_count < 0 ? "#dc2626" : DS.text,
              borderLeft: `1px solid ${DS.border}`, borderRight: `1px solid ${DS.border}`,
            }}>
              {place.vote_count}
            </span>
            <button onClick={() => handleVote(-1)} title="Not worth it" style={{
              display: "flex", alignItems: "center", gap: 6, padding: "9px 15px", border: "none",
              cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "inherit",
              background: place.my_vote === -1 ? "#dc2626" : "#fff",
              color: place.my_vote === -1 ? "#fff" : DS.textSub,
            }}>
              ▼ Skip
            </button>
          </div>
          <span style={{ fontSize: 12, color: DS.textMut }}>
            {place.my_vote === 1 ? "You vouched for this"
              : place.my_vote === -1 ? "You'd skip this"
              : "Been here? Weigh in"}
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
              background: DS.bg, border: `1px solid ${DS.border}`, borderRadius: 6,
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
                flex: 1, padding: "10px 12px", borderRadius: 5, fontSize: 13.5,
                border: `1.5px solid ${DS.border}`, fontFamily: "inherit", color: DS.text,
                outline: "none", background: "#fff",
              }}
            />
            <button onClick={handlePost} disabled={posting || !draft.trim()} style={{
              padding: "10px 16px", borderRadius: 5, border: "none", cursor: "pointer",
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
