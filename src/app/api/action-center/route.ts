import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getLocale, translateAction } from "@/lib/server-i18n";
import { getCurrentBroker } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Action Center — consolidated pending broker actions.
//
// Scans the DB for items that need the broker's attention across five channels
// and returns a single prioritised, deduplicated, capped-at-15 list:
//   (a) visit_followup   — scheduled / followed-up visits in the past or near future
//   (b) dispatch_due     — open POs whose expected dispatch date has passed
//   (c) payment_due      — bills not fully paid whose computed due date is
//                          within 7 days or already past
//   (d) brokerage_payout — eligible brokerages still awaiting payout
//                          (accrued or scheduled), aggregated per client
//   (e) dispute_resolve  — open disputes, escalated to urgent after 7 days
//
// Priority rules (per spec):
//   • visit_followup: overdue scheduled → urgent if >2d overdue, else high;
//                     re-follow-up (followed_up, >3d past planned) → high;
//                     upcoming scheduled within next 3d → normal
//   • dispatch_due:   always high
//   • payment_due:    urgent if >14d past due, high if past due, normal if
//                     due within 7d
//   • brokerage_payout: always high
//   • dispute_resolve: urgent if open >7d, else high
//
// Sort: priority asc (urgent → high → normal), then dueDate asc.
// Summary reflects the returned (capped) action set so the dot counts always
// match the rows shown on screen.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

type Priority = "urgent" | "high" | "normal";

type ActionType =
  | "visit_followup"
  | "dispatch_due"
  | "payment_due"
  | "brokerage_payout"
  | "dispute_resolve";

export type Action = {
  id: string;
  type: ActionType;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string; // ISO
  entityType: string;
  entityId: string | null;
  actionLabel: string;
  actionView: string; // matches a ViewKey in src/lib/ui-store.ts
};

const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
};

