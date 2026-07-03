"use client";

import { CARD_SHADOW, CATEGORIES, DS, placeTier } from "@/lib/ds";
import { formatEventWindow } from "@/lib/format";
import type { Place } from "@/lib/types";

interface Props {
  place: Place;
  selected: boolean;
  onClick: () => void;
}

export default function PlaceCard({ place, selected, onClick }: Props) {
  const cat = CATEGORIES[place.category];
  const tier = placeTier(place);
  return (
    <button
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left",
        background: selected ? cat.tint : DS.card,
        border: `1.5px solid ${selected ? cat.color : DS.border}`,
        borderRadius: 16, padding: "12px 14px", marginBottom: 10,
        boxShadow: CARD_SHADOW, cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>{cat.emoji}</span>
            <span style={{
              fontFamily: "var(--font-display)", fontSize: 15.5, fontWeight: 700,
              color: DS.text, letterSpacing: "-0.01em", flex: 1,
            }}>
              {place.title}
            </span>
            {tier.label && (
              <span style={{
                fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 999,
                background: tier.badgeBg, color: tier.color,
                border: `1px solid ${tier.badgeBorder}`, whiteSpace: "nowrap",
              }}>
                {tier.badgeEmoji} {tier.label}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: DS.textSub, marginTop: 4, marginLeft: 26 }}>
            {cat.label}{place.area ? ` · ${place.area}` : ""}
            {place.event_start && (
              <span style={{ color: "#dc2626", fontWeight: 600 }}>
                {" "}· {formatEventWindow(place.event_start, place.event_end)}
              </span>
            )}
          </div>
          <div style={{
            display: "flex", gap: 14, marginTop: 8, marginLeft: 26,
            fontSize: 12.5, color: DS.textMut, fontWeight: 600,
          }}>
            <span style={{ color: place.voted_by_me ? DS.accent : DS.textMut }}>
              ▲ {place.vote_count}
            </span>
            <span>💬 {place.comment_count}</span>
          </div>
        </div>
        {place.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={place.image_url} alt="" loading="lazy" style={{
            width: 72, height: 72, borderRadius: 12, objectFit: "cover",
            flexShrink: 0, alignSelf: "center", border: `1px solid ${DS.border}`,
          }} />
        ) : (
          <div style={{
            width: 72, height: 72, borderRadius: 12, flexShrink: 0, alignSelf: "center",
            background: cat.tint, border: `1px solid ${DS.border}`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
          }}>
            {cat.emoji}
          </div>
        )}
      </div>
    </button>
  );
}
