import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/data-health
//
// Returns a snapshot of system-wide data quality + storage + entity counts so
// the broker can spot stale records, compliance gaps, and forgotten work.
//
// Shape:
//   {
//     summary: { totalEntities, lastUpdated, storageUsedMB },
//     issues:  DataHealthIssue[],
//     completeness: {
//       clients:   { total, complete, pct, missing: MissingRecord[] },
//       suppliers: { ... },
//       pos:       { ... },
//       bills:     { ... },
//     }
//   }
//
// DataHealthIssue:
//   { id, severity: "warning"|"info"|"error", category, title, description,
//     count, entityType, actionView, examples?: { id, label }[],
//     fixable: boolean, fixType: string | null }
//
// `actionView` is the ViewKey the broker should navigate to in order to fix
// the issue (e.g. "bills" for stuck bills).
// `fixable` is true when the issue can be auto-resolved by /api/data-health/fix;
// `fixType` names the corresponding fix routine (see src/lib/data-health-fix.ts).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Severity = "error" | "warning" | "info";

type IssueExample = { id: string; label: string };

type DataHealthIssue = {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  count: number;
  entityType: string;
  actionView: string;
  examples?: IssueExample[];
  fixable: boolean;
  fixType: string | null;
};

// Internal "seed" type — used while building the issue list, before the
// post-processing loop stamps each issue with `fixable`/`fixType`. Keeps
// the push sites terse (no need to repeat `fixable: false, fixType: null`
// on every literal) while keeping the public `DataHealthIssue` type strict.
type IssueSeed = Omit<DataHealthIssue, "fixable" | "fixType">;

type MissingField = { field: string; label: string };
type MissingRecord = { id: string; label: string; missing: MissingField[] };

type CompletenessBucket = {
  total: number;
  complete: number;
  pct: number;
  missing: MissingRecord[];
};

type DataHealthResponse = {
  summary: {
    totalEntities: number;
    lastUpdated: string | null;
    storageUsedMB: number;
  };
  issues: DataHealthIssue[];
  completeness: {
    clients: CompletenessBucket;
    suppliers: CompletenessBucket;
    pos: CompletenessBucket;
    bills: CompletenessBucket;
  };
  // True when at least one issue is auto-fixable (drives the prominent
  // "Fix all auto-fixable" button in the Data Health view header).
  canFixAll: boolean;
  // ISO timestamp of the most recent AuditLog row with entityType =
  // "DataHealthFix" — null when no auto-fix has ever been run.
  lastFixedAt: string | null;
};

