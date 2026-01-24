"use client";

import { useEffect } from "react";
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
};

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
    const map = useMap();

    useEffect(() => {
        if (!bounds) return;
        map.fitBounds(bounds, { padding: [20, 20] });
    }, [map, bounds]);

    return null;
}

export default function TripLeafletMap(props: {
    polylineLatLngs: [number, number][];
    stops: Stop[];
    bounds: LatLngBoundsExpression | null;
}) {
    const { polylineLatLngs, stops, bounds } = props;

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

            {polylineLatLngs.length > 0 && <Polyline positions={polylineLatLngs} />}

            {stops.map((s) => (
                <CircleMarker
                    key={`${s.stop_id}-${s.stop_sequence}`}
                    center={[s.stop_lat, s.stop_lon]}
                    radius={4}
                >
                    <Popup>
                        <div style={{ fontSize: 13 }}>
                            <div>
                                <b>{s.stop_name ?? "Stop"}</b>
                            </div>
                            <div>ID: {s.stop_id}</div>
                            <div>Seq: {s.stop_sequence}</div>
                        </div>
                    </Popup>
                </CircleMarker>
            ))}

            <FitBounds bounds={bounds} />
        </MapContainer>
    );
}
