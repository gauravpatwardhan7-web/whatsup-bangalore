"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { BLR_CENTER, CATEGORIES, trendingTier } from "@/lib/ds";
import type { Place } from "@/lib/types";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const MAP_STYLE = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : "https://tiles.openfreemap.org/styles/liberty"; // free, no key needed

interface Props {
  places: Place[];
  selectedId: string | null;
  onSelect: (place: Place) => void;
  onCenterChange?: (center: { lat: number; lng: number }) => void;
}

export default function MapView({ places, selectedId, onSelect, onCenterChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const onSelectRef = useRef(onSelect);
  const onCenterChangeRef = useRef(onCenterChange);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onCenterChangeRef.current = onCenterChange;
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: BLR_CENTER,
      zoom: 12,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    // "Locate me" — Google-Maps-style button + live location dot.
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserLocation: true,
      }),
      "bottom-right"
    );
    map.on("moveend", () => {
      const c = map.getCenter();
      onCenterChangeRef.current?.({ lat: c.lat, lng: c.lng });
    });
    mapRef.current = map;
    // Keep the canvas sized to the container (it can be mis-measured at mount).
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync markers with the (filtered) places list.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();
    for (const place of places) {
      seen.add(place.id);
      const existing = markersRef.current.get(place.id);
      if (existing) {
        styleMarker(existing.getElement().firstElementChild as HTMLElement, place, place.id === selectedId);
        continue;
      }
      // MapLibre positions the marker element with its own inline transform,
      // so the rotated pin visual must live on an inner element — putting
      // rotate() on the marker element itself makes pins drift on zoom.
      const el = document.createElement("div");
      const inner = document.createElement("div");
      el.appendChild(inner);
      styleMarker(inner, place, place.id === selectedId);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current(place);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([place.lng, place.lat])
        .addTo(map);
      markersRef.current.set(place.id, marker);
    }
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [places, selectedId]);

  // Fly to selection when it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const place = places.find((p) => p.id === selectedId);
    if (place) {
      map.flyTo({ center: [place.lng, place.lat], zoom: Math.max(map.getZoom(), 13.5), duration: 800 });
    }
  }, [selectedId, places]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}

function styleMarker(inner: HTMLElement, place: Place, selected: boolean) {
  const cat = CATEGORIES[place.category];
  const tier = trendingTier(place.trending_score);
  inner.className = `pin${tier === "hot" ? " pin-hot" : tier === "warm" ? " pin-warm" : ""}`;
  inner.style.background = cat.color;
  inner.style.outline = selected ? `3px solid ${cat.color}55` : "none";
  inner.innerHTML = `<span>${cat.emoji}</span>`;
  inner.title = place.title;
  // Stacking must be set on the marker element MapLibre positions.
  const outer = inner.parentElement;
  if (outer) outer.style.zIndex = selected ? "30" : tier === "hot" ? "20" : tier === "warm" ? "10" : "1";
}
