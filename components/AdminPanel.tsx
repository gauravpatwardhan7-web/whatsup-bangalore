"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CARD_SHADOW, CATEGORIES, DS } from "@/lib/ds";
import { deletePlace, fetchAllPlacesForAdmin, getSessionUser, mergePlaces, setPlaceStatus } from "@/lib/data";
import { priceLabel, timeAgo } from "@/lib/format";
import type { Place, SessionUser } from "@/lib/types";

type Tab = "pending" | "approved" | "rejected";

export default function AdminPanel() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [places, setPlaces] = useState<Place[]>([]);
  const [tab, setTab] = useState<Tab>("pending");
  // The place currently being merged away (shows the target picker), or null.
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSessionUser().then(async (u) => {
      setUser(u);
      if (u?.isAdmin) setPlaces(await fetchAllPlacesForAdmin());
    });
  }, []);

  async function act(place: Place, action: "approved" | "rejected" | "delete") {
    if (action === "delete") {
      if (!confirm(`Delete "${place.title}" permanently?`)) return;
      await deletePlace(place.id);
      setPlaces((prev) => prev.filter((p) => p.id !== place.id));
      return;
    }
    await setPlaceStatus(place.id, action);
    setPlaces((prev) => prev.map((p) => (p.id === place.id ? { ...p, status: action } : p)));
  }

  async function doMerge(source: Place, target: Place) {
    if (!confirm(`Merge "${source.title}" INTO "${target.title}"?\n\nVotes, comments and mentions move to "${target.title}", and "${source.title}" is deleted.`)) return;
    setBusy(true);
    try {
      await mergePlaces(source.id, target.id);
      setPlaces((prev) => prev.filter((p) => p.id !== source.id));
      setMergingId(null);
    } catch (e) {
      alert(`Merge failed: ${e instanceof Error ? e.message : e}. Did you run migration 0011_merge_places.sql?`);
    } finally {
      setBusy(false);
    }
  }

  if (user === undefined) {
    return <Shell><p style={{ color: DS.textMut }}>Loading…</p></Shell>;
  }
  if (!user?.isAdmin) {
    return (
      <Shell>
        <p style={{ color: DS.textSub, fontSize: 14 }}>
          This page is for moderators. <Link href="/" style={{ color: DS.accent, fontWeight: 700 }}>← Back to the map</Link>
        </p>
      </Shell>
    );
  }

  const rows = places.filter((p) => p.status === tab);
  const counts = {
    pending: places.filter((p) => p.status === "pending").length,
    approved: places.filter((p) => p.status === "approved").length,
    rejected: places.filter((p) => p.status === "rejected").length,
  };

  return (
    <Shell>
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {(["pending", "approved", "rejected"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "7px 14px", borderRadius: 5, cursor: "pointer", fontSize: 13,
            fontWeight: 700, fontFamily: "inherit", textTransform: "capitalize",
            border: `1.5px solid ${tab === t ? DS.accent : DS.border}`,
            background: tab === t ? "#eaf1fe" : "#fff",
            color: tab === t ? DS.accent : DS.textSub,
          }}>
            {t} ({counts[t]})
          </button>
        ))}
      </div>

      {rows.length === 0 && (
        <p style={{ color: DS.textMut, fontSize: 14 }}>Nothing {tab} right now. 🎉</p>
      )}

      {rows.map((p) => (
        <AdminRow
          key={p.id}
          place={p}
          allPlaces={places}
          merging={mergingId === p.id}
          busy={busy}
          onAct={act}
          onStartMerge={() => setMergingId(mergingId === p.id ? null : p.id)}
          onMerge={(target) => doMerge(p, target)}
        />
      ))}
    </Shell>
  );
}

