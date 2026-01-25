"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Papa from "papaparse";

const LeafletMap = dynamic(() => import("./components2/LeafletMap"), {
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
  const [chargingStations, setChargingStations] = useState<ChargingStation[]>(
    [],
  );

  useEffect(() => {
    fetch("/charging_stations.csv")
      .then((res) => res.text())
      .then((csv) => {
        const parsed = Papa.parse(csv, {
          header: true,
          skipEmptyLines: true,
        });

        console.log(parsed);

        const stations = parsed.data.map((row: any) => ({
          lat: Number(row.latitude),
          lng: Number(row.longitude),
          name: row.station_name,
        }));

        setChargingStations(stations);
      });
  }, []);

  const [busRoutes, setBusRoutes] = useState<BusRoute[]>([]);

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

        console.log(parsed);

        const routeMap = new Map<string, BusRoute>();

        parsed.data.forEach((row: any) => {
          if (!row.route_id || !row.geometry_line) return;

          const routeId = row.route_id;

          if (!routeMap.has(routeId)) {
            routeMap.set(routeId, {
              routeId,
              headsign: row.trip_headsign,
              length: row.line_length,
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

  return (
    <div className="relative">
      <LeafletMap busRoutes={busRoutes} chargingStations={chargingStations} />
    </div>
  );
}