function fmtINR(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function pluralDays(n: number): string {
  const abs = Math.max(1, Math.abs(n));
  return `${abs} day${abs === 1 ? "" : "s"}`;
}

export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const locale = getLocale(req);
  const now = new Date();
  const actions: Action[] = [];

  // Fetch all five channels in parallel for a single round-trip of awaits.
  const [
    visits,
    overduePOs,
    openBills,
    eligibleBrokerages,
    openDisputes,
  ] = await Promise.all([
    // (a) Visits with plannedDate <= now+3d AND status in (scheduled, followed_up).
    db.visit.findMany({
      where: {
        brokerId: broker.id,
        status: { in: ["scheduled", "followed_up"] },
        plannedDate: { lte: new Date(now.getTime() + 3 * DAY_MS) },
      },
      include: { client: { select: { name: true } } },
      orderBy: { plannedDate: "asc" },
    }),
    // (b) Open POs with expectedDispatchDate in the past.
    db.purchaseOrder.findMany({
      where: {
        brokerId: broker.id,
        status: "open",
        expectedDispatchDate: { not: null, lt: now },
      },
      include: { supplier: { select: { name: true } } },
      orderBy: { expectedDispatchDate: "asc" },
    }),
    // (c) Bills not fully paid — client fetched for defaultPaymentCycleDays.
    db.bill.findMany({
      where: { brokerId: broker.id, status: { not: "fully_paid" } },
      include: { client: { select: { name: true, defaultPaymentCycleDays: true } } },
      orderBy: { createdAt: "asc" },
    }),
    // (d) Eligible brokerages awaiting payout.
    db.brokerage.findMany({
      where: { brokerId: broker.id, eligible: true, payoutStatus: { in: ["accrued", "scheduled"] } },
      include: { client: { select: { name: true, payoutCadence: true } } },
    }),
    // (e) Open disputes.
    db.dispute.findMany({
      where: { brokerId: broker.id, status: "open" },
      include: { po: { select: { poNumber: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // ── (a) Visits ───────────────────────────────────────────────────────────
  for (const v of visits) {
    const daysOverdue = Math.floor(
      (now.getTime() - v.plannedDate.getTime()) / DAY_MS,
    );
    const isPast = v.plannedDate < now;

    if (v.status === "scheduled" && isPast) {
      // Overdue scheduled visit — urgent if >2d, else high.
      const priority: Priority = daysOverdue > 2 ? "urgent" : "high";
      const { title, description } = translateAction("visit_followup_overdue", locale, {
        client: v.client.name,
        days: pluralDays(daysOverdue),
      });
      actions.push({
        id: `visit-followup-${v.id}`,
        type: "visit_followup",
        title,
        description,
        priority,
        dueDate: v.plannedDate.toISOString(),
        entityType: "Visit",
        entityId: v.id,
        actionLabel: "View visit",
        actionView: "visits",
      });
    } else if (
      v.status === "followed_up" &&
      v.plannedDate < new Date(now.getTime() - 3 * DAY_MS)
    ) {
      // Re-follow-up: visit was followed up but plannedDate is >3d past.
      const { title, description } = translateAction("visit_refollow", locale, {
        client: v.client.name,
        days: pluralDays(daysOverdue),
      });
      actions.push({
        id: `visit-refollow-${v.id}`,
        type: "visit_followup",
        title,
        description,
        priority: "high",
        dueDate: v.plannedDate.toISOString(),
        entityType: "Visit",
        entityId: v.id,
        actionLabel: "View visit",
        actionView: "visits",
      });
    } else if (v.status === "scheduled" && !isPast) {
      // Upcoming scheduled visit within next 3d → normal.
      const daysAhead = Math.max(
        0,
        Math.floor((v.plannedDate.getTime() - now.getTime()) / DAY_MS),
      );
      const { title, description } =
        daysAhead === 0
          ? translateAction("visit_upcoming_today", locale, {
              client: v.client.name,
            })
          : translateAction("visit_upcoming", locale, {
              client: v.client.name,
              days: pluralDays(daysAhead),
            });
      actions.push({
        id: `visit-upcoming-${v.id}`,
        type: "visit_followup",
        title,
        description,
        priority: "normal",
        dueDate: v.plannedDate.toISOString(),
        entityType: "Visit",
        entityId: v.id,
        actionLabel: "View visit",
        actionView: "visits",
      });
    }
  }

  // ── (b) Dispatches to record ─────────────────────────────────────────────
  for (const po of overduePOs) {
    // Use revised dispatch date if it was postponed, else the original expected.
    const effective = po.revisedDispatchDate ?? po.expectedDispatchDate;
    if (!effective) continue;
    const { title, description } = translateAction("dispatch", locale, {
      poNumber: po.poNumber,
      supplier: po.supplier.name,
    });
    actions.push({
      id: `dispatch-${po.id}`,
      type: "dispatch_due",
      title,
      description,
      priority: "high",
      dueDate: effective.toISOString(),
      entityType: "PurchaseOrder",
      entityId: po.id,
      actionLabel: "Record dispatch",
      actionView: "dispatches",
    });
  }

  // ── (c) Payments to collect ──────────────────────────────────────────────
  for (const bill of openBills) {
    const remaining = Math.max(0, bill.finalAmount - bill.paidAmount);
    if (remaining <= 0) continue; // paid in full even if status stale
    const dueDate = new Date(
      bill.createdAt.getTime() + bill.client.defaultPaymentCycleDays * DAY_MS,
    );
    const diffDays = Math.floor((now.getTime() - dueDate.getTime()) / DAY_MS);
    const isPast = dueDate < now;

    if (isPast) {
      const priority: Priority = diffDays > 14 ? "urgent" : "high";
      const { title, description } = translateAction("payment_past", locale, {
        billNumber: bill.billNumber,
        client: bill.client.name,
        amount: fmtINR(remaining),
        days: pluralDays(diffDays),
      });
      actions.push({
        id: `payment-${bill.id}`,
        type: "payment_due",
        title,
        description,
        priority,
        dueDate: dueDate.toISOString(),
        entityType: "Bill",
        entityId: bill.id,
        actionLabel: "Record payment",
        actionView: "payments",
      });
    } else if (dueDate <= new Date(now.getTime() + 7 * DAY_MS)) {
      const daysAhead = Math.max(
        0,
        Math.floor((dueDate.getTime() - now.getTime()) / DAY_MS),
      );
      const { title, description } =
        daysAhead === 0
          ? translateAction("payment_upcoming_today", locale, {
              billNumber: bill.billNumber,
              client: bill.client.name,
              amount: fmtINR(remaining),
            })
          : translateAction("payment_upcoming", locale, {
              billNumber: bill.billNumber,
              client: bill.client.name,
              amount: fmtINR(remaining),
              days: pluralDays(daysAhead),
            });
      actions.push({
        id: `payment-upcoming-${bill.id}`,
        type: "payment_due",
        title,
        description,
        priority: "normal",
        dueDate: dueDate.toISOString(),
        entityType: "Bill",
        entityId: bill.id,
        actionLabel: "Record payment",
        actionView: "payments",
      });
    }
  }

  // ── (d) Brokerage to pay out (aggregated per client) ─────────────────────
  // One action per client (since payout is managed as a batch in the brokerage
  // view). Sums eligible-accrued + eligible-scheduled amounts.
  const brokerageByClient = new Map<
    string,
    {
      total: number;
      cadence: string;
      clientName: string;
      earliestEligibleAt: Date;
    }
  >();
  for (const b of eligibleBrokerages) {
    const eligibleAt = b.eligibleAt ?? b.createdAt;
    const prev = brokerageByClient.get(b.clientId);
    if (prev) {
      prev.total += b.brokerageAmount;
      if (eligibleAt < prev.earliestEligibleAt) prev.earliestEligibleAt = eligibleAt;
    } else {
      brokerageByClient.set(b.clientId, {
        total: b.brokerageAmount,
        cadence: b.client.payoutCadence,
        clientName: b.client.name,
        earliestEligibleAt: eligibleAt,
      });
    }
  }
  for (const [clientId, agg] of brokerageByClient.entries()) {
    const cadenceLabel = agg.cadence.replace(/_/g, " ");
    const { title, description } = translateAction("brokerage", locale, {
      client: agg.clientName,
      amount: fmtINR(agg.total),
      cadence: cadenceLabel,
    });
    actions.push({
      id: `brokerage-${clientId}`,
      type: "brokerage_payout",
      title,
      description,
      priority: "high",
      dueDate: agg.earliestEligibleAt.toISOString(),
      entityType: "Client",
      entityId: clientId,
      actionLabel: "Manage brokerage",
      actionView: "brokerage",
    });
  }

  // ── (e) Disputes to resolve ──────────────────────────────────────────────
  for (const d of openDisputes) {
    const daysOpen = Math.max(
      1,
      Math.floor((now.getTime() - d.createdAt.getTime()) / DAY_MS),
    );
    const priority: Priority = daysOpen > 7 ? "urgent" : "high";
    const typeLabel = d.type.replace(/_/g, " ");
    const desc = d.description
      ? `${typeLabel} — ${d.description}`
      : `${typeLabel} — no further details recorded`;
    const { title, description } = translateAction("dispute", locale, {
      poNumber: d.po.poNumber,
      typeLabel,
      desc,
      days: pluralDays(daysOpen),
    });
    actions.push({
      id: `dispute-${d.id}`,
      type: "dispute_resolve",
      title,
      description,
      priority,
      dueDate: d.createdAt.toISOString(),
      entityType: "Dispute",
      entityId: d.id,
      actionLabel: "View dispute",
      actionView: "disputes",
    });
  }

  // ── Sort: priority asc, then dueDate asc ─────────────────────────────────
  actions.sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  const limited = actions.slice(0, 15);

  // Summary reflects the returned (capped) set so the dot counts always
  // match the rows shown on screen.
  const summary = {
    total: limited.length,
    urgent: limited.filter((a) => a.priority === "urgent").length,
    high: limited.filter((a) => a.priority === "high").length,
    normal: limited.filter((a) => a.priority === "normal").length,
  };

  return NextResponse.json({ actions: limited, summary });
}
