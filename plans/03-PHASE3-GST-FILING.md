# Phase 3: GST Filing Report (GSTR)

## Goal
Broker can see a GST summary — total GST collected (output) + total GST paid (input) = net GST liability/refund, ready for tax filing.

## Depends On
None — uses existing bill GST data + expense GST (if expense has GST component).

## API Route: `src/app/api/reports/gst-filing/route.ts`

**GET** `/api/reports/gst-filing?range=month|quarter&from=ISO&to=ISO`
- Requires auth (`getCurrentBroker`)
- Computes:

### Output GST (GST Collected from Clients)
```
For each bill in date range:
  - Bill base amount × GST rate = GST amount
  - Group by GST rate (5%, 12%, 18%, 28%)
  - Group by client (for GSTR-1 client-wise breakdown)

Output GST = sum of all bill GST amounts
```

### Input GST (GST Paid on Expenses)
```
For each expense in date range (if expense has GST component):
  - Future: expense.gstRate × expense.amount = input GST
  - Currently: expenses don't have GST — show as 0 or add GST field to expense

Input GST = sum of all expense GST amounts (currently 0)
```

### Net GST Liability
```
Net GST = Output GST − Input GST
If positive → broker owes government (liability)
If negative → broker gets refund
```

### Response Shape
```typescript
{
  range: { start: ISO, end: ISO, label: "August 2026" },
  outputGst: {
    byRate: [
      { rate: 5, baseAmount: number, gstAmount: number, billCount: number },
      { rate: 12, baseAmount: number, gstAmount: number, billCount: number },
    ],
    totalBase: number,
    totalGst: number,
  },
  inputGst: {
    totalGst: 0, // future: from expense GST
    breakdown: [],
  },
  netGst: {
    liability: number,  // output - input (positive = pay, negative = refund)
    isLiability: boolean,
  },
  clientBreakdown: [
    { clientName, gstin, baseAmount, gstRate, gstAmount, billCount }
  ],
}
```

## PDF Report: Add to `src/app/api/reports/route.ts`

Add `gst-filing` to ReportType. Create `buildGstFiling(brokerId, range)`:

### HTML Structure
```
[Header: "Broker OS — GST Filing Report" + date range]

[Summary Card]
  Output GST (Collected): ₹X
  Input GST (Paid): ₹X
  Net GST Liability: ₹X (pay) or ₹X (refund)

[Output GST by Rate Table]
  GST Rate | Base Amount | GST Amount | Bill Count
  5%       | ₹X          | ₹X         | N
  12%      | ₹X          | ₹X         | N
  Total    | ₹X          | ₹X         | N

[Client-wise Breakdown (GSTR-1 style)]
  Client Name | GSTIN | Base | Rate | GST | Bills
  Sharma...  | 24..  | ₹X   | 5%   | ₹X  | 2
  Meenakshi  | 33..  | ₹X   | 5%   | ₹X  | 1
  Total                              | ₹X

[Footer: "This report is for GST filing reference. Verify with your CA before filing."]
```

## View: `src/components/views/gst-filing-view.tsx`

### Layout
- SectionHeader: "GST Filing" / "GST summary for tax filing — GSTR-1 style"
- Date range selector (month/quarter)
- "Export PDF" button

### Summary Card
- 3 KPI tiles:
  1. Output GST (collected from bills) — amber
  2. Input GST (paid on expenses) — teal
  3. Net GST Liability/Refund — rose if liability, emerald if refund

### Output GST by Rate (table)
| GST Rate | Base Amount | GST Amount | Bills |
|----------|-------------|------------|-------|
| 5%       | ₹58,300     | ₹2,915    | 3     |
| 12%      | ₹49,600     | ₹5,952    | 1     |
| **Total**| **₹1,07,900** | **₹8,867** | **4** |

### Client-wise Breakdown (table — GSTR-1 style)
| Client | GSTIN | Base | Rate | GST Amount | Bills |
|--------|-------|------|------|-------------|-------|
| Sharma | 24AA.. | ₹58,300 | 5% | ₹2,915 | 2 |
| Trendz | 27AA.. | ₹49,600 | 12% | ₹5,952 | 1 |

### Note
"This is a reference summary. Verify with your Chartered Accountant before filing GST returns."

### Wire to sidebar
- ViewKey: `"gst-filing"`
- Sidebar: `{ key: "gst-filing", labelKey: "nav.gstFiling", icon: FileText, groupKey: "nav.accounting" }`
- Page router + command palette + i18n

## Acceptance Criteria
- [ ] GST output calculated correctly from all bills in date range
- [ ] Grouped by GST rate (5%, 12%, etc.)
- [ ] Client-wise breakdown (GSTR-1 style)
- [ ] Net GST = Output − Input (with liability/refund status)
- [ ] PDF export generates clean GST filing report
- [ ] Month + quarter date range filter works
- [ ] Lint passes
- [ ] brokerId scoping on all queries
