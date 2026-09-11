// Report Columns — canonical column catalog per entity type for the Custom
// Report Builder.
//
// Each entity type defines a list of available columns. A column is:
//   {
//     key:    string         — stable identifier (matches the JSON shape
//                              produced by the data fetcher in
//                              `/api/reports/custom/route.ts`)
//     label:  string         — human-readable header shown in the column
//                              picker + the rendered report table
//     type:   "text"|"number"|"currency"|"date"|"status"
//                             — drives right-alignment + formatting in the
//                              PDF and the type-aware sort comparison
//     sortable: boolean      — whether the user can sort the report by this
//                              column (currency / number / date columns are
//                              always sortable; some text columns like
//                              "notes" aren't useful to sort on)
//   }
//
// The same catalog drives:
//   1. The Custom Report Builder view's column picker (left side: checkbox
//      per available column; right side: ordered list of selected columns).
//   2. The report-generation API's column projection + per-cell formatter.
//   3. The grouping + sorting dropdowns (those only list sortable columns
//      for sorting; groupBy lists a curated set per entity).
//
// Adding a new column = add it to the relevant entity's array AND make sure
// the data fetcher in `/api/reports/custom/route.ts` emits it under the
// matching key on every row.

export type ColumnType = "text" | "number" | "currency" | "date" | "status";

export type ReportColumn = {
  key: string;
  label: string;
  type: ColumnType;
  sortable: boolean;
};

export type EntityType =
  | "client"
  | "supplier"
  | "bill"
  | "payment"
  | "brokerage"
  | "dispatch"
  | "dispute";

export const ENTITY_TYPES: EntityType[] = [
  "client",
  "supplier",
  "bill",
  "payment",
  "brokerage",
  "dispatch",
  "dispute",
];

export const ENTITY_LABELS: Record<EntityType, string> = {
  client: "Clients",
  supplier: "Suppliers",
  bill: "Bills",
  payment: "Payments",
  brokerage: "Brokerage",
  dispatch: "Dispatches",
  dispute: "Disputes",
};

// ── Column catalog per entity type ───────────────────────────────────────────

