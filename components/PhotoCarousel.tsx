"use client";

import { useRef, useState } from "react";
import { DS } from "@/lib/ds";

// Horizontal photo pager: touch/trackpad swipe (scroll-snap) plus prev/next
// arrow buttons for desktop mouse users, a dot row, and an index counter.
export default function PhotoCarousel({ photos, alt }: { photos: string[]; alt: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  if (photos.length === 0) return null;

  function goTo(next: number) {
    const el = ref.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(photos.length - 1, next));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
    setIdx(clamped);
  }
  // Keep the dots/counter in sync when the user swipes/scrolls directly.
  function onScroll() {
    const el = ref.current;
    if (el) setIdx(Math.round(el.scrollLeft / el.clientWidth));
  }

  const arrow = (side: "left" | "right"): React.CSSProperties => ({
    position: "absolute", top: "50%", [side]: 8, transform: "translateY(-50%)",
    width: 30, height: 30, borderRadius: 999, border: "none", cursor: "pointer",
    background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 18, fontWeight: 700,
    lineHeight: "30px", padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
  });

  const single = photos.length === 1;
  return (
    <div style={{ position: "relative", marginBottom: 12 }}>
      <div
        ref={ref}
        onScroll={onScroll}
        style={{
          display: "flex", overflowX: single ? "hidden" : "auto", borderRadius: 6,
          scrollSnapType: "x mandatory", scrollbarWidth: "none", WebkitOverflowScrolling: "touch",
        }}
      >
        {photos.map((url, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={url}
            alt={`${alt}${single ? "" : ` — photo ${i + 1}`}`}
            style={{
              width: "100%", flexShrink: 0, height: 190, objectFit: "cover",
              border: `1px solid ${DS.border}`, borderRadius: 6, scrollSnapAlign: "start",
            }}
          />
        ))}
      </div>

      {!single && (
        <>
          {idx > 0 && (
            <button aria-label="Previous photo" onClick={() => goTo(idx - 1)} style={arrow("left")}>‹</button>
          )}
          {idx < photos.length - 1 && (
            <button aria-label="Next photo" onClick={() => goTo(idx + 1)} style={arrow("right")}>›</button>
          )}
          <div style={{
            position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.55)", color: "#fff",
            borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700,
          }}>
            {idx + 1}/{photos.length}
          </div>
          <div style={{
            position: "absolute", bottom: 8, left: 0, right: 0,
            display: "flex", justifyContent: "center", gap: 6,
          }}>
            {photos.map((_, i) => (
              <button
                key={i}
                aria-label={`Go to photo ${i + 1}`}
                onClick={() => goTo(i)}
                style={{
                  width: 7, height: 7, borderRadius: 999, padding: 0, border: "none", cursor: "pointer",
                  background: i === idx ? "#fff" : "rgba(255,255,255,0.5)",
                  boxShadow: "0 0 2px rgba(0,0,0,0.6)",
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
