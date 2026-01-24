import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

function parseServiceId(serviceId: string) {
    // Works nicely for service_id values like: 20241201-Sunday-1-25-06-0000001
    // If it doesn't match, UI will still show the raw service_id.
    const m = serviceId.match(/^(\d{8})-([A-Za-z]+)-/);
    if (!m) return { date: null as string | null, weekday: null as string | null };

    const y = m[1].slice(0, 4);
    const mo = m[1].slice(4, 6);
    const d = m[1].slice(6, 8);
    return { date: `${y}-${mo}-${d}`, weekday: m[2] };
}

export async function GET(
    _req: Request,
    ctx: { params: Promise<{ blockId: string }> }
) {
    const { blockId } = await ctx.params;

    const dbPath = path.join(process.cwd(), "data", "gtfs_master.sqlite");
    if (!fs.existsSync(dbPath)) {
        return Response.json(
            { error: "Database not found", tried: dbPath },
            { status: 500 }
        );
    }

    const db = new Database(dbPath, { readonly: true });
    try {
        const rows = db
            .prepare(
                `
        SELECT DISTINCT service_id
        FROM trips
        WHERE block_id = ?
          AND service_id IS NOT NULL AND TRIM(service_id) <> ''
        ORDER BY service_id
      `
            )
            .all(blockId) as { service_id: string }[];

        const days = rows.map((r) => ({
            service_id: r.service_id,
            ...parseServiceId(r.service_id),
        }));

        return Response.json({ block_id: blockId, days });
    } finally {
        db.close();
    }
}
