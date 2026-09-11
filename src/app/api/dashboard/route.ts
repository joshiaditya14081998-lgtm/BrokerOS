import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

type Range = "month" | "quarter" | "year" | "all";

const VALID_RANGES: Range[] = ["month", "quarter", "year", "all"];

// Compute the [start, end] window for a given range.
// `start` is undefined for "all" so callers can short-circuit filtering.
function getRangeBounds(range: Range): { start: Date | undefined; end: Date } {
  const now = new Date();
  if (range === "all") return { start: undefined, end: now };

  const y = now.getFullYear();
  const m = now.getMonth();

  let start: Date;
  if (range === "month") {
    start = new Date(y, m, 1);
  } else if (range === "quarter") {
    // Quarter start months: Jan (0), Apr (3), Jul (6), Oct (9)
    const qStartMonth = Math.floor(m / 3) * 3;
    start = new Date(y, qStartMonth, 1);
  } else {
    // year
    start = new Date(y, 0, 1);
  }
  return { start, end: now };
}

// Build the earnings-trend buckets appropriate for the range:
//   month   → 30 daily buckets (ending today)
//   quarter → up to 13 weekly buckets (from quarter start)
//   year    → 12 monthly buckets (ending current month)
//   all     → 6 monthly buckets (ending current month) — original behavior
function buildEarningsBuckets(
  range: Range,
  now: Date,
): { label: string; start: Date; end: Date }[] {
  const buckets: { label: string; start: Date; end: Date }[] = [];

  if (range === "month") {
    for (let i = 29; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const e = new Date(s);
      e.setDate(e.getDate() + 1);
      buckets.push({
        label: s.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        start: s,
        end: e,
      });
    }
  } else if (range === "quarter") {
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
    const qStart = new Date(now.getFullYear(), qStartMonth, 1);
    for (let i = 0; i < 13; i++) {
      const s = new Date(qStart);
      s.setDate(s.getDate() + i * 7);
      if (s > now) break;
      const e = new Date(s);
      e.setDate(e.getDate() + 7);
      buckets.push({
        label: s.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        start: s,
        end: e,
      });
    }
  } else {
    // year (12 months) or all (6 months)
    const numMonths = range === "year" ? 12 : 6;
    for (let i = numMonths - 1; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const label =
        s.toLocaleDateString("en-IN", { month: "short" }) +
        (range === "year" ? ` ${String(s.getFullYear()).slice(-2)}` : "");
      buckets.push({ label, start: s, end: e });
    }
  }
  return buckets;
}

