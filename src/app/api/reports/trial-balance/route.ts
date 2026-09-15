import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-middleware";
import { reportError } from "@/lib/error-report";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Trial Balance JSON API
//
// GET /api/reports/trial-balance?asOf=ISO
//
// Returns every "account" the broker's books touch, with debit + credit totals
// as-of a given moment. The debit side MUST equal the credit side for the books
// to be in balance — `totals.isBalanced` exposes the check (rounding tolerance
// 0.01).
//
// Accounts computed (all scoped to brokerId):
//   1.  Client Receivables  (Asset, debit)   — outstanding bill balances
//   2.  Brokerage Receivable (Asset, debit)  — eligible but unpaid brokerage
//   3.  Brokerage Income    (Income, credit) — all eligible brokerage
//   4-9.Operating Expenses  (Expense, debit) — one account per Expense category
//   10. Bank/Cash           (Asset, both)    — payouts in (debit) / expenses out (credit)
//   11. GST Payable         (Liability, credit) — output GST billed to clients
//
// The view (`trial-balance-view.tsx`) consumes this JSON directly. The PDF
// variant lives in `/api/reports?type=trial-balance&asOf=<>` (see the main
// reports route).
// ─────────────────────────────────────────────────────────────────────────────

const EXPENSE_CATEGORIES = [
  "travel",
  "phone",
  "staff_salary",
  "office_rent",
  "marketing",
  "miscellaneous",
] as const;

const EXPENSE_ACCOUNT_NAMES: Record<(typeof EXPENSE_CATEGORIES)[number], string> = {
  travel: "Travel Expenses",
  phone: "Phone Expenses",
  staff_salary: "Staff Salary",
  office_rent: "Office Rent",
  marketing: "Marketing",
  miscellaneous: "Miscellaneous",
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const GET = withRateLimit(
  async (req: NextRequest) => {
    try {
      const broker = await getCurrentBroker();
      if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const { searchParams } = new URL(req.url);
      const asOfRaw = searchParams.get("asOf");
      const asOf = asOfRaw ? new Date(asOfRaw) : new Date();
      if (Number.isNaN(asOf.getTime())) {
        return NextResponse.json({ error: "Invalid asOf date" }, { status: 400 });
      }

      // ── 1. Client Receivables (Asset, debit) ──────────────────────────────
      // sum of (finalAmount - paidAmount) for every bill created on or before asOf
      const bills = await db.bill.findMany({
        where: { brokerId: broker.id, createdAt: { lte: asOf } },
        select: { finalAmount: true, paidAmount: true },
      });
      const clientReceivables = round2(
        bills.reduce((s, b) => s + (b.finalAmount - b.paidAmount), 0),
      );

      // ── 2. Brokerage Receivable (Asset, debit) ────────────────────────────
      // eligible AND not-yet-paid AND eligibleAt <= asOf
      const eligibleUnpaid = await db.brokerage.findMany({
        where: {
          brokerId: broker.id,
          eligible: true,
          payoutStatus: { not: "paid" },
          eligibleAt: { lte: asOf },
        },
        select: { brokerageAmount: true },
      });
      const brokerageReceivable = round2(
        eligibleUnpaid.reduce((s, b) => s + b.brokerageAmount, 0),
      );

      // ── 3. Brokerage Income (Income, credit) ──────────────────────────────
      // all eligible brokerage (accrued + paid), eligibleAt <= asOf
      const eligibleAll = await db.brokerage.findMany({
        where: {
          brokerId: broker.id,
          eligible: true,
          eligibleAt: { lte: asOf },
        },
        select: { brokerageAmount: true },
      });
      const brokerageIncome = round2(
        eligibleAll.reduce((s, b) => s + b.brokerageAmount, 0),
      );

      // ── 4-9. Operating Expenses by category (Expense, debit) ──────────────
      const expenseAgg = await db.expense.groupBy({
        by: ["category"],
        where: { brokerId: broker.id, date: { lte: asOf } },
        _sum: { amount: true },
      });
      const expenseByCat: Record<string, number> = {};
      for (const c of EXPENSE_CATEGORIES) expenseByCat[c] = 0;
      for (const row of expenseAgg) {
        if (typeof expenseByCat[row.category] === "number") {
          expenseByCat[row.category] += row._sum.amount ?? 0;
        }
      }

      // ── 10. Bank/Cash (Asset, both) ───────────────────────────────────────
      //  debit  = sum of BrokeragePayout.totalAmount where status=paid AND paidAt <= asOf
      //  credit = sum of all expenses where date <= asOf
      const paidPayouts = await db.brokeragePayout.findMany({
        where: { brokerId: broker.id, status: "paid", paidAt: { lte: asOf } },
        select: { totalAmount: true },
      });
      const bankCashDebit = round2(
        paidPayouts.reduce((s, p) => s + p.totalAmount, 0),
      );
      const allExpenses = await db.expense.aggregate({
        where: { brokerId: broker.id, date: { lte: asOf } },
        _sum: { amount: true },
      });
      const bankCashCredit = round2(allExpenses._sum.amount ?? 0);

      // ── 11. GST Payable (Liability, credit) ───────────────────────────────
      const gstAgg = await db.bill.aggregate({
        where: { brokerId: broker.id, createdAt: { lte: asOf } },
        _sum: { gstAmount: true },
      });
      const gstPayable = round2(gstAgg._sum.gstAmount ?? 0);

      // ── Compose accounts array ────────────────────────────────────────────
      const accounts: Array<{
        name: string;
        type: "asset" | "income" | "expense" | "liability";
        debit: number;
        credit: number;
      }> = [
        { name: "Client Receivables", type: "asset", debit: clientReceivables, credit: 0 },
        { name: "Brokerage Receivable", type: "asset", debit: brokerageReceivable, credit: 0 },
        { name: "Brokerage Income", type: "income", debit: 0, credit: brokerageIncome },
      ];
      for (const c of EXPENSE_CATEGORIES) {
        accounts.push({
          name: EXPENSE_ACCOUNT_NAMES[c],
          type: "expense",
          debit: round2(expenseByCat[c]),
          credit: 0,
        });
      }
      accounts.push({ name: "Bank/Cash", type: "asset", debit: bankCashDebit, credit: bankCashCredit });
      accounts.push({ name: "GST Payable", type: "liability", debit: 0, credit: gstPayable });

      const totalDebit = round2(accounts.reduce((s, a) => s + a.debit, 0));
      const totalCredit = round2(accounts.reduce((s, a) => s + a.credit, 0));
      const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

      return NextResponse.json({
        asOf: asOf.toISOString(),
        accounts,
        totals: { totalDebit, totalCredit, isBalanced },
      });
    } catch (error) {
      reportError(error, { route: "/api/reports/trial-balance" });
      return NextResponse.json({ error: "Failed to compute trial balance" }, { status: 500 });
    }
  },
  30,
  60_000,
);