export const REPORT_COLUMNS: Record<EntityType, ReportColumn[]> = {
  client: [
    { key: "name",             label: "Client Name",        type: "text",     sortable: true  },
    { key: "contactPerson",    label: "Contact Person",     type: "text",     sortable: true  },
    { key: "phone",            label: "Phone",              type: "text",     sortable: false },
    { key: "email",            label: "Email",              type: "text",     sortable: false },
    { key: "gstNo",            label: "GST No.",            type: "text",     sortable: false },
    { key: "totalBusiness",    label: "Total Business",     type: "currency", sortable: true  },
    { key: "outstanding",      label: "Outstanding",        type: "currency", sortable: true  },
    { key: "brokerageEarned",  label: "Brokerage Earned",   type: "currency", sortable: true  },
    { key: "openBills",        label: "Open Bills",         type: "number",   sortable: true  },
    { key: "payoutCadence",    label: "Payout Cadence",     type: "text",     sortable: true  },
  ],
  supplier: [
    { key: "name",                   label: "Supplier Name",        type: "text",     sortable: true  },
    { key: "contactPerson",          label: "Contact Person",       type: "text",     sortable: true  },
    { key: "phone",                  label: "Phone",                type: "text",     sortable: false },
    { key: "gstNo",                  label: "GST No.",              type: "text",     sortable: false },
    { key: "commissionRate",         label: "Commission %",         type: "number",   sortable: true  },
    { key: "totalSupplied",          label: "Total Supplied",       type: "currency", sortable: true  },
    { key: "outstandingBrokerage",   label: "Outstanding Brokerage",type: "currency", sortable: true  },
    { key: "paidBrokerage",          label: "Paid Brokerage",       type: "currency", sortable: true  },
    { key: "fulfillment",            label: "Fulfillment %",        type: "number",   sortable: true  },
    { key: "shortShipmentRate",      label: "Short-Shipment %",     type: "number",   sortable: true  },
  ],
  bill: [
    { key: "billNumber",        label: "Bill No.",           type: "text",     sortable: true  },
    { key: "poNumber",          label: "PO No.",             type: "text",     sortable: true  },
    { key: "clientName",        label: "Client",             type: "text",     sortable: true  },
    { key: "supplierName",      label: "Supplier",           type: "text",     sortable: true  },
    { key: "baseAmount",        label: "Base Amount",        type: "currency", sortable: true  },
    { key: "gstAmount",         label: "GST Amount",         type: "currency", sortable: true  },
    { key: "finalAmount",       label: "Final Amount",       type: "currency", sortable: true  },
    { key: "paidAmount",        label: "Paid Amount",        type: "currency", sortable: true  },
    { key: "due",               label: "Due",                type: "currency", sortable: true  },
    { key: "status",            label: "Status",             type: "status",   sortable: true  },
    { key: "brokerageAmount",   label: "Brokerage",          type: "currency", sortable: true  },
    { key: "brokerageEligible", label: "Brokerage Eligible", type: "status",   sortable: true  },
    { key: "createdAt",         label: "Created At",         type: "date",     sortable: true  },
  ],
  payment: [
    { key: "date",              label: "Date",               type: "date",     sortable: true  },
    { key: "billNumber",        label: "Bill No.",           type: "text",     sortable: true  },
    { key: "clientName",        label: "Client",             type: "text",     sortable: true  },
    { key: "amount",            label: "Amount",             type: "currency", sortable: true  },
    { key: "mode",              label: "Mode",               type: "text",     sortable: true  },
    { key: "reference",         label: "Reference",          type: "text",     sortable: false },
    { key: "notes",             label: "Notes",              type: "text",     sortable: false },
  ],
  brokerage: [
    { key: "billNumber",        label: "Bill No.",           type: "text",     sortable: true  },
    { key: "clientName",        label: "Client",             type: "text",     sortable: true  },
    { key: "supplierName",      label: "Supplier",           type: "text",     sortable: true  },
    { key: "commissionRate",    label: "Commission %",       type: "number",   sortable: true  },
    { key: "baseAmount",        label: "Base Amount",        type: "currency", sortable: true  },
    { key: "brokerageAmount",   label: "Brokerage Amount",   type: "currency", sortable: true  },
    { key: "eligible",          label: "Eligible",           type: "status",   sortable: true  },
    { key: "payoutStatus",      label: "Payout Status",      type: "status",   sortable: true  },
    { key: "eligibleAt",        label: "Eligible At",        type: "date",     sortable: true  },
  ],
  dispatch: [
    { key: "dispatchDate",      label: "Dispatch Date",      type: "date",     sortable: true  },
    { key: "poNumber",          label: "PO No.",             type: "text",     sortable: true  },
    { key: "clientName",        label: "Client",             type: "text",     sortable: true  },
    { key: "supplierName",      label: "Supplier",           type: "text",     sortable: true  },
    { key: "dispatchedQty",     label: "Dispatched Qty",     type: "number",   sortable: true  },
    { key: "orderedQty",        label: "Ordered Qty",        type: "number",   sortable: true  },
    { key: "status",            label: "Status",             type: "status",   sortable: true  },
    { key: "notes",             label: "Notes",              type: "text",     sortable: false },
  ],
  dispute: [
    { key: "poNumber",          label: "PO No.",             type: "text",     sortable: true  },
    { key: "clientName",        label: "Client",             type: "text",     sortable: true  },
    { key: "supplierName",      label: "Supplier",           type: "text",     sortable: true  },
    { key: "type",              label: "Type",               type: "text",     sortable: true  },
    { key: "description",       label: "Description",        type: "text",     sortable: false },
    { key: "quantityAffected",  label: "Qty Affected",       type: "number",   sortable: true  },
    { key: "valueAffected",     label: "Value Affected",     type: "currency", sortable: true  },
    { key: "status",            label: "Status",             type: "status",   sortable: true  },
    { key: "createdAt",         label: "Created At",         type: "date",     sortable: true  },
  ],
};

