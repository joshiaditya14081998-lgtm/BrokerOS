import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

// GET /api/photos/stats
//   → { count, totalSizeBytes, totalSizeMB }
//
// `count` is the number of Photo rows in the DB scoped to the current broker.
// `totalSizeBytes` is the sum of every file's size under `public/uploads/`
// (originals + thumbnails + legacy orphaned files), reported with 2-decimal
// MB precision. Cheap to compute (single readdirSync + statSync per file);
// safe to call on every Settings view load.
//
// NOTE: per-broker disk usage cannot be split cheaply on the local FS —
// uploads are shared on disk. `count` is broker-scoped; `totalSizeBytes`
// is the global uploads directory size (all brokers), surfaced for capacity
// awareness only.
export const dynamic = "force-dynamic";

export async function GET() {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Total photo records owned by this broker.
  const count = await db.photo.count({ where: { brokerId: broker.id } });

  // Sum file sizes on disk under public/uploads (global — not per-broker).
  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  let totalSizeBytes = 0;
  try {
    const entries = fs.readdirSync(uploadsDir);
    for (const name of entries) {
      const fullPath = path.join(uploadsDir, name);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          totalSizeBytes += stat.size;
        }
      } catch {
        // ignore individual file errors (broken symlink, perms, etc.)
      }
    }
  } catch {
    // uploads dir doesn't exist yet — nothing on disk.
    totalSizeBytes = 0;
  }

  const totalSizeMB = Number((totalSizeBytes / (1024 * 1024)).toFixed(2));

  return NextResponse.json({ count, totalSizeBytes, totalSizeMB });
}
