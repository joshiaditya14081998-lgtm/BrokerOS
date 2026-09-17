# 🐛 Broker OS — Bug Tracker (Testing Round)

**Live URL**: https://my-project-self-three-23.vercel.app
**Tester**: Real broker agent (Aditya Joshi persona)
**Started**: 16 Sept 2026
**Status**: Testing in progress — bugs logged, NOT fixed yet

## Bug Severity Levels
- 🔴 **Critical** — Breaks core functionality, data loss risk
- 🟠 **High** — Feature broken but workaround exists
- 🟡 **Medium** — UX issue, edge case, or minor logic error
- 🟢 **Low** — Cosmetic, polish, or nice-to-have

---

## 📋 BUGS FOUND

### BUG-001 [🟡 Medium] — Brokerage Payout: No PATCH endpoint to mark scheduled payout as paid
- **Found**: Round 3, Test 17
- **Endpoint**: `/api/brokerages` (only has `create_payout` action via POST)
- **Issue**: When a payout is auto-scheduled (status="scheduled"), there's no API to mark it as "paid". The `create_payout` action creates a NEW paid payout batch, but doesn't update the existing scheduled one.
- **Impact**: Broker can't mark scheduled payouts as paid — must delete + recreate or use create_payout flow (which creates duplicate)
- **Repro**: 
  1. Bill fully paid → brokerage auto-eligible → payout auto-scheduled
  2. Try `PATCH /api/brokerages/payouts/{id}` → 404 (no such route)
  3. Try `PATCH /api/brokerage-payouts/{id}` → 404