// GET /api/dashboard?range=month|quarter|year|all — broker financial overview + KPIs + charts + reminders
export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const rawRange = url.searchParams.get("range") ?? "all";
  const range: Range = VALID_RANGES.includes(rawRange as Range)
    ? (rawRange as Range)
    : "all";

  const { start: rangeStart, end: rangeEnd } = getRangeBounds(range);

  // Date-window predicate for in-memory filtering of already-fetched records.
  // When range === "all" (rangeStart undefined), every record passes.
  const inRange = (d: Date | null | undefined): boolean => {
    if (!rangeStart) return true;
    if (!d) return false;
    return d >= rangeStart && d <= rangeEnd;
  };

  const createdAtWhere = rangeStart
    ? { brokerId: broker.id, createdAt: { gte: rangeStart, lte: rangeEnd } }
    : { brokerId: broker.id };

  const [
    clients,
    suppliers,
    activePOs,
    openDisputes,
    visitsInRange,
    billsInRange,
    paymentsInRange,
    payoutsInRange,
    brokerages,
    payouts,
    allBills,
    notifications,
    posForStatus,
    clientNames,
  ] = await Promise.all([
    db.client.count({ where: { brokerId: broker.id } }),
    db.supplier.count({ where: { brokerId: broker.id } }),
    db.purchaseOrder.count({ where: { brokerId: broker.id } }),
    db.dispute.count({ where: { brokerId: broker.id } }),
    db.visit.count({ where: createdAtWhere }),
    db.bill.count({ where: createdAtWhere }),
    db.payment.count({ where: createdAtWhere }),
    db.brokeragePayout.count({ where: createdAtWhere }),
    db.brokerage.findMany({ where: { brokerId: broker.id }, include: { bill: true, payout: true } }),
    db.brokeragePayout.findMany({ where: { brokerId: broker.id } }),
    db.bill.findMany({ where: { brokerId: broker.id } }),
    db.notification.findMany({
      where: { brokerId: broker.id, status: "pending" },
      orderBy: { dueDate: "asc" },
      take: 8,
    }),
    db.purchaseOrder.findMany({
      where: createdAtWhere,
      select: { status: true },
    }),
    db.client.findMany({ where: { brokerId: broker.id }, select: { id: true, name: true } }),
  ]);

  // ── Brokerage KPIs (range-filtered by the most relevant timestamp) ─────────
  // accrued / scheduled: filter by eligibleAt within range (eligibility date)
  // paid: filter by payout.paidAt within range (settlement date)
  // pending (not eligible): filter by createdAt within range (when brokerage was created)
  const brokerageAccrued = brokerages
    .filter((b) => b.eligible && b.payoutStatus === "accrued" && inRange(b.eligibleAt))
    .reduce((s, b) => s + b.brokerageAmount, 0);
  const brokerageScheduled = brokerages
    .filter((b) => b.eligible && b.payoutStatus === "scheduled" && inRange(b.eligibleAt))
    .reduce((s, b) => s + b.brokerageAmount, 0);
  const brokeragePaid = brokerages
    .filter((b) => b.payoutStatus === "paid" && inRange(b.payout?.paidAt))
    .reduce((s, b) => s + b.brokerageAmount, 0);
  const brokeragePending = brokerages
    .filter((b) => !b.eligible && inRange(b.createdAt))
    .reduce((s, b) => s + b.brokerageAmount, 0);

  // Outstanding receivable is a point-in-time snapshot of unpaid bill balances —
  // intentionally NOT filtered by range (it reflects the current outstanding
  // position regardless of when the bills were raised).
  const outstandingReceivable = allBills.reduce(
    (s, b) => s + (b.finalAmount - b.paidAmount),
    0,
  );

  // ── Earnings trend chart (range-appropriate buckets) ──────────────────────
  const now = rangeEnd;
  const buckets = buildEarningsBuckets(range, now);
  const earningsTrend = buckets.map(({ label, start, end }) => {
    const earned = brokerages
      .filter((b) => b.eligibleAt && b.eligibleAt >= start && b.eligibleAt < end)
      .reduce((s, b) => s + b.brokerageAmount, 0);
    const paid = payouts
      .filter((p) => p.paidAt && p.paidAt >= start && p.paidAt < end)
      .reduce((s, p) => s + p.totalAmount, 0);
    return { label, earned, paid };
  });

  // ── Volume by client — bills created within range ─────────────────────────
  const billsForVolume = rangeStart
    ? allBills.filter((b) => b.createdAt >= rangeStart && b.createdAt <= rangeEnd)
    : allBills;
  const clientVolMap = new Map<string, number>();
  for (const b of billsForVolume) {
    clientVolMap.set(b.clientId, (clientVolMap.get(b.clientId) ?? 0) + b.finalAmount);
  }
  const volumeByClient = Array.from(clientVolMap.entries())
    .map(([clientId, value]) => {
      const cl = clientNames.find((n) => n.id === clientId);
      // Include the client `id` so the dashboard bar chart can wire an onClick
      // drill-down straight to the client detail sheet.
      return { id: clientId, name: cl?.name ?? "—", value };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // ── PO status — POs created within range ──────────────────────────────────
  const poStatusMap = new Map<string, number>();
  for (const p of posForStatus) {
    poStatusMap.set(p.status, (poStatusMap.get(p.status) ?? 0) + 1);
  }
  const poStatus = Array.from(poStatusMap.entries()).map(([name, value]) => ({
    name,
    value,
  }));

  return NextResponse.json({
    range,
    rangeStart: rangeStart ? rangeStart.toISOString() : null,
    rangeEnd: rangeEnd.toISOString(),
    outstandingIsAllTime: true,
    kpis: {
      clients,
      suppliers,
      activePOs,
      openDisputes,
      outstandingReceivable,
      brokerageAccrued,
      brokerageScheduled,
      brokeragePaid,
      brokeragePending,
    },
    charts: {
      earningsTrend,
      volumeByClient,
      poStatus,
    },
    notifications,
    counts: {
      visits: visitsInRange,
      bills: billsInRange,
      payments: paymentsInRange,
      payouts: payoutsInRange,
    },
  });
}
