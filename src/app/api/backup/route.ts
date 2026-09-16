import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Database backup / restore — full JSON snapshot of every Prisma table.
//
// GET  /api/backup  → exports the entire DB as a downloadable JSON file:
//                     { version: 1, exportedAt, tables: { clients, ... } }.
//                     Updates the `last_backup_at` system setting and writes an
//                     AuditLog entry. Returns Content-Disposition: attachment.
//
// POST /api/backup  → imports a JSON backup. Accepts either raw JSON or
//                     multipart/form-data with a `file` field. Validates the
//                     payload shape, then in a single $transaction:
//                       1. deletes every table (children-first order),
//                       2. re-inserts every table (parents-first order),
//                       3. re-links Brokerage.payoutId (inserted after Payouts),
//                       4. updates `last_backup_at` to the restore time,
//                       5. writes an AuditLog entry inside the new data.
//                     Returns { success: true, counts: { clients: N, ... } }.
//
// WARNING: POST wipes ALL existing data — the UI is required to show an
// explicit AlertDialog confirmation before invoking it.
// ─────────────────────────────────────────────────────────────────────────────

type BackupTable =
  | "systemSettings"
  | "clients"
  | "suppliers"
  | "visits"
  | "bookings"
  | "bookingLineItems"
  | "purchaseOrders"
  | "dispatchDateLogs"
  | "dispatches"
  | "bills"
  | "payments"
  | "brokerages"
  | "brokeragePayouts"
  | "disputes"
  | "photos"
  | "notifications"
  | "auditLogs"
  | "expenses"
  | "invoices";

type BackupShape = {
  version: 1;
  exportedAt: string;
  tables: Record<BackupTable, Record<string, unknown>[]>;
};

const REQUIRED_TABLES: BackupTable[] = [
  "systemSettings", "clients", "suppliers", "visits", "bookings",
  "bookingLineItems", "purchaseOrders", "dispatchDateLogs", "dispatches",
  "bills", "payments", "brokerages", "brokeragePayouts", "disputes",
  "photos", "notifications", "auditLogs",
  "expenses", "invoices",
];

// Keys that Prisma stores as DateTime — hydrate ISO strings back to Date
// objects on import (Prisma accepts either, but Date is unambiguous).
const DATE_FIELDS = new Set([
  "createdAt", "updatedAt", "plannedDate", "actualDate", "bookingDate",
  "expectedDispatchDate", "revisedDispatchDate", "dispatchDate",
  "date", "eligibleAt", "periodStart", "periodEnd", "paidAt", "dueDate",
]);

