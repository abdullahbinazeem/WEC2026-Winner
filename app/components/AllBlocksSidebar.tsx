"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function parseServiceId(serviceId: string) {
    const m = serviceId.match(/^(\d{8})-([A-Za-z]+)-/);
    if (!m) return { date: null as string | null, weekday: null as string | null };
    const y = m[1].slice(0, 4);
    const mo = m[1].slice(4, 6);
    const d = m[1].slice(6, 8);
    return { date: `${y}-${mo}-${d}`, weekday: m[2] };
}

function formatSeconds(sec: number) {
    const hh = Math.floor(sec / 3600);
    const mm = Math.floor((sec % 3600) / 60);
    const ss = sec % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

export default function AllBlocksSidebar(props: {
    onChange: (v: { serviceId: string; currentTime: number; speed: number; playing: boolean }) => void;
}) {
    const { onChange } = props;

    const [days, setDays] = useState<string[]>([]);
    const [serviceId, setServiceId] = useState("");
    const [currentTime, setCurrentTime] = useState(8 * 3600); // default 08:00:00
    const [speed, setSpeed] = useState(10);
    const [playing, setPlaying] = useState(false);

    const rafRef = useRef<number | null>(null);
    const lastTickRef = useRef<number | null>(null);

    useEffect(() => {
        (async () => {
            const res = await fetch("/api/days");
            const j = await res.json();
            const d = (j.days ?? []) as string[];
            setDays(d);
            if (d.length > 0) setServiceId(d[0]);
        })();
    }, []);

    // Emit state upward
    useEffect(() => {
        if (!serviceId) return;
        onChange({ serviceId, currentTime, speed, playing });
    }, [serviceId, currentTime, speed, playing, onChange]);

    // Play loop (just advances time; parent decides how to render)
    useEffect(() => {
        if (!playing) return;

        const tick = (now: number) => {
            if (!lastTickRef.current) lastTickRef.current = now;
            const dt = (now - lastTickRef.current) / 1000;
            lastTickRef.current = now;

            setCurrentTime((t) => Math.max(0, t + dt * speed));

            rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            lastTickRef.current = null;
        };
    }, [playing, speed]);

    const dayOptions = useMemo(() => {
        return days.map((id) => ({ id, ...parseServiceId(id) }));
    }, [days]);



    return (
        <div style={{ padding: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>All Blocks Playback</h2>

            <div style={{ display: "grid", gap: 10 }}>
                <div>
                    <div style={{ fontSize: 13, marginBottom: 6 }}>Day / Service</div>
                    <select
                        value={serviceId}
                        onChange={(e) => setServiceId(e.target.value)}
                        className="w-full border rounded p-2"
                    >
                        <option value="" disabled>
                            Select service day
                        </option>
                        {dayOptions.map((d) => (
                            <option key={d.id} value={d.id}>
                                {d.date && d.weekday ? `${d.weekday} (${d.date})` : d.id}
                            </option>
                        ))}
                    </select>


                </div>

                <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <b>Time</b>
                        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                            {formatSeconds(Math.floor(currentTime))}
                        </span>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={24 * 3600 - 1}
                        step={30}
                        value={currentTime ?? 0}
                        onChange={(e) => setCurrentTime(Number(e.target.value))}
                        className="w-full"
                    />

                    <div className="text-sm text-gray-600">
                        Time: {currentTime !== null
                            ? new Date(currentTime * 1000).toISOString().substr(11, 8)
                            : "—"}
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button
                            onClick={() => setPlaying((p) => !p)}
                            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", background: "white" }}
                        >
                            {playing ? "Pause" : "Play"}
                        </button>
                        <button
                            onClick={() => {
                                setPlaying(false);
                                setCurrentTime(8 * 3600);
                            }}
                            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", background: "white" }}
                        >
                            Reset
                        </button>
                    </div>
                </div>

                <div>
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
        </div>
    );
}