// ── Group-by options per entity type ─────────────────────────────────────────
//
// Group-by is a curated subset of columns where grouping actually produces
// useful sub-totals. The first entry is always "none" (no grouping).
export const GROUP_BY_OPTIONS: Record<EntityType, { key: string; label: string }[]> = {
  client:    [{ key: "none", label: "No grouping" }, { key: "payoutCadence", label: "Payout Cadence" }],
  supplier:  [{ key: "none", label: "No grouping" }, { key: "commissionRate", label: "Commission %" }],
  bill:      [{ key: "none", label: "No grouping" }, { key: "clientName", label: "Client" }, { key: "supplierName", label: "Supplier" }, { key: "status", label: "Status" }],
  payment:   [{ key: "none", label: "No grouping" }, { key: "clientName", label: "Client" }, { key: "mode", label: "Mode" }],
  brokerage: [{ key: "none", label: "No grouping" }, { key: "clientName", label: "Client" }, { key: "supplierName", label: "Supplier" }, { key: "payoutStatus", label: "Payout Status" }, { key: "eligible", label: "Eligible" }],
  dispatch:  [{ key: "none", label: "No grouping" }, { key: "clientName", label: "Client" }, { key: "supplierName", label: "Supplier" }, { key: "status", label: "Status" }],
  dispute:   [{ key: "none", label: "No grouping" }, { key: "clientName", label: "Client" }, { key: "supplierName", label: "Supplier" }, { key: "type", label: "Type" }, { key: "status", label: "Status" }],
};

// ── Status filter options per entity type ────────────────────────────────────
//
// Returns the list of meaningful status filter values for the entity. Empty
// array means "no status filter applies" (e.g. clients + suppliers have no
// status column — skip the status filter UI entirely).
export const STATUS_FILTER_OPTIONS: Record<EntityType, { key: string; label: string }[]> = {
  client:    [],
  supplier:  [],
  bill:      [
    { key: "pending",        label: "Pending" },
    { key: "partially_paid", label: "Partially Paid" },
    { key: "fully_paid",     label: "Fully Paid" },
  ],
  payment:   [], // payments have a mode, not a status
  brokerage: [
    { key: "accrued",   label: "Accrued" },
    { key: "scheduled", label: "Scheduled" },
    { key: "paid",      label: "Paid" },
  ],
  dispatch:  [
    { key: "in_transit",     label: "In Transit" },
    { key: "delivered",      label: "Delivered" },
    { key: "short_shipment", label: "Short Shipment" },
  ],
  dispute:   [
    { key: "open",      label: "Open" },
    { key: "resolved",  label: "Resolved" },
    { key: "rejected",  label: "Rejected" },
  ],
};

// ── Date-range filter options ────────────────────────────────────────────────
//
// "week" is only meaningful for entities with a clear date column (bills,
// payments, dispatches, disputes, brokerage). Clients + suppliers have no
// inherent "date" so the range filter is effectively cosmetic there — but
// we still expose it (the report applies it to the client's/supplier's
// createdAt, which is a reasonable proxy for "added this week").

export const DATE_RANGE_OPTIONS = [
  { key: "all",     label: "All time" },
  { key: "week",    label: "This week" },
  { key: "month",   label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "year",    label: "This year" },
  { key: "custom",  label: "Custom range" },
] as const;

export type DateRangeKey = (typeof DATE_RANGE_OPTIONS)[number]["key"];

// ── Template type options ────────────────────────────────────────────────────

export const TEMPLATE_TYPES = [
  { key: "summary",    label: "Summary" },
  { key: "comparison", label: "Comparison" },
  { key: "ledger",     label: "Ledger" },
  { key: "custom",     label: "Custom" },
] as const;

