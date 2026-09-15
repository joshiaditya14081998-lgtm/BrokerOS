# Phase 5: Trial Balance + Cash Flow Statement

## Goal
Broker can see a trial balance (all accounts with debit/credit) and a cash flow statement (money in vs money out over time).

## Depends On
Phase 1 + Phase 2 — needs all financial accounts (brokerage income, expenses, client receivables, payouts).

## API Route 1: Trial Balance

### `src/app/api/reports/trial-balance/route.ts`

**GET** `/api/reports/trial-balance?asOf=ISO`
- Requires auth
- Lists all "accounts" with their current debit/credit balance:

### Accounts
```
1. Client Receivables (Asset)
   Debit: sum of (bill.finalAmount - bill.paidAmount) for all bills
   Credit: 0
   
2. Brokerage Receivable (Asset)
   Debit: sum of eligible-but-unpaid brokerage amounts
   Credit: 0
   
3. Brokerage Income (Income)
   Debit: 0
   Credit: sum of all eligible brokerage amounts (accrued + paid)
   
4. Operating Expenses (Expense)
   Debit: sum of all expenses by category
   Credit: 0
   
5. Bank/Cash (Asset)
   Debit: sum of brokerage paid out
   Credit: sum of expenses paid
   
6. GST Payable (Liability)
   Debit: 0
   Credit: sum of all bill GST amounts (output GST)
```

### Response Shape
```typescript
{
  asOf: ISO,
  accounts: [
    { name: "Client Receivables", type: "asset", debit: number, credit: 0 },
    { name: "Brokerage Receivable", type: "asset", debit: number, credit: 0 },
    { name: "Brokerage Income", type: "income", debit: 0, credit: number },
    { name: "Travel Expenses", type: "expense", debit: number, credit: 0 },
    { name: "Phone Expenses", type: "expense", debit: number, credit: 0 },
    { name: "Staff Salary", type: "expense", debit: number, credit: 0 },
    { name: "Office Rent", type: "expense", debit: number, credit: 0 },
    { name: "Marketing", type: "expense", debit: number, credit: 0 },
    { name: "Miscellaneous", type: "expense", debit: number, credit: 0 },
    { name: "Bank/Cash", type: "asset", debit: number, credit: number },
    { name: "GST Payable", type: "liability", debit: 0, credit: number },
  ],
  totals: {
    totalDebit: number,
    totalCredit: number,
    isBalanced: boolean, // totalDebit === totalCredit
  }
}
```

## API Route 2: Cash Flow Statement

### `src/app/api/reports/cash-flow/route.ts`

**GET** `/api/reports/cash-flow?range=month|quarter|year&from=ISO&to=ISO`
- Requires auth
- Computes:

### Cash Inflows
```
1. Brokerage Payouts Received: sum of BrokeragePayout.totalAmount where status=paid
2. Client Payments Tracked: sum of Payment.amount (money received by supplier, broker tracks)
   Note: This is NOT cash to the broker — it's tracked on behalf.
   For broker's own cash: only brokerage payouts count as inflow.
3. Invoice Payments (Phase 4): sum of paid invoice amounts

Total Cash In = brokerage payouts + invoice payments
```

### Cash Outflows
```
1. Operating Expenses: sum of Expense.amount in date range
2. (Future: salary, rent, etc. — already in expenses by category)

Total Cash Out = total expenses
```

### Net Cash Flow
```
Net Cash Flow = Total Cash In − Total Cash Out
Opening Balance = previous period's closing
Closing Balance = Opening + Net Cash Flow
```

### Response Shape
```typescript
{
  range: { start: ISO, end: ISO, label: "August 2026" },
  inflows: {
    brokeragePayouts: number,
    invoicePayments: number,
    totalInflow: number,
  },
  outflows: {
    byCategory: { travel: number, phone: number, ... },
    totalOutflow: number,
  },
  net: {
    cashFlow: number,
    openingBalance: number,
    closingBalance: number,
  },
}
```

## Views

### `src/components/views/trial-balance-view.tsx`
- SectionHeader: "Trial Balance" / "All accounts — debit/credit verification"
- Date selector ("As of" — default today)
- Table:
  | Account | Type | Debit | Credit |
  |---------|------|-------|--------|
  | Client Receivables | Asset | ₹X | — |
  | Brokerage Income | Income | — | ₹X |
  | Travel Expenses | Expense | ₹X | — |
  | ...
  | **Total** | | **₹X** | **ₓX** |
  | Balance Check | | ✅ Balanced / ❌ Unbalanced |
- "Export PDF" button

### `src/components/views/cash-flow-view.tsx`
- SectionHeader: "Cash Flow" / "Money in vs money out"
- Date range selector (month/quarter/year)
- Summary: 3 KPI tiles (Total In, Total Out, Net Cash Flow)
- Inflow breakdown table
- Outflow breakdown table (by category)
- Bar chart: monthly cash flow trend (last 6 months)
- "Export PDF" button

### Wire to sidebar
- ViewKeys: `"trial-balance"`, `"cash-flow"`
- Sidebar items in Accounting group:
  - Trial Balance (icon: Scale)
  - Cash Flow (icon: Banknote)
- Page router + command palette + i18n

## Acceptance Criteria
- [ ] Trial balance shows all accounts with debit/credit
- [ ] Total debit = total credit (balanced check)
- [ ] Cash flow shows inflows (brokerage payouts + invoice payments)
- [ ] Cash flow shows outflows (expenses by category)
- [ ] Net cash flow + opening/closing balance
- [ ] Both views have date range filter
- [ ] Both have PDF export
- [ ] Lint passes
- [ ] brokerId scoping on all queries
