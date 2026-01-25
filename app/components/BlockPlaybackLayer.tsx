"use client";

import { useEffect, useMemo } from "react";
import { CircleMarker, Polyline, useMap } from "react-leaflet";

type Stop = {
    stop_id: string;
    stop_lat: number;
    stop_lon: number;
};

type Trip = {
    trip_id: string;
    start_seconds: number;
    end_seconds: number;
    geometry: { type: "LineString"; coordinates: [number, number][] } | null; // [lon,lat]
    stops: Stop[];
};

function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

function pointAlongPolyline(latlngs: [number, number][], f: number): [number, number] | null {
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

export default function BlockPlaybackLayer(props: {
    trips: Trip[];
    currentTime: number | null;
    followBus: boolean;
    showBlockLines?: boolean;
}) {
    const { trips, currentTime, followBus, showBlockLines = false } = props;
    const map = useMap();

    const tripLines = useMemo(() => {
        return trips
            .map((t) => {
                if (!t.geometry) return null;
                const latlngs = t.geometry.coordinates.map(([lon, lat]) => [lat, lon]) as [number, number][];
                return { trip: t, latlngs };
            })
            .filter(Boolean) as { trip: Trip; latlngs: [number, number][] }[];
    }, [trips]);

    const busPos = useMemo(() => {
        if (currentTime == null || tripLines.length === 0) return null;

        let active = tripLines.find(({ trip }) =>
            currentTime >= trip.start_seconds && currentTime <= trip.end_seconds
        );

        if (!active && currentTime < tripLines[0].trip.start_seconds) {
            active = tripLines[0];
            return pointAlongPolyline(active.latlngs, 0);
        }

        const last = tripLines[tripLines.length - 1];
        if (!active && currentTime > last.trip.end_seconds) {
            return pointAlongPolyline(last.latlngs, 1);
        }

        if (!active) return null;

        const dur = Math.max(1, active.trip.end_seconds - active.trip.start_seconds);
        const f = (currentTime - active.trip.start_seconds) / dur;
        return pointAlongPolyline(active.latlngs, f);
    }, [currentTime, tripLines]);

    useEffect(() => {
        if (!followBus || !busPos) return;
        map.panTo(busPos, { animate: true });
    }, [followBus, busPos, map]);

    return (
        <>
            {showBlockLines &&
                tripLines.map(({ trip, latlngs }) => (
                    <Polyline key={trip.trip_id} positions={latlngs} />
                ))}

            {busPos && <CircleMarker center={busPos} radius={8} />}
        </>
    );
}
