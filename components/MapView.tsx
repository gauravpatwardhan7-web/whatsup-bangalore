"use client";

import { useCallback, useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { BLR_CENTER, CATEGORIES, buzzScore, placeTier } from "@/lib/ds";
import { thumbUrl } from "@/lib/image";
import type { Category } from "@/lib/ds";
import type { Place } from "@/lib/types";

// Density is handled the way Airbnb handles listings: draw the best pins that
// fit, and drop any that would land on top of one already drawn. Nothing is
// capped or rolled into a number bubble — zoom in and the pixels between
// places grow, so the ones that were crowded out appear on their own.
//
// The gap is measured in world pixels, which depend on zoom but not on where
// the map is panned. So the visible set changes only when you zoom: panning
// never adds, removes, or reshuffles a marker.
//
// This is the one knob for how full the map feels. A pin is 24px across, so
// 30 leaves a few pixels between neighbours — packed, but nothing overlapping.
// Against the current 167 places that's ~69 pins with the whole city on
// screen and ~96 at the default zoom; 52 was airy to the point of looking
// empty (50 and 74). Turn it down for a busier map, up for a calmer one.
const MIN_PIN_GAP_PX = 30;
// Past this zoom nothing is thinned at all. Without it, places within ~30 m of
// each other (two spots in one block) would collide however far you zoomed in,
// so a handful could never be reached from the map.
const NO_THIN_ZOOM = 16;
// Buzzing and hotter always get drawn — a trending pin must never be the one
// that loses its spot.
const ALWAYS_SHOW_TIER = 2;

// This is a Bengaluru map, so it stays over Bengaluru: you can't pan off to
// another country or zoom out to the subcontinent. The box comfortably clears
// every place we hold, including the out-of-town ones (Nandi Hills to the
// north, Wonderla to the south-west). In practice the box is what stops the
// zoom-out — MapLibre won't let the viewport grow past it, which lands around
// zoom 11 with the whole metro on screen — and MIN_ZOOM is the backstop if
// these bounds are ever widened.
const CITY_BOUNDS: [[number, number], [number, number]] = [[77.25, 12.60], [78.00, 13.55]];
const MIN_ZOOM = 10;

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const MAP_STYLE = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : "https://tiles.openfreemap.org/styles/liberty"; // free, no key needed

interface Props {
  places: Place[];
  selectedId: string | null;
  // When this changes to a non-null value, the map fits to the places
  // currently shown — how the area filter zooms into one part of town.
  focusKey?: string | null;
  onSelect: (place: Place) => void;
  onCenterChange?: (center: { lat: number; lng: number }) => void;
  onMapClick?: (point: { lat: number; lng: number }) => void;
  // Pin-drop mode: crosshair cursor while the submit flow waits for a map tap.
  picking?: boolean;
  // The point tapped/dragged in pin-drop mode — shown as a draggable marker.
  pickedPin?: { lat: number; lng: number } | null;
  onPickedPinMove?: (point: { lat: number; lng: number }) => void;
}

// Web Mercator position in world pixels at a given zoom. Only the *difference*
// between two of these matters here, and that difference is the same wherever
// the map happens to be panned — which is what keeps pins from reshuffling
// under a drag.
export function worldPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const size = 512 * Math.pow(2, zoom);
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size,
  };
}

// Who wins the space when pins would overlap: whatever's open, then anything
// buzzing, then the rest round-robin across categories so one crowded
// category (food is ~2/3 of the data) can't take every remaining spot.
function pinPriority(places: Place[], selectedId: string | null): Place[] {
  const heat = (p: Place) => buzzScore(p.vote_count, p.comment_count, p.trending_score);
  const byHeat = (a: Place, b: Place) => heat(b) - heat(a);
  const open: Place[] = [];
  const hot: Place[] = [];
  const rest: Place[] = [];
  for (const p of places) {
    if (p.id === selectedId) open.push(p);
    else if (placeTier(p).level >= ALWAYS_SHOW_TIER) hot.push(p);
    else rest.push(p);
  }
  hot.sort(byHeat);
  rest.sort(byHeat);

  const queues = new Map<Category, Place[]>();
  for (const p of rest) {
    const q = queues.get(p.category);
    if (q) q.push(p);
    else queues.set(p.category, [p]);
  }
  const lists = [...queues.values()];
  const cursors = lists.map(() => 0);
  const mixed: Place[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (let i = 0; i < lists.length; i++) {
      const next = lists[i][cursors[i]];
      if (!next) continue;
      cursors[i]++;
      mixed.push(next);
      progressed = true;
    }
  }
  return [...open, ...hot, ...mixed];
}

