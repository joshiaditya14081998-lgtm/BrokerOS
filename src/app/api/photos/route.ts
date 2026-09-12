import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { checkLimit } from "@/lib/usage-limits";
import {
  isCloudinaryConfigured,
  uploadToCloudinary,
  getCloudinaryThumbnail,
  deleteFromCloudinary,
} from "@/lib/cloudinary";

const ENTITY_TYPES = new Set(["Visit", "Booking", "Dispatch", "Dispute", "Payment", "PurchaseOrder"]);
const STAGES = new Set(["booking", "dispatch", "receiving", "dispute", "visit", "payment"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// GET /api/photos?entityType=Dispatch&entityId=abc123
export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entityType");
  const entityId = searchParams.get("entityId");

  if (!entityType || !entityId) {
    return NextResponse.json(
      { error: "entityType and entityId query params are required" },
      { status: 400 },
    );
  }

  const photos = await db.photo.findMany({
    where: { entityType, entityId, brokerId: broker.id },
    orderBy: { createdAt: "desc" },
  });

  const serialised = photos.map((p) => ({
    ...p,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : new Date(p.createdAt).toISOString(),
  }));

  return NextResponse.json({ photos: serialised });
}

// POST /api/photos (multipart/form-data)
export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  const stage = (form.get("stage") as string | null)?.toString().trim();
  const entityType = (form.get("entityType") as string | null)?.toString().trim();
  const entityId = (form.get("entityId") as string | null)?.toString().trim();
  const caption = (form.get("caption") as string | null)?.toString().trim() || null;

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (!stage || !entityType || !entityId) {
    return NextResponse.json(
      { error: "stage, entityType and entityId are required" },
      { status: 400 },
    );
  }
  if (!STAGES.has(stage)) {
    return NextResponse.json({ error: `Invalid stage: ${stage}` }, { status: 400 });
  }
  if (!ENTITY_TYPES.has(entityType)) {
    return NextResponse.json({ error: `Invalid entityType: ${entityType}` }, { status: 400 });
  }
  if (!file.type || !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "File must be an image" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 413 });
  }

  // Usage limit check
  const limit = await checkLimit(broker.id, "photos");
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "Photo limit reached. Upgrade to upload more photos.",
        current: limit.current,
        limit: limit.limit,
        planName: limit.planName,
      },
      { status: 402 },
    );
  }

  const id = randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());

  let photoUrl: string;
  let thumbnailUrl: string | null = null;
  let publicId: string | null = null;

  if (isCloudinaryConfigured) {
    // Upload to Cloudinary
    const uploadResult = await uploadToCloudinary(buffer, `broker-os/${broker.id}/${stage}`);
    if (uploadResult) {
      photoUrl = uploadResult.url;
      thumbnailUrl = getCloudinaryThumbnail(uploadResult.url, 400);
      publicId = uploadResult.publicId;
    } else {
      return NextResponse.json(
        { error: "Failed to upload photo to Cloudinary" },
        { status: 500 },
      );
    }
  } else {
    // Fallback: local filesystem (for dev without Cloudinary)
    const fs = await import("fs");
    const path = await import("path");
    const dir = path.join(process.cwd(), "public", "uploads");
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const filename = `${id}.jpg`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buffer);
    photoUrl = `/uploads/${filename}`;
    thumbnailUrl = photoUrl; // no separate thumbnail in fallback
  }

  // Insert Photo record
  try {
    await db.photo.create({
      data: {
        id,
        brokerId: broker.id,
        stage,
        entityType,
        entityId,
        url: photoUrl,
        thumbnailUrl,
        caption,
      },
    });
  } catch (e) {
    // Clean up Cloudinary upload if DB insert fails
    if (publicId) await deleteFromCloudinary(publicId);
    return NextResponse.json(
      { error: `Failed to save photo record: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 500 },
    );
  }

  const photo = {
    id,
    brokerId: broker.id,
    stage,
    entityType,
    entityId,
    url: photoUrl,
    thumbnailUrl,
    caption,
    createdAt: new Date().toISOString(),
  };

  try {
    await db.auditLog.create({
      data: {
        brokerId: broker.id,
        entityType: "Photo",
        entityId: id,
        action: "create",
        after: JSON.stringify(photo),
        userName: broker.fullName || "Broker",
        reason: `Photo uploaded for ${entityType}:${entityId} (${stage})`,
      },
    });
  } catch {
    // Audit log is best-effort
  }

  return NextResponse.json({ photo }, { status: 201 });
}
