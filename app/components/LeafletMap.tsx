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

type LatLng = [number, number]; // [lat, lon]

/** From /api/playback buses[] */
export type ActiveBus = {
  block_id: string;
  trip_id: string;
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
          pos,
          latlngs, // useful if you want to draw the active trip line
        };
      })
      .filter(Boolean) as { block_id: string; trip_id: string; pos: LatLng; latlngs: LatLng[] }[];
  }, [playbackAll]);

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
        activeMarkers.map((m) => (
          <Polyline
            key={`active-trip-${m.block_id}-${m.trip_id}`}
            positions={m.latlngs}
            pathOptions={{ weight: 6, opacity: 0.9 }}
          />
        ))}

      {/* NEW: all active buses at once */}
      {activeMarkers.map((m) => (
        <Marker key={`bus-${m.block_id}`} position={m.pos} icon={busIcon}>
          <Popup>
            <div style={{ fontSize: 13 }}>
              <div>
                <strong>Block:</strong> {m.block_id}
              </div>
              <div>
                <strong>Trip:</strong> {m.trip_id}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
