import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Auto-fix engine for the Data Health dashboard.
//
// Each fix type is a pure, self-contained function that takes an optional
// `entityId` (to fix a single record) or `null` (to fix every matching
// record in one shot). They all return a uniform `{ fixed, entityIds,
// details }` shape so the API routes (`/api/data-health/fix` for one type
// and `/api/data-health/fix-all` for the batch button) can wrap them
// identically.
//
// Each fix:
//   • is idempotent (re-running it on already-fixed data is a no-op),
//   • leaves an AuditLog row with entityType "DataHealthFix" so the
//     broker has a tamper-evident trail of every automatic mutation.
// ─────────────────────────────────────────────────────────────────────────────

export type FixType =
  | "create_brokerage"
  | "generate_thumbnails"
  | "dismiss_stale_notifications"
  | "close_forgotten_visits"
  | "set_default_commission";

export const ALL_FIX_TYPES: FixType[] = [
  "create_brokerage",
  "generate_thumbnails",
  "dismiss_stale_notifications",
  "close_forgotten_visits",
  "set_default_commission",
];

export const FIX_TYPE_LABELS: Record<FixType, string> = {
  create_brokerage: "Create missing brokerage records",
  generate_thumbnails: "Generate missing photo thumbnails",
  dismiss_stale_notifications: "Dismiss stale notifications (>30 days)",
  close_forgotten_visits: "Close forgotten visits (>7 days)",
  set_default_commission: "Set default commission rate on suppliers",
};

