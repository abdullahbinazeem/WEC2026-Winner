"use client";

import { useEffect, useState } from "react";

type DayOption = {
    service_id: string;
    date: string | null;
    weekday: string | null;
};

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
    start_seconds: number;
    geometry_source: string | null;
    geometry: { type: "LineString"; coordinates: [number, number][] } | null;
    stops: Stop[];
};

type Props = {
    onDataLoaded: (payload: {
        block_id: string;
        service_id: string;
        trips: Trip[];
    }) => void;
};

export default function BlockViewerSidebar({ onDataLoaded }: Props) {
    const [blocks, setBlocks] = useState<string[]>([]);
    const [days, setDays] = useState<DayOption[]>([]);
    const [blockId, setBlockId] = useState("");
    const [serviceId, setServiceId] = useState("");

    const [err, setErr] = useState<string | null>(null);
    const [loadingDays, setLoadingDays] = useState(false);
    const [loadingTrips, setLoadingTrips] = useState(false);

    // Load blocks
    useEffect(() => {
        (async () => {
            const res = await fetch("/api/blocks");
            if (!res.ok) {
                setErr("Failed to load blocks");
                return;
            }
            const j = await res.json();
            setBlocks(j.blocks ?? []);
            if ((j.blocks ?? []).length > 0) setBlockId(j.blocks[0]);
        })();
    }, []);

    // Load days for block
    useEffect(() => {
        if (!blockId) return;
        (async () => {
            setLoadingDays(true);
            setDays([]);
            setServiceId("");
            try {
                const res = await fetch(`/api/block/${encodeURIComponent(blockId)}/days`);
                if (!res.ok) throw new Error("Failed to load days");
                const j = await res.json();
                setDays(j.days ?? []);
                if ((j.days ?? []).length > 0) setServiceId(j.days[0].service_id);
            } catch (e: any) {
                setErr(e.message);
            } finally {
                setLoadingDays(false);
            }
        })();
    }, [blockId]);

    // Load trips
    useEffect(() => {
        if (!blockId || !serviceId) return;
        (async () => {
            setLoadingTrips(true);
            setErr(null);
            try {
                const res = await fetch(
                    `/api/block/${encodeURIComponent(blockId)}/day/${encodeURIComponent(serviceId)}`
                );
                if (!res.ok) throw new Error("Failed to load trips");
                const j = await res.json();
                onDataLoaded(j);
            } catch (e: any) {
                setErr(e.message);
            } finally {
                setLoadingTrips(false);
            }
        })();
    }, [blockId, serviceId, onDataLoaded]);

    const labelDay = (d: DayOption) =>
        d.date && d.weekday ? `${d.weekday} (${d.date})` : d.service_id;

    return (
        <div style={{ padding: 16 }}>
            <h2 style={{ margin: "0 0 12px" }}>Block Playback</h2>

            <div style={{ display: "grid", gap: 10 }}>
                <div>
                    <div style={{ fontSize: 13, marginBottom: 6 }}>Block</div>
                    <select
                        value={blockId}
                        onChange={(e) => setBlockId(e.target.value)}
                        style={{ width: "100%", padding: 10, borderRadius: 10 }}
                    >
                        {blocks.map((b) => (
                            <option key={b} value={b}>{b}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <div style={{ fontSize: 13, marginBottom: 6 }}>Day</div>
                    <select
                        value={serviceId}
                        onChange={(e) => setServiceId(e.target.value)}
                        disabled={loadingDays}
                        style={{ width: "100%", padding: 10, borderRadius: 10 }}
                    >
                        {days.map((d) => (
                            <option key={d.service_id} value={d.service_id}>
                                {labelDay(d)}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {err && <div style={{ marginTop: 12, color: "#b00020" }}>{err}</div>}
            {loadingTrips && <div style={{ marginTop: 12 }}>Loading trips…</div>}
        </div>
    );
}
