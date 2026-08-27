"use client";

import { useCallback, useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import Supercluster from "supercluster";
import { BLR_CENTER, CATEGORIES, placeTier } from "@/lib/ds";
import { thumbUrl } from "@/lib/image";
import type { Place } from "@/lib/types";

// Clustering is currently OFF: MapApp caps the map at 100 places, which is
// sparse enough to show every pin individually — and number bubbles hid the
// photos that make pins tell places apart. The clustering path below stays
// intact; drop this below that cap to switch it back on.
const CLUSTER_THRESHOLD = 250;
// If clustering does come back, these tiers stay out of it — a glowing pin
// buried in a number bubble defeats the point.
const ALWAYS_SHOW_TIER = 2;

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const MAP_STYLE = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : "https://tiles.openfreemap.org/styles/liberty"; // free, no key needed

interface Props {
  places: Place[];
  selectedId: string | null;
  onSelect: (place: Place) => void;
  onCenterChange?: (center: { lat: number; lng: number }) => void;
  onMapClick?: (point: { lat: number; lng: number }) => void;
  // Pin-drop mode: crosshair cursor while the submit flow waits for a map tap.
  picking?: boolean;
  // The point tapped/dragged in pin-drop mode — shown as a draggable marker.
  pickedPin?: { lat: number; lng: number } | null;
  onPickedPinMove?: (point: { lat: number; lng: number }) => void;
}

type PointProps = { placeId: string };

export default function MapView({
  places, selectedId, onSelect, onCenterChange, onMapClick, picking, pickedPin, onPickedPinMove,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Individual place pins, keyed by place id (kept stable across re-renders).
  const pointMarkers = useRef<Map<string, maplibregl.Marker>>(new Map());
  // Cluster bubbles, keyed by "<zoom>:<cluster_id>" so a bubble that survives
  // a pan is reused in place instead of flashing out and back in on move-end.
  const clusterMarkers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const indexRef = useRef<Supercluster<PointProps> | null>(null);
  const placesRef = useRef<Map<string, Place>>(new Map());
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

  // Recompute clusters for the current viewport + zoom and sync DOM markers.
  // Reads everything from refs so it's stable (safe to call from map events).
  const render = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const index = indexRef.current; // null below the clustering threshold

    const seenPoints = new Set<string>();
    const seenClusters = new Set<string>();
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

    if (index) {
      // Cluster over the whole world, not just the viewport. With a few
      // hundred pins the marker count is tiny, and when every bubble/pin
      // exists up front, panning never adds, removes, or moves a single
      // marker — they're geo-anchored and just glide with the map. Bubbles
      // only regroup on zoom, where regrouping is what the user expects.
      // (Revisit if the map ever grows to thousands of places.)
      const zoom = Math.round(map.getZoom());
      const clusters = index.getClusters([-180, -90, 180, 90], zoom);
      for (const c of clusters) {
        const [lng, lat] = c.geometry.coordinates as [number, number];
        const props = c.properties as Supercluster.ClusterProperties | PointProps;
        if ("cluster" in props && props.cluster) {
          const clusterId = props.cluster_id;
          // Same id at the same zoom = same position and count, so an existing
          // bubble can be left exactly as it is.
          const key = `${zoom}:${clusterId}`;
          seenClusters.add(key);
          if (!clusterMarkers.current.has(key)) {
            const el = clusterElement(props.point_count);
            el.addEventListener("click", () => {
              const target = index.getClusterExpansionZoom(clusterId);
              map.easeTo({ center: [lng, lat], zoom: Math.min(target, 18), duration: 500 });
            });
            clusterMarkers.current.set(
              key,
              new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(map),
            );
          }
        } else {
          const place = placesRef.current.get((props as PointProps).placeId);
          if (place) ensurePoint(place);
        }
      }
      // Hot spots (buzzing / on fire) and the open one are never buried in a
      // cluster — they're excluded from the index and always drawn individually.
      for (const place of placesRef.current.values()) {
        if (placeTier(place).level >= ALWAYS_SHOW_TIER || place.id === selectedIdRef.current) ensurePoint(place);
      }
    } else {
      // Below the threshold: no clustering, every place is its own pin.
      for (const place of placesRef.current.values()) ensurePoint(place);
    }

    // Drop pins that clustered away and bubbles that dissolved (zoom change
    // or index rebuild) — panning alone never changes either set.
    for (const [id, m] of pointMarkers.current) {
      if (!seenPoints.has(id)) { m.remove(); pointMarkers.current.delete(id); }
    }
    for (const [key, m] of clusterMarkers.current) {
      if (!seenClusters.has(key)) { m.remove(); clusterMarkers.current.delete(key); }
    }
  }, []);

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
      render(); // re-cluster after the pan/zoom settles (no flicker mid-gesture)
    });
    map.on("click", (e) => {
      onMapClickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    map.on("load", render);
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
  useEffect(() => {
    placesRef.current = new Map(places.map((p) => [p.id, p]));
    // A fresh index reuses cluster ids for different groupings — stale bubbles
    // keyed on old ids would be wrong, so start clean.
    for (const m of clusterMarkers.current.values()) m.remove();
    clusterMarkers.current.clear();
    // Clustering only kicks in once the map gets busy. Below the threshold every
    // pin stands on its own; a null index tells render() to skip clustering.
    if (places.length < CLUSTER_THRESHOLD) {
      indexRef.current = null;
      render();
      return;
    }
    // Only cluster the quieter pins — buzzing / on-fire spots stay individual so
    // they're never hidden. minPoints:4 + small radius keeps clustering gentle
    // (lone pairs stay separate), and by ~zoom 14 everything is loose.
    const clusterable = places.filter((p) => placeTier(p).level < ALWAYS_SHOW_TIER);
    const index = new Supercluster<PointProps>({ radius: 30, maxZoom: 14, minPoints: 4 });
    index.load(
      clusterable.map((p) => ({
        type: "Feature" as const,
        properties: { placeId: p.id },
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      })),
    );
    indexRef.current = index;
    render();
  }, [places, render]);

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

function clusterElement(count: number): HTMLElement {
  // Bigger bubbles for denser clusters.
  const size = count < 10 ? 34 : count < 50 ? 42 : 52;
  const el = document.createElement("div");
  el.className = "cluster-pin";
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.textContent = count >= 1000 ? `${Math.round(count / 100) / 10}k` : String(count);
  return el;
}

function styleMarker(inner: HTMLElement, place: Place, selected: boolean) {
  const cat = CATEGORIES[place.category];
  const tier = placeTier(place);
  // 96px covers the largest pin (42px) on a 2x screen with room to spare.
  const thumb = thumbUrl(place.image_url, 96);
  inner.className = `pin${tier.pinClass ? " " + tier.pinClass : ""}`;
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
