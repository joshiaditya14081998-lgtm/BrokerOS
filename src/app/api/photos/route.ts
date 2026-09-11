import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { checkLimit } from "@/lib/usage-limits";

// Allowed entity types — kept in sync with the Photo model's stage-polymorphic relations.
// NOTE: "PurchaseOrder" is supported for receiving-stage proof-of-delivery photos
// (Gap 2 — see plan §4.7/§5.6). The Photo table has no dedicated `purchaseOrderId`
// FK column; we still accept the entityType and store all five optional FK
// columns as NULL — queries use the polymorphic (entityType, entityId) pair via
// `db.photo.findMany({ where: { entityType, entityId } })`, which works
// independently of the optional FK columns.
const ENTITY_TYPES = new Set(["Visit", "Booking", "Dispatch", "Dispute", "Payment", "PurchaseOrder"]);
const STAGES = new Set(["booking", "dispatch", "receiving", "dispute", "visit", "payment"]);

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Resolve the on-disk uploads directory: <projectRoot>/public/uploads
function uploadsDir(): string {
  return path.join(process.cwd(), "public", "uploads");
}

// GET /api/photos?entityType=Dispatch&entityId=abc123
//   → { photos: Photo[] } filtered by entityType + entityId, newest first.
//   Scoped to the current broker.
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

  // Normalise createdAt to ISO string for JSON transport (SQLite returns a
  // Date via Prisma's driver, but be defensive).
  const serialised = photos.map((p) => ({
    ...p,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : new Date(p.createdAt).toISOString(),
  }));

  return NextResponse.json({ photos: serialised });
}

// POST /api/photos  (multipart/form-data)
//   fields: file (image), stage, entityType, entityId, caption?
//   → { photo }
//   The Photo row + AuditLog entry are stamped with the current broker's id.
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

  // Usage-limit check — 402 if the broker's photo storage is at capacity.
  // Done AFTER the input validation so we don't burn a limit-read on malformed
  // requests, but BEFORE the file is written to disk so we don't leave
  // orphaned files behind a 402.
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

  // Preserve original extension (fallback to .bin); sanitize.
  const ext = path.extname(file.name || "").toLowerCase().replace(/[^a-z0-9.]/g, "");
  const safeExt = ext && ext.length <= 6 ? ext : ".jpg";
  const id = randomUUID();
  const filename = `${id}${safeExt}`;
  const thumbFilename = `thumb_${id}.jpg`;
  const publicUrl = `/uploads/${filename}`;
  const thumbPublicUrl = `/uploads/${thumbFilename}`;

  // Ensure target directory exists, then write the buffer.
  const dir = uploadsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore — directory may already exist
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const originalPath = path.join(dir, filename);
  const thumbPath = path.join(dir, thumbFilename);
  try {
    fs.writeFileSync(originalPath, buffer);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to write file: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 500 },
    );
  }

  // Generate a 400px-wide JPEG thumbnail (q80) for fast gallery rendering.
  // Best-effort — if sharp fails (e.g. exotic format), the upload still
  // succeeds; thumbnailUrl stays null so consumers fall back to the original.
  let thumbnailUrl: string | null = null;
  try {
    await sharp(originalPath)
      .resize(400, null, { fit: "inside" })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);
    thumbnailUrl = thumbPublicUrl;
  } catch (e) {
    console.warn(
      "[photos] thumbnail generation failed for",
      filename,
      e instanceof Error ? e.message : e,
    );
  }

  // Insert the Photo row. We use a raw SQL INSERT (with Prisma's tagged
  // template literal for safe parameter binding) instead of `db.photo.create()`
  // so we can populate BOTH the polymorphic columns (stage, entityType,
  // entityId) AND the matching nullable FK column (visitId/bookingId/…) in a
  // single statement. The dev server's hot-reload occasionally holds a stale
  // PrismaClient class that doesn't recognise the new FK columns on the
  // typed `create()` path; raw SQL sidesteps that validation layer and goes
  // straight to SQLite (which has the up-to-date schema).
  // Includes the `brokerId` column so the row is owned by the current broker.
  const visitId    = entityType === "Visit"    ? entityId : null;
  const bookingId  = entityType === "Booking"  ? entityId : null;
  const dispatchId = entityType === "Dispatch" ? entityId : null;
  const disputeId  = entityType === "Dispute"  ? entityId : null;
  const paymentId  = entityType === "Payment"  ? entityId : null;
  const createdAt = new Date();

  try {
    await db.$executeRaw`
      INSERT INTO Photo (id, brokerId, stage, entityType, entityId, url, thumbnailUrl, caption, createdAt,
                         visitId, bookingId, dispatchId, disputeId, paymentId)
      VALUES (${id}, ${broker.id}, ${stage}, ${entityType}, ${entityId}, ${publicUrl}, ${thumbnailUrl}, ${caption}, ${createdAt},
              ${visitId}, ${bookingId}, ${dispatchId}, ${disputeId}, ${paymentId})
    `;
  } catch (e) {
    // Clean up the uploaded files if the DB insert failed.
    try { fs.unlinkSync(originalPath); } catch {}
    try { fs.unlinkSync(thumbPath); } catch {}
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
    url: publicUrl,
    thumbnailUrl,
    caption,
    createdAt: createdAt.toISOString(),
  };

  try {
    await db.auditLog.create({
      data: {
        brokerId: broker.id,
        entityType: "Photo",
        entityId: id,
        action: "create",
        after: JSON.stringify(photo),
        userName: "Broker",
        reason: `Photo uploaded for ${entityType}:${entityId} (${stage})`,
      },
    });
  } catch {
    // Audit log is best-effort — don't fail the upload on audit error.
  }

  return NextResponse.json({ photo }, { status: 201 });
}
