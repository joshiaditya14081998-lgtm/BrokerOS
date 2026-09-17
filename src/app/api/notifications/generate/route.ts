import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { getLocale, translateNotification } from "@/lib/server-i18n";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Notification auto-generation engine
//
// Scans the database and creates PENDING notifications for due / overdue items
// across four channels:
//   1. visit_followup  — scheduled visits whose plannedDate is in the past
//                        (client didn't show, follow-up needed)
//   2. dispatch_due    — open / partially-delivered POs whose dispatch ETA
//                        (revisedDispatchDate ?? expectedDispatchDate) is within
//                        the next 7 days OR already past
//   3. payment_due     — pending / partially-paid bills whose computed due date
//                        (bill.createdAt + client.defaultPaymentCycleDays) is
//                        within the next 14 days OR already past
//   4. brokerage_due   — eligible, not-yet-paid brokerages whose payout cadence
//                        window has elapsed (immediate = at once; 4-month and
//                        12-month = window end reached)
//
// Idempotent: before creating, we check whether a PENDING notification with
// the same (type + entityType + entityId) already exists. If so, skip.
//
// The POST handler respects the `auto_generate_notifications` system setting
// (default true). When disabled it returns `{ generated: 0, skipped: true }`
// without touching the DB — so the dashboard can fire-and-forget on mount and
// let the route decide.
//
// All queries are scoped to the current authenticated broker — multi-tenant safe.
// ─────────────────────────────────────────────────────────────────────────────

type ChannelKey = "visit_followup" | "dispatch_due" | "payment_due" | "brokerage_due";

