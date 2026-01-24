"use client";

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BusRoute, ChargingStation } from "../page";
import { useMemo } from "react";

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

// Line/route name -> driver contact (made-up placeholders). Keys are lowercased.
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
  route_id?: string | null;
  start_seconds: number;
  end_seconds: number;
  geometry: { type: "LineString"; coordinates: [number, number][] } | null; // GeoJSON [lon,lat]
  status?: "active" | "next" | "prev";
};

export type PlaybackAll = {
  buses: ActiveBus[];
  currentTime: number | null;
  showTripLines?: boolean;
};

// ---------------- Battery helpers ----------------

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

type BatteryParams = { capacityKWh: number; runKW: number; idleKW: number };

function socAtTime(
  t: number,
  intervals: { start: number; end: number }[],
  p: BatteryParams
) {
  const cap = p.capacityKWh;
  let usedKWh = 0;

  // Prefer starting battery accounting at first trip start (more intuitive)
  let cursor = intervals.length ? intervals[0].start : 0;

  for (const iv of intervals) {
    if (t <= cursor) break;

    // idle cursor -> iv.start
    const idleEnd = Math.min(t, iv.start);
    if (idleEnd > cursor) {
      usedKWh += p.idleKW * ((idleEnd - cursor) / 3600);
    }
    if (t <= iv.start) break;

    // run iv.start -> iv.end
    const runEnd = Math.min(t, iv.end);
    if (runEnd > iv.start) {
      usedKWh += p.runKW * ((runEnd - iv.start) / 3600);
    }

    cursor = Math.max(cursor, iv.end);
  }

  // idle after last trip
  if (t > cursor) usedKWh += p.idleKW * ((t - cursor) / 3600);

  const remaining = clamp(cap - usedKWh, 0, cap);
  const soc = cap > 0 ? remaining / cap : 0;

  return { soc, remainingKWh: remaining };
}

function socColor(soc: number) {
  if (soc >= 0.5) return "#16a34a"; // green
  if (soc >= 0.2) return "#f59e0b"; // amber
  return "#dc2626"; // red
}

// ---------------- Geometry helpers ----------------

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function pointAlongPolyline(latlngs: LatLng[], f: number): LatLng | null {
  if (latlngs.length === 0) return null;
  if (latlngs.length === 1) return latlngs[0];

  const clamped = Math.max(0, Math.min(1, f));

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
  playbackAll,
  intervalsByBlock,
}: {
  chargingStations: ChargingStation[];
  busRoutes?: BusRoute[];
  playbackAll?: PlaybackAll | null;
  intervalsByBlock?: Record<string, { start: number; end: number }[]>;
}) {
  const battery: BatteryParams = { capacityKWh: 450, runKW: 110, idleKW: 6 };

  const activeMarkers = useMemo(() => {
    if (!playbackAll || playbackAll.currentTime == null) return [];
    const t = playbackAll.currentTime;

    return playbackAll.buses
      .map((b) => {
        if (!b.geometry) return null;
        const coords = b.geometry.coordinates;
        if (!coords || coords.length < 2) return null;

        const latlngs: LatLng[] = coords.map(([lon, lat]) => [lat, lon]);

        // Determine marker position:
        // - active: interpolate by time fraction within [start,end]
        // - next: stick to start of line
        // - prev: stick to end of line
        let pos: LatLng | null = null;

        const dur = Math.max(1, b.end_seconds - b.start_seconds);
        const f = (t - b.start_seconds) / dur;

        if (b.status === "next") pos = latlngs[0];
        else if (b.status === "prev") pos = latlngs[latlngs.length - 1];
        else pos = pointAlongPolyline(latlngs, f);

        if (!pos) return null;

        const intervals = intervalsByBlock?.[b.block_id] ?? [];
        const socInfo =
          intervals.length && playbackAll.currentTime != null
            ? socAtTime(playbackAll.currentTime, intervals, battery)
            : null;

        const socPct = socInfo ? Math.round(socInfo.soc * 100) : null;
        const ringColor = socInfo ? socColor(socInfo.soc) : "#2563eb";

        return {
          block_id: b.block_id,
          trip_id: b.trip_id,
          route_id: b.route_id ?? null,
          pos,
          latlngs,
          socInfo,
          socPct,
          ringColor,
          status: b.status ?? "active",
        };
      })
      .filter(Boolean) as {
        block_id: string;
        trip_id: string;
        pos: LatLng;
        latlngs: LatLng[];
        socInfo: { soc: number; remainingKWh: number } | null;
        socPct: number | null;
        ringColor: string;
        status: "active" | "next" | "prev";
      }[];
  }, [playbackAll, intervalsByBlock]);

  // Decorate with nearest charging station and driver info
  const markersWithDetails = useMemo(() => {
    const ensureDriver = (routeId: string | null, blockId: string) => {
      const key = routeId?.trim().toLowerCase();
      if (key && DRIVER_DIRECTORY[key]) return DRIVER_DIRECTORY[key];

      // Deterministic fallback based on route/block so it's stable per bus
      const hashKey = key ?? blockId;
      let h = 0;
      for (let i = 0; i < hashKey.length; i++) {
        h = (h * 31 + hashKey.charCodeAt(i)) >>> 0;
      }
      return DRIVER_ROSTER[h % DRIVER_ROSTER.length];
    };

    return activeMarkers.map((m) => {
      let nearest = null as null | { name: string; distanceMeters: number };
      for (const s of chargingStations) {
        const dist = haversineMeters(m.pos, [s.lat, s.lng]);
        if (!nearest || dist < nearest.distanceMeters) {
          nearest = { name: s.name, distanceMeters: dist };
        }
      }

      return {
        ...m,
        nearest,
        driver: ensureDriver(m.route_id, m.block_id),
      };
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

      {/* OPTIONAL: draw each block's chosen trip line */}
      {playbackAll?.showTripLines &&
        markersWithDetails.map((m) => (
          <Polyline
            key={`active-trip-${m.block_id}-${m.trip_id}`}
            positions={m.latlngs}
            pathOptions={{ weight: 6, opacity: 0.9 }}
          />
        ))}

      {/* All buses at once + battery ring */}
      {markersWithDetails.map((m) => (
        <div key={`bus-wrap-${m.block_id}`}>
          {/* battery ring */}
          {m.socInfo && (
            <CircleMarker
              center={m.pos}
              radius={14}
              pathOptions={{ color: m.ringColor, weight: 4, opacity: 0.9 }}
              fillOpacity={0}
            />
          )}

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
                <div>
                  <strong>Status:</strong> {m.status}
                </div>
                <div style={{ marginTop: 6 }}>
                  <div><strong>Driver:</strong> {m.driver?.name ?? "Not assigned"}</div>
                  <div><strong>Phone:</strong> {m.driver?.phone ?? "—"}</div>
                  {m.driver?.notes && <div>{m.driver.notes}</div>}
                </div>
                {m.nearest && (
                  <div style={{ marginTop: 6 }}>
                    <div><strong>Nearest charger:</strong> {m.nearest.name}</div>
                    <div>Distance: {(m.nearest.distanceMeters / 1000).toFixed(2)} km</div>
                  </div>
                )}
                {m.socInfo && (
                  <>
                    <div>
                      <strong>Battery:</strong> {m.socPct}%
                    </div>
                    <div>
                      <strong>Remaining:</strong>{" "}
                      {m.socInfo.remainingKWh.toFixed(1)} kWh
                    </div>
                  </>
                )}
              </div>
            </Popup>
          </Marker>
        </div>
      ))}
    </MapContainer>
  );
}
