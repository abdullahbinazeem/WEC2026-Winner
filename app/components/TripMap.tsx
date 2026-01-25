"use client";

import { useMemo, useState } from "react";
import type { LatLngBoundsExpression } from "leaflet";
import TripLeafletMap from "./TripLeafletMap";

type ApiStop = {
    stop_sequence: number;
    stop_id: string;
    stop_name: string | null;
    stop_lat: number;
    stop_lon: number;
};

type ApiResponse = {
    trip: {
        trip_id: string;
        route_id: string;
        trip_headsign: string | null;
        direction_id: number | null;
        geometry_source: string;
    };
    geometry: {
        type: "LineString";
        coordinates: [number, number][]; // [lon, lat]
    };
    stops: ApiStop[];
};

export default function TripMap() {
    const [tripId, setTripId] = useState("");
    const [data, setData] = useState<ApiResponse | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function loadTrip(id: string) {
        setLoading(true);
        setErr(null);
        setData(null);

        try {
            const res = await fetch(`/api/trip/${encodeURIComponent(id)}`);
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error(j?.error || `Request failed (${res.status})`);
            }
            const j = (await res.json()) as ApiResponse;
            setData(j);
        } catch (e: any) {
            setErr(e?.message || "Failed to load trip");
        } finally {
            setLoading(false);
        }
    }

    const polylineLatLngs = useMemo(() => {
        if (!data) return [];
        // GeoJSON coordinates are [lon, lat] -> Leaflet needs [lat, lon]
        return data.geometry.coordinates.map(([lon, lat]) => [lat, lon]) as [
            number,
            number
        ][];
    }, [data]);

    const bounds = useMemo(() => {
        if (polylineLatLngs.length < 2) return null;

        const lats = polylineLatLngs.map((p) => p[0]);
        const lons = polylineLatLngs.map((p) => p[1]);

        return [
            [Math.min(...lats), Math.min(...lons)],
            [Math.max(...lats), Math.max(...lons)],
        ] as LatLngBoundsExpression;
    }, [polylineLatLngs]);

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "360px 1fr",
                height: "100vh",
            }}
        >
            {/* Sidebar */}
            <div
                style={{
                    padding: 16,
                    borderRight: "1px solid #eee",
                    overflow: "auto",
                }}
            >
                <h1 style={{ margin: "0 0 12px" }}>GTFS Trip Viewer</h1>

                <label style={{ display: "block", fontSize: 14, marginBottom: 6 }}>
                    Trip ID
                </label>

                <div style={{ display: "flex", gap: 8 }}>
                    <input
                        value={tripId}
                        onChange={(e) => setTripId(e.target.value)}
                        placeholder="e.g. 28708008"
                        style={{
                            flex: 1,
                            padding: "10px 12px",
                            border: "1px solid #ccc",
                            borderRadius: 10,
                            outline: "none",
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && tripId.trim() && !loading) {
                                loadTrip(tripId.trim());
                            }
                        }}
                    />

                    <button
                        onClick={() => tripId.trim() && loadTrip(tripId.trim())}
                        disabled={!tripId.trim() || loading}
                        style={{
                            padding: "10px 14px",
                            borderRadius: 10,
                            border: "1px solid #ccc",
                            background: loading ? "#f3f3f3" : "white",
                            cursor: loading ? "not-allowed" : "pointer",
                        }}
                    >
                        {loading ? "Loading…" : "Load"}
                    </button>
                </div>

                {err && (
                    <div style={{ marginTop: 12, color: "#b00020", fontSize: 14 }}>
                        {err}
                    </div>
                )}

                {data && (
                    <>
                        <div style={{ marginTop: 14, fontSize: 14, lineHeight: 1.4 }}>
                            <div>
                                <b>Route:</b> {data.trip.route_id}
                            </div>
                            <div>
                                <b>Headsign:</b> {data.trip.trip_headsign ?? "(none)"}
                            </div>
                            <div>
                                <b>Direction:</b>{" "}
                                {data.trip.direction_id ?? "(unknown)"}
                            </div>
                            <div>
                                <b>Geometry:</b> {data.trip.geometry_source}
                            </div>
                            <div>
                                <b>Stops:</b> {data.stops.length}
                            </div>
                        </div>

                        <h2 style={{ marginTop: 16, fontSize: 16 }}>Stop List</h2>
                        <ol style={{ paddingLeft: 18, margin: 0, fontSize: 13 }}>
                            {data.stops.map((s) => (
                                <li key={`${s.stop_id}-${s.stop_sequence}`}>
                                    {s.stop_name ?? s.stop_id}
                                </li>
                            ))}
                        </ol>
                    </>
                )}

                {!data && !err && (
                    <div style={{ marginTop: 14, fontSize: 13, color: "#555" }}>
                        Enter a <code>trip_id</code> to load geometry + stops from the SQLite
                        master database.
                    </div>
                )}
            </div>

            {/* Map */}
            <div style={{ height: "100%", width: "100%" }}>
                <TripLeafletMap
                    polylineLatLngs={polylineLatLngs}
                    stops={data?.stops ?? []}
                    bounds={bounds}
                />
            </div>
        </div>
    );
}
