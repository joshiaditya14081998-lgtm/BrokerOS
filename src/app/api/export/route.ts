import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toCSV, type CsvColumn } from "@/lib/csv";
import type { Prisma } from "@prisma/client";
import { getCurrentBroker } from "@/lib/auth";

export const dynamic = "force-dynamic";

type ExportType =
  | "clients"
  | "suppliers"
  | "pos"
  | "bills"
  | "payments"
  | "brokerage"
  | "expenses"
  | "invoices"
  | "audit";

const VALID_TYPES: ExportType[] = [
  "clients",
  "suppliers",
  "pos",
  "bills",
  "payments",
  "brokerage",
  "expenses",
  "invoices",
  "audit",
];

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-entity builders. Each returns { columns, rows }.
// We reuse the same Prisma queries + computed fields as the list API routes
// so the CSV matches what the UI shows.
// ─────────────────────────────────────────────────────────────────────────────

async function buildClients(brokerId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const columns: CsvColumn[] = [
    { key: "name", label: "Name" },
    { key: "contactPerson", label: "Contact" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "gstNo", label: "GST" },
    { key: "defaultPaymentCycleDays", label: "PaymentCycleDays" },
    { key: "payoutCadence", label: "PayoutCadence" },
    { key: "gstRate", label: "GSTRate" },
    { key: "totalBusiness", label: "TotalBusiness" },
    { key: "outstanding", label: "Outstanding" },
    { key: "brokerageEarned", label: "BrokerageEarned" },
    { key: "openPOs", label: "OpenBills" },
  ];
  const clients = await db.client.findMany({
    where: { brokerId },
    include: {
      bills: { select: { id: true, finalAmount: true, paidAmount: true, status: true } },
      brokerages: { select: { id: true, brokerageAmount: true, eligible: true, payoutStatus: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const rows = clients.map((c) => {
    const outstanding = c.bills.reduce((s, b) => s + (b.finalAmount - b.paidAmount), 0);
    const totalBusiness = c.bills.reduce((s, b) => s + b.finalAmount, 0);
    const brokerageEarned = c.brokerages.filter((b) => b.eligible).reduce((s, b) => s + b.brokerageAmount, 0);
    const openBills = c.bills.filter((b) => b.status !== "fully_paid").length;
    return {
      name: c.name,
      contactPerson: c.contactPerson ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      gstNo: c.gstNo ?? "",
      defaultPaymentCycleDays: c.defaultPaymentCycleDays,
      payoutCadence: c.payoutCadence,
      gstRate: c.gstRate,
      totalBusiness,
      outstanding,
      brokerageEarned,
      openPOs: openBills,
    };
  });
  return { columns, rows };
}

async function buildSuppliers(brokerId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const columns: CsvColumn[] = [
    { key: "name", label: "Name" },
    { key: "contactPerson", label: "Contact" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "gstNo", label: "GST" },
    { key: "defaultCommissionRate", label: "CommissionRate" },
    { key: "defaultGstRate", label: "GSTRate" },
    { key: "totalSupplied", label: "TotalSupplied" },
    { key: "outstandingBrokerage", label: "OutstandingBrokerage" },
    { key: "paidBrokerage", label: "PaidBrokerage" },
    { key: "fulfillment", label: "Fulfillment%" },
    { key: "shortShipmentRate", label: "ShortShipmentRate%" },
    { key: "dispatchCount", label: "DispatchCount" },
  ];
  const suppliers = await db.supplier.findMany({
    where: { brokerId },
    include: {
      bills: { select: { id: true, baseAmount: true } },
      dispatches: { select: { id: true, status: true, dispatchedQty: true, po: { select: { totalValue: true, lineItemsJson: true } } } },
      brokerages: { select: { id: true, brokerageAmount: true, eligible: true, payoutStatus: true } },
    },
    orderBy: { name: "asc" },
  });
  const rows = suppliers.map((s) => {
    const totalSupplied = s.bills.reduce((a, b) => a + b.baseAmount, 0);
    const outstandingBrokerage = s.brokerages
      .filter((b) => b.eligible && b.payoutStatus !== "paid")
      .reduce((a, b) => a + b.brokerageAmount, 0);
    const paidBrokerage = s.brokerages
      .filter((b) => b.payoutStatus === "paid")
      .reduce((a, b) => a + b.brokerageAmount, 0);
    const totalOrderedQty = s.dispatches.reduce((a, d) => {
      let ordered = 0;
      try {
        ordered = (JSON.parse(d.po.lineItemsJson) as { setQty: number }[]).reduce((x, i) => x + i.setQty, 0);
      } catch {
        ordered = 0;
      }
      return a + ordered;
    }, 0);
    const totalDispatchedQty = s.dispatches.reduce((a, d) => a + d.dispatchedQty, 0);
    const fulfillment = totalOrderedQty ? Math.round((totalDispatchedQty / totalOrderedQty) * 100) : 0;
    const shortShipmentRate = s.dispatches.length
      ? Math.round((s.dispatches.filter((d) => d.status === "short_shipment").length / s.dispatches.length) * 100)
      : 0;
    return {
      name: s.name,
      contactPerson: s.contactPerson ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      gstNo: s.gstNo ?? "",
      defaultCommissionRate: s.defaultCommissionRate,
      defaultGstRate: s.defaultGstRate,
      totalSupplied,
      outstandingBrokerage,
      paidBrokerage,
      fulfillment,
      shortShipmentRate,
      dispatchCount: s.dispatches.length,
    };
  });
  return { columns, rows };
}

async function buildPos(brokerId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const columns: CsvColumn[] = [
    { key: "poNumber", label: "PONumber" },
    { key: "clientName", label: "Client" },
    { key: "supplierName", label: "Supplier" },
    { key: "totalValue", label: "TotalValue" },
    { key: "commissionRate", label: "CommissionRate" },
    { key: "gstRate", label: "GSTRate" },
    { key: "status", label: "Status" },
    { key: "orderedQty", label: "OrderedQty" },
    { key: "dispatchedQty", label: "DispatchedQty" },
    { key: "fulfillment", label: "Fulfillment%" },
    { key: "billStatus", label: "BillStatus" },
    { key: "createdAt", label: "Created" },
  ];
  const pos = await db.purchaseOrder.findMany({
    where: { brokerId },
    include: {
      client: { select: { name: true } },
      supplier: { select: { name: true } },
      dispatches: { select: { dispatchedQty: true } },
      bill: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const rows = pos.map((p) => {
    let orderedQty = 0;
    try {
      orderedQty = (JSON.parse(p.lineItemsJson) as { setQty: number }[]).reduce((s, i) => s + i.setQty, 0);
    } catch {
      orderedQty = 0;
    }
    const dispatchedQty = p.dispatches.reduce((s, d) => s + d.dispatchedQty, 0);
    const fulfillment = orderedQty ? Math.round((dispatchedQty / orderedQty) * 100) : 0;
    return {
      poNumber: p.poNumber,
      clientName: p.client.name,
      supplierName: p.supplier.name,
      totalValue: p.totalValue,
      commissionRate: p.commissionRate,
      gstRate: p.gstRate,
      status: p.status,
      orderedQty,
      dispatchedQty,
      fulfillment,
      billStatus: p.bill?.status ?? "",
      createdAt: p.createdAt,
    };
  });
  return { columns, rows };
}

async function buildBills(brokerId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const columns: CsvColumn[] = [
    { key: "billNumber", label: "BillNumber" },
    { key: "poNumber", label: "PO" },
    { key: "clientName", label: "Client" },
    { key: "supplierName", label: "Supplier" },
    { key: "baseAmount", label: "BaseAmount" },
    { key: "gstRate", label: "GSTRate" },
    { key: "gstAmount", label: "GSTAmount" },
    { key: "finalAmount", label: "FinalAmount" },
    { key: "paidAmount", label: "PaidAmount" },
    { key: "due", label: "Due" },
    { key: "status", label: "Status" },
    { key: "brokerageAmount", label: "BrokerageAmount" },
    { key: "brokerageEligible", label: "BrokerageEligible" },
    { key: "brokeragePayoutStatus", label: "BrokeragePayoutStatus" },
    { key: "createdAt", label: "Created" },
  ];
  const bills = await db.bill.findMany({
    where: { brokerId },
    include: {
      po: { select: { poNumber: true, supplier: { select: { name: true } } } },
      client: { select: { name: true } },
      brokerage: { select: { brokerageAmount: true, eligible: true, payoutStatus: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const rows = bills.map((b) => ({
    billNumber: b.billNumber,
    poNumber: b.po.poNumber,
    clientName: b.client.name,
    supplierName: b.po.supplier.name,
    baseAmount: b.baseAmount,
    gstRate: b.gstRate,
    gstAmount: b.gstAmount,
    finalAmount: b.finalAmount,
    paidAmount: b.paidAmount,
    due: b.finalAmount - b.paidAmount,
    status: b.status,
    brokerageAmount: b.brokerage?.brokerageAmount ?? 0,
    brokerageEligible: b.brokerage?.eligible ?? false,
    brokeragePayoutStatus: b.brokerage?.payoutStatus ?? "",
    createdAt: b.createdAt,
  }));
  return { columns, rows };
}

async function buildPayments(brokerId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const columns: CsvColumn[] = [
    { key: "date", label: "Date" },
    { key: "billNumber", label: "BillNumber" },
    { key: "clientName", label: "Client" },
    { key: "amount", label: "Amount" },
    { key: "mode", label: "Mode" },
    { key: "reference", label: "Reference" },
    { key: "notes", label: "Notes" },
  ];
  const payments = await db.payment.findMany({
    where: { brokerId },
    include: { bill: { select: { billNumber: true, po: { select: { poNumber: true } } } }, client: { select: { name: true } } },
    orderBy: { date: "desc" },
  });
  const rows = payments.map((p) => ({
    date: p.date,
    billNumber: p.bill.billNumber,
    clientName: p.client.name,
    amount: p.amount,
    mode: p.mode,
    reference: p.reference ?? "",
    notes: p.notes ?? "",
  }));
  return { columns, rows };
}

async function buildBrokerage(brokerId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const columns: CsvColumn[] = [
    { key: "billNumber", label: "BillNumber" },
    { key: "clientName", label: "Client" },
    { key: "supplierName", label: "Supplier" },
    { key: "commissionRate", label: "CommissionRate" },
    { key: "baseAmount", label: "BaseAmount" },
    { key: "brokerageAmount", label: "BrokerageAmount" },
    { key: "eligible", label: "Eligible" },
    { key: "payoutStatus", label: "PayoutStatus" },
    { key: "eligibleAt", label: "EligibleAt" },
    { key: "createdAt", label: "Created" },
  ];
  const brokerages = await db.brokerage.findMany({
    where: { brokerId },
    include: {
      bill: { select: { billNumber: true } },
      client: { select: { name: true } },
      supplier: { select: { name: true } },
      payout: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const rows = brokerages.map((b) => ({
    billNumber: b.bill.billNumber,
    clientName: b.client.name,
    supplierName: b.supplier.name,
    commissionRate: b.commissionRate,
    baseAmount: b.baseAmount,
    brokerageAmount: b.brokerageAmount,
    eligible: b.eligible,
    payoutStatus: b.payoutStatus,
    eligibleAt: b.eligibleAt,
    createdAt: b.createdAt,
  }));
  return { columns, rows };
}

// Shared audit filter parser — accepts the same query params as /api/audit
// (entityType, user, from, to) and returns a Prisma where clause. Always
// scoped to the supplied brokerId.
function parseAuditFilter(params: URLSearchParams, brokerId: string): Prisma.AuditLogWhereInput {
  const entityType = params.get("entityType")?.trim();
  const user = params.get("user")?.trim();
  const fromRaw = params.get("from");
  const toRaw = params.get("to");

  // Note: SQLite (Prisma's provider here) does not support `mode: "insensitive"`.
  // String comparison uses the default BINARY collation (case-sensitive).
  // Stored entityType values are PascalCase and the UI dropdown uses matching
  // values, so case-sensitive equals is sufficient.
  const where: Prisma.AuditLogWhereInput = { brokerId };
  if (entityType) {
    where.entityType = entityType;
  }
  if (user) {
    where.userName = { contains: user };
  }
  const range: { gte?: Date; lte?: Date } = {};
  if (fromRaw) {
    const d = new Date(fromRaw);
    if (!Number.isNaN(d.getTime())) range.gte = d;
  }
  if (toRaw) {
    const d = new Date(toRaw);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      range.lte = d;
    }
  }
  if (range.gte || range.lte) {
    where.createdAt = range;
  }
  return where;
}

function truncate(s: string | null, n = 200): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function buildAudit(params: URLSearchParams, brokerId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const columns: CsvColumn[] = [
    { key: "createdAt", label: "Time" },
    { key: "userName", label: "User" },
    { key: "entityType", label: "EntityType" },
    { key: "action", label: "Action" },
    { key: "reason", label: "Reason" },
    { key: "entityId", label: "EntityId" },
    { key: "before", label: "Before" },
    { key: "after", label: "After" },
  ];
  const where = parseAuditFilter(params, brokerId);
  const logs = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const rows = logs.map((l) => ({
    createdAt: l.createdAt,
    userName: l.userName ?? "System",
    entityType: l.entityType,
    action: l.action,
    reason: l.reason ?? "",
    entityId: l.entityId,
    before: truncate(l.before),
    after: truncate(l.after),
  }));
  return { columns, rows };
}

async function buildExpenses(brokerId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const columns: CsvColumn[] = [
    { key: "date", label: "Date" },
    { key: "category", label: "Category" },
    { key: "description", label: "Description" },
    { key: "vendor", label: "Vendor" },
    { key: "amount", label: "Amount" },
    { key: "createdAt", label: "Recorded" },
  ];
  const expenses = await db.expense.findMany({
    where: { brokerId },
    orderBy: { date: "desc" },
  });
  const rows = expenses.map((e) => ({
    date: e.date,
    category: e.category,
    description: e.description ?? "",
    vendor: e.vendor ?? "",
    amount: e.amount,
    createdAt: e.createdAt,
  }));
  return { columns, rows };
}

async function buildInvoices(brokerId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const columns: CsvColumn[] = [
    { key: "invoiceNumber", label: "InvoiceNumber" },
    { key: "clientName", label: "Client" },
    { key: "issueDate", label: "IssueDate" },
    { key: "dueDate", label: "DueDate" },
    { key: "subtotal", label: "Subtotal" },
    { key: "gstRate", label: "GSTRate" },
    { key: "gstAmount", label: "GSTAmount" },
    { key: "roundOff", label: "RoundOff" },
    { key: "totalAmount", label: "Total" },
    { key: "status", label: "Status" },
    { key: "placeOfSupply", label: "PlaceOfSupply" },
    { key: "createdAt", label: "CreatedAt" },
  ];
  const invoices = await db.invoice.findMany({
    where: { brokerId },
    orderBy: { issueDate: "desc" },
    include: { client: { select: { name: true } } },
  });
  const rows = invoices.map((i) => ({
    invoiceNumber: i.invoiceNumber,
    clientName: i.client.name,
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    subtotal: i.subtotal,
    gstRate: i.gstRate,
    gstAmount: i.gstAmount,
    roundOff: i.roundOff,
    totalAmount: i.totalAmount,
    status: i.status,
    placeOfSupply: i.placeOfSupply ?? "",
    createdAt: i.createdAt,
  }));
  return { columns, rows };
}

// Non-audit builders take a brokerId argument.
const BUILDERS: Record<Exclude<ExportType, "audit">, (brokerId: string) => Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }>> = {
  clients: buildClients,
  suppliers: buildSuppliers,
  pos: buildPos,
  bills: buildBills,
  payments: buildPayments,
  brokerage: buildBrokerage,
  expenses: buildExpenses,
  invoices: buildInvoices,
};

export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const typeParam = (searchParams.get("type") ?? "").toLowerCase();
  if (!VALID_TYPES.includes(typeParam as ExportType)) {
    return NextResponse.json(
      { error: `Invalid export type. Valid: ${VALID_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  const type = typeParam as ExportType;

  try {
    const { columns, rows } =
      type === "audit"
        ? await buildAudit(searchParams, broker.id)
        : await BUILDERS[type](broker.id);
    const csv = toCSV(rows, columns);
    const filename = `${type}-export-${todayStamp()}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Export failed: ${message}` }, { status: 500 });
  }
}
