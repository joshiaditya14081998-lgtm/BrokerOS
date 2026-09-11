/**
 * Backfill thumbnails for existing Photo records.
 *
 * Finds every Photo where `thumbnailUrl IS NULL`, checks whether the original
 * file still exists on disk under `public/uploads/`, generates a 400px-wide
 * JPEG (q80) thumbnail via `sharp`, writes it as `thumb_<basename>.jpg` next
 * to the original, and updates the Photo row's `thumbnailUrl`.
 *
 * Run once (idempotent):
 *   bun run src/lib/backfill-thumbnails.ts
 *
 * Safe to re-run — only null-thumbnailUrl rows are touched, and existing
 * thumbnail files are overwritten deterministically.
 */
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { db } from "@/lib/db";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

async function backfill() {
  const start = Date.now();
  console.log("[backfill] starting — scanning for photos without thumbnails…");

  const photos = await db.photo.findMany({
    where: { thumbnailUrl: null },
    orderBy: { createdAt: "asc" },
  });

  if (photos.length === 0) {
    console.log("[backfill] no Photo records need a thumbnail. Nothing to do.");
    return;
  }

  console.log(`[backfill] found ${photos.length} photo(s) without thumbnails.`);

  // Ensure uploads dir exists (it should, since photos exist).
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  } catch {
    // ignore
  }

  let generated = 0;
  let missing = 0;
  let failed = 0;
  let alreadyThumbed = 0;

  for (const p of photos) {
    // Derive the on-disk original path from the stored URL.
    if (!p.url || !p.url.startsWith("/uploads/")) {
      console.warn(`[backfill] photo ${p.id} — url is not under /uploads/ (url="${p.url}"). Skipping.`);
      failed++;
      continue;
    }
    const originalName = path.basename(p.url);
    const originalPath = path.join(UPLOADS_DIR, originalName);
    if (!fs.existsSync(originalPath)) {
      console.warn(`[backfill] photo ${p.id} — original file missing on disk: ${originalPath}. Skipping.`);
      missing++;
      continue;
    }

    // Use a deterministic thumbnail name. If the original already happens to
    // be named `thumb_*`, skip to avoid recursion.
    if (originalName.startsWith("thumb_")) {
      alreadyThumbed++;
      continue;
    }

    const thumbName = `thumb_${p.id}.jpg`;
    const thumbPath = path.join(UPLOADS_DIR, thumbName);
    const thumbUrl = `/uploads/${thumbName}`;

    try {
      await sharp(originalPath)
        .resize(400, null, { fit: "inside" })
        .jpeg({ quality: 80 })
        .toFile(thumbPath);

      await db.photo.update({
        where: { id: p.id },
        data: { thumbnailUrl: thumbUrl },
      });

      generated++;
      console.log(`[backfill] ✓ ${p.id}  ${originalName} → ${thumbName}`);
    } catch (e) {
      console.error(
        `[backfill] ✗ ${p.id} — sharp failed:`,
        e instanceof Error ? e.message : e,
      );
      failed++;
      // Clean up a possibly-corrupt partial thumbnail.
      try { fs.unlinkSync(thumbPath); } catch {}
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log("");
  console.log("[backfill] done.");
  console.log(`  total scanned : ${photos.length}`);
  console.log(`  generated     : ${generated}`);
  console.log(`  already thumb : ${alreadyThumbed}`);
  console.log(`  missing file  : ${missing}`);
  console.log(`  failed        : ${failed}`);
  console.log(`  elapsed       : ${elapsed}s`);
}

backfill()
  .catch((e) => {
    console.error("[backfill] fatal:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
