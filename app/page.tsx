"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Papa from "papaparse";
import BlockPlaybackSidebar, { PlaybackTrip } from "./components/BlockPlaybackSidebar";
import AllBlocksSidebar from "./components/AllBlocksSidebar";

const LeafletMap = dynamic(() => import("./components/LeafletMap"), {
  ssr: false,
});

type LatLng = [number, number];

export type BusRoute = {
  routeId: string;
  headsign: string;
  color: string;
  length: number;
  lines: LatLng[][];
};

function colorFromRoute(routeId: string) {
  let hash = 0;
  for (let i = 0; i < routeId.length; i++) {
    hash = routeId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${hash % 360}, 70%, 50%)`;
}

function parseMultiLineString(wkt: string): LatLng[][] {
  return wkt
    .replace("MULTILINESTRING", "")
    .replace(/\(\(/, "")
    .replace(/\)\)/, "")
    .split("),(")
    .map((segment) =>
      segment.split(",").map((point) => {
        const [lng, lat] = point.trim().split(" ").map(Number);
        return [lat, lng];
      }),
    );
}

export type ChargingStation = {
  lat: number;
  lng: number;
  name: string;
};

export default function Home() {
  const [chargingStations, setChargingStations] = useState<ChargingStation[]>([]);
  const [busRoutes, setBusRoutes] = useState<BusRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  // Controlled by AllBlocksSidebar
  const [playbackParams, setPlaybackParams] = useState<{
    serviceId: string;
    currentTime: number;
    speed: number;
    playing: boolean;
  } | null>(null);

  const [buses, setBuses] = useState<any[]>([]);
  const [intervalsByBlock, setIntervalsByBlock] = useState<Record<string, { start: number; end: number }[]>>({});


  // Load charging stations
  useEffect(() => {
    fetch("/charging_stations.csv")
      .then((res) => res.text())
      .then((csv) => {
        const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
        const stations = (parsed.data as any[]).map((row) => ({
          lat: Number(row.latitude),
          lng: Number(row.longitude),
          name: row.station_name,
        }));
        setChargingStations(stations);
      });
  }, []);

  useEffect(() => {
    if (!playbackParams?.serviceId) return;

    fetch(`/api/block_intervals?service_id=${encodeURIComponent(playbackParams.serviceId)}`)
      .then((r) => r.json())
      .then((j) => setIntervalsByBlock(j.intervalsByBlock ?? {}))
      .catch(() => setIntervalsByBlock({}));
  }, [playbackParams?.serviceId]);


  // Load route geometries
  useEffect(() => {
    fetch("/routes.csv")
      .then((res) => res.text())
      .then((csv) => {
        const parsed = Papa.parse(csv, {
          header: true,
          skipEmptyLines: true,
          delimiter: ",",
          quoteChar: '"',
        });

        const routeMap = new Map<string, BusRoute>();

        (parsed.data as any[]).forEach((row) => {
          if (!row.route_id || !row.geometry_line) return;

          const routeId = row.route_id;

          if (!routeMap.has(routeId)) {
            routeMap.set(routeId, {
              routeId,
              headsign: row.trip_headsign,
              length: Number(row.line_length),
              color: colorFromRoute(routeId),
              lines: [],
            });
          }

          const segments = parseMultiLineString(row.geometry_line);
          routeMap.get(routeId)!.lines.push(...segments);
        });

        setBusRoutes([...routeMap.values()]);
      });
  }, []);

  // Fetch active buses for the selected service_id and time
  useEffect(() => {
    if (!playbackParams) return;

    const { serviceId, currentTime } = playbackParams;
    const controller = new AbortController();

    fetch(
      `/api/playback?service_id=${encodeURIComponent(serviceId)}&t=${Math.floor(currentTime)}`,
      { signal: controller.signal }
    )
      .then((r) => r.json())
      .then((j) => setBuses(j.buses ?? []))
      .catch(() => { });

    return () => controller.abort();
  }, [playbackParams?.serviceId, playbackParams?.currentTime]);

  const mapTime = playbackParams?.currentTime ?? null;

  return (
    <div className="relative z-0 h-screen w-screen">
      <LeafletMap
        busRoutes={busRoutes}
        chargingStations={chargingStations}
        playbackAll={{
          buses,
          currentTime: mapTime,
          showTripLines: false,
        }}
        intervalsByBlock={intervalsByBlock}
        highlightedRouteId={selectedRouteId}
      />


      {/* Overlay layer */}
      <div className="fixed inset-0 z-[99999] pointer-events-none">
        <div className="pointer-events-auto absolute top-4 left-4 w-[440px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-auto rounded-xl border border-black/10 bg-white/95 backdrop-blur shadow-2xl">
          <AllBlocksSidebar onChange={setPlaybackParams} />
        </div>
      </div>

      {/* Bottom list */}
      <div className="fixed bottom-0 left-0 w-full h-50 z-[9999] text-black bg-white overflow-scroll">
        {busRoutes.map((route) => (
          <div
            key={route.routeId}
            onClick={() => setSelectedRouteId(route.routeId === selectedRouteId ? null : route.routeId)}
            className={`cursor-pointer p-2 hover:bg-gray-100 transition-colors ${selectedRouteId === route.routeId ? 'bg-blue-100 font-bold' : ''
              }`}
            style={{
              borderLeft: `4px solid ${route.color}`
            }}
          >
            <h2>Route {route.routeId}</h2>
          </div>
        ))}
      </div>
    </div>
  );
}