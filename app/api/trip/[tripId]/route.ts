import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

type StopRow = {
    stop_sequence: number;
    stop_id: string;
    stop_name: string | null;
    stop_lat: number;
    stop_lon: number;
};

export async function GET(
    _req: Request,
    ctx: { params: Promise<{ tripId: string }> } // <-- params is async here
) {
    const { tripId } = await ctx.params; // <-- unwrap it

    // Change this path if your DB is elsewhere:
    const dbPath = path.join(process.cwd(), "data", "gtfs_master.sqlite");

    // Helpful error if path is wrong
    if (!fs.existsSync(dbPath)) {
        return Response.json(
            {
                error: "Database file not found",
                tried: dbPath,
                hint: "Place gtfs_master.sqlite at /data/gtfs_master.sqlite (relative to project root), or update dbPath.",
            },
            { status: 500 }
        );
    }

    const db = new Database(dbPath, { readonly: true });

    try {
        const trip = db
            .prepare(
                `
        SELECT
          t.trip_id, t.route_id, t.trip_headsign, t.direction_id,
          g.geometry_source, g.geometry_json
        FROM trips t
        JOIN trip_geometry g ON g.trip_id = t.trip_id
        WHERE t.trip_id = ?
      `
            )
            .get(tripId) as
            | {
                trip_id: string;
                route_id: string;
                trip_headsign: string | null;
                direction_id: number | null;
                geometry_source: string;
                geometry_json: string;
            }
            | undefined;

        if (!trip) {
            return Response.json({ error: "Trip not found" }, { status: 404 });
        }

        const stops = db
            .prepare(
                `
        SELECT
          ts.stop_sequence,
          s.stop_id,
          s.stop_name,
          s.stop_lat,
          s.stop_lon
        FROM trip_stops ts
        JOIN stops s ON s.stop_id = ts.stop_id
        WHERE ts.trip_id = ?
        ORDER BY ts.stop_sequence
      `
            )
            .all(tripId) as StopRow[];

        return Response.json({
            trip: {
                trip_id: trip.trip_id,
                route_id: trip.route_id,
                trip_headsign: trip.trip_headsign,
                direction_id: trip.direction_id,
                geometry_source: trip.geometry_source,
            },
            geometry: JSON.parse(trip.geometry_json),
            stops,
        });
    } finally {
        db.close();
    }
}
