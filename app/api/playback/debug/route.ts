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
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const serviceId = url.searchParams.get("service_id");
    if (!serviceId) return Response.json({ error: "missing service_id" }, { status: 400 });

    const dbPath = path.join(process.cwd(), "data", "gtfs_master.sqlite");
    if (!fs.existsSync(dbPath)) {
        return Response.json({ error: "DB not found", tried: dbPath }, { status: 500 });
    }

    const db = new Database(dbPath, { readonly: true });

    try {
        const counts = db
            .prepare(
                `
        SELECT
          COUNT(*) as trips_total,
          SUM(CASE WHEN block_id IS NOT NULL AND TRIM(block_id) <> '' THEN 1 ELSE 0 END) as trips_with_block
        FROM trips
        WHERE service_id = ?
      `
            )
            .get(serviceId) as any;

        const sampleTrips = db
            .prepare(
                `
        SELECT trip_id, block_id
        FROM trips
        WHERE service_id = ?
          AND block_id IS NOT NULL AND TRIM(block_id) <> ''
        LIMIT 5
      `
            )
            .all(serviceId) as { trip_id: string; block_id: string }[];

        // For each sample trip, inspect stop time parse success and min/max
        const tripTimeInfo = sampleTrips.map((tr) => {
            const rows = db
                .prepare(
                    `
          SELECT arrival_time, departure_time
          FROM trip_stops
          WHERE trip_id = ?
          LIMIT 200
        `
                )
                .all(tr.trip_id) as { arrival_time: string | null; departure_time: string | null }[];

            let parsed = 0;
            let minT: number | null = null;
            let maxT: number | null = null;

            for (const r of rows) {
                const sec = gtfsTimeToSeconds(r.departure_time) ?? gtfsTimeToSeconds(r.arrival_time);
                if (sec == null) continue;
                parsed++;
                if (minT == null || sec < minT) minT = sec;
                if (maxT == null || sec > maxT) maxT = sec;
            }

            return {
                trip_id: tr.trip_id,
                block_id: tr.block_id,
                stop_rows_sampled: rows.length,
                parsed_times: parsed,
                min_seconds: minT,
                max_seconds: maxT,
                example_times: rows.slice(0, 5),
            };
        });

        return Response.json({ service_id: serviceId, counts, tripTimeInfo });
    } finally {
        db.close();
    }
}