function AdminRow({ place: p, allPlaces, merging, busy, onAct, onStartMerge, onMerge }: {
  place: Place;
  allPlaces: Place[];
  merging: boolean;
  busy: boolean;
  onAct: (place: Place, action: "approved" | "rejected" | "delete") => void;
  onStartMerge: () => void;
  onMerge: (target: Place) => void;
}) {
  const cat = CATEGORIES[p.category];
  const photos = p.image_urls?.length ? p.image_urls : p.image_url ? [p.image_url] : [];
  return (
    <div style={{
      background: "#fff", border: `1px solid ${DS.border}`, borderRadius: 8,
      padding: "14px 16px", marginBottom: 10, boxShadow: CARD_SHADOW,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{cat.emoji}</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 15.5, fontWeight: 700, color: DS.text, flex: 1 }}>
          {p.title}
        </span>
        <span style={{ fontSize: 11.5, color: DS.textMut }}>
          {p.source} · {timeAgo(p.created_at)}
        </span>
      </div>

      <div style={{ fontSize: 12.5, color: DS.textSub, margin: "5px 0 8px 26px" }}>
        {cat.label}{p.area ? ` · ${p.area}` : ""} · ({p.lat.toFixed(4)}, {p.lng.toFixed(4)})
      </div>

      {photos.length > 0 && (
        <div style={{ display: "flex", gap: 6, margin: "0 0 10px 26px", flexWrap: "wrap" }}>
          {photos.slice(0, 4).map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={url} alt="" loading="lazy" style={{
              width: 60, height: 60, borderRadius: 5, objectFit: "cover", border: `1px solid ${DS.border}`,
            }} />
          ))}
        </div>
      )}

      <p style={{ fontSize: 13.5, color: DS.text, margin: "0 0 8px 26px", lineHeight: 1.5 }}>
        {p.description || <em style={{ color: DS.textMut }}>No description</em>}
      </p>

      {/* Full context: stats + enrichment + the source that surfaced it. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: DS.textSub, margin: "0 0 8px 26px" }}>
        <span>▲ {p.vote_count} votes</span>
        <span>💬 {p.comment_count} comments</span>
        {p.rating != null && <span style={{ color: "#b45309" }}>★ {p.rating.toFixed(1)}{p.rating_count != null ? ` (${p.rating_count})` : ""}</span>}
        {priceLabel(p.price_level) && <span>{priceLabel(p.price_level)}</span>}
        {p.address && <span title="address">📍 {p.address}</span>}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12.5, fontWeight: 600, margin: "0 0 10px 26px" }}>
        <Link href={`/?place=${p.id}`} target="_blank" style={{ color: DS.accent }}>View on map ↗</Link>
        {p.source_url && <a href={p.source_url} target="_blank" rel="noopener noreferrer" style={{ color: DS.accent }}>Source ({p.source}) ↗</a>}
        {p.website && <a href={p.website} target="_blank" rel="noopener noreferrer" style={{ color: DS.accent }}>Website ↗</a>}
        <a href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`} target="_blank" rel="noopener noreferrer" style={{ color: DS.accent }}>Google Maps ↗</a>
      </div>

      <div style={{ display: "flex", gap: 8, marginLeft: 26, flexWrap: "wrap" }}>
        {p.status !== "approved" && (
          <ActionBtn color="#16a34a" onClick={() => onAct(p, "approved")}>✓ Approve</ActionBtn>
        )}
        {p.status !== "rejected" && (
          <ActionBtn color="#d97706" onClick={() => onAct(p, "rejected")}>Reject</ActionBtn>
        )}
        <ActionBtn color="#6366f1" onClick={onStartMerge}>{merging ? "Cancel merge" : "⤵ Merge"}</ActionBtn>
        <ActionBtn color="#dc2626" onClick={() => onAct(p, "delete")}>Delete</ActionBtn>
      </div>

      {merging && <MergePicker source={p} allPlaces={allPlaces} busy={busy} onPick={onMerge} />}
    </div>
  );
}

// Search other places to merge the source INTO.
function MergePicker({ source, allPlaces, busy, onPick }: {
  source: Place; allPlaces: Place[]; busy: boolean; onPick: (target: Place) => void;
}) {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    return allPlaces
      .filter((p) => p.id !== source.id)
      .filter((p) => !query || p.title.toLowerCase().includes(query) || (p.area ?? "").toLowerCase().includes(query))
      .slice(0, 8);
  }, [q, allPlaces, source.id]);

  return (
    <div style={{ margin: "10px 0 0 26px", padding: 12, background: DS.bg, border: `1px solid ${DS.border}`, borderRadius: 6 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: DS.textSub, marginBottom: 8 }}>
        Merge <b style={{ color: DS.text }}>{source.title}</b> into…
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the place to keep…"
        style={{
          width: "100%", boxSizing: "border-box", padding: "8px 11px", borderRadius: 5,
          border: `1.5px solid ${DS.border}`, fontSize: 13, fontFamily: "inherit", color: DS.text,
          outline: "none", background: "#fff", marginBottom: 8,
        }}
      />
      {matches.length === 0 && <div style={{ fontSize: 12.5, color: DS.textMut }}>No matches.</div>}
      {matches.map((t) => (
        <button
          key={t.id}
          disabled={busy}
          onClick={() => onPick(t)}
          style={{
            display: "flex", width: "100%", textAlign: "left", alignItems: "center", gap: 8,
            padding: "8px 10px", marginBottom: 4, borderRadius: 5, cursor: busy ? "default" : "pointer",
            border: `1px solid ${DS.border}`, background: "#fff", fontFamily: "inherit",
          }}
        >
          <span style={{ fontSize: 15 }}>{CATEGORIES[t.category].emoji}</span>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: DS.text }}>{t.title}</span>
          <span style={{ fontSize: 11.5, color: DS.textMut }}>{t.area ?? ""} · {t.status}</span>
        </button>
      ))}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", background: DS.bg, padding: "24px 16px" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 20 }}>
          <h1 style={{
            fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700,
            color: DS.text, letterSpacing: "-0.01em", margin: 0,
          }}>
            Moderation
          </h1>
          <Link href="/" style={{ fontSize: 13, fontWeight: 600, color: DS.accent }}>← Back to the map</Link>
        </div>
        {children}
      </div>
    </div>
  );
}

function ActionBtn({ color, onClick, children }: {
  color: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 13px", borderRadius: 5, cursor: "pointer", fontSize: 12.5,
      fontWeight: 700, fontFamily: "inherit", border: `1.5px solid ${color}55`,
      background: "#fff", color,
    }}>
      {children}
    </button>
  );
}