function hydrateDates(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (DATE_FIELDS.has(k) && typeof v === "string" && v.length > 0) {
      const d = new Date(v);
      out[k] = Number.isNaN(d.getTime()) ? null : d;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function hydrateAll(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(hydrateDates);
}

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function countRows(tables: Record<BackupTable, Record<string, unknown>[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of REQUIRED_TABLES) out[t] = tables[t]?.length ?? 0;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — export the entire DB as a downloadable JSON file.
// ─────────────────────────────────────────────────────────────────────────────
async function buildBackup(): Promise<BackupShape> {
  const [
    systemSettings, clients, suppliers, visits, bookings,
    bookingLineItems, purchaseOrders, dispatchDateLogs, dispatches,
    bills, payments, brokerages, brokeragePayouts, disputes,
    photos, notifications, auditLogs,
    expenses, invoices,
  ] = await Promise.all([
    db.systemSetting.findMany(),
    db.client.findMany(),
    db.supplier.findMany(),
    db.visit.findMany(),
    db.booking.findMany(),
    db.bookingLineItem.findMany(),
    db.purchaseOrder.findMany(),
    db.dispatchDateLog.findMany(),
    db.dispatch.findMany(),
    db.bill.findMany(),
    db.payment.findMany(),
    db.brokerage.findMany(),
    db.brokeragePayout.findMany(),
    db.dispute.findMany(),
    db.photo.findMany(),
    db.notification.findMany(),
    db.auditLog.findMany(),
    db.expense.findMany(),
    db.invoice.findMany(),
  ]);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: {
      systemSettings,
      clients,
      suppliers,
      visits,
      bookings,
      bookingLineItems,
      purchaseOrders,
      dispatchDateLogs,
      dispatches,
      bills,
      payments,
      brokerages,
      brokeragePayouts,
      disputes,
      photos,
      notifications,
      auditLogs,
      expenses,
      invoices,
    },
  };
}

export async function GET() {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const backup = await buildBackup();
  const json = JSON.stringify(backup, null, 2);
  const bytes = Buffer.byteLength(json, "utf-8");

  // Update `last_backup_at` so the UI can show "Last backup: just now".
  await db.systemSetting.upsert({
    where: { key: "last_backup_at" },
    create: {
      key: "last_backup_at",
      value: backup.exportedAt,
      notes: "ISO timestamp of last successful backup download.",
    },
    update: { value: backup.exportedAt },
  });

  // Audit-log the export.
  await db.auditLog.create({
    data: {
      entityType: "SystemSetting",
      entityId: "backup",
      action: "create",
      after: JSON.stringify({
        exportedAt: backup.exportedAt,
        bytes,
        rowCount: countRows(backup.tables),
      }),
      userName: "Broker",
      reason: "Database backup exported (download).",
    },
  });

  const filename = `broker-os-backup-${todayStamp()}.json`;
  return new NextResponse(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Length": String(bytes),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — import a JSON backup. Wipes ALL current data first.
// ─────────────────────────────────────────────────────────────────────────────
async function parsePayload(req: NextRequest): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return { ok: false, error: "Could not read multipart form data." };
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return { ok: false, error: "No 'file' field in multipart upload." };
    }
    const text = await file.text();
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, error: "Uploaded file is not valid JSON." };
    }
  }

  try {
    return { ok: true, data: await req.json() };
  } catch {
    return { ok: false, error: "Request body is not valid JSON." };
  }
}

