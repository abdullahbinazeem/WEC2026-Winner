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

        const intervalsByBlock = new Map<string, { start: number; end: number }[]>();

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
                const sec = gtfsTimeToSeconds(r.departure_time) ?? gtfsTimeToSeconds(r.arrival_time);
                if (sec == null) continue;
                if (minT == null || sec < minT) minT = sec;
                if (maxT == null || sec > maxT) maxT = sec;
            }

            if (minT == null || maxT == null) continue;

            if (!intervalsByBlock.has(tr.block_id)) intervalsByBlock.set(tr.block_id, []);
            intervalsByBlock.get(tr.block_id)!.push({ start: minT, end: maxT });
        }

        // Sort intervals in each block
        const out: Record<string, { start: number; end: number }[]> = {};
        for (const [blockId, arr] of intervalsByBlock.entries()) {
            arr.sort((a, b) => a.start - b.start);
            out[blockId] = arr;
        }

        return Response.json({ service_id: serviceId, intervalsByBlock: out });
    } finally {
        db.close();
    }
}
