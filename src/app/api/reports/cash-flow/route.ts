import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-middleware";
import { reportError } from "@/lib/error-report";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Cash Flow Statement JSON API
//
// GET /api/reports/cash-flow?range=month|quarter|year|custom&from=ISO&to=ISO
//
// Computes money-in vs money-out for the broker's own cash position over a
// window, plus opening + closing balance and an expense-category breakdown.
//
// Inflows:
//   - brokeragePayouts : sum of BrokeragePayout.totalAmount where status=paid
//                        AND paidAt falls in [start, end]
//   - invoicePayments  : sum of Invoice.totalAmount where status=paid AND
//                        issueDate falls in [start, end]
//                        (Invoice has no paidAt field — issueDate of a paid
//                        invoice is the proxy for v1.)
//
// Outflows:
//   - byCategory       : Expense grouped by category, where date falls in window
//   - totalOutflow     : sum of all expenses in window
//
// Net:
//   cashFlow        = totalInflow − totalOutflow
//   openingBalance  = (brokerage payouts paid before start)
//                   + (paid invoices issued before start)
//                   − (expenses incurred before start)
//   closingBalance  = openingBalance + cashFlow
//
// Range resolution:
//   month   → first day of current month → now
//   quarter → first day of current quarter → now
//   year    → Jan 1 of current year → now
//   custom  → use from/to query params (to is end-of-day)
//   default → month
// ─────────────────────────────────────────────────────────────────────────────

const EXPENSE_CATEGORIES = [
  "travel",
  "phone",
  "staff_salary",
  "office_rent",
  "marketing",
  "miscellaneous",
] as const;

type Range = "month" | "quarter" | "year" | "custom";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function resolveRange(range: Range, fromRaw: string | null, toRaw: string | null): {
  start: Date;
  end: Date;
  label: string;
} {
  const now = new Date();
  if (range === "custom") {
    const start = fromRaw ? new Date(fromRaw) : new Date(now.getFullYear(), now.getMonth(), 1);
    const toParsed = toRaw ? new Date(toRaw) : now;
    const end = new Date(toParsed);
    end.setHours(23, 59, 59, 999);
    const label = `${start.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;
    return { start, end, label };
  }
  const y = now.getFullYear();
  const m = now.getMonth();
  let start: Date;
  let label: string;
  if (range === "quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    start = new Date(y, qStartMonth, 1);
    const qNum = Math.floor(qStartMonth / 3) + 1;
    label = `Q${qNum} ${y}`;
  } else if (range === "year") {
    start = new Date(y, 0, 1);
    label = `Year ${y}`;
  } else {
    start = new Date(y, m, 1);
    label = start.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }
  return { start, end: now, label };
}

// Sum brokerage payouts (status=paid) where paidAt is in [start, end].
async function sumPayoutsInWindow(brokerId: string, start: Date, end: Date): Promise<number> {
  const rows = await db.brokeragePayout.findMany({
    where: {
      brokerId,
      status: "paid",
      paidAt: { gte: start, lte: end },
    },
    select: { totalAmount: true },
  });
  return rows.reduce((s, r) => s + r.totalAmount, 0);
}

// Sum paid-invoice totalAmount where issueDate is in [start, end].
async function sumPaidInvoicesInWindow(brokerId: string, start: Date, end: Date): Promise<number> {
  const rows = await db.invoice.findMany({
    where: {
      brokerId,
      status: "paid",
      issueDate: { gte: start, lte: end },
    },
    select: { totalAmount: true },
  });
  return rows.reduce((s, r) => s + r.totalAmount, 0);
}

// Total expense amount incurred in [start, end].
async function sumExpensesInWindow(brokerId: string, start: Date, end: Date): Promise<number> {
  const agg = await db.expense.aggregate({
    where: { brokerId, date: { gte: start, lte: end } },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

// Expense by category for [start, end] — returns the full category map.
async function expensesByCategoryInWindow(
  brokerId: string,
  start: Date,
  end: Date,
): Promise<Record<string, number>> {
  const agg = await db.expense.groupBy({
    by: ["category"],
    where: { brokerId, date: { gte: start, lte: end } },
    _sum: { amount: true },
  });
  const byCat: Record<string, number> = {};
  for (const c of EXPENSE_CATEGORIES) byCat[c] = 0;
  for (const row of agg) {
    if (typeof byCat[row.category] === "number") {
      byCat[row.category] += row._sum.amount ?? 0;
    }
  }
  return byCat;
}

export const GET = withRateLimit(
  async (req: NextRequest) => {
    try {
      const broker = await getCurrentBroker();
      if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const { searchParams } = new URL(req.url);
      const rawRange = (searchParams.get("range") ?? "month").toLowerCase() as Range;
      const range: Range = (["month", "quarter", "year", "custom"] as Range[]).includes(rawRange)
        ? rawRange
        : "month";

      const { start, end, label } = resolveRange(
        range,
        searchParams.get("from"),
        searchParams.get("to"),
      );

      // ── Inflows in window ─────────────────────────────────────────────────
      const [payoutsInWin, invoicesInWin] = await Promise.all([
        sumPayoutsInWindow(broker.id, start, end),
        sumPaidInvoicesInWindow(broker.id, start, end),
      ]);
      const totalInflow = round2(payoutsInWin + invoicesInWin);

      // ── Outflows in window ────────────────────────────────────────────────
      const [byCategoryRaw, totalOutflowRaw] = await Promise.all([
        expensesByCategoryInWindow(broker.id, start, end),
        sumExpensesInWindow(broker.id, start, end),
      ]);
      const byCategory: Record<string, number> = {};
      for (const c of EXPENSE_CATEGORIES) byCategory[c] = round2(byCategoryRaw[c] ?? 0);
      const totalOutflow = round2(totalOutflowRaw);

      // ── Opening balance: cumulative position before `start` ───────────────
      // opening = (payouts paid before start) + (paid invoices issued before start)
      //         − (expenses incurred before start)
      const epoch = new Date(0);
      const [payoutsBefore, invoicesBefore, expensesBefore] = await Promise.all([
        sumPayoutsInWindow(broker.id, epoch, start),
        sumPaidInvoicesInWindow(broker.id, epoch, start),
        sumExpensesInWindow(broker.id, epoch, start),
      ]);
      const openingBalance = round2(payoutsBefore + invoicesBefore - expensesBefore);

      // ── Net + closing ─────────────────────────────────────────────────────
      const cashFlow = round2(totalInflow - totalOutflow);
      const closingBalance = round2(openingBalance + cashFlow);

      return NextResponse.json({
        range: { start: start.toISOString(), end: end.toISOString(), label },
        inflows: {
          brokeragePayouts: round2(payoutsInWin),
          invoicePayments: round2(invoicesInWin),
          totalInflow,
        },
        outflows: {
          byCategory,
          totalOutflow,
        },
        net: {
          cashFlow,
          openingBalance,
          closingBalance,
        },
      });
    } catch (error) {
      reportError(error, { route: "/api/reports/cash-flow" });
      return NextResponse.json({ error: "Failed to compute cash flow" }, { status: 500 });
    }
  },
  30,
  60_000,
);
