"use client";

import { useEffect, useMemo } from "react";
import {
    MapContainer,
    TileLayer,
    Polyline,
    CircleMarker,
    Popup,
    useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

type Stop = {
    stop_sequence: number;
    stop_id: string;
    stop_name: string | null;
    stop_lat: number;
    stop_lon: number;
    arrival_time: string | null;
    departure_time: string | null;
};

type Trip = {
    trip_id: string;
    route_id: string;
    trip_headsign: string | null;
    direction_id: number | null;
    geometry: { type: "LineString"; coordinates: [number, number][] } | null; // [lon,lat]
    stops: Stop[];
    start_seconds: number;
    end_seconds: number;
};

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
    const map = useMap();
    useEffect(() => {
        if (!bounds) return;
        map.fitBounds(bounds, { padding: [20, 20] });
    }, [map, bounds]);
    return null;
}

function FollowBus({
    enabled,
    busPos,
}: {
    enabled: boolean;
    busPos: [number, number] | null; // [lat, lon]
}) {
    const map = useMap();

    useEffect(() => {
        if (!enabled || !busPos) return;

        // Keep current zoom; pan smoothly
        map.panTo(busPos, { animate: true });
    }, [enabled, busPos, map]);

    return null;
}

function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

function pointAlongPolyline(latlngs: [number, number][], f: number): [number, number] | null {
    if (latlngs.length === 0) return null;
    if (latlngs.length === 1) return latlngs[0];

    const clamped = Math.max(0, Math.min(1, f));

    const segLens: number[] = [];
    let total = 0;
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

export default function BlockLeafletMap({
    trips,
    bounds,
    currentTimeSeconds,
    followBus,
}: {
    trips: Trip[];
    bounds: LatLngBoundsExpression | null;
    currentTimeSeconds: number | null;
    followBus: boolean;
}) {
    const tripLines = useMemo(() => {
        return trips
            .map((t) => {
                if (!t.geometry) return null;
                const latlngs = t.geometry.coordinates.map(([lon, lat]) => [lat, lon]) as [number, number][];
                return { trip: t, latlngs };
            })
            .filter(Boolean) as { trip: Trip; latlngs: [number, number][] }[];
    }, [trips]);

    const stopDots = useMemo(() => {
        const seen = new Set<string>();
        const out: Stop[] = [];
        for (const t of trips) {
            for (const s of t.stops) {
                if (seen.has(s.stop_id)) continue;
                seen.add(s.stop_id);
                out.push(s);
            }
        }
        return out;
    }, [trips]);

    const busPos = useMemo(() => {
        if (currentTimeSeconds == null) return null;
        if (tripLines.length === 0) return null;

        let active = tripLines.find(({ trip }) =>
            currentTimeSeconds >= trip.start_seconds && currentTimeSeconds <= trip.end_seconds
        );

        if (!active && currentTimeSeconds < tripLines[0].trip.start_seconds) {
            active = tripLines[0];
            return pointAlongPolyline(active.latlngs, 0);
        }

        const last = tripLines[tripLines.length - 1];
        if (!active && currentTimeSeconds > last.trip.end_seconds) {
            return pointAlongPolyline(last.latlngs, 1);
        }

        if (!active) return null;

        const dur = Math.max(1, active.trip.end_seconds - active.trip.start_seconds);
        const f = (currentTimeSeconds - active.trip.start_seconds) / dur;
        return pointAlongPolyline(active.latlngs, f);
    }, [currentTimeSeconds, tripLines]);

    return (
        <MapContainer
            center={[53.5461, -113.4938]}
            zoom={12}
            style={{ height: "100%", width: "100%" }}
        >
            <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {tripLines.map(({ trip, latlngs }) => (
                <Polyline key={trip.trip_id} positions={latlngs} />
            ))}

            {stopDots.map((s) => (
                <CircleMarker key={s.stop_id} center={[s.stop_lat, s.stop_lon]} radius={3}>
                    <Popup>
                        <div style={{ fontSize: 13 }}>
                            <div><b>{s.stop_name ?? "Stop"}</b></div>
                            <div>ID: {s.stop_id}</div>
                        </div>
                    </Popup>
                </CircleMarker>
            ))}

            {busPos && (
                <CircleMarker center={busPos} radius={8}>
                    <Popup>
                        <div style={{ fontSize: 13 }}>
                            <b>Bus (block playback)</b>
                        </div>
                    </Popup>
                </CircleMarker>
            )}

            <FollowBus enabled={followBus} busPos={busPos} />
            <FitBounds bounds={bounds} />
        </MapContainer>
    );
}
