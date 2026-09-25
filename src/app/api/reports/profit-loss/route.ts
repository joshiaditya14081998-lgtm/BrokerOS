import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-middleware";
import { reportError } from "@/lib/error-report";
import { getCached, setCached, CACHE_TTL } from "@/lib/cache";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// P&L Statement JSON API
//
// GET /api/reports/profit-loss?range=month|quarter|year|custom&from=ISO&to=ISO
//
// Computes Profit & Loss for the broker over a date range:
//   Income = brokerage eligible in range (accrued) + brokerage paid in range
//   Expenses = operating expenses grouped by category
//   Net = Income − Expenses
//   Comparison = same calc for the previous period of equal length
//
// Used by the P&L Statement React view (`pl-statement-view.tsx`). The PDF
// export path lives in `/api/reports/route.ts?type=profit-loss` and mirrors
// this computation for the print-optimized HTML output.
// ─────────────────────────────────────────────────────────────────────────────

type Range = "month" | "quarter" | "year" | "custom";

const VALID_RANGES: Range[] = ["month", "quarter", "year", "custom"];

const EXPENSE_CATEGORIES = [
  "travel",
  "phone",
  "staff_salary",
  "office_rent",
  "marketing",
  "miscellaneous",
] as const;

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Resolve `range` + optional `from`/`to` into a { start, end } window.
// `custom` requires both; others derive from the current date.
function resolveRange(
  range: Range,
  fromRaw: string | null,
  toRaw: string | null,
): { start: Date; end: Date } {
  const now = new Date();
  if (range === "custom") {
    const from = parseDate(fromRaw) ?? new Date(now.getFullYear(), now.getMonth(), 1);
    const to = parseDate(toRaw) ?? now;
    // Inclusive upper bound — end of day.
    to.setHours(23, 59, 59, 999);
    return { start: from, end: to };
  }
  const y = now.getFullYear();
  const m = now.getMonth();
  let start: Date;
  if (range === "month") {
    start = new Date(y, m, 1);
  } else if (range === "quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    start = new Date(y, qStartMonth, 1);
  } else {
    // year
    start = new Date(y, 0, 1);
  }
  return { start, end: now };
}

// Compute the previous period of the same length as `{start, end}` — used
// for the % change comparison. Returns `{start, end}` where end = the
// original start (exclusive) and start = original start − duration.
function previousRange(start: Date, end: Date): { start: Date; end: Date } {
  const duration = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1); // day before
  const prevStart = new Date(prevEnd.getTime() - duration);
  return { start: prevStart, end: prevEnd };
}

// Compute income + expenses for a given range. Extracted so the previous
// period can reuse the exact same logic for the comparison.
async function computePL(brokerId: string, start: Date, end: Date) {
  // ── Income ────────────────────────────────────────────────────────────────
  // Brokerage eligible in range — uses `eligibleAt` (the timestamp the
  // brokerage became eligible). `eligibleAt` is null for non-eligible rows;
  // the gte filter implicitly excludes them.
  const eligibleBrokerages = await db.brokerage.aggregate({
    where: {
      brokerId,
      eligible: true,
      eligibleAt: { gte: start, lte: end },
    },
    _sum: { brokerageAmount: true },
  });
  const brokerageEligible = eligibleBrokerages._sum.brokerageAmount ?? 0;

  // Brokerage actually paid out in range — uses BrokeragePayout.paidAt via
  // the brokerage → payout relation. A brokerage is "paid" when its
  // payout.status = "paid" AND payout.paidAt ∈ [start, end].
  const paidBrokerages = await db.brokerage.aggregate({
    where: {
      brokerId,
      payoutStatus: "paid",
      payout: { paidAt: { gte: start, lte: end } },
    },
    _sum: { brokerageAmount: true },
  });
  const brokeragePaidOut = paidBrokerages._sum.brokerageAmount ?? 0;

  const totalIncome = brokerageEligible;

  // ── Expenses ──────────────────────────────────────────────────────────────
  // Group by category. Expenses use `date` (the date the cost was incurred).
  const expensesByCat = await db.expense.groupBy({
    by: ["category"],
    where: {
      brokerId,
      date: { gte: start, lte: end },
    },
    _sum: { amount: true },
  });
  const byCategoryMap = new Map<string, number>();
  for (const row of expensesByCat) {
    byCategoryMap.set(row.category, row._sum.amount ?? 0);
  }
  const byCategory: Record<string, number> = {};
  for (const cat of EXPENSE_CATEGORIES) {
    byCategory[cat] = byCategoryMap.get(cat) ?? 0;
  }
  const totalExpenses = (Object.values(byCategory) as number[]).reduce((s, v) => s + v, 0);

  // ── Net ───────────────────────────────────────────────────────────────────
  const profit = totalIncome - totalExpenses;
  const marginPercent = totalIncome > 0 ? (profit / totalIncome) * 100 : 0;
  return {
    brokerageEligible,
    brokeragePaidOut,
    totalIncome,
    byCategory,
    totalExpenses,
    profit,
    marginPercent,
    isProfit: profit >= 0,
  };
}

export const GET = withRateLimit(
  async (req: NextRequest) => {
    try {
      const broker = await getCurrentBroker();
      if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const { searchParams } = new URL(req.url);
      const rangeRaw = searchParams.get("range") ?? "month";
      const range = (VALID_RANGES as readonly string[]).includes(rangeRaw)
        ? (rangeRaw as Range)
        : "month";

      const { start, end } = resolveRange(
        range,
        searchParams.get("from"),
        searchParams.get("to"),
      );

      // ── Cache check — 5 minute TTL for P&L report (data changes on mutations)
      const cacheKey = `${broker.id}:pl:${range}:${searchParams.get("from") ?? ""}:${searchParams.get("to") ?? ""}`;
      const cached = getCached(cacheKey);
      if (cached) return NextResponse.json(cached);

      const prev = previousRange(start, end);

      const current = await computePL(broker.id, start, end);
      const previous = await computePL(broker.id, prev.start, prev.end);

      const changePercent =
        previous.profit !== 0
          ? ((current.profit - previous.profit) / Math.abs(previous.profit)) * 100
          : current.profit !== 0
            ? 100
            : 0;

      const rangeLabel =
        range === "custom"
          ? `${start.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} — ${end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
          : range === "month"
            ? start.toLocaleDateString("en-IN", { month: "long", year: "numeric" })
            : range === "quarter"
              ? `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`
              : `Year ${start.getFullYear()}`;

      const response = {
        range: { start: start.toISOString(), end: end.toISOString(), label: rangeLabel },
        income: {
          brokerageEligible: current.brokerageEligible,
          brokeragePaidOut: current.brokeragePaidOut,
          otherIncome: 0,
          totalIncome: current.totalIncome,
        },
        expenses: {
          ...current.byCategory,
          totalExpenses: current.totalExpenses,
        },
        net: {
          profit: current.profit,
          marginPercent: current.marginPercent,
          isProfit: current.isProfit,
        },
        comparison: {
          previousRangeProfit: previous.profit,
          changePercent,
        },
      };

      // Cache for 5 minutes — P&L is computationally expensive (4+ DB queries × 2 periods)
      setCached(cacheKey, response, CACHE_TTL.REPORTS);

      return NextResponse.json(response);
    } catch (error) {
      reportError(error, { path: "/api/reports/profit-loss", method: "GET" });
      return NextResponse.json({ error: "Failed to load P&L data" }, { status: 500 });
    }
  },
  30,
  60_000,
);
