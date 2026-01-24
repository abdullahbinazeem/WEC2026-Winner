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
    const tStr = url.searchParams.get("t"); // seconds
    let globalMin: number | null = null;
    let globalMax: number | null = null;

    let nextActiveStart: number | null = null; // smallest start >= t
    let prevActiveEnd: number | null = null;   // largest end <= t
    if (!serviceId || !tStr) {
        return Response.json({ error: "Missing service_id or t" }, { status: 400 });
    }

    const t = Number(tStr);
    if (!Number.isFinite(t)) {
        return Response.json({ error: "Invalid t" }, { status: 400 });
    }

    const dbPath = path.join(process.cwd(), "data", "gtfs_master.sqlite");
    if (!fs.existsSync(dbPath)) {
        return Response.json({ error: "DB not found", tried: dbPath }, { status: 500 });
    }

    const db = new Database(dbPath, { readonly: true });

    try {
        // 1) Candidate trips for this service day (with blocks)
        const trips = db
            .prepare(
                `
        SELECT trip_id, block_id
        FROM trips
        WHERE service_id = ?
          AND block_id IS NOT NULL AND TRIM(block_id) <> ''
      `
            )
            .all(serviceId) as { trip_id: string; block_id: string }[];

        // 2) For each trip, compute start/end from stop_times
        // We want active trip per block at time t.
        // This is not the most optimized approach, but fine for prototypes.
        const activeByBlock = new Map<
            string,
            { trip_id: string; start: number; end: number }
        >();

        for (const tr of trips) {
            const rows = db
                .prepare(
                    `
          SELECT arrival_time, departure_time
          FROM trip_stops
          WHERE trip_id = ?
        `
                )
                .all(tr.trip_id) as { arrival_time: string | null; departure_time: string | null }[];

            let minT: number | null = null;
            let maxT: number | null = null;

            for (const r of rows) {
                const a = gtfsTimeToSeconds(r.arrival_time);
                const d = gtfsTimeToSeconds(r.departure_time);
                const sec = d ?? a;
                if (sec == null) continue;
                if (minT == null || sec < minT) minT = sec;
                if (maxT == null || sec > maxT) maxT = sec;
            }

            if (minT == null || maxT == null) continue;

            if (t < minT || t > maxT) continue; // not active at this time

            // Track global window for this service_id
            if (globalMin == null || minT < globalMin) globalMin = minT;
            if (globalMax == null || maxT > globalMax) globalMax = maxT;

            // Track nearest times for UX hints
            if (minT >= t && (nextActiveStart == null || minT < nextActiveStart)) {
                nextActiveStart = minT;
            }
            if (maxT <= t && (prevActiveEnd == null || maxT > prevActiveEnd)) {
                prevActiveEnd = maxT;
            }


            // If multiple trips overlap (rare), prefer the one with latest start
            const cur = activeByBlock.get(tr.block_id);
            if (!cur || minT > cur.start) {
                activeByBlock.set(tr.block_id, { trip_id: tr.trip_id, start: minT, end: maxT });
            }
        }

        // 3) Attach geometry for active trips
        const buses = [];
        for (const [block_id, info] of activeByBlock.entries()) {
            const geom = db
                .prepare(
                    `
          SELECT geometry_json
          FROM trip_geometry
          WHERE trip_id = ?
        `
                )
                .get(info.trip_id) as { geometry_json: string } | undefined;

            if (!geom) continue;

            buses.push({
                block_id,
                trip_id: info.trip_id,
                start_seconds: info.start,
                end_seconds: info.end,
                geometry: JSON.parse(geom.geometry_json), // GeoJSON LineString
            });
        }

        return Response.json({
            service_id: serviceId,
            t,
            service_window: { start: globalMin, end: globalMax }, // seconds
            hint: {
                next_active_time: nextActiveStart,
                prev_active_time: prevActiveEnd,
            },
            buses,
        });

    } finally {
        db.close();
    }
}
