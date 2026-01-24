import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

function gtfsTimeToSeconds(t: string | null | undefined) {
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

type StopRow = {
    stop_sequence: number;
    stop_id: string;
    stop_name: string | null;
    stop_lat: number;
    stop_lon: number;
    arrival_time: string | null;
    departure_time: string | null;
};

export async function GET(
    _req: Request,
    ctx: { params: Promise<{ blockId: string; serviceId: string }> }
) {
    const { blockId, serviceId } = await ctx.params;

    const dbPath = path.join(process.cwd(), "data", "gtfs_master.sqlite");
    if (!fs.existsSync(dbPath)) {
        return Response.json(
            { error: "Database not found", tried: dbPath },
            { status: 500 }
        );
    }

    const db = new Database(dbPath, { readonly: true });

    try {
        // 1) Get all trips for this block + service_id
        const trips = db
            .prepare(
                `
        SELECT trip_id, route_id, trip_headsign, direction_id
        FROM trips
        WHERE block_id = ? AND service_id = ?
      `
            )
            .all(blockId, serviceId) as {
                trip_id: string;
                route_id: string;
                trip_headsign: string | null;
                direction_id: number | null;
            }[];

        if (trips.length === 0) {
            return Response.json(
                { error: "No trips found for that block/day", blockId, serviceId },
                { status: 404 }
            );
        }

        // 2) For each trip, get a start time (min of departure/arrival)
        // We'll compute per-trip by scanning its stop_times rows (fast enough for one block/day).
        const tripDetails = trips.map((t) => {
            const rows = db
                .prepare(
                    `
          SELECT arrival_time, departure_time
          FROM trip_stops
          WHERE trip_id = ?
        `
                )
                .all(t.trip_id) as { arrival_time: string | null; departure_time: string | null }[];

            let best: number | null = null;
            for (const r of rows) {
                const sec = gtfsTimeToSeconds(r.departure_time) ?? gtfsTimeToSeconds(r.arrival_time);
                if (sec == null) continue;
                if (best == null || sec < best) best = sec;
            }

            return { ...t, start_seconds: best ?? Number.MAX_SAFE_INTEGER };
        });

        tripDetails.sort((a, b) => a.start_seconds - b.start_seconds);

        // 3) Attach geometry + ordered stops for each trip
        const outTrips = tripDetails.map((t) => {
            const geomRow = db
                .prepare(
                    `
          SELECT geometry_source, geometry_json
          FROM trip_geometry
          WHERE trip_id = ?
        `
                )
                .get(t.trip_id) as { geometry_source: string; geometry_json: string } | undefined;

            const stops = db
                .prepare(
                    `
          SELECT
            ts.stop_sequence,
            s.stop_id,
            s.stop_name,
            s.stop_lat,
            s.stop_lon,
            ts.arrival_time,
            ts.departure_time
          FROM trip_stops ts
          JOIN stops s ON s.stop_id = ts.stop_id
          WHERE ts.trip_id = ?
          ORDER BY ts.stop_sequence
        `
                )
                .all(t.trip_id) as StopRow[];

            return {
                trip_id: t.trip_id,
                route_id: t.route_id,
                trip_headsign: t.trip_headsign,
                direction_id: t.direction_id,
                start_seconds: t.start_seconds,
                geometry_source: geomRow?.geometry_source ?? null,
                geometry: geomRow ? JSON.parse(geomRow.geometry_json) : null,
                stops,
            };
        });

        return Response.json({
            block_id: blockId,
            service_id: serviceId,
            trips: outTrips,
        });
    } finally {
        db.close();
    }
}
