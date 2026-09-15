# Garment Broker OS — Accounting & Finance Master Plan

## Overview
This document is the master reference for adding accounting + finance features to the Broker OS.
Each phase has its own detailed plan file. Follow them in order.

## Current State (What EXISTS ✅)
1. ✅ Brokerage calculation (commission %, base excl GST, eligibility, payout cadence)
2. ✅ Bill adjustment (PO → minus short-ship → minus returns → + GST = final)
3. ✅ Payment tracking (partial/full, running balance, payment modes)
4. ✅ Client ledger (debit/credit/running balance tab in client detail)
5. ✅ Party ledger (universal client/supplier transaction timeline)
6. ✅ Brokerage payout (immediate/4-month/12-month cumulative)
7. ✅ GST handling (per-client rate, calculated on base, tracked separately)
8. ✅ Dashboard financial KPIs (outstanding, brokerage earned/paid/pending)
9. ✅ Analytics (revenue by client/supplier, forecasting, seasonal trends)
10. ✅ PDF reports (brokerage statement, client ledger, supplier summary)

## What's MISSING (This Plan) ❌
1. ❌ Broker Expense Tracking
2. ❌ P&L Statement (Profit & Loss)
3. ❌ GST Filing Report (GSTR)
4. ❌ Invoice Generation
5. ❌ Trial Balance
6. ❌ Cash Flow Statement

## Phase Order + Dependencies

```
Phase 1: Expense Tracking (no dependencies)
    ↓
Phase 2: P&L Statement (depends on Phase 1 — needs expense data)
    ↓
Phase 3: GST Filing Report (no dependency — uses existing bill GST data)
    ↓
Phase 4: Invoice Generation (no dependency — new entity)
    ↓
Phase 5: Trial Balance + Cash Flow (depends on Phase 1+2 — needs all accounts)
```

## Effort Estimate

| Phase | Time | Priority |
|-------|------|----------|
| 1. Expense Tracking | 6 hours | 🔴 High |
| 2. P&L Statement | 5 hours | 🔴 High |
| 3. GST Filing Report | 4 hours | 🟡 Medium |
| 4. Invoice Generation | 5 hours | 🟡 Medium |
| 5. Trial Balance + Cash Flow | 4 hours | 🟢 Low |
| **Total** | **~24 hours (3 days)** | |

## New Sidebar Items After All Phases

```
Finance:     Bills, Payments, Brokerage, Party Ledger, Expenses, Invoices
Accounting:  P&L Statement, GST Filing, Trial Balance, Cash Flow
Billing:     Billing & Plan
```

## New Prisma Models

```
Expense      — broker's operating expenses
Invoice      — GST-compliant invoices for services
```

## Files Created By Each Phase

### Phase 1 (Expense Tracking)
- `prisma/schema.prisma` — add Expense model
- `src/app/api/expenses/route.ts` — GET (list) + POST (create)
- `src/app/api/expenses/[id]/route.ts` — PATCH + DELETE
- `src/components/views/expenses-view.tsx` — expense list + add dialog
- `src/lib/i18n/en.ts` + `hi.ts` + `gu.ts` — translation keys

### Phase 2 (P&L Statement)
- `src/app/api/reports/profit-loss/route.ts` — GET (generate P&L data)
- `src/app/api/reports/route.ts` — add `profit-loss` report type
- `src/components/views/pl-statement-view.tsx` — P&L view
- Dashboard: add net profit/loss KPI card

### Phase 3 (GST Filing Report)
- `src/app/api/reports/gst-filing/route.ts` — GET (GST summary)
- `src/app/api/reports/route.ts` — add `gst-filing` report type
- `src/components/views/gst-filing-view.tsx` — GST filing dashboard

### Phase 4 (Invoice Generation)
- `prisma/schema.prisma` — add Invoice + InvoiceLineItem models
- `src/app/api/invoices/route.ts` — GET + POST
- `src/app/api/invoices/[id]/route.ts` — GET + PATCH + DELETE
- `src/app/api/reports/route.ts` — add `invoice` report type
- `src/components/views/invoices-view.tsx` — invoice list + create dialog

### Phase 5 (Trial Balance + Cash Flow)
- `src/app/api/reports/trial-balance/route.ts` — GET
- `src/app/api/reports/cash-flow/route.ts` — GET
- `src/components/views/trial-balance-view.tsx`
- `src/components/views/cash-flow-view.tsx`

## General Rules
- Every new API route must use `getCurrentBroker()` + `brokerId` scoping
- Every new view must use `glass` styling, emerald accent, dark mode
- Every new API must have rate limiting via `withRateLimit()`
- Every create/update must write an AuditLog entry
- All financial calculations must be in INR (with multi-currency display support)
- All PDF reports must use the existing `htmlShell()` pattern from `/api/reports/route.ts`
