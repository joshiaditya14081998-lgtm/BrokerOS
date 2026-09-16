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
// Double-entry model for a garment broker (agent, not goods owner):
//   When a bill is raised on a client:
//     Dr Client Receivables (finalAmount incl GST)
//       Cr Supplier Payable (baseAmount — owed to supplier)
//       Cr GST Payable (gstAmount — owed to government)
//   When the client pays the bill:
//     Dr Bank/Cash
//       Cr Client Receivables
//   When brokerage becomes eligible (bill fully paid):
//     Dr Brokerage Receivable
//       Cr Brokerage Income
//   When a service invoice is issued:
//     Dr Client Receivables (totalAmount)
//       Cr Service Income (subtotal)
//       Cr GST Payable (gstAmount)
//   When the invoice is paid:
//     Dr Bank/Cash
//       Cr Client Receivables
//   When the broker pays a supplier (not tracked in app — assumed):
//     Dr Supplier Payable
//       Cr Bank/Cash
//   When the broker incurs an operating expense:
//     Dr Operating Expenses (by category)
//       Cr Bank/Cash
//
// Accounts computed (all scoped to brokerId, all as-of `asOf`):
//   1.  Client Receivables  (Asset, debit)   — outstanding bills + pending invoices
//   2.  Brokerage Receivable (Asset, debit)  — eligible but unpaid brokerage
//   3.  Brokerage Income    (Income, credit) — all eligible brokerage
//   4-9.Operating Expenses  (Expense, debit) — one account per Expense category
//   10. Bank/Cash           (Asset, both)    — all cash in (debit) / expenses out (credit)
//   11. Supplier Payable    (Liability, credit) — bill base amounts owed to suppliers
//   12. GST Payable         (Liability, credit) — output GST from bills + invoices
//   13. Service Income      (Income, credit) — invoice subtotals (service revenue)
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
      // Outstanding bill balances + pending invoice totals, all created on or
      // before asOf. Bills: sum(finalAmount - paidAmount). Invoices: sum of
      // totalAmount where status = "pending" (cancelled invoices are written
      // off, paid invoices have zero receivable).
      const bills = await db.bill.findMany({
        where: { brokerId: broker.id, createdAt: { lte: asOf } },
        select: { finalAmount: true, paidAmount: true, baseAmount: true, gstAmount: true },
      });
      const billReceivables = round2(
        bills.reduce((s, b) => s + (b.finalAmount - b.paidAmount), 0),
      );
      // Supplier Payable = sum of bill base amounts (money owed to suppliers for
      // goods shipped on the broker's behalf). The broker is an agent — the
      // base belongs to the supplier, not the broker.
      const supplierPayable = round2(
        bills.reduce((s, b) => s + b.baseAmount, 0),
      );
      // Bill GST collected (output GST on goods).
      const billGstCollected = round2(
        bills.reduce((s, b) => s + b.gstAmount, 0),
      );

      // Pending invoices — these are receivables too (client owes for services).
      const pendingInvoices = await db.invoice.findMany({
        where: {
          brokerId: broker.id,
          status: "pending",
          issueDate: { lte: asOf },
        },
        select: { totalAmount: true, subtotal: true, gstAmount: true },
      });
      const invoiceReceivables = round2(
        pendingInvoices.reduce((s, i) => s + i.totalAmount, 0),
      );
      const clientReceivables = round2(billReceivables + invoiceReceivables);

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
      //  debit  = bill payments received + invoice payments received + brokerage payouts paid
      //  credit = operating expenses paid
      // Bill payments: sum of all Payment.amount where the bill was created <= asOf
      // AND the payment date <= asOf. These are the cash the broker received
      // from clients on behalf of suppliers + GST + brokerage.
      const billPayments = await db.payment.aggregate({
        where: { brokerId: broker.id, date: { lte: asOf } },
        _sum: { amount: true },
      });
      const billPaymentsReceived = round2(billPayments._sum.amount ?? 0);

      // Invoice payments: sum of Invoice.totalAmount where status="paid" AND
      // issueDate <= asOf. (We don't track a separate paidAt on invoices — use
      // issueDate as the best proxy for when cash was received.)
      const paidInvoices = await db.invoice.aggregate({
        where: {
          brokerId: broker.id,
          status: "paid",
          issueDate: { lte: asOf },
        },
        _sum: { totalAmount: true, subtotal: true, gstAmount: true },
      });
      const invoicePaymentsReceived = round2(paidInvoices._sum.totalAmount ?? 0);
      const serviceIncome = round2(paidInvoices._sum.subtotal ?? 0);
      const invoiceGstCollected = round2(paidInvoices._sum.gstAmount ?? 0);

      // Brokerage payouts actually paid out to the broker (cash in)
      const paidPayouts = await db.brokeragePayout.aggregate({
        where: { brokerId: broker.id, status: "paid", paidAt: { lte: asOf } },
        _sum: { totalAmount: true },
      });
      const payoutsReceived = round2(paidPayouts._sum.totalAmount ?? 0);

      const bankCashDebit = round2(
        billPaymentsReceived + invoicePaymentsReceived + payoutsReceived,
      );
      const allExpenses = await db.expense.aggregate({
        where: { brokerId: broker.id, date: { lte: asOf } },
        _sum: { amount: true },
      });
      const bankCashCredit = round2(allExpenses._sum.amount ?? 0);

      // ── 11. GST Payable (Liability, credit) ───────────────────────────────
      // Output GST from bills + invoices (both are GST the broker collected on
      // behalf of the government).
      const gstPayable = round2(billGstCollected + invoiceGstCollected);

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
      accounts.push({ name: "Supplier Payable", type: "liability", debit: 0, credit: supplierPayable });
      accounts.push({ name: "GST Payable", type: "liability", debit: 0, credit: gstPayable });
      accounts.push({ name: "Service Income", type: "income", debit: 0, credit: serviceIncome });

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
