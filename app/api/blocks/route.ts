import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

export async function GET() {
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
        SELECT DISTINCT block_id
        FROM trips
        WHERE block_id IS NOT NULL AND TRIM(block_id) <> ''
        ORDER BY block_id
      `
            )
            .all() as { block_id: string }[];

        return Response.json({ blocks: rows.map((r) => r.block_id) });
    } finally {
        db.close();
    }
}
