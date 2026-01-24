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
import { useEffect, useRef, useState } from "react";
import BusFleetDashboard from "./BusDashboard";

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

const chargingBusIcon = L.icon({
  iconUrl: "/assets/bus_charging_icon.png", // bus while charging
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

interface Bus {
  id: string;
  line: [number, number][];
  routeId: string;
  route: BusRoute;
  length: number;
  presetDirection: number;
  chargingStations: ChargingStation[];
  // Add these fields to track state
  isCharging?: boolean;
  isMovingToStation?: boolean;
}

export default function LeafletMap({
  chargingStations,
  busRoutes,
}: {
  chargingStations: ChargingStation[];
  busRoutes?: BusRoute[];
}) {
  const [buses, setBuses] = useState<Bus[]>([]);

  useEffect(() => {
    if (!busRoutes) return;

    const newBuses: typeof buses = [];

    busRoutes.forEach((route) => {
      const [lat1, lon1] = route.lines[0][0];
      const [lat2, lon2] = route.lines[0][route.lines[0].length - 1];

      const threshold = 0.0002; // degrees, NOT km
      const distance = Math.sqrt((lat1 - lat2) ** 2 + (lon1 - lon2) ** 2);

      const loop = distance < threshold;

      // Forward bus
      newBuses.push({
        id: `${route.routeId}-forward-${Date.now()}-${Math.random()}`,
        line: route.lines[0],
        length: route.length,
        routeId: route.routeId,
        route,
        presetDirection: 1,
        chargingStations,
      });

      // Reverse bus if not loop
      if (!loop) {
        newBuses.push({
          id: `${route.routeId}-reverse-${Date.now()}-${Math.random()}`,
          line: route.lines[0],
          length: route.length,
          routeId: route.routeId,
          route,
          presetDirection: -1,
          chargingStations,
        });
      }
    });

    setBuses(newBuses);
  }, []);

  const handleDestroyBus = (busId: string) => {
    setBuses((prevBuses) => prevBuses.filter((bus, i) => bus.id != busId));
  };

  const addBus = (bus: Bus) => {
    setBuses((prevBuses) => [...prevBuses, bus]);
  };

  const updateBusState = (
    busId: string,
    updates: {
      isCharging?: boolean;
      isMovingToStation?: boolean;
    },
  ) => {
    setBuses((prevBuses) =>
      prevBuses.map((bus) => (bus.id === busId ? { ...bus, ...updates } : bus)),
    );
  };

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
      {buses?.map((bus, i) => {
        return (
          <MovingBus
            key={bus.id}
            line={bus.line}
            length={bus.length}
            routeId={bus.routeId}
            route={bus.route}
            presetDirection={1}
            chargingStations={chargingStations}
            onDestroy={() => handleDestroyBus(bus.id)}
            createBus={(busData: Bus) => addBus(busData)}
            onStateChange={(updates: {
              isCharging?: boolean;
              isMovingToStation?: boolean;
            }) => updateBusState(bus.id, updates)}
          />
        );
      })}
      <BusFleetDashboard buses={buses} />
    </MapContainer>
  );
}

function MovingBus({
  line,
  routeId,
  route,
  length,
  presetDirection,
  chargingStations,
  onDestroy,
  createBus,
  onStateChange,
}: {
  line: [number, number][];
  routeId: string;
  route: BusRoute;
  length: number;
  presetDirection: number;
  chargingStations: ChargingStation[];
  onDestroy: () => void;
  createBus: (bus: Bus) => void;
  onStateChange: (updates: {
    isCharging?: boolean;
    isMovingToStation?: boolean;
    absoluteDistanceTraveled?: number;
  }) => void; //
}) {
  const [posIndex, setPosIndex] = useState(
    presetDirection == 1 ? 0 : line.length - 1,
  );
  const [direction, setDirection] = useState(presetDirection); // 1 for forward, -1 for backward
  const [distanceTraveled, setDistanceTraveled] = useState(0);
  const [absoluteDistanceTraveled, setAbsoluteDistanceTraveled] = useState(0);
  const [isCharging, setIsCharging] = useState(false);
  const [chargingProgress, setChargingProgress] = useState(0);
  const [targetStation, setTargetStation] = useState<ChargingStation | null>(
    null,
  );
  const [isMovingToStation, setIsMovingToStation] = useState(false);
  const [stationProgress, setStationProgress] = useState(0);

  const GLOBAL_SPEED_FACTOR = 30;
  const STATION_SPEED_M_PER_MS = 0.005; // meters per millisecond for moving to station

  const totalRangeRef = useRef<number>(10000 + Math.random() * 60000);
  const TOTAL_ELECTRIC_RANGE_M = totalRangeRef.current;
  const CHARGING_TIME_MS = 1000; // 10 seconds to fully charge

  useEffect(() => {
    onStateChange({
      isCharging,
      isMovingToStation,
    });
  }, [isCharging, isMovingToStation]);

  const batteryLevel =
    (TOTAL_ELECTRIC_RANGE_M - absoluteDistanceTraveled) /
    TOTAL_ELECTRIC_RANGE_M;

  // Find closest charging station
  const findClosestStation = () => {
    const currentPos = line[posIndex];
    let closest = chargingStations[0];
    let minDist = Infinity;

    chargingStations.forEach((station) => {
      const dist = Math.sqrt(
        (station.lat - currentPos[0]) ** 2 + (station.lng - currentPos[1]) ** 2,
      );
      if (dist < minDist) {
        minDist = dist;
        closest = station;
      }
    });

    return closest;
  };

  // Handle charging
  useEffect(() => {
    if (isCharging) {
      const chargeInterval = setInterval(() => {
        setChargingProgress((prev) => {
          const next = prev + 100;
          if (next >= CHARGING_TIME_MS) {
            onDestroy();
            setIsCharging(false);
            setAbsoluteDistanceTraveled(0);
            setTargetStation(null);
            return 0;
          }
          return next;
        });
      }, 100);

      return () => clearInterval(chargeInterval);
    }
  }, [isCharging]);

  // Check if bus needs charging
  useEffect(() => {
    if (
      (line.length - distanceTraveled > TOTAL_ELECTRIC_RANGE_M ||
        batteryLevel < 0.25) &&
      !isCharging &&
      !targetStation &&
      !isMovingToStation
    ) {
      const station = findClosestStation();
      setTargetStation(station);
      setIsMovingToStation(true);
    }
  }, [batteryLevel, isCharging, targetStation, isMovingToStation]);

  const hasSpawnedRef = useRef(false);

  // Smoothly move to charging station
  useEffect(() => {
    if (isMovingToStation && targetStation) {
      const currentPos = line[posIndex];
      const distanceToStation = Math.sqrt(
        (targetStation.lat - currentPos[0]) ** 2 +
          (targetStation.lng - currentPos[1]) ** 2,
      );
      const estimatedTimeMs =
        (distanceToStation / STATION_SPEED_M_PER_MS) * 1000;

      const moveInterval = setInterval(() => {
        setStationProgress((prev) => {
          const next = prev + 100 / (estimatedTimeMs / 100);
          if (next >= 100) {
            if (!hasSpawnedRef.current) {
              hasSpawnedRef.current = true;
              createBus({
                id: `${routeId}-after-charge-${Date.now()}-${Math.random()}`,
                line,
                length,
                routeId,
                route,
                presetDirection: direction,
                chargingStations,
              });
            }

            setIsMovingToStation(false);
            setIsCharging(true);
            return 0;
          }
          return next;
        });
      }, 100);

      return () => clearInterval(moveInterval);
    }
  }, [isMovingToStation, targetStation]);

  // Main movement loop
  useEffect(() => {
    if (isCharging || isMovingToStation) return;

    const interval = setInterval(() => {
      setDistanceTraveled((prev) => {
        let next = prev + 16.67 * GLOBAL_SPEED_FACTOR * direction;

        if (next >= length) {
          setDirection(-1);
          return length - 1;
        } else if (next < 0) {
          setDirection(1);
          return 0;
        }

        return next;
      });

      setAbsoluteDistanceTraveled((prev) => prev + 16.67 * 30);
    }, 1000);

    return () => clearInterval(interval);
  }, [direction, isCharging, isMovingToStation]);

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

  const getCurrentPosition = (): [number, number] => {
    if (isMovingToStation && targetStation) {
      const currentPos = line[posIndex];
      const progress = stationProgress / 100;
      const lat =
        currentPos[0] + (targetStation.lat - currentPos[0]) * progress;
      const lng =
        currentPos[1] + (targetStation.lng - currentPos[1]) * progress;
      return [lat, lng];
    } else if (targetStation) {
      return [targetStation.lat, targetStation.lng];
    }
    return line[posIndex];
  };

  return (
    <Marker
      position={getCurrentPosition()}
      icon={isCharging ? chargingBusIcon : busIcon}
    >
      <Popup>
        <strong>Bus:</strong> {routeId} <br />
        <strong>Direction:</strong> {direction === 1 ? "Outbound" : "Inbound"}{" "}
        <br />
        <strong>Battery:</strong> {Math.round(batteryLevel * 100)}%
        <br />
        {isMovingToStation && (
          <>
            <strong>Status:</strong> Moving to charging station
            <br />
          </>
        )}
        {isCharging && (
          <>
            <strong>Status:</strong> Charging (
            {Math.round((chargingProgress / CHARGING_TIME_MS) * 100)}%)
            <br />
            <strong>At:</strong> {targetStation?.name}
          </>
        )}
      </Popup>
    </Marker>
  );
}
