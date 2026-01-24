"use client";

import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BusRoute, ChargingStation } from "../page";
import { useEffect, useState, useMemo } from "react";

const chargingIcon = L.icon({
  iconUrl: "/assets/charging_station_icon.png",
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [-4, -16],
});

const busIcon = L.icon({
  iconUrl: "/assets/bus_icon.png",
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

// Lightweight directory: line/route name -> driver contact. Add real data when available.
// Keys are stored lowercased for flexible matching.
const DRIVER_DIRECTORY: Record<string, { name: string; phone: string; notes?: string }> = {
  "green line": { name: "Jordan Alvarez", phone: "780-555-4123", notes: "Day shift" },
  "blue line": { name: "Priya Desai", phone: "780-555-7741", notes: "Night shift" },
  "red line": { name: "Marcus Bell", phone: "780-555-6644" },
  "orange line": { name: "Elena Park", phone: "780-555-2255" },
  "north loop": { name: "Sofia Ramirez", phone: "780-555-8890" },
  "south loop": { name: "Caleb Wright", phone: "780-555-0917" },
  "east express": { name: "Liam Thompson", phone: "780-555-3826" },
  "west rapid": { name: "Avery McKenzie", phone: "780-555-5408" },
};

const DRIVER_ROSTER = [
  { name: "Harper Collins", phone: "780-555-1304" },
  { name: "Noah Patel", phone: "780-555-2479" },
  { name: "Maya Singh", phone: "780-555-6682" },
  { name: "Oliver Chen", phone: "780-555-9044" },
  { name: "Zoe Martinez", phone: "780-555-3176" },
  { name: "Ethan Brooks", phone: "780-555-8621" },
  { name: "Isla Nguyen", phone: "780-555-7490" },
  { name: "Henry Adams", phone: "780-555-5013" },
];

type LatLng = [number, number]; // [lat, lon]

/** From /api/playback buses[] */
export type ActiveBus = {
  block_id: string;
  trip_id: string;
  route_id: string | null;
  start_seconds: number;
  end_seconds: number;
  geometry: { type: "LineString"; coordinates: [number, number][] } | null; // GeoJSON [lon,lat]
};

export type PlaybackAll = {
  buses: ActiveBus[];
  currentTime: number | null;
  showTripLines?: boolean;
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function pointAlongPolyline(latlngs: LatLng[], f: number): LatLng | null {
  if (latlngs.length === 0) return null;
  if (latlngs.length === 1) return latlngs[0];

  const clamped = Math.max(0, Math.min(1, f));

  // Segment lengths (in degrees; fine for visualization)
  let total = 0;
  const segLens: number[] = [];
  for (let i = 0; i < latlngs.length - 1; i++) {
    const [lat1, lon1] = latlngs[i];
    const [lat2, lon2] = latlngs[i + 1];
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const len = Math.sqrt(dLat * dLat + dLon * dLon);
    segLens.push(len);
    total += len;
  }

  if (total === 0) return latlngs[0];

  const target = clamped * total;

  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    const len = segLens[i];
    if (acc + len >= target) {
      const localT = (target - acc) / (len || 1);
      const [lat1, lon1] = latlngs[i];
      const [lat2, lon2] = latlngs[i + 1];
      return [lerp(lat1, lat2, localT), lerp(lon1, lon2, localT)];
    }
    acc += len;
  }

  return latlngs[latlngs.length - 1];
}

function haversineMeters(a: LatLng, b: LatLng) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000; // meters
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export default function LeafletMap({
  chargingStations,
  busRoutes,
  playbackAll, // <-- NEW
}: {
  chargingStations: ChargingStation[];
  busRoutes?: BusRoute[];
  playbackAll?: PlaybackAll | null;
}) {
  // Compute all active bus marker positions whenever time/buses update
  const activeMarkers = useMemo(() => {
    if (!playbackAll || playbackAll.currentTime == null) return [];

    const t = playbackAll.currentTime;

    return playbackAll.buses
      .map((b) => {
        if (!b.geometry) return null;

        const coords = b.geometry.coordinates;
        if (!coords || coords.length < 2) return null;

        // Convert GeoJSON [lon,lat] to Leaflet [lat,lon]
        const latlngs: LatLng[] = coords.map(([lon, lat]) => [lat, lon]);

        const dur = Math.max(1, b.end_seconds - b.start_seconds);
        const f = (t - b.start_seconds) / dur;

        const pos = pointAlongPolyline(latlngs, f);
        if (!pos) return null;

        return {
          block_id: b.block_id,
          trip_id: b.trip_id,
          route_id: b.route_id ?? null,
          pos,
          latlngs, // useful if you want to draw the active trip line
        };
      })
      .filter(Boolean) as { block_id: string; trip_id: string; route_id: string | null; pos: LatLng; latlngs: LatLng[] }[];
  }, [playbackAll]);

  // Pair each active bus with its nearest charging station
  const markersWithNearest = useMemo(() => {
    const ensureDriver = (routeId: string | null, blockId: string) => {
      const normalized = routeId?.trim().toLowerCase();
      if (normalized && DRIVER_DIRECTORY[normalized]) return DRIVER_DIRECTORY[normalized];
      // Fallback: pick a fake driver deterministically by hash of route/block so it is stable per bus.
      const key = normalized ?? blockId;
      let hash = 0;
      for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
      }
      return DRIVER_ROSTER[hash % DRIVER_ROSTER.length];
    };

    if (chargingStations.length === 0) {
      return activeMarkers.map((m) => ({
        ...m,
        nearest: null as const,
        driver: ensureDriver(m.route_id, m.block_id),
      }));
    }

    return activeMarkers.map((m) => {
      let nearest = null as null | { name: string; distanceMeters: number };
      for (const s of chargingStations) {
        const dist = haversineMeters(m.pos, [s.lat, s.lng]);
        if (!nearest || dist < nearest.distanceMeters) {
          nearest = { name: s.name, distanceMeters: dist };
        }
      }
      const driver = ensureDriver(m.route_id, m.block_id);
      return { ...m, nearest, driver };
    });
  }, [activeMarkers, chargingStations]);

  return (
    <MapContainer
      center={[53.5462, -113.4912]}
      zoom={11}
      style={{ height: "100vh", width: "100%", zIndex: 0 }}
    >
      <TileLayer url="https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png" />

      {/* Charging Stations */}
      {chargingStations.map((s, i) => (
        <Marker key={i} position={[s.lat, s.lng]} icon={chargingIcon}>
          <Popup>{s.name}</Popup>
        </Marker>
      ))}

      {/* Bus Routes (static) */}
      {busRoutes?.map((route) =>
        route.lines.map((line, idx) => (
          <Polyline
            key={`${route.routeId}-${idx}`}
            positions={line}
            pathOptions={{
              color: route.color,
              weight: 4,
              opacity: 1,
            }}
          >
            <Popup>
              <strong>Route:</strong> {route.routeId}
            </Popup>
          </Polyline>
        ))
      )}

      {/* OPTIONAL: draw each active block's current trip line */}
      {playbackAll?.showTripLines &&
        markersWithNearest.map((m) => (
          <Polyline
            key={`active-trip-${m.block_id}-${m.trip_id}`}
            positions={m.latlngs}
            pathOptions={{ weight: 6, opacity: 0.9 }}
          />
        ))}

      {/* NEW: all active buses at once */}
      {markersWithNearest.map((m) => (
        <Marker key={`bus-${m.block_id}`} position={m.pos} icon={busIcon}>
          <Popup>
            <div style={{ fontSize: 13 }}>
              <div>
                <strong>Block:</strong> {m.block_id}
              </div>
              <div>
                <strong>Trip:</strong> {m.trip_id}
              </div>
              <div>
                <strong>Line:</strong> {m.route_id ?? "—"}
              </div>
              <div style={{ marginTop: 6 }}>
                <div><strong>Driver:</strong> {m.driver ? m.driver.name : "Not assigned"}</div>
                <div><strong>Phone:</strong> {m.driver ? m.driver.phone : "—"}</div>
                {m.driver?.notes && <div>{m.driver.notes}</div>}
              </div>
              {m.nearest && (
                <div style={{ marginTop: 6 }}>
                  <div><strong>Nearest charger:</strong> {m.nearest.name}</div>
                  <div>Distance: {(m.nearest.distanceMeters / 1000).toFixed(2)} km</div>
                </div>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
