import Database from "better-sqlite3";
import path from "path";

export const runtime = "nodejs";

export async function GET() {
    const db = new Database(
        path.join(process.cwd(), "data", "gtfs_master.sqlite"),
        { readonly: true }
    );

    try {
        const rows = db
            .prepare(
                `
        SELECT DISTINCT service_id
        FROM trips
        ORDER BY service_id
        `
            )
            .all() as { service_id: string }[];

        return Response.json(rows.map((r) => r.service_id));
    } finally {
        db.close();
    }
}
