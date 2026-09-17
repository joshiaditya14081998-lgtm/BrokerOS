import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-middleware";
import { reportError } from "@/lib/error-report";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Categories — single source of truth for both client + server validation.
// `staff_salary` + `office_rent` keep snake_case so they sort + display
// consistently with the rest of the schema's status enum strings.
// ─────────────────────────────────────────────────────────────────────────────
export const EXPENSE_CATEGORIES = [
  "travel",
  "phone",
  "staff_salary",
  "office_rent",
  "marketing",
  "miscellaneous",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const ExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.number().min(0.01).max(10000000), // max ₹10 lakh — prevents typo-driven huge entries
  date: z.string().refine((val) => {
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return false;
    // Reject dates more than 1 year in the future
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    return d.getTime() <= oneYearFromNow.getTime();
  }, "Date cannot be more than 1 year in the future"),
  description: z.string().max(500).optional().nullable(),
  vendor: z.string().max(200).optional().nullable(),
  receiptUrl: z.string().optional().nullable(),
});

// Parse an ISO date query param. Returns null when the value is missing or
// unparseable so callers can skip the filter entirely.
function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// GET /api/expenses?category=X&from=ISO&to=ISO
// Auth required (getCurrentBroker). Always scoped to brokerId.
// Returns `{ expenses: [...], summary: { total, byCategory: { travel: N, ... } } }`.
// The summary is computed server-side from the same filter set the list uses,
// so the two always agree (the dashboard's "Total Expenses" KPI can call this
// with `?from=&to=` for the current month without re-implementing the roll-up).
export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category")?.trim() || undefined;
  const from = parseDate(searchParams.get("from"));
  const toRaw = parseDate(searchParams.get("to"));
  // Inclusive upper bound — push `to` to end-of-day so a same-day range
  // captures the whole day rather than just midnight.
  const to = toRaw ? new Date(toRaw.getTime()) : null;
  if (to) to.setHours(23, 59, 59, 999);

  // Defensive: only apply `category` if it's a known value — otherwise the
  // broker could 500 by passing `?category=,`.
  const categoryFilter =
    category && (EXPENSE_CATEGORIES as readonly string[]).includes(category)
      ? category
      : undefined;

  const where = {
    brokerId: broker.id,
    ...(categoryFilter ? { category: categoryFilter } : {}),
    ...(from || to
      ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
  };

  const expenses = await db.expense.findMany({
    where,
    orderBy: { date: "desc" },
  });

  // Summary — total + per-category roll-up over the same filtered set.
  const byCategory: Record<string, number> = {};
  for (const c of EXPENSE_CATEGORIES) byCategory[c] = 0;
  let total = 0;
  for (const e of expenses) {
    total += e.amount;
    if (typeof byCategory[e.category] === "number") {
      byCategory[e.category] += e.amount;
    } else {
      byCategory[e.category] = e.amount;
    }
  }

  return NextResponse.json({
    expenses,
    summary: { total, byCategory },
  });
}

// POST /api/expenses
// Body: { category, amount, date, description?, vendor?, receiptUrl? }
// Zod-validated. Rate-limited at 30 req/min per IP — a financial mutation
// surface, so stricter than the default 100/min but looser than auth routes.
export const POST = withRateLimit(
  async (req: NextRequest) => {
    try {
      const broker = await getCurrentBroker();
      if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const body = await req.json();
      const parsed = ExpenseSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      }
      const { category, amount, date, description, vendor, receiptUrl } = parsed.data;

      const expense = await db.expense.create({
        data: {
          brokerId: broker.id,
          category,
          amount,
          date: new Date(date),
          description: description?.trim() || null,
          vendor: vendor?.trim() || null,
          receiptUrl: receiptUrl?.trim() || null,
        },
      });

      await db.auditLog.create({
        data: {
          brokerId: broker.id,
          entityType: "Expense",
          entityId: expense.id,
          action: "create",
          after: JSON.stringify(expense),
          userName: "Broker",
          reason: `Expense recorded: ${category} · ${amount}`,
        },
      });

      return NextResponse.json({ expense });
    } catch (error) {
      reportError(error, { path: "/api/expenses", method: "POST" });
      return NextResponse.json({ error: "Failed to record expense" }, { status: 500 });
    }
  },
  30,
  60_000,
);
