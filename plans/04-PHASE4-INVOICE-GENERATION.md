# Phase 4: Invoice Generation

## Goal
Broker can create professional GST-compliant invoices for services rendered to clients, with PDF output.

## Depends On
None — new entity.

## Prisma Schema Change

Add to `prisma/schema.prisma`:

```prisma
model Invoice {
  id            String   @id @default(cuid())
  brokerId      String
  broker        Broker   @relation(fields: [brokerId], references: [id], onDelete: Cascade)
  clientId      String
  client        Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  invoiceNumber String   @unique
  // Invoice dates
  issueDate     DateTime
  dueDate       DateTime?
  // Items (JSON array of {description, hsnCode, quantity, rate, amount})
  itemsJson     String
  // Tax
  subtotal      Float    // sum of item amounts (excl GST)
  gstRate       Float    @default(5.0)
  gstAmount     Float    @default(0)
  roundOff      Float    @default(0)
  totalAmount   Float    // subtotal + gstAmount + roundOff
  // Status
  status        String   @default("pending") // pending | paid | cancelled
  notes         String?
  // Place of supply (for GST)
  placeOfSupply String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([brokerId, issueDate])
  @@index([clientId])
}
```

Add to `Broker` model: `invoices Invoice[]`
Add to `Client` model: `invoices Invoice[]`

Run: `bun run db:push`

## API Routes

### `src/app/api/invoices/route.ts`

**GET** `/api/invoices?status=X&clientId=Y&from=ISO&to=ISO`
- Requires auth
- Filters: `brokerId`, optional `status`, `clientId`, date range
- Returns `{ invoices: [...] }`
- Rate limited: `withRateLimit(handler, 30, 60000)`

**POST** `/api/invoices`
- Body:
  ```typescript
  {
    clientId: string,
    issueDate: string (ISO),
    dueDate?: string,
    items: [{ description, hsnCode?, quantity, rate }],
    gstRate?: number (default from client),
    notes?: string,
    placeOfSupply?: string,
  }
  ```
- Zod validation
- Auto-generates invoice number: `INV-2026-0001`
- Computes: subtotal (sum of items), gstAmount (subtotal × rate%), roundOff, totalAmount
- Creates Invoice with `brokerId`
- AuditLog entry
- Returns `{ invoice }`

### `src/app/api/invoices/[id]/route.ts`

**GET** — invoice detail with items + client info
**PATCH** — update status (pending → paid / cancelled)
**DELETE** — delete (only if status === "pending")

## PDF Report: Add to `src/app/api/reports/route.ts`

Add `invoice` to ReportType. Create `buildInvoice(brokerId, invoiceId)`:

### HTML Structure (Professional GST Invoice)
```
[Header: Broker name, address, GSTIN, logo text]
  "TAX INVOICE"
  Invoice Number: INV-2026-0001
  Issue Date: 12 Aug 2026
  Due Date: 26 Aug 2026

[Bill From]
  Broker Name
  Address
  GSTIN: 24AAGCB1234M1Z5

[Bill To]
  Client Name
  Address
  GSTIN: 27AAHCT6677Q1Z4
  Place of Supply: Gujarat (27)

[Items Table]
  # | Description | HSN Code | Qty | Rate | Amount
  1 | Brokerage service for PO-2026-0001 | 9985 | 1 | ₹2,915 | ₹2,915
  2 | Dispatch coordination for 3 styles | 9985 | 3 | ₹500 | ₹1,500

  Subtotal: ₹4,415
  GST (5%): ₹220.75
  Round Off: ₹-0.75
  Total: ₹4,635

[Footer]
  "This is a computer-generated invoice."
  Payment terms + bank details
```

## View: `src/components/views/invoices-view.tsx`

### Layout
- SectionHeader: "Invoices" / "GST-compliant invoices for services"
- "Create Invoice" button + "Export CSV" button

### Filter Bar
- Status filter (All / Pending / Paid / Cancelled)
- Client filter (Select)
- Search (by invoice number)

### Invoice List (table)
| Invoice No | Client | Issue Date | Due Date | Subtotal | GST | Total | Status | Actions |
|-----------|--------|------------|----------|----------|-----|-------|--------|---------|
| INV-2026-0001 | Sharma | 12 Aug | 26 Aug | ₹4,415 | ₹220 | ₹4,635 | Pending | View PDF |

- Row click → invoice detail (dialog or sheet)
- "PDF" button per row → opens `/api/reports?type=invoice&invoiceId=X` in new tab
- Status chips: Pending=amber, Paid=emerald, Cancelled=zinc

### "Create Invoice" Dialog
Fields:
- Client (Select — required)
- Issue Date (date — default today)
- Due Date (date — optional)
- Items editor (dynamic):
  - Description (Input — required)
  - HSN Code (Input — optional, default "9985" for brokerage services)
  - Quantity (number — default 1)
  - Rate (number — per unit)
  - Amount (auto-calculated: qty × rate)
  - Add/Remove items
- GST Rate (number — default from client profile)
- Place of Supply (Input — state code, e.g. "Gujarat (24)")
- Notes (Textarea)
- Live preview: Subtotal + GST + Total shown at bottom
- Submit → POST /api/invoices

### Wire to sidebar
- ViewKey: `"invoices"`
- Sidebar: `{ key: "invoices", labelKey: "nav.invoices", icon: FileText, groupKey: "nav.finance" }`
- Page router + command palette + i18n

## Acceptance Criteria
- [ ] Broker can create an invoice with multiple line items
- [ ] GST auto-calculated on subtotal
- [ ] Invoice number auto-generated (INV-YYYY-NNNN)
- [ ] PDF generates professional GST-compliant invoice
- [ ] Invoice list with status filter + client filter
- [ ] Status can be changed (pending → paid / cancelled)
- [ ] CSV export works
- [ ] Lint passes
- [ ] brokerId scoping on all queries
- [ ] AuditLog entry on create/update/delete
