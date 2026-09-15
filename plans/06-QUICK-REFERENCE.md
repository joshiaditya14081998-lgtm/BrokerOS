# Quick Reference — All Phases Summary

## File Checklist

### Phase 1: Expense Tracking
- [ ] `prisma/schema.prisma` — add Expense model + Broker.expenses relation
- [ ] `src/app/api/expenses/route.ts` — GET (list+summary) + POST (create)
- [ ] `src/app/api/expenses/[id]/route.ts` — PATCH + DELETE
- [ ] `src/components/views/expenses-view.tsx` — full view
- [ ] `src/lib/ui-store.ts` — add "expenses" to ViewKey
- [ ] `src/components/sidebar.tsx` — add nav item (Finance group, ReceiptIndianRupee icon)
- [ ] `src/app/page.tsx` — import + VIEW_TITLE_KEYS + ViewRouter
- [ ] `src/components/command-palette.tsx` — add to NAV_ITEMS
- [ ] `src/components/views/dashboard-view.tsx` — add "Total Expenses" + "Net Profit" KPI cards
- [ ] `src/lib/i18n/en.ts` + `hi.ts` + `gu.ts` — add keys

### Phase 2: P&L Statement
- [ ] `src/app/api/reports/profit-loss/route.ts` — GET (compute P&L data)
- [ ] `src/app/api/reports/route.ts` — add `profit-loss` to ReportType + buildProfitLoss()
- [ ] `src/components/views/pl-statement-view.tsx` — full view
- [ ] `src/lib/ui-store.ts` — add "pl-statement" to ViewKey
- [ ] `src/components/sidebar.tsx` — add nav item (new "Accounting" group, TrendingUp icon)
- [ ] `src/app/page.tsx` — import + route
- [ ] `src/components/command-palette.tsx` — add to NAV_ITEMS
- [ ] `src/lib/i18n/` — add keys

### Phase 3: GST Filing Report
- [ ] `src/app/api/reports/gst-filing/route.ts` — GET (GST summary)
- [ ] `src/app/api/reports/route.ts` — add `gst-filing` to ReportType + buildGstFiling()
- [ ] `src/components/views/gst-filing-view.tsx` — full view
- [ ] `src/lib/ui-store.ts` — add "gst-filing" to ViewKey
- [ ] `src/components/sidebar.tsx` — add nav item (Accounting group, FileText icon)
- [ ] `src/app/page.tsx` — import + route
- [ ] `src/components/command-palette.tsx` — add to NAV_ITEMS
- [ ] `src/lib/i18n/` — add keys

### Phase 4: Invoice Generation
- [ ] `prisma/schema.prisma` — add Invoice model + relations
- [ ] `src/app/api/invoices/route.ts` — GET + POST
- [ ] `src/app/api/invoices/[id]/route.ts` — GET + PATCH + DELETE
- [ ] `src/app/api/reports/route.ts` — add `invoice` to ReportType + buildInvoice()
- [ ] `src/components/views/invoices-view.tsx` — full view with create dialog
- [ ] `src/lib/ui-store.ts` — add "invoices" to ViewKey
- [ ] `src/components/sidebar.tsx` — add nav item (Finance group, FileText icon)
- [ ] `src/app/page.tsx` — import + route
- [ ] `src/components/command-palette.tsx` — add to NAV_ITEMS
- [ ] `src/lib/i18n/` — add keys

### Phase 5: Trial Balance + Cash Flow
- [ ] `src/app/api/reports/trial-balance/route.ts` — GET
- [ ] `src/app/api/reports/cash-flow/route.ts` — GET
- [ ] `src/components/views/trial-balance-view.tsx` — full view
- [ ] `src/components/views/cash-flow-view.tsx` — full view
- [ ] `src/lib/ui-store.ts` — add "trial-balance" + "cash-flow" to ViewKey
- [ ] `src/components/sidebar.tsx` — add 2 nav items (Accounting group)
- [ ] `src/app/page.tsx` — import + route
- [ ] `src/components/command-palette.tsx` — add to NAV_ITEMS
- [ ] `src/lib/i18n/` — add keys

## New Sidebar Groups After All Phases

```
Overview:    Dashboard, Analytics, Daily Digest
Contacts:    Clients, Suppliers, Tags
Operations:  Visits, Purchase Orders, Dispatch Tracking, Draft Queue, Disputes
Finance:     Bills, Payments, Brokerage, Party Ledger, Expenses, Invoices, Billing & Plan
Accounting:  P&L Statement, GST Filing, Trial Balance, Cash Flow  ← NEW GROUP
Portals:     Portals
System:      Notifications, Saved Views, Report Builder, Settings
```

## New Prisma Models Summary

```prisma
model Expense {
  id          String   @id @default(cuid())
  brokerId    String
  broker      Broker   @relation(fields: [brokerId], references: [id], onDelete: Cascade)
  category    String   // travel | phone | staff_salary | office_rent | marketing | miscellaneous
  amount      Float
  date        DateTime
  description String?
  vendor      String?
  receiptUrl  String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([brokerId, date])
  @@index([brokerId, category])
}

model Invoice {
  id            String   @id @default(cuid())
  brokerId      String
  broker        Broker   @relation(fields: [brokerId], references: [id], onDelete: Cascade)
  clientId      String
  client        Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  invoiceNumber String   @unique
  issueDate     DateTime
  dueDate       DateTime?
  itemsJson     String
  subtotal      Float
  gstRate       Float    @default(5.0)
  gstAmount     Float    @default(0)
  roundOff      Float    @default(0)
  totalAmount   Float
  status        String   @default("pending")
  notes         String?
  placeOfSupply String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([brokerId, issueDate])
  @@index([clientId])
}
```

## Testing Checklist (Per Phase)
1. Run `bun run db:push` after schema changes
2. Run `bun run lint` after each phase
3. Test API with curl (auth required → 401 without session)
4. Test view renders (no console errors)
5. Test create/edit/delete flow
6. Test brokerId scoping (cross-tenant access blocked)
7. Test AuditLog entry created
8. Git push → CI/CD auto-deploys → verify on Vercel
