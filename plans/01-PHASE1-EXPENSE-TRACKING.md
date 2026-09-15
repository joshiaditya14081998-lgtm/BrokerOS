# Phase 1: Broker Expense Tracking

## Goal
Broker can record operating expenses (travel, phone, staff, rent, marketing, misc) and see a monthly expense summary on the dashboard.

## Prisma Schema Change

Add to `prisma/schema.prisma`:

```prisma
model Expense {
  id          String   @id @default(cuid())
  brokerId    String
  broker      Broker   @relation(fields: [brokerId], references: [id], onDelete: Cascade)
  category    String   // travel | phone | staff_salary | office_rent | marketing | miscellaneous
  amount      Float
  date        DateTime
  description String?
  vendor      String?  // who was paid (e.g. "HP Petrol Pump", "Airtel")
  receiptUrl  String?  // Cloudinary URL if receipt photo uploaded
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([brokerId, date])
  @@index([brokerId, category])
}
```

Add to `Broker` model:
```prisma
expenses    Expense[]
```

Run: `bun run db:push`

## API Routes

### `src/app/api/expenses/route.ts`

**GET** `/api/expenses?category=X&from=ISO&to=ISO`
- Requires auth (`getCurrentBroker`)
- Filters: `brokerId: broker.id`, optional `category`, optional date range
- Returns `{ expenses: [...], summary: { total, byCategory: { travel: N, phone: N, ... } } }`
- Rate limited: `withRateLimit(handler, 30, 60000)`

**POST** `/api/expenses`
- Body: `{ category, amount, date, description?, vendor?, receiptUrl? }`
- Zod validation:
  ```typescript
  const ExpenseSchema = z.object({
    category: z.enum(["travel", "phone", "staff_salary", "office_rent", "marketing", "miscellaneous"]),
    amount: z.number().min(0.01),
    date: z.string(),
    description: z.string().optional().nullable(),
    vendor: z.string().optional().nullable(),
    receiptUrl: z.string().optional().nullable(),
  });
  ```
- Creates expense with `brokerId: broker.id`
- AuditLog entry
- Returns `{ expense }`

### `src/app/api/expenses/[id]/route.ts`

**PATCH** `/api/expenses/[id]`
- Body: any subset of `{ category, amount, date, description, vendor, receiptUrl }`
- Verify `expense.brokerId === broker.id`
- AuditLog entry
- Returns `{ expense }`

**DELETE** `/api/expenses/[id]`
- Verify ownership
- AuditLog entry
- Returns `{ ok: true }`

## View: `src/components/views/expenses-view.tsx`

### Layout
- SectionHeader: "Expenses" / "Operating costs — travel, rent, staff, marketing"
- Action: "Add Expense" button + "Export CSV" button

### Summary Strip (top)
4 KPI mini-cards:
1. This Month: ₹X (total expenses this month)
2. Last Month: ₹X (for comparison)
3. YTD: ₹X (year-to-date total)
4. Top Category: "Travel ₹X" (highest spending category)

### Filter Bar
- Category filter (Select: All / Travel / Phone / Staff Salary / Office Rent / Marketing / Misc)
- Date range (from/to date inputs)
- Search (by description or vendor)

### Expense List (table inside GlassCard)
| Date | Category | Description | Vendor | Amount | Actions |
|------|----------|-------------|--------|--------|---------|
| 12 Aug | Travel | Surat to Mumbai trip | HP Petrol | ₹2,500 | Edit Delete |

- Category shown as colored chip (travel=teal, phone=blue→no→teal, rent=amber, staff=emerald, marketing=plum, misc=zinc)
- Amount right-aligned, bold
- Row click → edit dialog
- Pagination

### "Add Expense" Dialog
Fields:
- Category (Select — required)
- Amount (number — required, min 1)
- Date (date input — default today)
- Description (Textarea)
- Vendor (Input — optional)
- Receipt photo (PhotoUpload — optional, stage="expense", entityType="Expense")
- Submit → POST /api/expenses

### Wire to sidebar
- Add to `ui-store.ts` ViewKey: `"expenses"`
- Add to `sidebar.tsx`: `{ key: "expenses", labelKey: "nav.expenses", icon: ReceiptIndianRupee, groupKey: "nav.finance" }`
- Add to `page.tsx`: import + VIEW_TITLE_KEYS + ViewRouter case
- Add to `command-palette.tsx`: NAV_ITEMS
- Add i18n keys to en.ts / hi.ts / gu.ts

### Dashboard Integration
- Add to `dashboard-view.tsx`: fetch `/api/expenses?from={monthStart}&to={now}` and show:
  - "Total Expenses" KPI card (this month)
  - "Net Profit" KPI card (brokerage earned − expenses)

## Acceptance Criteria
- [ ] Broker can create an expense with category, amount, date, description
- [ ] Expenses list shows all entries filtered by category/date
- [ ] Monthly summary shows total + by-category breakdown
- [ ] Dashboard shows "Total Expenses" + "Net Profit" KPI cards
- [ ] Edit + delete works
- [ ] CSV export works
- [ ] Lint passes (0 errors)
- [ ] brokerId scoping on all queries
- [ ] AuditLog entry on create/update/delete