const DAY_MS = 24 * 60 * 60 * 1000;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  // setMonth handles year rollover (months > 11 → next year) automatically.
  d.setMonth(d.getMonth() + months);
  return d;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtINR(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

async function readAutoGenerateFlag(): Promise<boolean> {
  const row = await db.systemSetting.findUnique({ where: { key: "auto_generate_notifications" } });
  if (!row) return true; // default ON
  return String(row.value).toLowerCase() === "true";
}

// GET /api/notifications/generate — read-only summary.
// Returns the count of pending notifications + the most recent notification's
// createdAt (used by the UI as a "last generated" timestamp). Does NOT mutate.
// The `locale` query param is accepted for signature symmetry with POST but
// not used here — GET returns counts only, no translatable strings.
export async function GET(_req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pendingCount = await db.notification.count({ where: { status: "pending", brokerId: broker.id } });
  const latest = await db.notification.findFirst({
    where: { brokerId: broker.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return NextResponse.json({
    pendingCount,
    lastGenerated: latest ? latest.createdAt.toISOString() : null,
  });
}

// POST /api/notifications/generate — scan + create pending notifications.
// Reads the `locale` query param so the generated title/message are in the
// broker's chosen language (defaults to "en"). Translation strings live in
// `src/lib/server-i18n.ts` so the action-center route can share them.
export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const locale = getLocale(req);
  // Master toggle: dashboard fires-and-forgets on mount; route decides.
  const enabled = await readAutoGenerateFlag();
  if (!enabled) {
    return NextResponse.json({
      generated: 0,
      skipped: true,
      details: { visit_followup: 0, dispatch_due: 0, payment_due: 0, brokerage_due: 0 },
    });
  }

  const now = new Date();
  const dispatchHorizon = new Date(now.getTime() + 7 * DAY_MS); // upcoming 7d
  const paymentHorizon = new Date(now.getTime() + 14 * DAY_MS); // upcoming 14d

  const details: Record<ChannelKey, number> = {
    visit_followup: 0,
    dispatch_due: 0,
    payment_due: 0,
    brokerage_due: 0,
  };

  // Fetch all existing pending notifications once and key them for O(1) lookup.
  // Key: `${type}|${entityType}|${entityId}` — scoped to this broker.
  const existing = await db.notification.findMany({
    where: { status: "pending", brokerId: broker.id },
    select: { type: true, entityType: true, entityId: true },
  });
  const existingKeys = new Set(
    existing.map((n) => `${n.type}|${n.entityType ?? ""}|${n.entityId ?? ""}`)
  );
  const hasPending = (type: ChannelKey, entityType: string, entityId: string) =>
    existingKeys.has(`${type}|${entityType}|${entityId}`);

  const creates: Array<{
    type: ChannelKey;
    title: string;
    message: string;
    dueDate: Date;
    entityType: string;
    entityId: string;
    status: "pending";
    brokerId: string;
  }> = [];

  // ── (a) Visit follow-ups ────────────────────────────────────────────────
  // Visits still "scheduled" but plannedDate is in the past — client didn't show.
  // (Visits already "followed_up" / "occurred" / "no_show" don't need a reminder.)
  const overdueVisits = await db.visit.findMany({
    where: { status: "scheduled", plannedDate: { lt: now }, brokerId: broker.id },
    include: { client: { select: { name: true } } },
  });
  for (const v of overdueVisits) {
    if (hasPending("visit_followup", "Visit", v.id)) continue;
    const { title, message } = translateNotification("visit_followup", locale, {
      client: v.client.name,
      date: fmtDate(v.plannedDate),
    });
    creates.push({
      type: "visit_followup",
      title,
      message,
      dueDate: v.plannedDate,
      entityType: "Visit",
      entityId: v.id,
      status: "pending",
      brokerId: broker.id,
    });
  }

  // ── (b) Dispatch due ────────────────────────────────────────────────────
  // Open or partially-delivered POs whose (revised ?? expected) dispatch date
  // is within the next 7 days OR already past.
  const dispatchPOs = await db.purchaseOrder.findMany({
    where: {
      brokerId: broker.id,
      status: { in: ["open", "partially_delivered"] },
      OR: [{ revisedDispatchDate: { not: null } }, { expectedDispatchDate: { not: null } }],
    },
    include: { supplier: { select: { name: true } } },
  });
  for (const po of dispatchPOs) {
    const due = po.revisedDispatchDate ?? po.expectedDispatchDate;
    if (!due) continue;
    if (due > dispatchHorizon && due >= now) continue; // >7d out AND not past
    if (hasPending("dispatch_due", "PurchaseOrder", po.id)) continue;
    const { title, message } = translateNotification("dispatch_due", locale, {
      poNumber: po.poNumber,
      supplier: po.supplier.name,
      status: po.status.replace(/_/g, " "),
      date: fmtDate(due),
    });
    creates.push({
      type: "dispatch_due",
      title,
      message,
      dueDate: due,
      entityType: "PurchaseOrder",
      entityId: po.id,
      status: "pending",
      brokerId: broker.id,
    });
  }

  // ── (c) Payment due ─────────────────────────────────────────────────────
  // Pending / partially-paid bills. due = bill.createdAt + client.defaultPaymentCycleDays.
  // Notify if due date is within the next 14 days OR already past.
  const openBills = await db.bill.findMany({
    where: { status: { in: ["pending", "partially_paid"] }, brokerId: broker.id },
    include: { client: { select: { name: true, defaultPaymentCycleDays: true } } },
  });
  for (const bill of openBills) {
    const dueDate = new Date(bill.createdAt.getTime() + bill.client.defaultPaymentCycleDays * DAY_MS);
    if (dueDate > paymentHorizon && dueDate >= now) continue;
    if (hasPending("payment_due", "Bill", bill.id)) continue;
    const remaining = Math.max(0, bill.finalAmount - bill.paidAmount);
    const { title, message } = translateNotification("payment_due", locale, {
      billNumber: bill.billNumber,
      client: bill.client.name,
      amount: fmtINR(remaining),
      status: bill.status.replace(/_/g, " "),
    });
    creates.push({
      type: "payment_due",
      title,
      message,
      dueDate,
      entityType: "Bill",
      entityId: bill.id,
      status: "pending",
      brokerId: broker.id,
    });
  }

  // ── (d) Brokerage due ───────────────────────────────────────────────────
  // Eligible brokerages (eligible === true) not yet paid (payoutStatus !== "paid").
  //   • immediate cadence          → due immediately
  //   • 4_month_cumulative / 12m   → due once period end (first eligibleAt + N
  //                                  months among the client's eligible-unpaid
  //                                  set) has passed
  const eligibleBrokerages = await db.brokerage.findMany({
    where: { eligible: true, payoutStatus: { not: "paid" }, brokerId: broker.id },
    include: { client: { select: { name: true, payoutCadence: true } } },
    orderBy: { eligibleAt: "asc" },
  });

  // Group by client: earliest eligibleAt (period start) + count pending payout.
  const byClient = new Map<string, { earliest: Date; count: number; cadence: string; clientName: string }>();
  for (const b of eligibleBrokerages) {
    const eligibleAt = b.eligibleAt ?? now;
    const prev = byClient.get(b.clientId);
    if (prev) {
      prev.count += 1;
      if (eligibleAt < prev.earliest) prev.earliest = eligibleAt;
    } else {
      byClient.set(b.clientId, {
        earliest: eligibleAt,
        count: 1,
        cadence: b.client.payoutCadence,
        clientName: b.client.name,
      });
    }
  }

  for (const b of eligibleBrokerages) {
    const eligibleAt = b.eligibleAt ?? now;
    const cadence = b.client.payoutCadence;
    const meta = byClient.get(b.clientId);
    const n = meta?.count ?? 1;

    let due = false;
    let dueDate: Date = eligibleAt;

    if (cadence === "immediate") {
      // Eligible → payout due right away.
      due = true;
      dueDate = eligibleAt;
    } else if (cadence === "4_month_cumulative" || cadence === "12_month_cumulative") {
      const months = cadence === "4_month_cumulative" ? 4 : 12;
      const periodEnd = addMonths(meta?.earliest ?? eligibleAt, months);
      dueDate = periodEnd;
      if (now >= periodEnd) due = true;
    } else {
      // Unknown cadence — fall back to immediate behaviour.
      due = true;
      dueDate = eligibleAt;
    }

    if (!due) continue;
    if (hasPending("brokerage_due", "Brokerage", b.id)) continue;

    const cadenceLabel = cadence.replace(/_/g, " ");
    const { title, message } = translateNotification("brokerage_due", locale, {
      client: b.client.name,
      amount: fmtINR(b.brokerageAmount),
      cadence: cadenceLabel,
      n: String(n),
    });
    creates.push({
      type: "brokerage_due",
      title,
      message,
      dueDate,
      entityType: "Brokerage",
      entityId: b.id,
      status: "pending",
      brokerId: broker.id,
    });
  }

  // Persist (batch) — single round-trip createMany.
  if (creates.length > 0) {
    await db.notification.createMany({ data: creates });
    for (const c of creates) details[c.type] += 1;
  }

  // Email-digest intent flag — surfaces whether the broker has opted into
  // email notifications so callers (the dashboard, the scheduler) can decide
  // whether to ALSO fire POST /api/notifications/email. The generate route
  // itself NEVER sends email (that would duplicate the scheduler's call) —
  // it just reports intent. The actual email-sending decision + HTML
  // generation lives in /api/notifications/email.
  const emailEnabledRow = await db.systemSetting.findUnique({
    where: { key: "email_notifications_enabled" },
  });
  const emailEnabled = String(emailEnabledRow?.value ?? "false").toLowerCase() === "true";

  // Count total notifications for this broker (for UI display)
  const totalCount = await db.notification.count({ where: { brokerId: broker.id } });

  return NextResponse.json({
    generated: creates.length,
    total: totalCount,
    skipped: false,
    details,
    emailEnabled,
    emailWanted: emailEnabled && creates.length > 0,
  });
}