export type FixResult = {
  fixType: FixType;
  fixed: number;
  entityIds: string[];
  details: Record<string, unknown>;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SEVEN_DAYS = 7 * MS_PER_DAY;
const THIRTY_DAYS = 30 * MS_PER_DAY;

// Default commission rate is sourced from the SystemSetting table; falls
// back to 5.0 (the same hard-coded default in the Prisma schema).
async function resolveDefaultCommissionRate(): Promise<number> {
  try {
    const row = await db.systemSetting.findUnique({
      where: { key: "default_commission_rate" },
    });
    if (row) {
      const n = Number(row.value);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {
    // ignore — fall through to default
  }
  return 5.0;
}

// Audit log helper — every fix calls this once with a summary of what was
// changed. `entityId` is set to the `fixType` so audit consumers can group
// by fix type without joining another table.
async function logFix(
  brokerId: string,
  fixType: FixType,
  count: number,
  entityIds: string[],
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        brokerId,
        entityType: "DataHealthFix",
        entityId: fixType,
        action: "auto_fix",
        after: JSON.stringify({ fixType, count, entityIds, ...extra }),
        userName: "Broker",
        reason: "Auto-fix from Data Health",
      },
    });
  } catch {
    // Best-effort — never fail a fix because the audit log write failed.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. create_brokerage
//
// Bills without a Brokerage row are a data-integrity gap (the bill-creation
// flow normally auto-creates one). We rebuild the missing rows using the
// snapshot `commissionRate` on the PO and the bill's `baseAmount`, marked
// `eligible: false` (so it doesn't accidentally trigger a payout) and
// `payoutStatus: "accrued"`.
// ─────────────────────────────────────────────────────────────────────────────
async function fixCreateBrokerage(brokerId: string, entityId: string | null): Promise<FixResult> {
  // Find bills missing a brokerage row. If `entityId` is provided, restrict
  // to that single bill.
  const bills = await db.bill.findMany({
    where: {
      brokerId,
      brokerage: null,
      ...(entityId ? { id: entityId } : {}),
    },
    select: {
      id: true,
      billNumber: true,
      baseAmount: true,
      clientId: true,
      supplierId: true,
      po: { select: { commissionRate: true, poNumber: true } },
    },
  });

  const entityIds: string[] = [];
  let totalBrokerageAmount = 0;

  for (const bill of bills) {
    const commissionRate = bill.po?.commissionRate ?? 0;
    const base = bill.baseAmount;
    const brokerageAmount = Math.round(base * (commissionRate / 100));
    try {
      await db.brokerage.create({
        data: {
          brokerId,
          billId: bill.id,
          supplierId: bill.supplierId,
          clientId: bill.clientId,
          commissionRate,
          baseAmount: base,
          brokerageAmount,
          eligible: false,
          payoutStatus: "accrued",
        },
      });
      entityIds.push(bill.id);
      totalBrokerageAmount += brokerageAmount;
    } catch {
      // skip on per-row error (e.g. race condition creating brokerage)
    }
  }

  await logFix(brokerId, "create_brokerage", entityIds.length, entityIds, {
    totalBrokerageAmount,
  });

  return {
    fixType: "create_brokerage",
    fixed: entityIds.length,
    entityIds,
    details: {
      billsFixed: entityIds.length,
      totalBrokerageAmount,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. generate_thumbnails
//
// Legacy Photo rows may have `thumbnailUrl = null` (older uploads pre-sharp).
// We re-read the original file from disk and regenerate a 400px-wide JPEG
// thumbnail into `public/uploads/thumb_<id>.jpg`, then update the row.
// ─────────────────────────────────────────────────────────────────────────────
async function fixGenerateThumbnails(brokerId: string, entityId: string | null): Promise<FixResult> {
  const photos = await db.photo.findMany({
    where: {
      brokerId,
      thumbnailUrl: null,
      ...(entityId ? { id: entityId } : {}),
    },
    select: { id: true, url: true },
  });

  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  const entityIds: string[] = [];
  const failed: string[] = [];

  for (const photo of photos) {
    // `url` looks like `/uploads/<filename>` — strip leading slash + prefix.
    const relPath = photo.url.startsWith("/") ? photo.url.slice(1) : photo.url;
    const originalPath = path.join(process.cwd(), relPath);

    let originalExists = false;
    try {
      originalExists = fs.statSync(originalPath).isFile();
    } catch {
      originalExists = false;
    }
    if (!originalExists) {
      failed.push(photo.id);
      continue;
    }

    const thumbFilename = `thumb_${photo.id}.jpg`;
    const thumbPath = path.join(uploadsDir, thumbFilename);
    const thumbPublicUrl = `/uploads/${thumbFilename}`;

    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
      await sharp(originalPath)
        .resize(400, null, { fit: "inside" })
        .jpeg({ quality: 80 })
        .toFile(thumbPath);
      await db.photo.update({
        where: { id: photo.id },
        data: { thumbnailUrl: thumbPublicUrl },
      });
      entityIds.push(photo.id);
    } catch {
      failed.push(photo.id);
    }
  }

  await logFix(brokerId, "generate_thumbnails", entityIds.length, entityIds, {
    failed,
    failedCount: failed.length,
  });

  return {
    fixType: "generate_thumbnails",
    fixed: entityIds.length,
    entityIds,
    details: {
      thumbnailsGenerated: entityIds.length,
      failedCount: failed.length,
      failed,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. dismiss_stale_notifications
//
// Notifications still "pending" >30 days after creation are stale. We mark
// them as "dismissed" (the Notification model's terminal non-done state)
// with a reason in the message so the broker can see why.
// ─────────────────────────────────────────────────────────────────────────────
async function fixDismissStaleNotifications(
  brokerId: string,
  entityId: string | null,
): Promise<FixResult> {
  const cutoff = new Date(Date.now() - THIRTY_DAYS);
  const notifications = await db.notification.findMany({
    where: {
      brokerId,
      status: "pending",
      createdAt: { lt: cutoff },
      ...(entityId ? { id: entityId } : {}),
    },
    select: { id: true, title: true },
  });

  const entityIds = notifications.map((n) => n.id);
  if (entityIds.length > 0) {
    await db.notification.updateMany({
      where: { id: { in: entityIds } },
      data: { status: "dismissed" },
    });
  }

  await logFix(brokerId, "dismiss_stale_notifications", entityIds.length, entityIds);

  return {
    fixType: "dismiss_stale_notifications",
    fixed: entityIds.length,
    entityIds,
    details: {
      dismissedCount: entityIds.length,
      cutoff: cutoff.toISOString(),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. close_forgotten_visits
//
// Visits still "scheduled" >7 days past their planned date are clearly never
// going to happen. We flip them to "no_show" so they stop polluting the
// active-visit pipeline. (Manual review can still override back to "occurred"
// from the Visits view if needed.)
// ─────────────────────────────────────────────────────────────────────────────
async function fixCloseForgottenVisits(brokerId: string, entityId: string | null): Promise<FixResult> {
  const cutoff = new Date(Date.now() - SEVEN_DAYS);
  const visits = await db.visit.findMany({
    where: {
      brokerId,
      status: "scheduled",
      plannedDate: { lt: cutoff },
      ...(entityId ? { id: entityId } : {}),
    },
    select: { id: true, clientId: true },
  });

  const entityIds = visits.map((v) => v.id);
  if (entityIds.length > 0) {
    await db.visit.updateMany({
      where: { id: { in: entityIds } },
      data: { status: "no_show" },
    });
  }

  await logFix(brokerId, "close_forgotten_visits", entityIds.length, entityIds);

  return {
    fixType: "close_forgotten_visits",
    fixed: entityIds.length,
    entityIds,
    details: {
      closedCount: entityIds.length,
      cutoff: cutoff.toISOString(),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. set_default_commission
//
// Suppliers with `defaultCommissionRate <= 0` (or null) were never given an
// explicit rate. We set them to the system default (SystemSetting key
// `default_commission_rate`, falling back to 5.0). This makes brokerage
// computation deterministic instead of silently using the DB default.
// ─────────────────────────────────────────────────────────────────────────────
async function fixSetDefaultCommission(brokerId: string, entityId: string | null): Promise<FixResult> {
  const defaultRate = await resolveDefaultCommissionRate();

  // `defaultCommissionRate` is non-null in the schema, but <=0 indicates
  // the broker explicitly zeroed it (or a migration left a 0). We treat
  // <=0 as "needs fix".
  const suppliers = await db.supplier.findMany({
    where: {
      brokerId,
      defaultCommissionRate: { lte: 0 },
      ...(entityId ? { id: entityId } : {}),
    },
    select: { id: true, name: true },
  });

  const entityIds = suppliers.map((s) => s.id);
  if (entityIds.length > 0) {
    await db.supplier.updateMany({
      where: { id: { in: entityIds } },
      data: { defaultCommissionRate: defaultRate },
    });
  }

  await logFix(brokerId, "set_default_commission", entityIds.length, entityIds, {
    defaultRate,
  });

  return {
    fixType: "set_default_commission",
    fixed: entityIds.length,
    entityIds,
    details: {
      suppliersUpdated: entityIds.length,
      defaultRateApplied: defaultRate,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — runs a single fix by type.
// ─────────────────────────────────────────────────────────────────────────────
export async function runFix(
  fixType: FixType,
  entityId: string | null,
  brokerId: string,
): Promise<FixResult> {
  switch (fixType) {
    case "create_brokerage":
      return fixCreateBrokerage(brokerId, entityId);
    case "generate_thumbnails":
      return fixGenerateThumbnails(brokerId, entityId);
    case "dismiss_stale_notifications":
      return fixDismissStaleNotifications(brokerId, entityId);
    case "close_forgotten_visits":
      return fixCloseForgottenVisits(brokerId, entityId);
    case "set_default_commission":
      return fixSetDefaultCommission(brokerId, entityId);
    default: {
      // Exhaustiveness guard — if a new FixType is added without a case,
      // TypeScript will error here at compile time.
      const _exhaustive: never = fixType;
      throw new Error(`Unknown fix type: ${String(_exhaustive)}`);
    }
  }
}

// True if `value` is one of the supported FixType literals.
export function isFixType(value: unknown): value is FixType {
  return typeof value === "string" && ALL_FIX_TYPES.includes(value as FixType);
}