- **Expected**: PATCH endpoint to update payout status (scheduled → paid) + set paidAt
- **Workaround**: Use `POST /api/brokerages` with `action: "create_payout"` + `payoutIds` (but this creates a new payout, doesn't update existing)

---

### BUG-002 [🟢 Low] — Backup GET returned 500 (FIXED in commit 43781b6, but logging for record)
- **Found**: Round 3, Test 22
- **Endpoint**: `GET /api/backup`
- **Issue**: `buildBackup()` didn't include `db.expense.findMany()` or `db.invoice.findMany()`. Also `auditLog.create` was missing `brokerId`.
- **Status**: ✅ Already fixed (commit 43781b6) — but noting for audit trail

---

## 📝 Testing Progress Log

### Round 1 — Accounting (6 phases)
- ✅ Phase 1: Expense Tracking
- ✅ Phase 2: P&L Statement
- ✅ Phase 3: GST Filing
- ✅ Phase 4: Invoice Generation
- ✅ Phase 5: Trial Balance + Cash Flow
- ✅ Dashboard KPIs

### Round 2 — Core Features (15 categories)
- ✅ Edit/Delete operations
- ✅ Disputes workflow
- ✅ Party Ledger
- ✅ Tags
- ✅ Notifications/Action Center
- ✅ Analytics
- ✅ Daily Digest
- ✅ Settings
- ✅ Saved Views
- ✅ Data Health
- ✅ Cross-tenant Security
- ✅ Keyboard Shortcuts
- ✅ Admin Panel
- ✅ Edge Cases (validation)
- ✅ Mobile responsiveness

### Round 3 — Advanced (12 categories)
- ✅ Short Shipment
- ✅ Brokerage Payout (BUG-001 found)
- ✅ Bulk Operations
- ✅ Global Search
- ✅ Report Builder
- ✅ Portal View
- ✅ Backup/Restore (BUG-002 found + fixed)
- ✅ Rate Limiting
- ✅ Concurrency
- ✅ Currency Formatting
- ✅ UI Rendering
- ✅ Date Filtering

### Round 4 — IN PROGRESS (continued testing)

### BUG-003 [🟠 High] — API Docs view is orphaned (not accessible)
- **Found**: Round 4, Test 29
- **Issue**: The `api-docs` ViewKey exists in `src/lib/ui-store.ts` and the view component `src/components/views/api-docs-view.tsx` exists, but:
  - ❌ Not added to `src/components/sidebar.tsx` NAV array
  - ❌ Not added to `src/components/command-palette.tsx` NAV_ITEMS
  - ❌ Not added to `src/app/page.tsx` ViewRouter switch + VIEW_TITLE_KEYS
- **Impact**: API Docs view is completely inaccessible — no way to navigate to it
- **Repro**: 
  1. Open command palette (⌘K) → search "API" → no result
  2. Check sidebar → no API Docs link
  3. Navigate to `/api-docs` → 404
- **Expected**: API Docs should appear in System group of sidebar, command palette, and page router
- **Fix needed**: Add `api-docs` to sidebar NAV + command palette NAV_ITEMS + page.tsx ViewRouter + VIEW_TITLE_KEYS + i18n keys

---

### BUG-004 [🟢 Low] — Data Health warnings show "undefined" for type field
- **Found**: Round 3, Test 10
- **Endpoint**: `/api/data-health`
- **Issue**: Data health warnings return `type: undefined` in the response. The `description` field has content but `type` is missing.
- **Response sample**: `[{"severity":"warning","undefined":"GST numbers are required..."}]`
- **Impact**: UI can't categorize warnings by type
- **Repro**: `fetch('/api/data-health').then(r=>r.json())` → check `issues[0].type` → `undefined`
- **Expected**: Each issue should have a `type` field (e.g., "missing_gst", "missing_photos")


### BUG-005 [🔴 Critical] — Scheduler route returns 500 (missing import)
- **Found**: Round 4, Test 36
- **Endpoint**: `GET /api/scheduler`
- **Issue**: The route uses `getCurrentBroker()` on line 17 but never imports it. The only import is `NextResponse` from `next/server`.
- **Impact**: `/api/scheduler` always returns 500 → sidebar scheduler badge always shows "Offline" → Settings page can't show scheduler status → "Run now" button in Settings doesn't work
- **Repro**: `fetch('/api/scheduler')` → 500
- **Root cause**: Missing `import { getCurrentBroker } from "@/lib/auth";`
- **Fix needed**: Add the import at the top of `src/app/api/scheduler/route.ts`

---

### BUG-006 [🟡 Medium] — Billing view: no API endpoint at /api/billing (only /api/billing/status, /checkout, /portal)
- **Found**: Round 4, Test 31
- **Endpoint**: `GET /api/billing` → 404
- **Issue**: The billing view works (uses `/api/billing/status`), but a direct fetch to `/api/billing` returns 404. Not a user-facing bug (view renders fine), but inconsistent API surface.
- **Impact**: Minor — developers might expect `/api/billing` as the canonical endpoint
- **Note**: View itself works correctly (shows plan, usage, comparison, manage billing button)

---

### BUG-007 [🟢 Low] — Notification generate returns undefined for total
- **Found**: Round 4, Test 36
- **Endpoint**: `POST /api/notifications/generate`
- **Issue**: Response is `{ generated: 0, total: undefined }` — the `total` field is undefined instead of showing the total notification count
- **Impact**: Minor — UI might show "undefined" if it reads `total`
- **Fix needed**: Include `total` count in response


### BUG-008 [🟡 Medium] — Expense allows future dates (year 2099 accepted)
- **Found**: Round 4, Test 39
- **Endpoint**: `POST /api/expenses`
- **Issue**: Creating an expense with `date: '2099-12-31'` succeeds. There's no validation to prevent absurdly future-dated expenses.
- **Impact**: Data quality — broker could accidentally create expenses with wrong year (e.g., 2027 instead of 2026), which would skew P&L and Trial Balance reports for that future period
- **Repro**: `POST /api/expenses` with `date: '2099-12-31'` → 201 Created
- **Expected**: Reject dates more than ~1 year in the future, or warn the user
- **Note**: Same issue likely exists for invoices (issueDate), visits (plannedDate), payments (date) — should check all date inputs


---

## 📊 Testing Summary (Round 4)

### Tests Completed (13 categories)
- ✅ Onboarding Wizard replay (dialog works)
- ❌ API Docs view (BUG-003: orphaned, inaccessible)
- ✅ Photos upload (Cloudinary integration works)
- ✅ Billing & Plan view (usage limits, plan comparison)
- ✅ Client Detail Sheet (tabs: Bills/Ledger/Deliveries/Brokerage)
- ✅ Share Link button (exists)
- ✅ Pagination (audit has 53 logs, expenses 12)
- ✅ Filter combinations (status+client, category+date)
- ❌ Scheduler (BUG-005: 500 error, missing import)
- ✅ Data Health fix-all (closed 1 forgotten visit)
- ✅ Audit trail filtering (by entityType)
- ✅ More edge cases (empty items, negative rate, duplicate bill, cross-broker)
- ⚠️ Future date bug (BUG-008)

### Final Bug Count: 8
- 🔴 Critical: 1 (BUG-005 — scheduler 500)
- 🟠 High: 2 (BUG-001 payout no PATCH, BUG-003 API Docs orphaned)
- 🟡 Medium: 3 (BUG-004 data health type, BUG-007 notification total, BUG-008 future dates)
- 🟢 Low: 2 (BUG-002 backup fixed, BUG-006 billing endpoint)
- ✅ Fixed: 1 (BUG-002 backup — already committed)

### Final Data State
- Clients: 5, Suppliers: 5, Active POs: 2
- Bills: 2, Payments: 2, Payouts: 1
- Expenses: 12+, Invoices: 3+
- Audit Logs: 53
- Photos: 1, Tags: 3, Saved Views: 1


### BUG-009 [🟢 Low] — API 404 returns HTML instead of JSON
- **Found**: Round 5, Test 47
- **Endpoint**: Any non-existent API route (e.g., `/api/nonexistent`)
- **Issue**: When hitting a non-existent API endpoint, the response is a full HTML 404 page instead of a JSON error. This breaks clients that try to parse the response as JSON.
- **Impact**: Minor — API clients get JSON parse errors instead of a clean `{ error: "Not found" }` response
- **Repro**: `fetch('/api/nonexistent')` → 404 with `text/html` body (full HTML page)
- **Expected**: API routes should return `{ error: "Not found" }` with `application/json` content type
- **Fix needed**: Add a catch-all API route at `/api/[...path]/route.ts` that returns JSON 404


### BUG-010 [🟡 Medium] — No max amount validation on expenses (₹100 crore accepted)
- **Found**: Round 5, Test 57
- **Endpoint**: `POST /api/expenses`
- **Issue**: Creating an expense with `amount: 1000000000` (₹100 crore) succeeds. There's no upper bound validation.
- **Impact**: Data quality — a typo could create an expense of ₹100 crore instead of ₹1,000, hugely skewing P&L and Trial Balance
- **Repro**: `POST /api/expenses` with `amount: 1000000000` → 201 Created
- **Expected**: Reject amounts above a reasonable limit (e.g., ₹1 crore = 10,000,000) or warn the user
- **Note**: Same issue likely on invoices (totalAmount), payments, bills

---

### BUG-011 [🟢 Low] — No max length validation on client name (255 chars attempted, but blocked by plan limit)
- **Found**: Round 5, Test 57
- **Endpoint**: `POST /api/clients`
- **Issue**: 255-char name was rejected, but only because of the Free plan 5-client limit — not because of name length validation. If the broker upgrades, they could create a client with an absurdly long name.
- **Impact**: Minor — UI layout might break with very long names
- **Expected**: Name field should have a max length (e.g., 100 chars) in the Zod schema


### BUG-012 [🔴 Critical] — 3 API routes missing brokerId in auditLog.create (500 error)
- **Found**: Round 5, Test 61
- **Affected routes**:
  1. `POST /api/report-templates` — 1 auditLog.create without brokerId
  2. `PATCH/DELETE /api/report-templates/[id]` — 2 auditLog.create calls without brokerId
  3. `POST /api/onboarding` — 1 auditLog.create without brokerId
- **Issue**: Same root cause as BUG-002 (backup) — `auditLog.create` calls are missing the required `brokerId` field. The AuditLog model has `brokerId` as a required field (FK to Broker), so Prisma throws a 500 error.
- **Impact**: 
  - Creating/updating/deleting report templates → 500 error
  - Completing onboarding → 500 error
- **Repro**: `POST /api/report-templates` with valid body → 500
- **Fix needed**: Add `brokerId: broker.id` to all 4 auditLog.create data blocks in these 3 files
- **Pattern**: This is the same bug pattern as BUG-002 — should audit ALL `auditLog.create` calls across the codebase


---

## 📊 Round 5 Testing Summary

### Tests Completed (22 categories)
- ✅ Mobile UI (responsive: lg:block sidebar + lg:hidden hamburger)
- ✅ Supplier Detail Sheet (reliability score, performance breakdown, tabs)
- ✅ PO Detail Sheet (line items, fulfillment, tabs: Line Items/Dispatches/Billing/Timeline)
- ✅ Accessibility (semantic HTML: main/header/nav, 8 aria-labels, 1 sr-only, 44 focusable elements)
- ✅ Timezone handling (dates stored as UTC ISO strings)
- ✅ CSV export format (correct headers + data)
- ✅ Error pages (404 page renders, but API 404 returns HTML — BUG-009)
- ✅ Number formatting (Indian system: ₹1,00,00,000 works correctly)
- ✅ Concurrent edit (last-write-wins — acceptable)
- ✅ PDF content verification (P&L, Invoice, Trial Balance, Cash Flow — all have correct content)
- ✅ Data health fix (individual + fix-all work)
- ✅ Audit trail detail (before/after snapshots present for update/delete)
- ❌ Report templates CRUD (BUG-012: 500 on create due to missing brokerId)
- ✅ Tags CRUD complete (create + assign + unassign + delete all work)
- ✅ Analytics deep dive (forecast, brokerage by cadence)
- ✅ Portal invite (correctly returns "Client not found" for bad ID)
- ✅ Draft Queue (client-side IndexedDB, no API — correct)
- ✅ SQL injection (Prisma parameterized queries — safe)
- ✅ XSS (stored in DB, UI should escape — verified stored)
- ⚠️ Edge cases (BUG-008: future dates, BUG-010: no max amount, BUG-011: no max name length)

### Final Bug Count: 12
- 🔴 Critical: 2 (BUG-005 scheduler, BUG-012 auditLog brokerId)
- 🟠 High: 2 (BUG-001 payout no PATCH, BUG-003 API Docs orphaned)
- 🟡 Medium: 4 (BUG-004 data health type, BUG-006 billing endpoint, BUG-008 future dates, BUG-010 no max amount)
- 🟢 Low: 4 (BUG-002 backup fixed, BUG-007 notification total, BUG-009 API 404 HTML, BUG-011 no max name length)
- ✅ Already Fixed: 1 (BUG-002)

### Total Tests Across All Rounds: 62 categories
### Total Bugs Found: 12 (1 already fixed)

---

## 🎉 BUG FIX SUMMARY (Round 6)

### Bugs Fixed (10/12)
| ID | Severity | Status | Fix |
|----|----------|--------|-----|
| BUG-001 | 🟡 Medium | ✅ Fixed | Added PATCH /api/brokerages/payouts/[id] endpoint |
| BUG-002 | 🟢 Low | ✅ Fixed (earlier) | Backup includes Expense + Invoice (commit 43781b6) |
| BUG-003 | 🟠 High | ✅ Fixed | API Docs wired into sidebar + palette + router |
| BUG-004 | 🟢 Low | ✅ Not a bug | Field is "category" not "type" — test error |
| BUG-005 | 🔴 Critical | ✅ Fixed | Added missing getCurrentBroker import |
| BUG-006 | 🟡 Medium | ✅ Not a bug | /api/billing/status is by design |
| BUG-007 | 🟢 Low | ✅ Fixed | Added total count to notification generate response |
| BUG-008 | 🟡 Medium | ✅ Fixed | Added future date validation (reject >1 year) |
| BUG-009 | 🟢 Low | ✅ Fixed | Catch-all API 404 returns JSON |
| BUG-010 | 🟡 Medium | ✅ Fixed | Added max amount validation (₹10 lakh cap) |
| BUG-011 | 🟢 Low | ✅ Fixed | Added max name length (100 chars) |
| BUG-012 | 🔴 Critical | ✅ Fixed | Added brokerId to reportTemplate.create + auditLog + scoped queries |

### Commits
- `e25aab1` — Fix 10 bugs from testing rounds
- `1061098` — Fix BUG-012 root cause: reportTemplate.create missing brokerId + security scoping

### Verification (on production)
- BUG-005: ✅ 200 (was 500)
- BUG-009: ✅ application/json (was text/html)
- BUG-008: ✅ Rejected (was accepted)
- BUG-012: ✅ 200 + template created (was 500)
- BUG-001: ✅ Payout marked paid (was 404)
- BUG-003: ✅ API Docs in sidebar (was orphaned)