// Maps a DataHealthIssue id → the auto-fix routine that resolves it.
// Issues NOT in this map require a manual decision (payment, file upload,
// GST number entry, etc.) and so `fixable` is false for them.
const FIX_TYPE_BY_ISSUE: Record<string, string> = {
  "bills-no-brokerage": "create_brokerage",
  "photos-no-thumbnails": "generate_thumbnails",
  "stale-notifications": "dismiss_stale_notifications",
  "forgotten-visits": "close_forgotten_visits",
  "suppliers-no-commission": "set_default_commission",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SEVEN_DAYS = 7 * MS_PER_DAY;
const FOURTEEN_DAYS = 14 * MS_PER_DAY;
const THIRTY_DAYS = 30 * MS_PER_DAY;

function pct(complete: number, total: number): number {
  if (total <= 0) return 100;
  return Math.round((complete / total) * 100);
}

// Estimate SQLite DB file size on disk (MB, 2-decimal). Returns 0 if the file
// cannot be stat'd (e.g. running on a remote DB elsewhere — though we always
// use SQLite here). The path is derived from the DATABASE_URL env var.
function dbSizeMB(): number {
  try {
    const url = process.env.DATABASE_URL ?? "";
    // SQLite URLs look like `file:/abs/path/to.db` or `file:./relative.db`.
    const m = url.match(/^file:(.+)$/);
    if (!m) return 0;
    let p = m[1];
    if (p.startsWith("./")) p = path.join(process.cwd(), p.slice(2));
    const stat = fs.statSync(p);
    return Number((stat.size / (1024 * 1024)).toFixed(2));
  } catch {
    return 0;
  }
}

// Total size on disk under public/uploads (originals + thumbnails).
function uploadsSizeMB(): number {
  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  let totalBytes = 0;
  try {
    const entries = fs.readdirSync(uploadsDir);
    for (const name of entries) {
      const full = path.join(uploadsDir, name);
      try {
        const s = fs.statSync(full);
        if (s.isFile()) totalBytes += s.size;
      } catch {
        /* ignore individual file errors */
      }
    }
  } catch {
    /* uploads dir doesn't exist yet */
  }
  return Number((totalBytes / (1024 * 1024)).toFixed(2));
}

export async function GET() {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();

  // ── Fetch the most recent auto-fix audit log entry (for the "Last
  //    auto-fix" badge in the Data Health view header). Single-row query —
  //    cheap enough to do on every GET.
  const lastFixLog = await db.auditLog.findFirst({
    where: { brokerId: broker.id, entityType: "DataHealthFix", action: "auto_fix" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const lastFixedAt = lastFixLog ? lastFixLog.createdAt.toISOString() : null;

  // ── Pull all the data we need in parallel (single round-trip fan-out) ──────
  const [
    clients,
    suppliers,
    pos,
    bills,
    visits,
    dispatches,
    disputes,
    notifications,
    photos,
    photoStats,
    settingsCounts,
  ] = await Promise.all([
    db.client.findMany({
      where: { brokerId: broker.id },
      select: {
        id: true, name: true, phone: true, email: true, gstNo: true,
        address: true, updatedAt: true,
      },
    }),
    db.supplier.findMany({
      where: { brokerId: broker.id },
      select: {
        id: true, name: true, phone: true, gstNo: true,
        defaultCommissionRate: true, updatedAt: true,
      },
    }),
    db.purchaseOrder.findMany({
      where: { brokerId: broker.id },
      select: {
        id: true, poNumber: true, status: true,
        expectedDispatchDate: true, updatedAt: true,
        dispatches: { select: { id: true } },
        bill: { select: { id: true } },
      },
    }),
    db.bill.findMany({
      where: { brokerId: broker.id },
      select: {
        id: true, billNumber: true, status: true, updatedAt: true,
        payments: { select: { id: true } },
        brokerage: { select: { id: true } },
      },
    }),
    db.visit.findMany({
      where: { brokerId: broker.id },
      select: {
        id: true, status: true, plannedDate: true, updatedAt: true, clientId: true,
        client: { select: { name: true } },
      },
    }),
    db.dispatch.findMany({
      where: { brokerId: broker.id },
      select: {
        id: true, dispatchDate: true, updatedAt: true, poId: true,
        po: { select: { poNumber: true } },
      },
    }),
    db.dispute.findMany({
      where: { brokerId: broker.id },
      select: {
        id: true, status: true, createdAt: true, updatedAt: true, poId: true,
        po: { select: { poNumber: true } },
      },
    }),
    db.notification.findMany({
      where: { brokerId: broker.id },
      select: { id: true, status: true, createdAt: true, updatedAt: true, title: true },
    }),
    db.photo.findMany({ where: { brokerId: broker.id }, select: { id: true, thumbnailUrl: true, entityType: true, entityId: true } }),
    // Photo storage stat (count + bytes) — same logic as /api/photos/stats but
    // we compute it inline here so we don't make an extra HTTP round-trip.
    Promise.resolve({ uploadsMB: uploadsSizeMB() }),
    // Counts for the totals strip
    Promise.all([
      db.visit.count({ where: { brokerId: broker.id } }),
      db.dispatch.count({ where: { brokerId: broker.id } }),
      db.dispute.count({ where: { brokerId: broker.id } }),
      db.notification.count({ where: { brokerId: broker.id } }),
      db.payment.count({ where: { brokerId: broker.id } }),
      db.brokerage.count({ where: { brokerId: broker.id } }),
      db.brokeragePayout.count({ where: { brokerId: broker.id } }),
      db.auditLog.count({ where: { brokerId: broker.id } }),
      db.photo.count({ where: { brokerId: broker.id } }),
    ]),
  ]);

  const [
    visitCount, dispatchCount, disputeCount, notificationCount,
    paymentCount, brokerageCount, payoutCount, auditCount, photoCount,
  ] = settingsCounts;

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  const totalEntities =
    clients.length + suppliers.length + pos.length + bills.length +
    visitCount + dispatchCount + disputeCount + notificationCount +
    paymentCount + brokerageCount + payoutCount + auditCount + photoCount;

  // Most recent updatedAt across all relevant tables (bills/payments/etc. all
  // have updatedAt; photos + audit logs use createdAt).
  const candidateTimes: Date[] = [
    ...clients.map((c) => c.updatedAt),
    ...suppliers.map((s) => s.updatedAt),
    ...pos.map((p) => p.updatedAt),
    ...bills.map((b) => b.updatedAt),
    ...visits.map((v) => v.updatedAt),
    ...dispatches.map((d) => d.updatedAt),
    ...disputes.map((d) => d.updatedAt),
    ...notifications.map((n) => n.updatedAt),
  ];
  const lastUpdated = candidateTimes.length
    ? new Date(Math.max(...candidateTimes.map((d) => d.getTime()))).toISOString()
    : null;

  const storageUsedMB = Number((photoStats.uploadsMB + dbSizeMB()).toFixed(2));

  // ─────────────────────────────────────────────────────────────────────────
  // Completeness — Clients
  // Required: name + phone + email + gstNo + address
  // ─────────────────────────────────────────────────────────────────────────
  const clientsMissing: MissingRecord[] = [];
  let clientsComplete = 0;
  for (const c of clients) {
    const missing: MissingField[] = [];
    if (!c.name) missing.push({ field: "name", label: "Name" });
    if (!c.phone) missing.push({ field: "phone", label: "Phone" });
    if (!c.email) missing.push({ field: "email", label: "Email" });
    if (!c.gstNo) missing.push({ field: "gstNo", label: "GST No." });
    if (!c.address) missing.push({ field: "address", label: "Address" });
    if (missing.length === 0) {
      clientsComplete++;
    } else {
      clientsMissing.push({ id: c.id, label: c.name || "(unnamed client)", missing });
    }
  }
  const clientsBucket: CompletenessBucket = {
    total: clients.length,
    complete: clientsComplete,
    pct: pct(clientsComplete, clients.length),
    missing: clientsMissing.slice(0, 50), // cap to keep payload small
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Completeness — Suppliers
  // Required: name + phone + gstNo + defaultCommissionRate set (> 0)
  // (defaultCommissionRate has a DB default of 5.0; we flag rate<=0 as missing
  // since 5.0 is always present unless explicitly zeroed.)
  // ─────────────────────────────────────────────────────────────────────────
  const suppliersMissing: MissingRecord[] = [];
  let suppliersComplete = 0;
  for (const s of suppliers) {
    const missing: MissingField[] = [];
    if (!s.name) missing.push({ field: "name", label: "Name" });
    if (!s.phone) missing.push({ field: "phone", label: "Phone" });
    if (!s.gstNo) missing.push({ field: "gstNo", label: "GST No." });
    if (!s.defaultCommissionRate || s.defaultCommissionRate <= 0)
      missing.push({ field: "defaultCommissionRate", label: "Commission rate" });
    if (missing.length === 0) {
      suppliersComplete++;
    } else {
      suppliersMissing.push({ id: s.id, label: s.name || "(unnamed supplier)", missing });
    }
  }
  const suppliersBucket: CompletenessBucket = {
    total: suppliers.length,
    complete: suppliersComplete,
    pct: pct(suppliersComplete, suppliers.length),
    missing: suppliersMissing.slice(0, 50),
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Completeness — POs
  // Required: expectedDispatchDate + ≥1 dispatch + a bill
  // ─────────────────────────────────────────────────────────────────────────
  const posMissing: MissingRecord[] = [];
  let posComplete = 0;
  for (const p of pos) {
    const missing: MissingField[] = [];
    if (!p.expectedDispatchDate) missing.push({ field: "expectedDispatchDate", label: "Expected dispatch date" });
    if (p.dispatches.length === 0) missing.push({ field: "dispatches", label: "At least one dispatch" });
    if (!p.bill) missing.push({ field: "bill", label: "Bill generated" });
    if (missing.length === 0) {
      posComplete++;
    } else {
      posMissing.push({ id: p.id, label: p.poNumber, missing });
    }
  }
  const posBucket: CompletenessBucket = {
    total: pos.length,
    complete: posComplete,
    pct: pct(posComplete, pos.length),
    missing: posMissing.slice(0, 50),
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Completeness — Bills
  // Required: ≥1 payment + brokerage created
  // (fully_paid bills with no payments shouldn't exist; brokerage is auto-
  // created at bill time, but a missing row is an integrity gap.)
  // ─────────────────────────────────────────────────────────────────────────
  const billsMissing: MissingRecord[] = [];
  let billsComplete = 0;
  for (const b of bills) {
    const missing: MissingField[] = [];
    if (b.payments.length === 0) missing.push({ field: "payments", label: "At least one payment" });
    if (!b.brokerage) missing.push({ field: "brokerage", label: "Brokerage record" });
    if (missing.length === 0) {
      billsComplete++;
    } else {
      billsMissing.push({ id: b.id, label: b.billNumber, missing });
    }
  }
  const billsBucket: CompletenessBucket = {
    total: bills.length,
    complete: billsComplete,
    pct: pct(billsComplete, bills.length),
    missing: billsMissing.slice(0, 50),
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Issues
  // ─────────────────────────────────────────────────────────────────────────
  const issues: IssueSeed[] = [];

  // (error) Stuck bills — status "pending" AND zero payments.
  const stuckBills = bills.filter((b) => b.status === "pending" && b.payments.length === 0);
  if (stuckBills.length > 0) {
    issues.push({
      id: "stuck-bills",
      severity: "error",
      category: "Finance",
      title: "Bills with no payments",
      description: "Pending bills that have never received a payment. These block brokerage eligibility and inflate outstanding receivables.",
      count: stuckBills.length,
      entityType: "Bill",
      actionView: "bills",
      examples: stuckBills.slice(0, 3).map((b) => ({ id: b.id, label: b.billNumber })),
    });
  }

  // (error) Forgotten POs — status "open", no dispatches, expectedDispatchDate in the past.
  const forgottenPos = pos.filter(
    (p) => p.status === "open" && p.dispatches.length === 0 &&
      p.expectedDispatchDate && new Date(p.expectedDispatchDate).getTime() < now.getTime(),
  );
  if (forgottenPos.length > 0) {
    issues.push({
      id: "forgotten-pos",
      severity: "error",
      category: "Operations",
      title: "Forgotten purchase orders",
      description: "POs still open with no dispatches, past their expected dispatch date. Either record a dispatch, mark as short-shipped, or close them.",
      count: forgottenPos.length,
      entityType: "PurchaseOrder",
      actionView: "pos",
      examples: forgottenPos.slice(0, 3).map((p) => ({ id: p.id, label: p.poNumber })),
    });
  }

  // (warning) Clients without GST numbers.
  const clientsNoGst = clients.filter((c) => !c.gstNo);
  if (clientsNoGst.length > 0) {
    issues.push({
      id: "clients-no-gst",
      severity: "warning",
      category: "Compliance",
      title: "Clients without GST numbers",
      description: "GST numbers are required for compliant invoicing and tax filing. Add GST numbers for these clients before generating their next bill.",
      count: clientsNoGst.length,
      entityType: "Client",
      actionView: "clients",
      examples: clientsNoGst.slice(0, 3).map((c) => ({ id: c.id, label: c.name || "(unnamed)" })),
    });
  }

  // (warning) Suppliers without explicit commission rate (rate <= 0 means
  // broker never set one; the DB default 5.0 is technically present but we
  // flag rate <= 0 to avoid noise on suppliers that have the default.)
  const suppliersNoCommission = suppliers.filter(
    (s) => !s.defaultCommissionRate || s.defaultCommissionRate <= 0,
  );
  if (suppliersNoCommission.length > 0) {
    issues.push({
      id: "suppliers-no-commission",
      severity: "warning",
      category: "Configuration",
      title: "Suppliers without a commission rate",
      description: "These suppliers have no default commission rate set. Brokerage will fall back to the system default — set an explicit rate per supplier to avoid surprises.",
      count: suppliersNoCommission.length,
      entityType: "Supplier",
      actionView: "suppliers",
      examples: suppliersNoCommission.slice(0, 3).map((s) => ({ id: s.id, label: s.name || "(unnamed)" })),
    });
  }

  // (warning) Visits with status "scheduled" older than 7 days.
  const forgottenVisits = visits.filter(
    (v) => v.status === "scheduled" &&
      (now.getTime() - new Date(v.plannedDate).getTime()) > SEVEN_DAYS,
  );
  if (forgottenVisits.length > 0) {
    issues.push({
      id: "forgotten-visits",
      severity: "warning",
      category: "Operations",
      title: "Forgotten scheduled visits",
      description: "Visits still marked scheduled more than 7 days after their planned date. Mark them as occurred, followed up, or no-show to keep the visit pipeline accurate.",
      count: forgottenVisits.length,
      entityType: "Visit",
      actionView: "visits",
      examples: forgottenVisits.slice(0, 3).map((v) => ({
        id: v.id,
        label: v.client?.name ?? "Visit",
      })),
    });
  }

  // (warning) Dispatches with no photos (missing audit trail).
  // Build a Set of dispatchIds that have at least one photo.
  const dispatchIdsWithPhotos = new Set(
    photos.filter((p) => p.entityType === "Dispatch").map((p) => p.entityId),
  );
  const dispatchesNoPhotos = dispatches.filter((d) => !dispatchIdsWithPhotos.has(d.id));
  if (dispatchesNoPhotos.length > 0) {
    issues.push({
      id: "dispatches-no-photos",
      severity: "warning",
      category: "Audit Trail",
      title: "Dispatches without photos",
      description: "Dispatches should have at least one photo (challan, loading, or delivery proof) for an audit trail. Add photos to these dispatches.",
      count: dispatchesNoPhotos.length,
      entityType: "Dispatch",
      actionView: "dispatches",
      examples: dispatchesNoPhotos.slice(0, 3).map((d) => ({
        id: d.id,
        label: d.po?.poNumber ? `Dispatch for ${d.po.poNumber}` : "Dispatch",
      })),
    });
  }

  // (warning) Disputes open for >14 days.
  const staleDisputes = disputes.filter(
    (d) => d.status === "open" && (now.getTime() - new Date(d.createdAt).getTime()) > FOURTEEN_DAYS,
  );
  if (staleDisputes.length > 0) {
    issues.push({
      id: "stale-disputes",
      severity: "warning",
      category: "Operations",
      title: "Disputes open for >14 days",
      description: "Long-running disputes hurt supplier relations and stall brokerage. Resolve, reject, or document the reason for the delay.",
      count: staleDisputes.length,
      entityType: "Dispute",
      actionView: "disputes",
      examples: staleDisputes.slice(0, 3).map((d) => ({
        id: d.id,
        label: d.po?.poNumber ? `Dispute on ${d.po.poNumber}` : "Dispute",
      })),
    });
  }

  // (info) Bills with no brokerage record — data integrity check.
  const billsNoBrokerage = bills.filter((b) => !b.brokerage);
  if (billsNoBrokerage.length > 0) {
    issues.push({
      id: "bills-no-brokerage",
      severity: "info",
      category: "Data Integrity",
      title: "Bills without a brokerage record",
      description: "Every bill should have an auto-generated brokerage entry. Missing rows indicate a data integrity gap — usually from manual DB edits or a failed creation step.",
      count: billsNoBrokerage.length,
      entityType: "Bill",
      actionView: "brokerage",
      examples: billsNoBrokerage.slice(0, 3).map((b) => ({ id: b.id, label: b.billNumber })),
    });
  }

  // (info) Photos without thumbnails (from the backfill — should be 0 or very few).
  const photosNoThumbs = photos.filter((p) => !p.thumbnailUrl);
  if (photosNoThumbs.length > 0) {
    issues.push({
      id: "photos-no-thumbnails",
      severity: "info",
      category: "Storage",
      title: "Photos without thumbnails",
      description: "Some legacy photos have no thumbnail. Run the thumbnail backfill (Settings → Backup & Restore) to generate them — improves list-view load time.",
      count: photosNoThumbs.length,
      entityType: "Photo",
      actionView: "settings",
    });
  }

  // (info) Notifications pending for >30 days (stale).
  const staleNotifications = notifications.filter(
    (n) => n.status === "pending" && (now.getTime() - new Date(n.createdAt).getTime()) > THIRTY_DAYS,
  );
  if (staleNotifications.length > 0) {
    issues.push({
      id: "stale-notifications",
      severity: "info",
      category: "Notifications",
      title: "Stale pending notifications",
      description: "Notifications still pending after 30 days. Either mark them done, dismiss them, or document why they're still open.",
      count: staleNotifications.length,
      entityType: "Notification",
      actionView: "notifications",
      examples: staleNotifications.slice(0, 3).map((n) => ({ id: n.id, label: n.title })),
    });
  }

  // Sort issues by severity: error → warning → info.
  const severityRank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  // Stamp each issue with its auto-fix metadata. `fixable`/`fixType` are
  // derived from the FIX_TYPE_BY_ISSUE map so the source of truth for
  // "which issues are auto-fixable" lives in exactly one place. After
  // stamping, the seeds satisfy the full DataHealthIssue type.
  const stampedIssues: DataHealthIssue[] = issues.map((issue) => {
    const fixType = FIX_TYPE_BY_ISSUE[issue.id] ?? null;
    return {
      ...issue,
      fixable: fixType !== null,
      fixType,
    };
  });

  const canFixAll = stampedIssues.some((i) => i.fixable);

  const response: DataHealthResponse = {
    summary: { totalEntities, lastUpdated, storageUsedMB },
    issues: stampedIssues,
    completeness: {
      clients: clientsBucket,
      suppliers: suppliersBucket,
      pos: posBucket,
      bills: billsBucket,
    },
    canFixAll,
    lastFixedAt,
  };

  return NextResponse.json(response);
}
