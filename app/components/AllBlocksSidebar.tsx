"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function parseServiceId(serviceId: string) {
  const m = serviceId.match(/^(\d{8})-([A-Za-z]+)-/);
  if (!m)
    return { date: null as string | null, weekday: null as string | null };
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
  onChange: (v: {
    serviceId: string;
    currentTime: number;
    speed: number;
    playing: boolean;
  }) => void;
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
    <div className="w-80 border-r border-gray-200 bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-gray-200 bg-white ">
        <h2 className="text-xl font-semibold text-gray-900">
          Transit Playback
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Control simulation timeline
        </p>
      </div>

      {/* Controls */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Service Day Selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Service Day
          </label>
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="w-full px-3 py-2 bg-gray-400 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Select a service day</option>
            {dayOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.date && d.weekday ? `${d.weekday} — ${d.date}` : d.id}
              </option>
            ))}
          </select>
        </div>

        {/* Time Control */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              Current Time
            </label>
            <span className="text-2xl font-mono font-semibold text-blue-600">
              {formatSeconds(Math.floor(currentTime))}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={24 * 3600}
            step={60}
            value={currentTime}
            onChange={(e) => setCurrentTime(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>00:00</span>
            <span>12:00</span>
            <span>24:00</span>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex gap-3">
          <button
            onClick={() => setPlaying((p) => !p)}
            className={`flex-1 px-4 py-3 rounded-lg font-medium transition-all ${
              playing
                ? "bg-red-500 hover:bg-red-600 text-white shadow-md"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-md"
            }`}
          >
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            onClick={() => {
              setPlaying(false);
              setCurrentTime(8 * 3600);
            }}
            className="px-4 py-3 bg-white border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
          >
            ↺ Reset
          </button>
        </div>

        {/* Speed Control */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              Playback Speed
            </label>
            <span className="text-lg font-semibold text-gray-900">
              {speed.toFixed(1)}×
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={60}
            step={1}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1×</span>
            <span>30×</span>
            <span>60×</span>
          </div>
        </div>
      </div>
    </div>
  );
}
