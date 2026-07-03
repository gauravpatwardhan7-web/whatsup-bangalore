"use client";

import { useRef, useState } from "react";
import { CATEGORIES, DS, FLOAT_SHADOW, type Category } from "@/lib/ds";
import { searchBangalore, type GeocodeResult } from "@/lib/geocode";
import { submitPlace, uploadImage } from "@/lib/data";
import type { NewPlaceInput, SessionUser } from "@/lib/types";

interface Props {
  user: SessionUser;
  isMobile: boolean;
  getMapCenter: () => { lat: number; lng: number };
  onClose: () => void;
  onSubmitted: (status: "approved" | "pending") => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 10, fontSize: 13.5,
  border: `1.5px solid ${DS.border}`, fontFamily: "inherit", color: DS.text,
  outline: "none", background: "#fff", boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: DS.textSub, display: "block",
  marginBottom: 5, marginTop: 14,
};

export default function SubmitSheet({ user, isMobile, getMapCenter, onClose, onSubmitted }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<Category>("food");
  const [area, setArea] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [locQuery, setLocQuery] = useState("");
  const [locResults, setLocResults] = useState<GeocodeResult[]>([]);
  const [location, setLocation] = useState<GeocodeResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      setImageUrl(await uploadImage(file, user));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function handleLocQuery(q: string) {
    setLocQuery(q);
    setLocation(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 3) { setLocResults([]); return; }
    // Debounce: Nominatim allows max 1 req/sec.
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        setLocResults(await searchBangalore(q));
      } finally {
        setSearching(false);
      }
    }, 1100);
  }

  function useMapCenter() {
    const c = getMapCenter();
    setLocation({ label: `Pinned on map (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})`, lat: c.lat, lng: c.lng });
    setLocResults([]);
    setLocQuery("");
  }

  async function handleSubmit() {
    setError(null);
    if (!title.trim()) { setError("Give it a name."); return; }
    if (!location) { setError("Pick a location — search or use the map center."); return; }
    if (category === "event" && !eventStart) { setError("Events need a start date."); return; }
    setSaving(true);
    try {
      const input: NewPlaceInput = {
        title: title.trim(),
        description: description.trim(),
        category,
        lat: location.lat,
        lng: location.lng,
        address: location.label.startsWith("Pinned on map") ? null : location.label.split(",").slice(0, 2).join(","),
        area: area.trim() || null,
        image_url: imageUrl,
        source_url: sourceUrl.trim() || null,
        event_start: eventStart ? new Date(eventStart).toISOString() : null,
        event_end: eventEnd ? new Date(eventEnd).toISOString() : null,
      };
      const status = await submitPlace(input, user);
      onSubmitted(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: "absolute",
      ...(isMobile
        ? { left: 8, right: 8, bottom: 8, maxHeight: "80dvh" }
        : { top: 74, right: 12, width: 380, maxHeight: "calc(100dvh - 90px)" }),
      background: DS.card, borderRadius: 20, boxShadow: FLOAT_SHADOW,
      border: `1px solid ${DS.border}`, zIndex: 47,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 16px", borderBottom: `1px solid ${DS.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, color: DS.text }}>
          Put something on the map
        </span>
        <button onClick={onClose} aria-label="Close" style={{
          border: "none", background: "rgba(0,0,0,0.06)", borderRadius: 999,
          width: 28, height: 28, cursor: "pointer", color: DS.textSub, fontSize: 15,
        }}>✕</button>
      </div>

      <div style={{ overflowY: "auto", padding: "4px 16px 16px" }}>
        <label style={labelStyle}>Name</label>
        <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Secret rooftop chai spot" />

        <label style={labelStyle}>Category</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(Object.keys(CATEGORIES) as Category[]).map((c) => (
            <button key={c} onClick={() => setCategory(c)} style={{
              padding: "6px 11px", borderRadius: 999, cursor: "pointer", fontSize: 12.5,
              fontWeight: 600, fontFamily: "inherit",
              border: `1.5px solid ${category === c ? CATEGORIES[c].color : DS.border}`,
              background: category === c ? CATEGORIES[c].tint : "#fff",
              color: category === c ? CATEGORIES[c].color : DS.textSub,
            }}>
              {CATEGORIES[c].emoji} {CATEGORIES[c].label}
            </button>
          ))}
        </div>

        <label style={labelStyle}>Location</label>
        {location ? (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, background: "#f0fdf4",
            border: "1.5px solid #bbf7d0", borderRadius: 10, padding: "9px 12px", fontSize: 13,
          }}>
            <span style={{ flex: 1, color: DS.text }}>📍 {location.label}</span>
            <button onClick={() => setLocation(null)} style={{
              border: "none", background: "none", cursor: "pointer", color: DS.textSub, fontWeight: 700,
            }}>change</button>
          </div>
        ) : (
          <>
            <input style={inputStyle} value={locQuery} onChange={(e) => handleLocQuery(e.target.value)}
              placeholder="Search a place or address in Bengaluru…" />
            {searching && <div style={{ fontSize: 12, color: DS.textMut, marginTop: 5 }}>Searching…</div>}
            {locResults.map((r, i) => (
              <button key={i} onClick={() => { setLocation(r); setLocResults([]); }} style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
                marginTop: 5, borderRadius: 8, border: `1px solid ${DS.border}`, background: DS.bg,
                fontSize: 12.5, color: DS.text, cursor: "pointer", fontFamily: "inherit",
              }}>
                📍 {r.label}
              </button>
            ))}
            <button onClick={useMapCenter} style={{
              marginTop: 7, padding: "8px 12px", borderRadius: 999, cursor: "pointer",
              border: `1.5px dashed ${DS.borderMd}`, background: "#fff", fontSize: 12.5,
              fontWeight: 600, color: DS.textSub, fontFamily: "inherit",
            }}>
              🎯 Drop pin at current map center
            </button>
          </>
        )}

        <label style={labelStyle}>Why is it cool?</label>
        <textarea style={{ ...inputStyle, minHeight: 80, resize: "none", lineHeight: 1.5 }}
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What should people know before they go?" />

        <label style={labelStyle}>Photo (optional — a good pic gets people out the door)</label>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files?.[0])} />
        {imageUrl ? (
          <div style={{ position: "relative" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="Preview" style={{
              width: "100%", maxHeight: 160, objectFit: "cover", borderRadius: 12,
              border: `1.5px solid ${DS.border}`,
            }} />
            <button onClick={() => setImageUrl(null)} style={{
              position: "absolute", top: 8, right: 8, border: "none", cursor: "pointer",
              background: "rgba(0,0,0,0.55)", color: "#fff", borderRadius: 999,
              padding: "4px 10px", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit",
            }}>
              Remove
            </button>
          </div>
        ) : (
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} style={{
            width: "100%", padding: "18px 12px", borderRadius: 12, cursor: "pointer",
            border: `1.5px dashed ${DS.borderMd}`, background: DS.bg, fontSize: 13,
            fontWeight: 600, color: uploading ? DS.textMut : DS.textSub, fontFamily: "inherit",
          }}>
            {uploading ? "Uploading…" : "📸 Add a photo"}
          </button>
        )}

        <label style={labelStyle}>Area (optional)</label>
        <input style={inputStyle} value={area} onChange={(e) => setArea(e.target.value)}
          placeholder="e.g. Indiranagar" />

        <label style={labelStyle}>Link (optional — Instagram post, website…)</label>
        <input style={inputStyle} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://instagram.com/p/…" />

        {category === "event" && (
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Starts</label>
              <input type="datetime-local" style={inputStyle} value={eventStart}
                onChange={(e) => setEventStart(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Ends</label>
              <input type="datetime-local" style={inputStyle} value={eventEnd}
                onChange={(e) => setEventEnd(e.target.value)} />
            </div>
          </div>
        )}

        {error && (
          <div style={{
            marginTop: 12, padding: "9px 12px", borderRadius: 10, fontSize: 12.5,
            background: "#fef2f2", border: "1px solid #fca5a5", color: "#dc2626",
          }}>
            {error}
          </div>
        )}

        <button onClick={handleSubmit} disabled={saving} style={{
          width: "100%", marginTop: 16, padding: "12px", borderRadius: 12, border: "none",
          background: saving ? DS.borderMd : DS.accent, color: "#fff", fontSize: 14.5,
          fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
        }}>
          {saving ? "Adding…" : user.isAdmin ? "Add to the map" : "Submit for review"}
        </button>
        {!user.isAdmin && (
          <div style={{ fontSize: 11.5, color: DS.textMut, marginTop: 8, textAlign: "center" }}>
            Submissions go live after a quick review.
          </div>
        )}
      </div>
    </div>
  );
}
