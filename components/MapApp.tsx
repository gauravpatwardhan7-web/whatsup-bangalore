"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BLR_CENTER, CATEGORIES, DS, FLOAT_SHADOW, buzzScore, type Category } from "@/lib/ds";
import { fetchPlaces, fetchPlaceStats, getSessionUser, signInWithGoogle, signOut, subscribeToActivity } from "@/lib/data";
import { MOCK_MODE } from "@/lib/supabase/client";
import { isThisWeekend } from "@/lib/format";
import type { Place, SessionUser, SortMode } from "@/lib/types";
import MapView from "./MapView";
import PlaceCard from "./PlaceCard";
import PlaceSheet from "./PlaceSheet";
import SubmitSheet from "./SubmitSheet";

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

const TOP_N = 10;

const SORTS: { id: SortMode; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "newest", label: "Newest" },
  { id: "loved", label: "Most loved" },
];

export default function MapApp() {
  const isMobile = useIsMobile();
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [sort, setSort] = useState<SortMode>("trending");
  const [activeCats, setActiveCats] = useState<Set<Category>>(new Set());
  const [weekendOnly, setWeekendOnly] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const mapCenterRef = useRef({ lat: BLR_CENTER[1], lng: BLR_CENTER[0] });

  useEffect(() => {
    fetchPlaces().then(setPlaces).catch(() => setToast("Couldn't load places — check your Supabase setup."))
      .finally(() => setLoading(false));
    getSessionUser().then(setUser).catch(() => {});
  }, []);

  // Real-time: when anyone votes or comments, refresh that one place's live
  // counts so its badge/glow/rank updates for everyone without a refresh.
  useEffect(() => {
    const unsubscribe = subscribeToActivity(async (placeId) => {
      try {
        const stats = await fetchPlaceStats(placeId);
        if (stats) {
          setPlaces((prev) => prev.map((p) =>
            p.id === placeId
              ? { ...p, vote_count: stats.vote_count, comment_count: stats.comment_count, my_vote: stats.my_vote, trending_score: stats.trending_score }
              : p
          ));
        }
      } catch { /* ignore transient realtime refresh errors */ }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    let rows = places;
    if (activeCats.size > 0) rows = rows.filter((p) => activeCats.has(p.category));
    if (weekendOnly) rows = rows.filter((p) => isThisWeekend(p.event_start));
    const sorted = [...rows];
    if (sort === "trending") sorted.sort((a, b) => buzzScore(b.vote_count, b.comment_count) - buzzScore(a.vote_count, a.comment_count));
    if (sort === "newest") sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (sort === "loved") sorted.sort((a, b) => b.vote_count - a.vote_count);
    return sorted;
  }, [places, activeCats, weekendOnly, sort]);

  // "Trending" and "Most loved" are rankings → show a numbered Top 10.
  // "Newest" is a feed → show it all, unranked.
  const isRanked = sort !== "newest";
  const visible = isRanked ? filtered.slice(0, TOP_N) : filtered;
  const soleCat = activeCats.size === 1 ? [...activeCats][0] : null;

  const listHeading = loading
    ? "Loading the city…"
    : isRanked
      ? `Top ${Math.min(TOP_N, filtered.length)} ${sort === "loved" ? "loved" : "trending"}` +
        `${soleCat ? " " + CATEGORIES[soleCat].label.toLowerCase() : ""}` +
        `${weekendOnly ? " this weekend" : ""}`
      : `${filtered.length} spot${filtered.length === 1 ? "" : "s"}` +
        `${soleCat ? " · " + CATEGORIES[soleCat].label.toLowerCase() : ""}` +
        `${weekendOnly ? " this weekend" : " popping up"}`;

  const selected = filtered.find((p) => p.id === selectedId)
    ?? places.find((p) => p.id === selectedId)
    ?? null;

  const updatePlace = useCallback((updated: Place) => {
    setPlaces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }, []);

  function toggleCat(c: Category) {
    setActiveCats((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  }

  async function handleSignIn() {
    if (MOCK_MODE) { setToast("Demo mode — connect Supabase to enable real sign-in."); return; }
    await signInWithGoogle();
  }

  async function handleSignOut() {
    await signOut();
    setUser(null);
    setPlaces(await fetchPlaces());
  }

  const chipStyle = (active: boolean, color: string, tint: string): React.CSSProperties => ({
    padding: "6px 12px", borderRadius: 999, cursor: "pointer", fontSize: 12.5,
    fontWeight: 600, fontFamily: "inherit", whiteSpace: "nowrap",
    border: `1.5px solid ${active ? color : DS.border}`,
    background: active ? tint : "rgba(255,255,255,0.92)",
    color: active ? color : DS.textSub,
  });

  return (
    <div style={{ position: "relative", height: "100dvh", overflow: "hidden", background: DS.bg }}>
      <MapView
        places={filtered}
        selectedId={selectedId}
        onSelect={(p) => setSelectedId(p.id)}
        onCenterChange={(c) => { mapCenterRef.current = c; }}
      />

      {/* ── floating header ── */}
      <div style={{
        position: "absolute", top: 12, left: 12, right: 12, zIndex: 50,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: isMobile ? 6 : 9, background: "rgba(255,255,255,0.95)",
          backdropFilter: "blur(8px)", borderRadius: 999, padding: isMobile ? "7px 12px" : "8px 16px",
          boxShadow: FLOAT_SHADOW, border: `1px solid ${DS.border}`,
        }}>
          <span style={{ fontSize: isMobile ? 15 : 18 }}>🔥</span>
          <span style={{
            fontFamily: "var(--font-display)", fontSize: isMobile ? 14 : 16.5, fontWeight: 700,
            color: DS.text, letterSpacing: "-0.01em", whiteSpace: "nowrap",
          }}>
            Whatsup <span style={{ color: DS.accent }}>Bangalore</span>
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => (user ? setShowSubmit(true) : handleSignIn())}
          style={{
            padding: isMobile ? "8px 12px" : "9px 16px", borderRadius: 999, border: "none", cursor: "pointer",
            background: DS.accent, color: "#fff", fontSize: 13, fontWeight: 700,
            fontFamily: "inherit", boxShadow: FLOAT_SHADOW, whiteSpace: "nowrap",
          }}
        >
          {isMobile ? "+ Add" : "+ Add a spot"}
        </button>
        {user ? (
          <button onClick={handleSignOut} title={`Signed in as ${user.name} — click to sign out`} style={{
            position: "relative", width: 38, height: 38, borderRadius: 999, border: `2px solid #fff`,
            cursor: "pointer", boxShadow: FLOAT_SHADOW, overflow: "hidden", background: DS.accentLt,
            color: "#fff", fontWeight: 700, fontSize: 15, padding: 0, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {/* Initial sits underneath as the fallback; the avatar image
                overlays it and removes itself if it fails to load. */}
            <span>{user.name.charAt(0).toUpperCase()}</span>
            {user.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
                style={{
                  position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
                }}
              />
            )}
          </button>
        ) : (
          <button onClick={handleSignIn} style={{
            padding: "9px 16px", borderRadius: 999, cursor: "pointer",
            border: `1.5px solid ${DS.borderMd}`, background: "rgba(255,255,255,0.95)",
            color: DS.text, fontSize: 13, fontWeight: 700, fontFamily: "inherit",
            boxShadow: FLOAT_SHADOW, whiteSpace: "nowrap",
          }}>
            Sign in
          </button>
        )}
      </div>

      {/* ── filter chips ── */}
      <div style={{
        position: "absolute", top: 62, left: 12, right: 12, zIndex: 45,
        display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4,
        scrollbarWidth: "none",
      }}>
        <button
          onClick={() => setWeekendOnly((w) => !w)}
          style={chipStyle(weekendOnly, "#dc2626", "#fef2f2")}
        >
          📅 This weekend
        </button>
        {(Object.keys(CATEGORIES) as Category[]).map((c) => (
          <button key={c} onClick={() => toggleCat(c)}
            style={chipStyle(activeCats.has(c), CATEGORIES[c].color, CATEGORIES[c].tint)}>
            {CATEGORIES[c].emoji} {CATEGORIES[c].label}
          </button>
        ))}
      </div>

      {/* ── list panel: desktop left panel / mobile bottom sheet ── */}
      {!selected && !showSubmit && (
        <div style={{
          position: "absolute", zIndex: 30,
          ...(isMobile
            ? { left: 8, right: 8, bottom: 8, maxHeight: listOpen ? "46dvh" : 52 }
            : { top: 108, left: 12, width: 360, bottom: 16 }),
          background: "rgba(255,255,255,0.97)", backdropFilter: "blur(8px)",
          borderRadius: 20, boxShadow: FLOAT_SHADOW, border: `1px solid ${DS.border}`,
          display: "flex", flexDirection: "column", overflow: "hidden",
          transition: "max-height 0.25s ease",
        }}>
          <button
            onClick={() => isMobile && setListOpen((o) => !o)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "13px 16px 10px",
              background: "none", border: "none", cursor: isMobile ? "pointer" : "default",
              fontFamily: "inherit", textAlign: "left",
            }}
          >
            <span style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, color: DS.text, flex: 1 }}>
              {listHeading}
            </span>
            {isMobile && <span style={{ color: DS.textMut, fontSize: 13 }}>{listOpen ? "▾" : "▴"}</span>}
          </button>

          <div style={{ display: "flex", gap: 4, padding: "0 16px 10px" }}>
            {SORTS.map((s) => (
              <button key={s.id} onClick={() => setSort(s.id)} style={{
                padding: "5px 11px", borderRadius: 999, cursor: "pointer", fontSize: 12,
                fontWeight: 700, fontFamily: "inherit", border: "none",
                background: sort === s.id ? DS.text : DS.bg,
                color: sort === s.id ? "#fff" : DS.textSub,
              }}>
                {s.label}
              </button>
            ))}
          </div>

          <div style={{ overflowY: "auto", padding: "2px 12px 12px" }}>
            {!loading && filtered.length === 0 && (
              <div style={{ fontSize: 13, color: DS.textMut, padding: "8px 4px" }}>
                Nothing here with these filters. Know a spot? Add it!
              </div>
            )}
            {visible.map((p, i) => (
              <PlaceCard
                key={p.id}
                place={p}
                rank={isRanked ? i + 1 : undefined}
                selected={false}
                onClick={() => setSelectedId(p.id)}
              />
            ))}
            {isRanked && filtered.length > TOP_N && (
              <div style={{ fontSize: 12, color: DS.textMut, textAlign: "center", padding: "4px 0 6px" }}>
                +{filtered.length - TOP_N} more on the map
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── detail sheet ── */}
      {selected && (
        <PlaceSheet
          place={selected}
          user={user}
          isMobile={isMobile}
          onClose={() => setSelectedId(null)}
          onVoteToggled={updatePlace}
          onCommentAdded={updatePlace}
          onSignInNeeded={handleSignIn}
        />
      )}

      {/* ── submit sheet ── */}
      {showSubmit && user && (
        <SubmitSheet
          user={user}
          isMobile={isMobile}
          getMapCenter={() => mapCenterRef.current}
          onClose={() => setShowSubmit(false)}
          onSubmitted={async (status) => {
            setShowSubmit(false);
            setToast(status === "approved" ? "It's on the map! 🎉" : "Submitted — it'll go live after review. 🙌");
            setPlaces(await fetchPlaces());
          }}
        />
      )}

      {/* ── demo-mode banner ── */}
      {MOCK_MODE && (
        <div style={{
          position: "absolute", bottom: isMobile ? "auto" : 16, top: isMobile ? 104 : "auto",
          right: 12, zIndex: 55, background: "#fffbeb", border: "1px solid #fde68a",
          borderRadius: 12, padding: "8px 13px", fontSize: 11.5, color: "#92400e",
          fontWeight: 600, boxShadow: FLOAT_SHADOW, maxWidth: 260,
        }}>
          Demo mode: showing sample data. Connect Supabase (see README) to go live.
        </div>
      )}

      {/* ── toast ── */}
      {toast && (
        <div style={{
          position: "absolute", top: isMobile ? "auto" : 16, bottom: isMobile ? 70 : "auto",
          left: "50%", transform: "translateX(-50%)", zIndex: 60,
          background: DS.text, color: "#fff", borderRadius: 999, padding: "10px 20px",
          fontSize: 13.5, fontWeight: 600, boxShadow: FLOAT_SHADOW, whiteSpace: "nowrap",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
