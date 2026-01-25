"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LatLngBoundsExpression } from "leaflet";
import BlockLeafletMap from "./BlockLeafletMap";

type DayOption = { service_id: string; date: string | null; weekday: string | null };

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

    // Added client-side:
    end_seconds: number;
};

type BlockDayResponse = {
    block_id: string;
    service_id: string;
    trips: Omit<Trip, "end_seconds">[];
};

function gtfsTimeToSeconds(t: string | null | undefined): number | null {
    if (!t) return null;
    const s = String(t).trim();
    if (!s) return null;
    const m = s.match(/^(\d+):([0-5]\d):([0-5]\d)$/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    return hh * 3600 + mm * 60 + ss;
}

function formatSeconds(sec: number) {
    // show as HH:MM:SS, allowing >24h
    const hh = Math.floor(sec / 3600);
    const mm = Math.floor((sec % 3600) / 60);
    const ss = sec % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function parseServiceId(serviceId: string) {
    const m = serviceId.match(/^(\d{8})-([A-Za-z]+)-/);
    if (!m) return { date: null as string | null, weekday: null as string | null };
    const y = m[1].slice(0, 4);
    const mo = m[1].slice(4, 6);
    const d = m[1].slice(6, 8);
    return { date: `${y}-${mo}-${d}`, weekday: m[2] };
}

export default function BlockViewer() {
    const [blocks, setBlocks] = useState<string[]>([]);
    const [days, setDays] = useState<DayOption[]>([]);
    const [blockId, setBlockId] = useState<string>("");
    const [serviceId, setServiceId] = useState<string>("");
    const [followBus, setFollowBus] = useState(false);
    const [speed, setSpeed] = useState(10); // 10x default


    const [data, setData] = useState<{ block_id: string; service_id: string; trips: Trip[] } | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [loadingDays, setLoadingDays] = useState(false);
    const [loadingTrips, setLoadingTrips] = useState(false);

    // Playback state
    const [currentTime, setCurrentTime] = useState<number | null>(null);
    const [playing, setPlaying] = useState(false);
    const rafRef = useRef<number | null>(null);
    const lastTickRef = useRef<number | null>(null);

    // Load blocks
    useEffect(() => {
        (async () => {
            setErr(null);
            const res = await fetch("/api/blocks");
            if (!res.ok) {
                setErr("Failed to load blocks");
                return;
            }
            const j = await res.json();
            const bs: string[] = j.blocks ?? [];
            setBlocks(bs);
            if (bs.length > 0) setBlockId(bs[0]);
        })();
    }, []);

    // Load valid days for selected block
    useEffect(() => {
        if (!blockId) return;
        (async () => {
            setLoadingDays(true);
            setErr(null);
            setDays([]);
            setServiceId("");
            setData(null);
            setPlaying(false);
            setCurrentTime(null);

            try {
                const res = await fetch(`/api/block/${encodeURIComponent(blockId)}/days`);
                if (!res.ok) throw new Error("Failed to load days for block");
                const j = await res.json();
                const optsRaw: { service_id: string }[] = j.days ?? [];
                const opts: DayOption[] = optsRaw.map((x) => ({ service_id: x.service_id, ...parseServiceId(x.service_id) }));
                setDays(opts);
                if (opts.length > 0) setServiceId(opts[0].service_id);
            } catch (e: any) {
                setErr(e?.message ?? "Failed to load days");
            } finally {
                setLoadingDays(false);
            }
        })();
    }, [blockId]);

    // Load trips for block+day
    useEffect(() => {
        if (!blockId || !serviceId) return;
        (async () => {
            setLoadingTrips(true);
            setErr(null);
            setData(null);
            setPlaying(false);
            setCurrentTime(null);

            try {
                const res = await fetch(
                    `/api/block/${encodeURIComponent(blockId)}/day/${encodeURIComponent(serviceId)}`
                );
                if (!res.ok) {
                    const j = await res.json().catch(() => ({}));
                    throw new Error(j?.error || "Failed to load block/day trips");
                }
                const j = (await res.json()) as BlockDayResponse;

                // Compute end_seconds for each trip from stops (max of dep/arr)
                const tripsWithEnd: Trip[] = (j.trips ?? []).map((t) => {
                    let maxT: number | null = null;
                    for (const s of t.stops) {
                        const sec = gtfsTimeToSeconds(s.departure_time) ?? gtfsTimeToSeconds(s.arrival_time);
                        if (sec == null) continue;
                        if (maxT == null || sec > maxT) maxT = sec;
                    }
                    const end = maxT ?? (t.start_seconds + 1);
                    return { ...t, end_seconds: Math.max(end, t.start_seconds + 1) };
                });

                // Ensure chronological by start_seconds
                tripsWithEnd.sort((a, b) => a.start_seconds - b.start_seconds);

                const payload = { block_id: j.block_id, service_id: j.service_id, trips: tripsWithEnd };
                setData(payload);

                // Initialize playback time to start of first trip
                if (tripsWithEnd.length > 0) {
                    setCurrentTime(tripsWithEnd[0].start_seconds);
                }
            } catch (e: any) {
                setErr(e?.message ?? "Failed to load trips");
            } finally {
                setLoadingTrips(false);
            }
        })();
    }, [blockId, serviceId]);

    // Playback range
    const playbackRange = useMemo(() => {
        if (!data?.trips?.length) return null;
        const minT = Math.min(...data.trips.map((t) => t.start_seconds));
        const maxT = Math.max(...data.trips.map((t) => t.end_seconds));
        return { minT, maxT };
    }, [data]);

    // Map bounds across all geometries
    const bounds = useMemo(() => {
        if (!data?.trips?.length) return null;

        const points: [number, number][] = [];
        for (const t of data.trips) {
            if (!t.geometry) continue;
            for (const [lon, lat] of t.geometry.coordinates) {
                points.push([lat, lon]);
            }
        }
        if (points.length < 2) return null;

        const lats = points.map((p) => p[0]);
        const lons = points.map((p) => p[1]);

        return [
            [Math.min(...lats), Math.min(...lons)],
            [Math.max(...lats), Math.max(...lons)],
        ] as LatLngBoundsExpression;
    }, [data]);

    // Animation loop (requestAnimationFrame)
    useEffect(() => {
        if (!playing || !playbackRange) return;

        const speed = 10; // 10x realtime. Change as you like.

        const tick = (now: number) => {
            if (!lastTickRef.current) lastTickRef.current = now;
            const dt = (now - lastTickRef.current) / 1000; // seconds
            lastTickRef.current = now;

            setCurrentTime((prev) => {
                if (prev == null) return playbackRange.minT;
                const next = prev + dt * speed;
                if (next >= playbackRange.maxT) {
                    // stop at end
                    setPlaying(false);
                    return playbackRange.maxT;
                }
                return next;
            });

            rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            lastTickRef.current = null;
        };
    }, [playing, playbackRange]);

    const dayLabel = (d: DayOption) =>
        d.date && d.weekday ? `${d.weekday} (${d.date})` : d.service_id;

    const onSliderChange = (v: number) => {
        setPlaying(false);
        setCurrentTime(v);
    };

    return (
        <div style={{ position: "relative", height: "100vh", width: "100vw" }}>
            {/* Map (full screen) */}
            <div style={{ height: "100%", width: "100%" }}>
                <BlockLeafletMap
                    trips={data?.trips ?? []}
                    bounds={bounds}
                    currentTimeSeconds={currentTime}
                    followBus={followBus}
                />
            </div>

            {/* Overlay sidebar */}
            <div
                style={{
                    position: "absolute",
                    top: 16,
                    left: 16,
                    zIndex: 1000,
                    width: 440,
                    maxWidth: "calc(100vw - 32px)",
                    maxHeight: "calc(100vh - 32px)",
                    overflow: "auto",
                    borderRadius: 14,
                    border: "1px solid rgba(0,0,0,0.12)",
                    background: "rgba(255,255,255,0.95)",
                    backdropFilter: "blur(8px)",
                    boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
                    padding: 14,
                }}
            >
                <h1 style={{ margin: "0 0 10px", fontSize: 18 }}>Block Playback</h1>

                <div style={{ display: "grid", gap: 10 }}>
                    <div>
                        <div style={{ fontSize: 13, marginBottom: 6 }}>Block</div>
                        <select
                            value={blockId}
                            onChange={(e) => setBlockId(e.target.value)}
                            disabled={blocks.length === 0}
                            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                        >
                            {blocks.map((b) => (
                                <option key={b} value={b}>{b}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <div style={{ fontSize: 13, marginBottom: 6 }}>Day / Service</div>
                        <select
                            value={serviceId}
                            onChange={(e) => setServiceId(e.target.value)}
                            disabled={!blockId || loadingDays || days.length === 0}
                            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                        >
                            {days.map((d) => (
                                <option key={d.service_id} value={d.service_id}>
                                    {dayLabel(d)}
                                </option>
                            ))}
                        </select>
                        {loadingDays && (
                            <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>Loading days…</div>
                        )}
                    </div>
                </div>

                {err && <div style={{ marginTop: 10, color: "#b00020", fontSize: 13 }}>{err}</div>}
                {loadingTrips && <div style={{ marginTop: 10, fontSize: 13 }}>Loading trips…</div>}

                {/* Playback controls */}
                {playbackRange && (
                    <div style={{ marginTop: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                            <div><b>Time</b></div>
                            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                                {currentTime != null ? formatSeconds(Math.floor(currentTime)) : "—"}
                            </div>
                        </div>

                        <input
                            type="range"
                            min={playbackRange.minT}
                            max={playbackRange.maxT}
                            value={currentTime ?? playbackRange.minT}
                            onChange={(e) => onSliderChange(Number(e.target.value))}
                            style={{ width: "100%", marginTop: 8 }}
                        />

                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <button
                                onClick={() => setPlaying((p) => !p)}
                                disabled={currentTime == null}
                                style={{
                                    padding: "10px 12px",
                                    borderRadius: 10,
                                    border: "1px solid #ccc",
                                    background: "white",
                                    cursor: "pointer",
                                }}
                            >
                                {playing ? "Pause" : "Play"}
                            </button>

                            <button
                                onClick={() => {
                                    setPlaying(false);
                                    setCurrentTime(playbackRange.minT);
                                }}
                                style={{
                                    padding: "10px 12px",
                                    borderRadius: 10,
                                    border: "1px solid #ccc",
                                    background: "white",
                                    cursor: "pointer",
                                }}
                            >
                                Reset
                            </button>
                        </div>

                        <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
                            Range: {formatSeconds(playbackRange.minT)} → {formatSeconds(playbackRange.maxT)}
                        </div>
                    </div>
                )}

                {/* Follow toggle */}
                <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13 }}>
                    <input
                        type="checkbox"
                        checked={followBus}
                        onChange={(e) => setFollowBus(e.target.checked)}
                    />
                    Follow bus
                </label>

                {/* Speed slider */}
                <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <div><b>Speed</b></div>
                        <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                            {speed.toFixed(1)}×
                        </div>
                    </div>

                    <input
                        type="range"
                        min={0.5}
                        max={30}
                        step={0.5}
                        value={speed}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                        style={{ width: "100%", marginTop: 8 }}
                    />
                </div>


                {/* Trip list */}
                {data && (
                    <div style={{ marginTop: 14 }}>
                        <div style={{ fontSize: 13, color: "#555" }}>
                            Trips: <b>{data.trips.length}</b>
                        </div>

                        <ol style={{ paddingLeft: 18, margin: "8px 0 0", fontSize: 12 }}>
                            {data.trips.map((t) => (
                                <li key={t.trip_id} style={{ marginBottom: 6 }}>
                                    <div><b>{t.route_id}</b> — {t.trip_headsign ?? "(no headsign)"}</div>
                                    <div style={{ color: "#666" }}>
                                        {formatSeconds(t.start_seconds)} → {formatSeconds(t.end_seconds)} | trip_id {t.trip_id}
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </div>
                )}
            </div>
        </div>
    );
}