// The pins that fit at this zoom without colliding, best first.
export function pinsThatFit(places: Place[], zoom: number, selectedId: string | null, gapPx = MIN_PIN_GAP_PX): Place[] {
  if (zoom >= NO_THIN_ZOOM) return places;
  const gapSq = gapPx * gapPx;
  const taken: { x: number; y: number }[] = [];
  const shown: Place[] = [];
  for (const place of pinPriority(places, selectedId)) {
    const { x, y } = worldPixel(place.lat, place.lng, zoom);
    const clash = taken.some((t) => (t.x - x) ** 2 + (t.y - y) ** 2 < gapSq);
    // The open pin and hot spots are drawn even if they'd overlap.
    if (clash && place.id !== selectedId && placeTier(place).level < ALWAYS_SHOW_TIER) continue;
    taken.push({ x, y });
    shown.push(place);
  }
  return shown;
}

export default function MapView({
  places, selectedId, focusKey, onSelect, onCenterChange, onMapClick, picking, pickedPin, onPickedPinMove,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Individual place pins, keyed by place id (kept stable across re-renders).
  const pointMarkers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const placesRef = useRef<Map<string, Place>>(new Map());
  // What the last render was computed from. Panning doesn't change any of it,
  // so a pan short-circuits before touching a single marker.
  const renderKeyRef = useRef("");
  const placesVersionRef = useRef(0);
  const selectedIdRef = useRef(selectedId);
  const pickedMarkerRef = useRef<maplibregl.Marker | null>(null);

  const onSelectRef = useRef(onSelect);
  const onCenterChangeRef = useRef(onCenterChange);
  const onMapClickRef = useRef(onMapClick);
  const onPickedPinMoveRef = useRef(onPickedPinMove);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onCenterChangeRef.current = onCenterChange;
    onMapClickRef.current = onMapClick;
    onPickedPinMoveRef.current = onPickedPinMove;
  });

  // Work out which pins fit at this zoom and sync the DOM markers to match.
  // Reads everything from refs so it's stable (safe to call from map events).
  const render = useCallback((force = false) => {
    const map = mapRef.current;
    if (!map) return;
    // Round the zoom so the tail end of an ease doesn't re-thin repeatedly.
    const zoom = Math.round(map.getZoom() * 4) / 4;
    const key = `${zoom}|${placesVersionRef.current}|${selectedIdRef.current ?? ""}`;
    if (!force && key === renderKeyRef.current) return; // a pan lands here
    renderKeyRef.current = key;

    const seenPoints = new Set<string>();
    // Create-or-restyle an individual pin for a place.
    const ensurePoint = (place: Place) => {
      seenPoints.add(place.id);
      const existing = pointMarkers.current.get(place.id);
      if (existing) {
        styleMarker(existing.getElement().firstElementChild as HTMLElement, place, place.id === selectedIdRef.current);
        return;
      }
      // MapLibre positions the marker element with its own inline transform,
      // so the rotated pin visual must live on an inner element.
      const el = document.createElement("div");
      const inner = document.createElement("div");
      el.appendChild(inner);
      styleMarker(inner, place, place.id === selectedIdRef.current);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current(placesRef.current.get(place.id) ?? place);
      });
      pointMarkers.current.set(
        place.id,
        new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([place.lng, place.lat]).addTo(map),
      );
    };

    for (const place of pinsThatFit([...placesRef.current.values()], zoom, selectedIdRef.current)) {
      ensurePoint(place);
    }

    // Drop pins that lost their spot at this zoom, or left the filtered set.
    for (const [id, m] of pointMarkers.current) {
      if (!seenPoints.has(id)) { m.remove(); pointMarkers.current.delete(id); }
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: BLR_CENTER,
      zoom: 12,
      minZoom: MIN_ZOOM,
      maxBounds: CITY_BOUNDS,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserLocation: true,
      }),
      "bottom-right",
    );
    map.on("moveend", () => {
      const c = map.getCenter();
      onCenterChangeRef.current?.({ lat: c.lat, lng: c.lng });
      // Re-thin once the gesture settles (no flicker mid-drag). A pan leaves
      // the render key untouched, so this is a no-op unless the zoom changed.
      render();
    });
    map.on("click", (e) => {
      onMapClickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    map.on("load", () => render());
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [render]);

  // Rebuild the cluster index whenever the (filtered) places change.
  // Re-thin whenever the (filtered) places change — a new set can free up or
  // claim spots, so this one is forced past the render-key short-circuit.
  useEffect(() => {
    placesRef.current = new Map(places.map((p) => [p.id, p]));
    placesVersionRef.current++;
    render(true);
  }, [places, render]);

  // Zoom to whatever's on screen when the focus key changes (area filter).
  // Declared after the places effect above so placesRef is already current.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusKey) return;
    const pts = [...placesRef.current.values()];
    if (!pts.length) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const p of pts) bounds.extend([p.lng, p.lat]);
    // Keep the fitted area clear of the desktop list panel and the filter rows.
    const wide = map.getContainer().clientWidth >= 768;
    map.fitBounds(bounds, {
      padding: { top: 160, bottom: wide ? 40 : 90, left: wide ? 400 : 40, right: 40 },
      maxZoom: 15.5,
      duration: 700,
    });
  }, [focusKey]);

  // Restyle selected pin + fly to it.
  useEffect(() => {
    selectedIdRef.current = selectedId;
    render();
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const place = placesRef.current.get(selectedId);
    if (place) {
      map.flyTo({ center: [place.lng, place.lat], zoom: Math.max(map.getZoom(), 13.5), duration: 800 });
    }
  }, [selectedId, render]);

  // Draggable "dropped pin" marker so the user sees (and can nudge) the point
  // they picked during the submit flow.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!pickedPin) {
      pickedMarkerRef.current?.remove();
      pickedMarkerRef.current = null;
      return;
    }
    if (pickedMarkerRef.current) {
      pickedMarkerRef.current.setLngLat([pickedPin.lng, pickedPin.lat]);
      return;
    }
    const el = document.createElement("div");
    el.className = "picked-pin";
    el.innerHTML = "<span>📍</span>";
    el.title = "Drag to adjust";
    const marker = new maplibregl.Marker({ element: el, anchor: "bottom", draggable: true })
      .setLngLat([pickedPin.lng, pickedPin.lat])
      .addTo(map);
    marker.on("dragend", () => {
      const { lat, lng } = marker.getLngLat();
      onPickedPinMoveRef.current?.({ lat, lng });
    });
    pickedMarkerRef.current = marker;
  }, [pickedPin]);

  // MapLibre manages the canvas cursor itself, so override there.
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = picking ? "crosshair" : "";
  }, [picking]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}

function styleMarker(inner: HTMLElement, place: Place, selected: boolean) {
  const cat = CATEGORIES[place.category];
  const tier = placeTier(place);
  // 96px covers the largest pin (42px) on a 2x screen with room to spare.
  const thumb = thumbUrl(place.image_url, 96);
  inner.className = `pin${tier.pinClass ? " " + tier.pinClass : ""}${selected ? " pin-sel" : ""}`;
  inner.style.setProperty("--cat", cat.color);
  inner.style.setProperty("--glow", tier.pinColor || "0,0,0");
  inner.style.backgroundImage = thumb ? `url("${encodeURI(thumb)}")` : "";
  inner.style.outline = selected ? `3px solid ${cat.color}55` : "none";
  // With a photo the emoji shrinks to a corner badge; without one it stays
  // centred as the pin's whole identity.
  inner.innerHTML =
    `<span class="${thumb ? "pin-cat" : "pin-emoji"}">${cat.emoji}</span>` +
    (tier.level >= 3 ? `<b class="pin-tier">${tier.badgeEmoji}</b>` : "");
  inner.title = place.title;
  const outer = inner.parentElement;
  if (outer) outer.style.zIndex = String(selected ? 30 : 5 + tier.level * 3);
}
