import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

// DELETE /api/photos/[id]
//   → removes the Photo record AND the underlying file from /public/uploads.
//   → { ok: true }
//   Scoped to the current broker — a no-op (returns 404) if the photo row
//   belongs to another tenant.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const photo = await db.photo.findUnique({ where: { id } });
  if (!photo || photo.brokerId !== broker.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete the original + thumbnail files from disk (best-effort — DB record
  // is the source of truth).
  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  const filesToDelete = [photo.url, photo.thumbnailUrl];
  for (const fileUrl of filesToDelete) {
    if (!fileUrl?.startsWith("/uploads/")) continue;
    const filename = path.basename(fileUrl);
    const filePath = path.join(uploadsDir, filename);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore disk errors; still delete the DB record
    }
  }

  try {
    await db.auditLog.create({
      data: {
        brokerId: broker.id,
        entityType: "Photo",
        entityId: id,
        action: "delete",
        before: JSON.stringify(photo),
        userName: "Broker",
        reason: `Photo removed from ${photo.entityType}:${photo.entityId} (${photo.stage})`,
      },
    });
  } catch {
    // best-effort
  }

  await db.photo.deleteMany({ where: { id, brokerId: broker.id } });
  return NextResponse.json({ ok: true });
}
