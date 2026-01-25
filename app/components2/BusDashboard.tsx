import Link from "next/link";
import { useEffect, useState } from "react";

export default function BusFleetDashboard({ buses }: { buses: any[] }) {
  const [stats, setStats] = useState({
    total: 0,
    charging: 0,
    movingToStation: 0,
    active: 0,
    lowBattery: 0,
  });

  // Simulated time (starts at now)
  const [simTime, setSimTime] = useState<Date>(() => new Date());

  // Update fleet stats
  useEffect(() => {
    setStats({
      total: buses.length,
      charging: buses.filter((b) => b.isCharging).length,
      movingToStation: buses.filter((b) => b.isMovingToStation).length,
      active: buses.filter((b) => !b.isCharging && !b.isMovingToStation).length,
      lowBattery: buses.filter(
        (b) => b.batteryLevel !== undefined && b.batteryLevel < 0.2,
      ).length,
    });
  }, [buses]);

  // Advance simulated time by +30s every 1s
  useEffect(() => {
    const interval = setInterval(() => {
      setSimTime((prev) => new Date(prev.getTime() + 30 * 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute top-4 right-4 z-[1000] bg-white rounded-lg shadow-lg p-4 min-w-[280px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-200">
        <h2 className="text-lg font-bold text-gray-800">Fleet Status</h2>
        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
      </div>

      {/* Stats */}
      <div className="space-y-3">
        {/* Total Buses */}
        <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                />
              </svg>
            </div>
            <div>
              <p className="text-xs text-gray-600 font-medium">
                Total Deployed
              </p>
              <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
            </div>
          </div>
        </div>

        {/* Active */}
        <div className="flex items-center justify-between p-2 bg-green-50 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-sm text-gray-700 font-medium">Active</span>
          </div>
          <span className="text-lg font-bold text-green-700">
            {stats.active}
          </span>
        </div>

        {/* Charging */}
        <div className="flex items-center justify-between p-2 bg-yellow-50 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
            <span className="text-sm text-gray-700 font-medium">Charging</span>
          </div>
          <span className="text-lg font-bold text-yellow-700">
            {stats.charging}
          </span>
        </div>

        {/* Moving to Station */}
        <div className="flex items-center justify-between p-2 bg-orange-50 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
            <span className="text-sm text-gray-700 font-medium">
              To Station
            </span>
          </div>
          <span className="text-lg font-bold text-orange-700">
            {stats.movingToStation}
          </span>
        </div>

        {/* Low Battery */}
        {stats.lowBattery > 0 && (
          <div className="flex items-center justify-between p-2 bg-red-50 rounded-lg border border-red-200">
            <div className="flex items-center gap-2">
              <svg
                className="w-4 h-4 text-red-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-sm text-red-700 font-medium">
                Low Battery
              </span>
            </div>
            <span className="text-lg font-bold text-red-700">
              {stats.lowBattery}
            </span>
          </div>
        )}
      </div>

      {/* Fleet List */}
      <div className="mt-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Active Fleet
        </h3>

        <div className="max-h-[220px] overflow-y-auto space-y-2 pr-1">
          {buses.map((bus) => {
            let statusLabel = "Active";
            let statusColor = "bg-green-100 text-green-700";
            let dotColor = "bg-green-500";

            if (bus.isCharging) {
              statusLabel = "Charging";
              statusColor = "bg-yellow-100 text-yellow-700";
              dotColor = "bg-yellow-500";
            } else if (bus.isMovingToStation) {
              statusLabel = "To Station";
              statusColor = "bg-orange-100 text-orange-700";
              dotColor = "bg-orange-500";
            }

            const lowBattery =
              bus.batteryLevel !== undefined && bus.batteryLevel < 0.2;

            return (
              <div
                key={bus.id}
                className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      Route {bus.routeId}
                    </p>
                    {lowBattery && (
                      <p className="text-xs text-red-600">Low battery</p>
                    )}
                  </div>
                </div>

                <span
                  className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor}`}
                >
                  {statusLabel}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between">
        <span className="text-xs text-gray-500">⏱ Sim Time</span>
        <span className="text-xs text-gray-500">
          {simTime.toLocaleTimeString()}
        </span>
      </div>

      <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between">
        <Link href="/analyzer" className="text-xs text-gray-400">
          Go To Realtime Analyzer
        </Link>
      </div>
    </div>
  );
}