export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parsePayload(req);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const body = parsed.data;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Backup payload must be a JSON object." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (b.version !== 1) {
    return NextResponse.json({ error: `Unsupported backup version (expected 1, got ${String(b.version)}).` }, { status: 400 });
  }
  if (typeof b.tables !== "object" || b.tables === null || Array.isArray(b.tables)) {
    return NextResponse.json({ error: "Invalid backup: 'tables' must be an object." }, { status: 400 });
  }

  const tablesRaw = b.tables as Record<string, unknown>;
  for (const t of REQUIRED_TABLES) {
    if (!Array.isArray(tablesRaw[t])) {
      return NextResponse.json({ error: `Missing or non-array table: ${t}.` }, { status: 400 });
    }
  }

  const T = tablesRaw as Record<BackupTable, Record<string, unknown>[]>;
  // Prisma's `createMany` data argument is a strongly-typed per-model input.
  // Backup rows are dynamically shaped (we round-trip JSON), so we cast to
  // `any[]` at the call sites below. The row schema matches the Prisma model
  // 1:1 by construction (exported via `findMany()` with no `select`/`include`),
  // and any structural drift would surface as a runtime error inside the
  // `$transaction` (which rolls back on failure).
  const rows = (k: BackupTable): any[] => hydrateAll(T[k]) as any[];

  try {
    await db.$transaction(async (tx) => {
      // ── DELETE (children first, parents last) ──
      // BrokeragePayout deletion sets Brokerage.payoutId = null (onDelete: SetNull).
      // All other relations are Cascade, so the order below is the safe wipe order.
      // Expenses + Invoices added (ACC1 + ACC4) — deleted after their parent
      // relations (Bill, Client) still exist but before Broker is wiped.
      await tx.auditLog.deleteMany({});
      await tx.notification.deleteMany({});
      await tx.photo.deleteMany({});
      await tx.dispute.deleteMany({});
      await tx.invoice.deleteMany({});
      await tx.expense.deleteMany({});
      await tx.brokeragePayout.deleteMany({});
      await tx.brokerage.deleteMany({});
      await tx.payment.deleteMany({});
      await tx.bill.deleteMany({});
      await tx.dispatch.deleteMany({});
      await tx.dispatchDateLog.deleteMany({});
      await tx.purchaseOrder.deleteMany({});
      await tx.bookingLineItem.deleteMany({});
      await tx.booking.deleteMany({});
      await tx.visit.deleteMany({});
      await tx.supplier.deleteMany({});
      await tx.client.deleteMany({});
      await tx.systemSetting.deleteMany({});

      // ── INSERT (parents first, children last) ──
      // Brokerage is inserted before BrokeragePayout (per spec order); its
      // payoutId is left null here and re-linked after BrokeragePayout exists.
      await tx.systemSetting.createMany({ data: rows("systemSettings") });
      await tx.client.createMany({ data: rows("clients") });
      await tx.supplier.createMany({ data: rows("suppliers") });
      await tx.visit.createMany({ data: rows("visits") });
      await tx.booking.createMany({ data: rows("bookings") });
      await tx.bookingLineItem.createMany({ data: rows("bookingLineItems") });
      await tx.purchaseOrder.createMany({ data: rows("purchaseOrders") });
      await tx.dispatchDateLog.createMany({ data: rows("dispatchDateLogs") });
      await tx.dispatch.createMany({ data: rows("dispatches") });
      await tx.bill.createMany({ data: rows("bills") });
      await tx.payment.createMany({ data: rows("payments") });
      await tx.brokerage.createMany({
        data: rows("brokerages").map((r: Record<string, unknown>) => ({ ...r, payoutId: null })) as any[],
      });
      await tx.brokeragePayout.createMany({ data: rows("brokeragePayouts") });

      // Re-link Brokerage.payoutId now that BrokeragePayout rows exist.
      for (const br of T.brokerages) {
        if (br.payoutId && typeof br.payoutId === "string") {
          await tx.brokerage.update({
            where: { id: String(br.id) },
            data: { payoutId: String(br.payoutId) },
          });
        }
      }

      await tx.dispute.createMany({ data: rows("disputes") });
      await tx.photo.createMany({ data: rows("photos") });
      await tx.notification.createMany({ data: rows("notifications") });
      // ACC1 + ACC4 — Expenses + Invoices (after Client exists; Invoice references Client)
      await tx.expense.createMany({ data: rows("expenses") });
      await tx.invoice.createMany({ data: rows("invoices") });
      await tx.auditLog.createMany({ data: rows("auditLogs") });

      // Re-upsert `last_backup_at` so future exports reflect this restore
      // time. (The restored data may have its own last_backup_at; overwrite.)
      const now = new Date().toISOString();
      await tx.systemSetting.upsert({
        where: { key: "last_backup_at" },
        create: {
          key: "last_backup_at",
          value: now,
          notes: "Last backup/restore activity (ISO timestamp).",
        },
        update: { value: now },
      });

      // Audit-log the restore (created AFTER the import so it lives in the
      // freshly-restored data).
      await tx.auditLog.create({
        data: {
          entityType: "SystemSetting",
          entityId: "backup",
          action: "create",
          after: JSON.stringify({
            restoredAt: now,
            sourceExportedAt: typeof b.exportedAt === "string" ? b.exportedAt : null,
            counts: countRows(T),
          }),
          userName: "Broker",
          reason: "Database restored from backup JSON.",
        },
      });
    });

    return NextResponse.json({
      success: true,
      sourceExportedAt: typeof b.exportedAt === "string" ? b.exportedAt : null,
      counts: countRows(T),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Restore failed: ${msg}` }, { status: 500 });
  }
}
