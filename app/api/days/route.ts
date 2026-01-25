import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

export async function GET() {
    const dbPath = path.join(process.cwd(), "data", "gtfs_master.sqlite");
    if (!fs.existsSync(dbPath)) {
        return Response.json({ error: "DB not found", tried: dbPath }, { status: 500 });
    }

    const db = new Database(dbPath, { readonly: true });
    try {
        const rows = db
            .prepare(
                `
        SELECT DISTINCT service_id
        FROM trips
        WHERE service_id IS NOT NULL AND TRIM(service_id) <> ''
        ORDER BY service_id
      `
            )
            .all() as { service_id: string }[];

        return Response.json({ days: rows.map((r) => r.service_id) });
    } finally {
        db.close();
    }
}
