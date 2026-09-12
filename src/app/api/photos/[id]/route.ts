import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { isCloudinaryConfigured, deleteFromCloudinary } from "@/lib/cloudinary";

// DELETE /api/photos/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const photo = await db.photo.findUnique({ where: { id } });
  if (!photo || photo.brokerId !== broker.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete from Cloudinary (if Cloudinary-hosted) or local FS (fallback)
  if (isCloudinaryConfigured && photo.url.includes("cloudinary.com")) {
    // Extract publicId from Cloudinary URL
    // URL format: https://res.cloudinary.com/{cloud}/image/upload/v{version}/{folder}/{id}
    const urlParts = photo.url.split("/upload/");
    if (urlParts.length > 1) {
      const publicIdWithVersion = urlParts[1];
      // Remove version prefix (v123456/) if present
      const publicId = publicIdWithVersion.replace(/^v\d+\//, "").replace(/\.[^/.]+$/, "");
      await deleteFromCloudinary(publicId);
    }
  } else if (photo.url.startsWith("/uploads/")) {
    // Local FS fallback
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.join(process.cwd(), "public", photo.url);
    try { fs.unlinkSync(filePath); } catch {}
  }

  try {
    await db.auditLog.create({
      data: {
        brokerId: broker.id,
        entityType: "Photo",
        entityId: id,
        action: "delete",
        before: JSON.stringify(photo),
        userName: broker.fullName || "Broker",
        reason: `Photo removed from ${photo.entityType}:${photo.entityId} (${photo.stage})`,
      },
    });
  } catch {
    // best-effort
  }

  await db.photo.deleteMany({ where: { id, brokerId: broker.id } });
  return NextResponse.json({ ok: true });
}
