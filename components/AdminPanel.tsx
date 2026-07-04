"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CARD_SHADOW, CATEGORIES, DS } from "@/lib/ds";
import { deletePlace, fetchAllPlacesForAdmin, getSessionUser, setPlaceStatus } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import type { Place, SessionUser } from "@/lib/types";

type Tab = "pending" | "approved" | "rejected";

export default function AdminPanel() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [places, setPlaces] = useState<Place[]>([]);
  const [tab, setTab] = useState<Tab>("pending");

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
            padding: "7px 14px", borderRadius: 999, cursor: "pointer", fontSize: 13,
            fontWeight: 700, fontFamily: "inherit", textTransform: "capitalize",
            border: `1.5px solid ${tab === t ? DS.accent : DS.border}`,
            background: tab === t ? "#eff3ec" : "#fff",
            color: tab === t ? DS.accent : DS.textSub,
          }}>
            {t} ({counts[t]})
          </button>
        ))}
      </div>

      {rows.length === 0 && (
        <p style={{ color: DS.textMut, fontSize: 14 }}>Nothing {tab} right now. 🎉</p>
      )}

      {rows.map((p) => {
        const cat = CATEGORIES[p.category];
        return (
          <div key={p.id} style={{
            background: "#fff", border: `1px solid ${DS.border}`, borderRadius: 16,
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
            <p style={{ fontSize: 13.5, color: DS.text, margin: "0 0 10px 26px", lineHeight: 1.5 }}>
              {p.description || <em style={{ color: DS.textMut }}>No description</em>}
            </p>
            <div style={{ display: "flex", gap: 8, marginLeft: 26 }}>
              {p.status !== "approved" && (
                <ActionBtn color="#16a34a" onClick={() => act(p, "approved")}>✓ Approve</ActionBtn>
              )}
              {p.status !== "rejected" && (
                <ActionBtn color="#d97706" onClick={() => act(p, "rejected")}>Reject</ActionBtn>
              )}
              <ActionBtn color="#dc2626" onClick={() => act(p, "delete")}>Delete</ActionBtn>
            </div>
          </div>
        );
      })}
    </Shell>
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
      padding: "6px 13px", borderRadius: 999, cursor: "pointer", fontSize: 12.5,
      fontWeight: 700, fontFamily: "inherit", border: `1.5px solid ${color}55`,
      background: "#fff", color,
    }}>
      {children}
    </button>
  );
}