export type TemplateType = (typeof TEMPLATE_TYPES)[number]["key"];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isValidEntityType(s: string): s is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(s);
}

export function isValidTemplateType(s: string): s is TemplateType {
  return (TEMPLATE_TYPES.map((t) => t.key) as readonly string[]).includes(s as TemplateType);
}

export function isValidDateRange(s: string): s is DateRangeKey {
  return (DATE_RANGE_OPTIONS.map((o) => o.key) as readonly string[]).includes(s as DateRangeKey);
}

// Get a column definition by entity + key. Returns undefined for unknown keys
// (defensive — older templates may reference renamed columns).
export function getColumn(entity: EntityType, key: string): ReportColumn | undefined {
  return REPORT_COLUMNS[entity].find((c) => c.key === key);
}

// ── Template config types (shared by the API + the view) ─────────────────────

export type ReportTemplateConfig = {
  entityType: EntityType;
  columns: string[];
  filters: {
    dateRange?: DateRangeKey;
    fromDate?: string;
    toDate?: string;
    status?: string;
    tagId?: string;
  };
  groupBy?: string | null;
  sortBy?: { field: string; direction: "asc" | "desc" };
  title: string;
  includeCharts: boolean;
  includeSummary?: boolean;
};

export type ReportTemplateDTO = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  configJson: string;
  createdAt: string;
  updatedAt: string;
};

export function toReportTemplateDTO(t: {
  id: string;
  name: string;
  description: string | null;
  type: string;
  configJson: string;
  createdAt: Date;
  updatedAt: Date;
}): ReportTemplateDTO {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    type: t.type,
    configJson: t.configJson,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// Safe-parse a configJson string into a ReportTemplateConfig, applying
// sensible defaults for any missing fields. Used by the report-generation
// API so a half-baked template (e.g. one missing `filters`) still renders.
export function parseConfig(json: string): ReportTemplateConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = {};
  }
  const cfg = (parsed ?? {}) as Partial<ReportTemplateConfig>;
  const entityTypeRaw = typeof cfg.entityType === "string" ? cfg.entityType : "";
  const entityType: EntityType = isValidEntityType(entityTypeRaw) ? entityTypeRaw : "client";
  const allCols = REPORT_COLUMNS[entityType].map((c) => c.key);
  const cols = Array.isArray(cfg.columns)
    ? cfg.columns.filter((c): c is string => typeof c === "string" && allCols.includes(c))
    : [];
  const dateRangeRaw = typeof cfg.filters?.dateRange === "string" ? cfg.filters.dateRange : "";
  return {
    entityType,
    columns: cols.length > 0 ? cols : allCols.slice(0, 4),
    filters: {
      dateRange: isValidDateRange(dateRangeRaw) ? dateRangeRaw : "all",
      fromDate: typeof cfg.filters?.fromDate === "string" ? cfg.filters!.fromDate : undefined,
      toDate: typeof cfg.filters?.toDate === "string" ? cfg.filters!.toDate : undefined,
      status: typeof cfg.filters?.status === "string" ? cfg.filters!.status : undefined,
      tagId: typeof cfg.filters?.tagId === "string" ? cfg.filters!.tagId : undefined,
    },
    groupBy: typeof cfg.groupBy === "string" ? cfg.groupBy : null,
    sortBy: cfg.sortBy && typeof cfg.sortBy.field === "string" && typeof cfg.sortBy.direction === "string"
      ? { field: cfg.sortBy.field, direction: cfg.sortBy.direction === "asc" ? "asc" : "desc" }
      : undefined,
    title: typeof cfg.title === "string" ? cfg.title : "Custom Report",
    includeCharts: typeof cfg.includeCharts === "boolean" ? cfg.includeCharts : false,
    includeSummary: typeof cfg.includeSummary === "boolean" ? cfg.includeSummary : true,
  };
}
