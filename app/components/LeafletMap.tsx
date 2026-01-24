"use client";

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BusRoute, ChargingStation } from "../page";
import { useEffect, useState } from "react";

const chargingIcon = L.icon({
  iconUrl: "/assets/charging_station_icon.png",
  iconSize: [32, 32], // adjust size
  iconAnchor: [16, 16], // bottom center
  popupAnchor: [-4, -16],
});

const busIcon = L.icon({
  iconUrl: "/assets/bus_icon.png", // your bus icon
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

export default function LeafletMap({
  chargingStations,
  busRoutes,
}: {
  chargingStations: ChargingStation[];
  busRoutes?: BusRoute[];
}) {
  return (
    <MapContainer
      center={[53.5462, -113.4912]}
      zoom={11}
      style={{ height: "100vh", width: "100%" }}
    >
      <TileLayer url="https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png" />
      {/* Charging Stations */}
      {chargingStations.map((s, i) => {
        return (
          <Marker key={i} position={[s.lat, s.lng]} icon={chargingIcon}>
            <Popup>{s.name}</Popup>
          </Marker>
        );
      })}
      {/* Bus Routes */}
      {busRoutes?.map((route) =>
        route.lines.map((line, idx) => (
          <Polyline
            key={`${route.routeId}-${idx}`}
            positions={line}
            pathOptions={{
              color: route.color,
              weight: 4,
              opacity: 1,
            }}
          >
            <Popup>
              <strong>Route:</strong> {route.routeId}
            </Popup>
          </Polyline>
        )),
      )}
      {/* Moving Buses */}
      {busRoutes?.map((route) => (
        <MovingBus
          key={route.routeId}
          line={route.lines[0]}
          length={route.length}
          routeId={route.routeId}
          route={route}
        />
      ))}
    </MapContainer>
  );
}

function MovingBus({
  line,
  routeId,
  route,
  length,
}: {
  line: [number, number][];
  routeId: string;
  route: BusRoute;
  length: number;
}) {
  const [posIndex, setPosIndex] = useState(0);
  const [distanceTraveled, setDistanceTraveled] = useState(0);
  const [direction, setDirection] = useState(1); // 1 for forward, -1 for backward

  useEffect(() => {
    const interval = setInterval(() => {
      setDistanceTraveled((prev) => prev + 16.67 * 240 * direction);
    }, 1000);

    return () => clearInterval(interval);
  }, [direction]);

  useEffect(() => {
    let newPosition = Math.round(
      (distanceTraveled / length) * (line.length - 1),
    );

    if (
      newPosition !== posIndex &&
      newPosition >= 0 &&
      newPosition < line.length
    ) {
      setPosIndex(newPosition);
    }
  }, [distanceTraveled]);

  return (
    <Marker position={line[posIndex]} icon={busIcon}>
      <Popup>
        <strong>Bus:</strong> {routeId} <br />
        <strong>Direction</strong> {direction === 1 ? "Outbound" : "Inbound"}
      </Popup>
    </Marker>
  );
}
