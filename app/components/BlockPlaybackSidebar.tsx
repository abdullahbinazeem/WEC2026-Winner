"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

export type PlaybackTrip = {
    trip_id: string;
    route_id: string;
    trip_headsign: string | null;
    direction_id: number | null;
    start_seconds: number;
    end_seconds: number;
    geometry: { type: "LineString"; coordinates: [number, number][] } | null; // [lon,lat]
    stops: Stop[];
};

type BlockDayResponse = {
    block_id: string;
    service_id: string;
    trips: Omit<PlaybackTrip, "end_seconds">[];
};

function gtfsTimeToSeconds(t: string | null | undefined): number | null {
    if (!t) return null;
    const s = String(t).trim();
    if (!s) return null;
    const m = s.match(/^(\d+):([0-5]\d):([0-5]\d)$/);
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function formatSeconds(sec: number) {
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

export default function BlockPlaybackSidebar(props: {
    onPlaybackChange: (p: {
        blockId: string;
        serviceId: string;
        trips: PlaybackTrip[];
        currentTime: number | null;
        followBus: boolean;
    } | null) => void;
}) {
    const { onPlaybackChange } = props;

    const [blocks, setBlocks] = useState<string[]>([]);
    const [days, setDays] = useState<DayOption[]>([]);
    const [blockId, setBlockId] = useState("");
    const [serviceId, setServiceId] = useState("");

    const [trips, setTrips] = useState<PlaybackTrip[]>([]);
    const [err, setErr] = useState<string | null>(null);

    const [currentTime, setCurrentTime] = useState<number | null>(null);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(10);
    const [followBus, setFollowBus] = useState(false);

    const rafRef = useRef<number | null>(null);
    const lastTickRef = useRef<number | null>(null);

    // Load blocks
    useEffect(() => {
        (async () => {
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

    // Load days for block
    useEffect(() => {
        if (!blockId) return;
        (async () => {
            setErr(null);
            setDays([]);
            setServiceId("");
            setTrips([]);
            setPlaying(false);
            setCurrentTime(null);
            onPlaybackChange(null);

            const res = await fetch(`/api/block/${encodeURIComponent(blockId)}/days`);
            if (!res.ok) {
                setErr("Failed to load days");
                return;
            }
            const j = await res.json();
            const optsRaw: { service_id: string }[] = j.days ?? [];
            const opts: DayOption[] = optsRaw.map((x) => ({ service_id: x.service_id, ...parseServiceId(x.service_id) }));
            setDays(opts);
            if (opts.length > 0) setServiceId(opts[0].service_id);
        })();
    }, [blockId, onPlaybackChange]);

    // Load trips for block+day
    useEffect(() => {
        if (!blockId || !serviceId) return;
        (async () => {
            setErr(null);
            setTrips([]);
            setPlaying(false);
            setCurrentTime(null);
            onPlaybackChange(null);

            const res = await fetch(
                `/api/block/${encodeURIComponent(blockId)}/day/${encodeURIComponent(serviceId)}`
            );
            if (!res.ok) {
                setErr("Failed to load block/day trips");
                return;
            }
            const j = (await res.json()) as BlockDayResponse;

            const tripsWithEnd: PlaybackTrip[] = (j.trips ?? []).map((t) => {
                let maxT: number | null = null;
                for (const s of t.stops) {
                    const sec = gtfsTimeToSeconds(s.departure_time) ?? gtfsTimeToSeconds(s.arrival_time);
                    if (sec == null) continue;
                    if (maxT == null || sec > maxT) maxT = sec;
                }
                const end = maxT ?? (t.start_seconds + 1);
                return { ...t, end_seconds: Math.max(end, t.start_seconds + 1) };
            });

            tripsWithEnd.sort((a, b) => a.start_seconds - b.start_seconds);

            setTrips(tripsWithEnd);
            if (tripsWithEnd.length > 0) setCurrentTime(tripsWithEnd[0].start_seconds);
        })();
    }, [blockId, serviceId, onPlaybackChange]);

    // Playback range
    const range = useMemo(() => {
        if (trips.length === 0) return null;
        const minT = Math.min(...trips.map((t) => t.start_seconds));
        const maxT = Math.max(...trips.map((t) => t.end_seconds));
        return { minT, maxT };
    }, [trips]);

    // Animation
    useEffect(() => {
        if (!playing || !range) return;

        const tick = (now: number) => {
            if (!lastTickRef.current) lastTickRef.current = now;
            const dt = (now - lastTickRef.current) / 1000;
            lastTickRef.current = now;

            setCurrentTime((prev) => {
                if (prev == null) return range.minT;
                const next = prev + dt * speed;
                if (next >= range.maxT) {
                    setPlaying(false);
                    return range.maxT;
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
    }, [playing, range, speed]);

    // Push state up to parent whenever it changes
    useEffect(() => {
        if (!blockId || !serviceId || trips.length === 0) {
            onPlaybackChange(null);
            return;
        }
        onPlaybackChange({
            blockId,
            serviceId,
            trips,
            currentTime,
            followBus,
        });
    }, [blockId, serviceId, trips, currentTime, followBus, onPlaybackChange]);

    const dayLabel = (d: DayOption) =>
        d.date && d.weekday ? `${d.weekday} (${d.date})` : d.service_id;

    return (
        <div style={{ padding: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Block Playback</h2>

            <div style={{ display: "grid", gap: 10 }}>
                <div>
                    <div style={{ fontSize: 13, marginBottom: 6 }}>Block</div>
                    <select
                        value={blockId}
                        onChange={(e) => setBlockId(e.target.value)}
                        style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
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
                        disabled={days.length === 0}
                        style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                    >
                        {days.map((d) => (
                            <option key={d.service_id} value={d.service_id}>
                                {dayLabel(d)}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {err && <div style={{ marginTop: 10, color: "#b00020", fontSize: 13 }}>{err}</div>}

            {range && (
                <div style={{ marginTop: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <b>Time</b>
                        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                            {currentTime != null ? formatSeconds(Math.floor(currentTime)) : "—"}
                        </span>
                    </div>

                    <input
                        type="range"
                        min={range.minT}
                        max={range.maxT}
                        value={currentTime ?? range.minT}
                        onChange={(e) => {
                            setPlaying(false);
                            setCurrentTime(Number(e.target.value));
                        }}
                        style={{ width: "100%", marginTop: 8 }}
                    />

                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button
                            onClick={() => setPlaying((p) => !p)}
                            disabled={currentTime == null}
                            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", background: "white" }}
                        >
                            {playing ? "Pause" : "Play"}
                        </button>
                        <button
                            onClick={() => {
                                setPlaying(false);
                                setCurrentTime(range.minT);
                            }}
                            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", background: "white" }}
                        >
                            Reset
                        </button>
                    </div>

                    <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13 }}>
                        <input
                            type="checkbox"
                            checked={followBus}
                            onChange={(e) => setFollowBus(e.target.checked)}
                        />
                        Follow bus
                    </label>

                    <div style={{ marginTop: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                            <b>Speed</b>
                            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                                {speed.toFixed(1)}×
                            </span>
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
                </div>
            )}
        </div>
    );
}
