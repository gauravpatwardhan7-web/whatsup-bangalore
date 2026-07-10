"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CATEGORIES, DS, CARD_SHADOW, type Category } from "@/lib/ds";
import { fetchPlaces } from "@/lib/data";
import { curate, SECTIONS, type Curation, type Section } from "@/lib/newsletter";
import { formatEventWindow, priceLabel } from "@/lib/format";
import type { Place } from "@/lib/types";

// On-site version of the weekly email. Same curation as scripts/send-newsletter.ts
// (via lib/newsletter), rendered as web cards that deep-link back to the map.
export default function NewsletterPage() {
  const [curation, setCuration] = useState<Curation<Place> | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchPlaces()
      .then((places) => setCuration(curate<Place>(places)))
      .catch(() => setError(true));
  }, []);

  const weekOf = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const hasPicks = curation && (curation.picks.length > 0 || curation.events.length > 0);

  return (
    <div style={{ minHeight: "100dvh", background: DS.bg, padding: "28px 16px 60px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <Link href="/" style={{ fontSize: 13, fontWeight: 700, color: DS.accent }}>← Back to the map</Link>
          <span style={{ fontSize: 12, color: DS.textMut }}>Week of {weekOf}</span>
        </div>

        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: DS.textMut }}>
            What&rsquo;s Trending Bangalore
          </div>
          <h1 style={{
            fontFamily: "var(--font-display)", fontSize: 34, fontWeight: 700,
            color: DS.text, letterSpacing: "-0.02em", margin: "10px 0 6px", lineHeight: 1.1,
          }}>
            Your weekend, sorted.
          </h1>
          <p style={{ fontSize: 14.5, color: DS.textSub, lineHeight: 1.6, margin: "0 auto", maxWidth: 460 }}>
            Not a top-10 list — the places the city is actually talking about, one for every mood.
          </p>
        </div>

        {error && (
          <p style={{ color: DS.textMut, fontSize: 14, textAlign: "center", marginTop: 40 }}>
            Couldn&rsquo;t load this week&rsquo;s picks. Try the <Link href="/" style={{ color: DS.accent }}>map</Link> instead.
          </p>
        )}
        {!error && !curation && (
          <p style={{ color: DS.textMut, fontSize: 14, textAlign: "center", marginTop: 40 }}>Curating this week&rsquo;s picks…</p>
        )}
        {curation && !hasPicks && (
          <p style={{ color: DS.textMut, fontSize: 14, textAlign: "center", marginTop: 40 }}>
            Nothing curated yet this week — check back soon, or <Link href="/" style={{ color: DS.accent }}>add a spot</Link>.
          </p>
        )}

        {curation?.picks.map(({ place, section }) => (
          <PickCard key={place.id} place={place} section={section} alternates={curation.runnersUp[section] ?? []} />
        ))}

        {curation && curation.events.length > 0 && (
          <div style={{ marginTop: 34 }}>
            <div style={{ fontSize: 12, letterSpacing: 2.5, textTransform: "uppercase", color: DS.accent, fontWeight: 700, marginBottom: 6 }}>
              This weekend
            </div>
            {curation.events.map((e) => (
              <Link key={e.id} href={`/?place=${e.id}`} style={{ textDecoration: "none", display: "block" }}>
                <div style={{ padding: "12px 0", borderBottom: `1px solid ${DS.border}` }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#dc2626" }}>
                    {e.event_start ? formatEventWindow(e.event_start, e.event_end) : ""}
                  </span>{" "}
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: DS.text }}>{e.title}</span>
                  {e.area && <span style={{ fontSize: 13, color: DS.textMut }}> · {e.area}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 40 }}>
          <Link href="/" style={{
            display: "inline-block", background: DS.accent, color: "#fff", textDecoration: "none",
            padding: "12px 24px", borderRadius: 8, fontSize: 14, fontWeight: 700,
          }}>
            Explore the full map →
          </Link>
        </div>
      </div>
    </div>
  );
}

function PickCard({ place, section, alternates }: { place: Place; section: Section; alternates: Place[] }) {
  const def = SECTIONS[section];
  const cat = CATEGORIES[place.category as Category];
  return (
    <Link href={`/?place=${place.id}`} style={{ textDecoration: "none", display: "block" }}>
      <div style={{
        background: DS.card, border: `1px solid ${DS.border}`, borderRadius: 12,
        boxShadow: CARD_SHADOW, padding: 18, marginTop: 22,
      }}>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: DS.accent, fontWeight: 700 }}>
          {def.label} <span style={{ color: DS.textMut, fontWeight: 400, letterSpacing: 0, textTransform: "none" }}>— {def.lede}</span>
        </div>
        <h2 style={{
          fontFamily: "var(--font-display)", fontSize: 23, fontWeight: 700, color: DS.text,
          letterSpacing: "-0.01em", margin: "6px 0 2px", lineHeight: 1.2,
        }}>
          {cat?.emoji} {place.title}
        </h2>
        {place.area && <div style={{ fontSize: 13, color: DS.textMut }}>{place.area}</div>}
        <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 13, fontWeight: 700 }}>
          {place.rating != null && (
            <span style={{ color: "#b45309" }}>
              ★ {place.rating.toFixed(1)}
              {place.rating_count != null && (
                <span style={{ color: DS.textMut, fontWeight: 500 }}> ({place.rating_count.toLocaleString("en-IN")})</span>
              )}
            </span>
          )}
          {priceLabel(place.price_level) && <span style={{ color: DS.textSub }}>{priceLabel(place.price_level)}</span>}
          {place.vote_count > 0 && <span style={{ color: DS.textSub }}>▲ {place.vote_count} locals</span>}
        </div>
        {place.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={place.image_url} alt="" loading="lazy" style={{
            width: "100%", height: 220, objectFit: "cover", borderRadius: 10, marginTop: 12,
            border: `1px solid ${DS.border}`,
          }} />
        )}
        <p style={{ fontSize: 15, color: DS.textSub, lineHeight: 1.65, margin: "12px 0 0" }}>{place.description}</p>
        {alternates.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 13, color: DS.textSub, lineHeight: 1.7 }}>
            <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: DS.textMut, fontWeight: 700 }}>
              Also on the radar{"  "}
            </span>
            {alternates.map((a, i) => (
              <span key={a.id}>
                {i > 0 && <span style={{ color: DS.border }}> · </span>}
                <b style={{ color: DS.text }}>{a.title}</b>
                {a.area && <span style={{ color: DS.textMut }}> ({a.area})</span>}
                {a.rating != null && <span style={{ color: "#b45309" }}> ★ {a.rating.toFixed(1)}</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
