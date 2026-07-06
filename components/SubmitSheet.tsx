"use client";

import { useRef, useState } from "react";
import { CATEGORIES, DS, FLOAT_SHADOW, type Category } from "@/lib/ds";
import { searchBangalore, type GeocodeResult } from "@/lib/geocode";
import { fetchNearbyPlaces, submitPlace, uploadImage, type NearbyPlace } from "@/lib/data";
import { findDuplicate, isInBengaluru, validateEventDates } from "@/lib/guardrails";
import type { NewPlaceInput, SessionUser } from "@/lib/types";

interface Props {
  user: SessionUser;
  isMobile: boolean;
  getMapCenter: () => { lat: number; lng: number };
  onClose: () => void;
  onSubmitted: (status: "approved" | "pending") => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 5, fontSize: 13.5,
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
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupCandidate, setDupCandidate] = useState<NearbyPlace | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const url = await uploadImage(file, user);
        setImageUrls((prev) => [...prev, url]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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

  function useMyLocation() {
    if (!navigator.geolocation) { setError("Location isn't available in this browser."); return; }
    setError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLocation({ label: `My location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`, lat: latitude, lng: longitude });
        setLocResults([]);
        setLocQuery("");
        setLocating(false);
      },
      () => {
        setError("Couldn't get your location — allow location access, or search instead.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // skipDupCheck = true when the user pressed "Add anyway" on the dup warning.
  async function handleSubmit(skipDupCheck = false) {
    setError(null);
    if (!skipDupCheck) setDupCandidate(null);
    if (!title.trim()) { setError("Give it a name."); return; }
    if (!location) { setError("Pick a location — search or use the map center."); return; }
    if (!isInBengaluru(location.lat, location.lng)) {
      setError("That pin is outside Bengaluru — search again or move the map into the city.");
      return;
    }
    if (category === "event") {
      if (!eventStart) { setError("Events need a start date."); return; }
      const dateError = validateEventDates(eventStart, eventEnd);
      if (dateError) { setError(dateError); return; }
    }
    setSaving(true);
    try {
      if (!skipDupCheck) {
        // Warn-and-allow: same-ish name within ~75m → ask before saving.
        const nearby = await fetchNearbyPlaces(location.lat, location.lng).catch(() => []);
        const dup = findDuplicate(title.trim(), nearby);
        if (dup) {
          setDupCandidate(dup);
          setSaving(false);
          return;
        }
      }
      const input: NewPlaceInput = {
        title: title.trim(),
        description: description.trim(),
        category,
        lat: location.lat,
        lng: location.lng,
        address: location.label.startsWith("Pinned on map") ? null : location.label.split(",").slice(0, 2).join(","),
        area: area.trim() || null,
        image_url: imageUrls[0] ?? null,
        image_urls: imageUrls,
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
      background: DS.card, borderRadius: 10, boxShadow: FLOAT_SHADOW,
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
          border: "none", background: "rgba(0,0,0,0.06)", borderRadius: 5,
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
              padding: "6px 11px", borderRadius: 5, cursor: "pointer", fontSize: 12.5,
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
            border: "1.5px solid #bbf7d0", borderRadius: 5, padding: "9px 12px", fontSize: 13,
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
            <div style={{ display: "flex", gap: 7, marginTop: 7, flexWrap: "wrap" }}>
              <button onClick={useMyLocation} disabled={locating} style={{
                padding: "8px 12px", borderRadius: 5, cursor: "pointer",
                border: `1.5px solid ${DS.accent}`, background: "#eff3ec", fontSize: 12.5,
                fontWeight: 700, color: DS.accent, fontFamily: "inherit",
              }}>
                {locating ? "Locating…" : "📍 Use my current location"}
              </button>
              <button onClick={useMapCenter} style={{
                padding: "8px 12px", borderRadius: 5, cursor: "pointer",
                border: `1.5px dashed ${DS.borderMd}`, background: "#fff", fontSize: 12.5,
                fontWeight: 600, color: DS.textSub, fontFamily: "inherit",
              }}>
                🎯 Drop pin at map center
              </button>
            </div>
          </>
        )}

        <label style={labelStyle}>
          Why is it cool?{" "}
          <span style={{ fontWeight: 500, color: DS.textMut }}>
            (becomes the spot&rsquo;s description — you can comment on it later)
          </span>
        </label>
        <textarea style={{ ...inputStyle, minHeight: 80, resize: "none", lineHeight: 1.5 }}
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What should people know before they go?" />

        <label style={labelStyle}>Photos (optional — a good pic gets people out the door)</label>
        <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)} />
        {imageUrls.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 7 }}>
            {imageUrls.map((url, i) => (
              <div key={i} style={{ position: "relative", width: 104, height: 78 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Photo ${i + 1}`} style={{
                  width: "100%", height: "100%", objectFit: "cover", borderRadius: 6,
                  border: `1.5px solid ${DS.border}`,
                }} />
                {i === 0 && imageUrls.length > 1 && (
                  <span style={{
                    position: "absolute", bottom: 4, left: 4, background: "rgba(0,0,0,0.55)",
                    color: "#fff", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700,
                  }}>cover</span>
                )}
                <button onClick={() => setImageUrls((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`Remove photo ${i + 1}`} style={{
                    position: "absolute", top: 4, right: 4, border: "none", cursor: "pointer",
                    background: "rgba(0,0,0,0.55)", color: "#fff", borderRadius: 4,
                    width: 20, height: 20, fontSize: 11, fontWeight: 700, fontFamily: "inherit",
                    lineHeight: "20px", padding: 0,
                  }}>✕</button>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} style={{
          width: "100%", padding: imageUrls.length ? "10px 12px" : "18px 12px", borderRadius: 6,
          cursor: "pointer",
          border: `1.5px dashed ${DS.borderMd}`, background: DS.bg, fontSize: 13,
          fontWeight: 600, color: uploading ? DS.textMut : DS.textSub, fontFamily: "inherit",
        }}>
          {uploading ? "Uploading…" : imageUrls.length ? "📸 Add more photos" : "📸 Add photos"}
        </button>

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

        {dupCandidate && (
          <div style={{
            marginTop: 12, padding: "10px 12px", borderRadius: 5, fontSize: 12.5,
            background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e", lineHeight: 1.5,
          }}>
            <strong>&ldquo;{dupCandidate.title}&rdquo; already exists right there.</strong>
            {" "}Is this the same place? If it&rsquo;s genuinely different, add it anyway.
            <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
              <button onClick={() => handleSubmit(true)} disabled={saving} style={{
                padding: "6px 12px", borderRadius: 5, cursor: "pointer", fontSize: 12,
                fontWeight: 700, fontFamily: "inherit", border: "1.5px solid #f59e0b",
                background: "#fff", color: "#92400e",
              }}>
                It&rsquo;s different — add anyway
              </button>
              <button onClick={() => setDupCandidate(null)} style={{
                padding: "6px 12px", borderRadius: 5, cursor: "pointer", fontSize: 12,
                fontWeight: 600, fontFamily: "inherit", border: "none",
                background: "rgba(0,0,0,0.06)", color: DS.textSub,
              }}>
                Never mind
              </button>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            marginTop: 12, padding: "9px 12px", borderRadius: 5, fontSize: 12.5,
            background: "#fef2f2", border: "1px solid #fca5a5", color: "#dc2626",
          }}>
            {error}
          </div>
        )}

        <button onClick={() => handleSubmit()} disabled={saving} style={{
          width: "100%", marginTop: 16, padding: "12px", borderRadius: 6, border: "none",
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
