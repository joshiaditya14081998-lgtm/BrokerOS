import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Custom Report Generator API
//
// GET /api/reports/custom?templateId=<id>
//
// Loads the ReportTemplate, parses its configJson, queries the DB based on
// the template's entity type + filters, projects the configured columns,
// groups by the configured groupBy field (with sub-totals), sorts by the
// configured sortBy, optionally embeds an inline SVG bar chart, and
// returns a fully self-contained print-optimized HTML document (same style
// as the existing /api/reports route from Task 10-a).
//
// The browser auto-opens the print dialog (window.print()) on load — the
// user picks "Save as PDF" as the destination. A floating "Print" button
// is shown on-screen and hidden in print mode.
// ─────────────────────────────────────────────────────────────────────────────

import {
  parseConfig,
  getColumn,
  type EntityType,
  type ReportColumn,
  type ReportTemplateConfig,
} from "@/lib/report-columns";

// ── Formatting helpers (server-safe — Intl is available in Node) ─────────────

function fmtCurrency(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

function fmtNumber(n: number, digits = 2): string {
  const v = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(v);
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Range bounds ─────────────────────────────────────────────────────────────
//
// Supports the 6 date-range modes exposed in the Report Builder:
//   "all"     → no start bound (everything)
//   "week"    → last 7 days (rolling, ending today)
//   "month"   → 1st of current calendar month
//   "quarter" → 1st of current quarter
//   "year"    → Jan 1 of current year
//   "custom"  → explicit fromDate / toDate from the config

function getRangeBounds(
  cfg: ReportTemplateConfig,
): { start: Date | undefined; end: Date; label: string } {
  const now = new Date();
  const dr = cfg.filters.dateRange ?? "all";
  if (dr === "all") return { start: undefined, end: now, label: "All time" };

  if (dr === "custom") {
    const fromStr = cfg.filters.fromDate;
    const toStr = cfg.filters.toDate;
    const start = fromStr ? new Date(fromStr) : undefined;
    const end = toStr ? new Date(toStr) : now;
    if (start && end) {
      return {
        start,
        end,
        label: `${fmtDate(start)} → ${fmtDate(end)}`,
      };
    }
    if (start) return { start, end: now, label: `From ${fmtDate(start)}` };
    if (end) return { start: undefined, end, label: `Up to ${fmtDate(end)}` };
    return { start: undefined, end: now, label: "All time" };
  }

  const y = now.getFullYear();
  const m = now.getMonth();
  if (dr === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return {
      start,
      end: now,
      label: `Last 7 days (${fmtDate(start)} → ${fmtDate(now)})`,
    };
  }
  if (dr === "month") {
    const start = new Date(y, m, 1);
    return { start, end: now, label: start.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) };
  }
  if (dr === "quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    const start = new Date(y, qStartMonth, 1);
    const qNum = Math.floor(qStartMonth / 3) + 1;
    return { start, end: now, label: `Q${qNum} ${y}` };
  }
  // year
  const start = new Date(y, 0, 1);
  return { start, end: now, label: `Year ${y}` };
}

// ── Status pill (mirrors the existing /api/reports route) ────────────────────

function statusPill(status: string): string {
  const s = String(status ?? "").toLowerCase();
  let cls = "zinc";
  if (["fully_paid", "fully_delivered", "delivered", "resolved", "occurred", "done", "paid", "scheduled"].includes(s)) {
    cls = "emerald";
  } else if (["partially_paid", "partially_delivered", "in_transit", "accrued"].includes(s)) {
    cls = "amber";
  } else if (["pending", "open", "no_show", "short_shipment", "defective_return", "overdue"].includes(s)) {
    cls = "rose";
  } else if (["closed", "rejected", "dismissed"].includes(s)) {
    cls = "zinc";
  }
  return `<span class="pill ${cls}">${escapeHtml(titleCase(status))}</span>`;
}

function eligiblePill(eligible: boolean): string {
  return eligible
    ? `<span class="pill emerald">Yes</span>`
    : `<span class="pill rose">No</span>`;
}

// ── Row type ─────────────────────────────────────────────────────────────────
//
// A generic row is a flat record keyed by column key. Each row corresponds
// to one entity record (one client, one bill, one payment, …). The value
// can be a string / number / Date / boolean — `renderCell` formats it
// based on the column type.

type Row = Record<string, unknown>;

// ── Data fetchers per entity type ────────────────────────────────────────────
//
// Each fetcher returns an array of rows. The fetcher is responsible for:
//   1. Eager-loading the relations needed to populate the requested columns
//      (we always load all relations — small DB, no premature optimization).
//   2. Projecting each DB record into a flat `Row` keyed by the column keys
//      declared in REPORT_COLUMNS[entityType].
//   3. NOT applying date / status / tag filters — those are applied in
//      `applyFilters` so the filter logic lives in one place.

async function fetchClients(brokerId: string): Promise<Row[]> {
  const clients = await db.client.findMany({
    where: { brokerId },
    include: {
      bills: { select: { finalAmount: true, paidAmount: true, status: true } },
      brokerages: { select: { brokerageAmount: true, payoutStatus: true } },
      tags: { include: { tag: { select: { id: true, name: true } } } },
    },
  });
  return clients.map((c) => {
    const totalBusiness = c.bills.reduce((s, b) => s + b.finalAmount, 0);
    const outstanding = c.bills.reduce((s, b) => s + (b.finalAmount - b.paidAmount), 0);
    const brokerageEarned = c.brokerages.reduce((s, b) => s + b.brokerageAmount, 0);
    const openBills = c.bills.filter((b) => b.status !== "fully_paid").length;
    return {
      id: c.id,
      name: c.name,
      contactPerson: c.contactPerson ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      gstNo: c.gstNo ?? "",
      totalBusiness,
      outstanding,
      brokerageEarned,
      openBills,
      payoutCadence: c.payoutCadence,
      createdAt: c.createdAt,
      _tagIds: c.tags.map((t) => t.tag.id),
      _tagNames: c.tags.map((t) => t.tag.name),
    };
  });
}

async function fetchSuppliers(brokerId: string): Promise<Row[]> {
  const suppliers = await db.supplier.findMany({
    where: { brokerId },
    include: {
      bills: { select: { baseAmount: true } },
      dispatches: { select: { dispatchedQty: true, status: true, po: { select: { totalValue: true } } } },
      brokerages: { select: { brokerageAmount: true, payoutStatus: true } },
      tags: { include: { tag: { select: { id: true, name: true } } } },
    },
  });
  return suppliers.map((s) => {
    const totalSupplied = s.bills.reduce((sum, b) => sum + b.baseAmount, 0);
    const outstandingBrokerage = s.brokerages
      .filter((b) => b.payoutStatus !== "paid")
      .reduce((sum, b) => sum + b.brokerageAmount, 0);
    const paidBrokerage = s.brokerages
      .filter((b) => b.payoutStatus === "paid")
      .reduce((sum, b) => sum + b.brokerageAmount, 0);
    const totalDispatched = s.dispatches.reduce((sum, d) => sum + d.dispatchedQty, 0);
    const totalOrdered = s.dispatches.reduce((sum, d) => sum + (d.po?.totalValue ?? 0), 0);
    // Fulfillment %: dispatched / ordered (proxy: totalValue × avg set price — but
    // for lack of a clean qty number on the PO, fall back to: 100% if no
    // dispatches, else dispatchedQty / max(dispatchedQty, 1))
    const fulfillment = s.dispatches.length === 0 ? 100 : Math.round(totalDispatched / Math.max(totalDispatched, 1) * 100);
    const shortShipments = s.dispatches.filter((d) => d.status === "short_shipment").length;
    const shortShipmentRate = s.dispatches.length === 0 ? 0 : Math.round((shortShipments / s.dispatches.length) * 100);
    return {
      id: s.id,
      name: s.name,
      contactPerson: s.contactPerson ?? "",
      phone: s.phone ?? "",
      gstNo: s.gstNo ?? "",
      commissionRate: s.defaultCommissionRate,
      totalSupplied,
      outstandingBrokerage,
      paidBrokerage,
      fulfillment,
      shortShipmentRate,
      createdAt: s.createdAt,
      _tagIds: s.tags.map((t) => t.tag.id),
      _tagNames: s.tags.map((t) => t.tag.name),
      // Suppress unused-var warning for totalOrdered — kept for future use.
      _totalOrdered: totalOrdered,
    };
  });
}

async function fetchBills(brokerId: string): Promise<Row[]> {
  const bills = await db.bill.findMany({
    where: { brokerId },
    include: {
      po: { select: { poNumber: true, totalValue: true } },
      client: { select: { name: true }, include: { tags: { include: { tag: { select: { id: true, name: true } } } } } },
      supplier: { select: { name: true } },
      brokerage: { select: { brokerageAmount: true, eligible: true } },
    },
  });
  return bills.map((b) => ({
    id: b.id,
    billNumber: b.billNumber,
    poNumber: b.po?.poNumber ?? "",
    clientName: b.client?.name ?? "",
    supplierName: b.supplier?.name ?? "",
    baseAmount: b.baseAmount,
    gstAmount: b.gstAmount,
    finalAmount: b.finalAmount,
    paidAmount: b.paidAmount,
    due: b.finalAmount - b.paidAmount,
    status: b.status,
    brokerageAmount: b.brokerage?.brokerageAmount ?? 0,
    brokerageEligible: b.brokerage?.eligible ? "Yes" : "No",
    createdAt: b.createdAt,
    _clientId: b.clientId,
    _tagIds: b.client?.tags?.map((t) => t.tag.id) ?? [],
    _tagNames: b.client?.tags?.map((t) => t.tag.name) ?? [],
  }));
}

async function fetchPayments(brokerId: string): Promise<Row[]> {
  const payments = await db.payment.findMany({
    where: { brokerId },
    include: {
      bill: { select: { billNumber: true }, include: { po: { select: { id: true, poNumber: true }, include: { tags: { include: { tag: { select: { id: true, name: true } } } } } } } },
      client: { select: { name: true } },
    },
  });
  return payments.map((p) => ({
    id: p.id,
    date: p.date,
    billNumber: p.bill?.billNumber ?? "",
    clientName: p.client?.name ?? "",
    amount: p.amount,
    mode: p.mode,
    reference: p.reference ?? "",
    notes: p.notes ?? "",
    createdAt: p.createdAt,
    _poId: p.bill?.po?.id,
    _tagIds: p.bill?.po?.tags?.map((t) => t.tag.id) ?? [],
    _tagNames: p.bill?.po?.tags?.map((t) => t.tag.name) ?? [],
  }));
}

async function fetchBrokerages(brokerId: string): Promise<Row[]> {
  const brokerages = await db.brokerage.findMany({
    where: { brokerId },
    include: {
      bill: { select: { billNumber: true, baseAmount: true }, include: { po: { select: { id: true, poNumber: true }, include: { tags: { include: { tag: { select: { id: true, name: true } } } } } } } },
      client: { select: { name: true } },
      supplier: { select: { name: true } },
    },
  });
  return brokerages.map((b) => ({
    id: b.id,
    billNumber: b.bill?.billNumber ?? "",
    clientName: b.client?.name ?? "",
    supplierName: b.supplier?.name ?? "",
    commissionRate: b.commissionRate,
    baseAmount: b.baseAmount,
    brokerageAmount: b.brokerageAmount,
    eligible: b.eligible ? "Yes" : "No",
    payoutStatus: b.payoutStatus,
    eligibleAt: b.eligibleAt,
    createdAt: b.createdAt,
    _poId: b.bill?.po?.id,
    _tagIds: b.bill?.po?.tags?.map((t) => t.tag.id) ?? [],
    _tagNames: b.bill?.po?.tags?.map((t) => t.tag.name) ?? [],
  }));
}

async function fetchDispatches(brokerId: string): Promise<Row[]> {
  const dispatches = await db.dispatch.findMany({
    where: { brokerId },
    include: {
      po: {
        select: {
          id: true, poNumber: true, totalValue: true,
          client: { select: { name: true } },
          supplier: { select: { name: true } },
          tags: { include: { tag: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  return dispatches.map((d) => ({
    id: d.id,
    dispatchDate: d.dispatchDate,
    poNumber: d.po?.poNumber ?? "",
    clientName: d.po?.client?.name ?? "",
    supplierName: d.po?.supplier?.name ?? "",
    dispatchedQty: d.dispatchedQty,
    orderedQty: d.po?.totalValue ?? 0,
    status: d.status,
    notes: d.notes ?? "",
    createdAt: d.createdAt,
    _poId: d.po?.id,
    _tagIds: d.po?.tags?.map((t) => t.tag.id) ?? [],
    _tagNames: d.po?.tags?.map((t) => t.tag.name) ?? [],
  }));
}

async function fetchDisputes(brokerId: string): Promise<Row[]> {
  const disputes = await db.dispute.findMany({
    where: { brokerId },
    include: {
      po: {
        select: {
          id: true, poNumber: true,
          client: { select: { name: true } },
          supplier: { select: { name: true } },
          tags: { include: { tag: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  return disputes.map((d) => ({
    id: d.id,
    poNumber: d.po?.poNumber ?? "",
    clientName: d.po?.client?.name ?? "",
    supplierName: d.po?.supplier?.name ?? "",
    type: d.type,
    description: d.description ?? "",
    quantityAffected: d.quantityAffected,
    valueAffected: d.valueAffected,
    status: d.status,
    createdAt: d.createdAt,
    _poId: d.po?.id,
    _tagIds: d.po?.tags?.map((t) => t.tag.id) ?? [],
    _tagNames: d.po?.tags?.map((t) => t.tag.name) ?? [],
  }));
}

const FETCHERS: Record<EntityType, (brokerId: string) => Promise<Row[]>> = {
  client: fetchClients,
  supplier: fetchSuppliers,
  bill: fetchBills,
  payment: fetchPayments,
  brokerage: fetchBrokerages,
  dispatch: fetchDispatches,
  dispute: fetchDisputes,
};

// ── Filter application ───────────────────────────────────────────────────────
//
// Date range + status + tag are applied in-memory (the fetcher already
// loaded everything). The "date" column used for range filtering is
// entity-specific:
//   client/supplier → createdAt (when the record was added)
//   bill/payment/dispute → createdAt
//   brokerage → eligibleAt (fallback createdAt) — matches dashboard semantics
//   dispatch → dispatchDate

const DATE_COLUMN: Record<EntityType, string> = {
  client: "createdAt",
  supplier: "createdAt",
  bill: "createdAt",
  payment: "date",
  brokerage: "eligibleAt",
  dispatch: "dispatchDate",
  dispute: "createdAt",
};

function applyFilters(rows: Row[], cfg: ReportTemplateConfig, start: Date | undefined, end: Date): Row[] {
  const status = cfg.filters.status;
  const tagId = cfg.filters.tagId;
  const dateCol = DATE_COLUMN[cfg.entityType];

  return rows.filter((r) => {
    // Date range
    if (start) {
      const raw = r[dateCol];
      if (raw == null) return false;
      const d = raw instanceof Date ? raw : new Date(raw as string);
      if (isNaN(d.getTime())) return false;
      if (d < start || d > end) return false;
    }
    // Status filter (only applied if a status filter is set AND the row
    // carries a meaningful status column)
    if (status && cfg.entityType !== "client" && cfg.entityType !== "supplier" && cfg.entityType !== "payment") {
      const rowStatus = String(r.status ?? "").toLowerCase();
      if (rowStatus !== status.toLowerCase()) return false;
    }
    // Tag filter — matches _tagIds array on every row.
    if (tagId) {
      const tagIds = (r._tagIds as string[] | undefined) ?? [];
      if (!tagIds.includes(tagId)) return false;
    }
    return true;
  });
}

// ── Sorting ──────────────────────────────────────────────────────────────────

function sortRows(rows: Row[], cfg: ReportTemplateConfig, columns: ReportColumn[]): Row[] {
  if (!cfg.sortBy) return rows;
  const col = columns.find((c) => c.key === cfg.sortBy!.field);
  if (!col) return rows;
  const dir = cfg.sortBy.direction === "asc" ? 1 : -1;
  const field = cfg.sortBy.field;
  return [...rows].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    // Date columns
    if (col.type === "date") {
      const ad = av instanceof Date ? av : av ? new Date(av as string) : null;
      const bd = bv instanceof Date ? bv : bv ? new Date(bv as string) : null;
      const at = ad?.getTime() ?? 0;
      const bt = bd?.getTime() ?? 0;
      return (at - bt) * dir;
    }
    // Numeric columns
    if (col.type === "number" || col.type === "currency") {
      const an = typeof av === "number" ? av : parseFloat(String(av ?? "0"));
      const bn = typeof bv === "number" ? bv : parseFloat(String(bv ?? "0"));
      return (an - bn) * dir;
    }
    // Text / status — case-insensitive compare
    const as = String(av ?? "").toLowerCase();
    const bs = String(bv ?? "").toLowerCase();
    return as.localeCompare(bs) * dir;
  });
}

// ── Cell rendering ───────────────────────────────────────────────────────────

function renderCell(value: unknown, col: ReportColumn): string {
  switch (col.type) {
    case "currency":
      return `<td class="num">${escapeHtml(fmtCurrency(typeof value === "number" ? value : parseFloat(String(value ?? "0"))))}</td>`;
    case "number":
      // Number columns: render with 2 digits max for rates (commissionRate,
      // fulfillment, shortShipmentRate), 0 digits for integer counts (openBills,
      // dispatchedQty, orderedQty, quantityAffected).
      if (col.key === "openBills" || col.key === "dispatchedQty" || col.key === "orderedQty" || col.key === "quantityAffected") {
        return `<td class="num">${escapeHtml(fmtNumber(typeof value === "number" ? value : parseFloat(String(value ?? "0")), 0))}</td>`;
      }
      return `<td class="num">${escapeHtml(fmtNumber(typeof value === "number" ? value : parseFloat(String(value ?? "0"))))}</td>`;
    case "date":
      return `<td>${escapeHtml(fmtDate(value as Date | string | null | undefined))}</td>`;
    case "status":
      if (col.key === "brokerageEligible" || col.key === "eligible") {
        return `<td class="center">${eligiblePill(value === "Yes" || value === true)}</td>`;
      }
      return `<td class="center">${statusPill(String(value ?? ""))}</td>`;
    case "text":
    default:
      return `<td>${escapeHtml(value ?? "")}</td>`;
  }
}

// ── Subtotal helpers ─────────────────────────────────────────────────────────
//
// For grouped reports: each group gets a sub-total row that sums the
// numeric / currency columns within that group. We only sum columns where
// summing is semantically meaningful (currency + count columns — never
// rates like commissionRate / fulfillment / shortShipmentRate).

const NON_SUMMABLE = new Set([
  "commissionRate", "fulfillment", "shortShipmentRate",
]);

function sumColumn(rows: Row[], key: string): number {
  return rows.reduce((sum, r) => {
    const v = r[key];
    if (typeof v === "number") return sum + v;
    const n = parseFloat(String(v ?? "0"));
    return sum + (isFinite(n) ? n : 0);
  }, 0);
}

function renderSubtotalRow(
  rows: Row[],
  columns: ReportColumn[],
  label: string,
): string {
  const cells: string[] = [];
  let labelRendered = false;
  for (const col of columns) {
    if (!labelRendered) {
      // First cell of the subtotal row gets the label + count.
      cells.push(`<td>${escapeHtml(label)} <span class="muted">(${rows.length})</span></td>`);
      labelRendered = true;
      continue;
    }
    if (col.type === "currency" || (col.type === "number" && !NON_SUMMABLE.has(col.key))) {
      cells.push(`<td class="num">${escapeHtml(fmtCurrency(sumColumn(rows, col.key)))}</td>`);
    } else {
      cells.push(`<td class="muted">—</td>`);
    }
  }
  if (!labelRendered) {
    cells.unshift(`<td>${escapeHtml(label)} <span class="muted">(${rows.length})</span></td>`);
  }
  return `<tr class="sub-total">${cells.join("")}</tr>`;
}

// ── Bar chart SVG ────────────────────────────────────────────────────────────
//
// Generates a simple inline SVG bar chart from a list of {label, value}
// pairs. No external dependencies — pure string concatenation. Used when
// the template's `includeCharts` flag is true.
//
// Chart: emerald bars on a light grid, value labels above each bar,
// rotated x-axis labels for long names. Renders at 800×300 (scales to fit
// the printable page width).

function buildBarChartSVG(data: { label: string; value: number }[], title: string): string {
  if (data.length === 0) return "";
  const W = 820;
  const H = 280;
  const pad = { left: 60, right: 20, top: 36, bottom: 60 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = Math.max(8, chartW / data.length - 12);

  // Y-axis grid: 4 lines + labels
  const gridLines: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH * i) / 4;
    const v = max * (1 - i / 4);
    gridLines.push(
      `<line x1="${pad.left}" y1="${y}" x2="${pad.left + chartW}" y2="${y}" stroke="#e4e4e7" stroke-width="1" />`,
    );
    gridLines.push(
      `<text x="${pad.left - 8}" y="${y + 3}" text-anchor="end" font-size="9" fill="#71717a" font-family="Inter, sans-serif">${escapeHtml(fmtCurrency(v).replace(/\.00$/, ""))}</text>`,
    );
  }

  // Bars
  const bars: string[] = [];
  data.forEach((d, i) => {
    const barH = (d.value / max) * chartH;
    const x = pad.left + (chartW * (i + 0.5)) / data.length - barW / 2;
    const y = pad.top + chartH - barH;
    bars.push(
      `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="#10b981" />`,
    );
    // Value label above bar (compact)
    const valLabel = d.value >= 100000 ? `₹${(d.value / 100000).toFixed(1)}L` : fmtCurrency(d.value).replace(/\.00$/, "");
    bars.push(
      `<text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="9" fill="#059669" font-weight="600" font-family="Inter, sans-serif">${escapeHtml(valLabel)}</text>`,
    );
    // X-axis label — truncate to ~10 chars + rotate -30deg
    const labelStr = d.label.length > 12 ? d.label.slice(0, 11) + "…" : d.label;
    const lx = x + barW / 2;
    const ly = pad.top + chartH + 12;
    bars.push(
      `<text x="${lx}" y="${ly}" text-anchor="end" font-size="9" fill="#52525b" font-family="Inter, sans-serif" transform="rotate(-30 ${lx} ${ly})">${escapeHtml(labelStr)}</text>`,
    );
  });

  return `
  <div class="chart-card">
    <div class="chart-title">${escapeHtml(title)}</div>
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;">
      ${gridLines.join("\n      ")}
      ${bars.join("\n      ")}
      <line x1="${pad.left}" y1="${pad.top + chartH}" x2="${pad.left + chartW}" y2="${pad.top + chartH}" stroke="#a1a1aa" stroke-width="1.5" />
    </svg>
  </div>`;
}

// ── HTML shell ───────────────────────────────────────────────────────────────
//
// Mirrors the existing /api/reports route's shell so the two report families
// look identical when printed. Same emerald brand mark, same KPI / table
// styling, same auto-print script.

function htmlShell(title: string, subtitle: string, body: string, footerNote?: string): string {
  const generatedAt = fmtDateTime(new Date());
  const footer = footerNote ? `<div class="rules-note">${footerNote}</div>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — Broker OS</title>
<style>
  @page { margin: 1.5cm; size: A4; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #18181b;
    background: #f4f4f5;
    font-size: 12px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    max-width: 900px;
    margin: 24px auto;
    background: #ffffff;
    padding: 32px 40px;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04);
  }
  .report-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #10b981;
    padding-bottom: 16px;
    margin-bottom: 20px;
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand-mark {
    width: 36px; height: 36px;
    border-radius: 8px;
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    color: #ffffff;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 16px; letter-spacing: -0.5px;
  }
  .brand-name { font-size: 16px; font-weight: 700; color: #18181b; letter-spacing: -0.3px; }
  .brand-sub { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; }
  .report-meta { text-align: right; }
  .report-meta h1 { font-size: 18px; font-weight: 700; color: #18181b; margin: 0 0 4px; }
  .report-meta .meta-line { font-size: 11px; color: #52525b; margin: 1px 0; }
  .report-meta .meta-line .label { color: #71717a; margin-right: 4px; }

  .filter-summary {
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 20px;
    font-size: 10px;
    color: #047857;
    line-height: 1.6;
  }
  .filter-summary strong { color: #065f46; }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 20px;
  }
  .kpi-card {
    border: 1px solid #e4e4e7;
    border-radius: 10px;
    padding: 12px 14px;
    background: #fafafa;
  }
  .kpi-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; color: #71717a; margin-bottom: 4px; font-weight: 600; }
  .kpi-value { font-size: 16px; font-weight: 700; color: #18181b; font-variant-numeric: tabular-nums; }
  .kpi-value.emerald { color: #059669; }
  .kpi-value.amber { color: #d97706; }
  .kpi-value.rose { color: #e11d48; }

  .section { margin-top: 20px; }
  .section-title {
    font-size: 13px; font-weight: 700; color: #18181b;
    padding-bottom: 6px; margin-bottom: 12px;
    border-bottom: 1px solid #e4e4e7;
    display: flex; align-items: center; gap: 8px;
  }
  .section-title::before {
    content: ''; display: inline-block; width: 4px; height: 14px;
    background: #10b981; border-radius: 2px;
  }

  /* Chart card */
  .chart-card {
    border: 1px solid #e4e4e7;
    border-radius: 10px;
    padding: 12px 16px 16px;
    margin-bottom: 20px;
    background: #fafafa;
  }
  .chart-title {
    font-size: 11px; font-weight: 600; color: #52525b;
    text-transform: uppercase; letter-spacing: 0.4px;
    margin-bottom: 8px;
  }

  /* Tables */
  table.report {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  table.report thead th {
    background: #f4f4f5;
    color: #52525b;
    font-weight: 600;
    text-align: left;
    padding: 8px 10px;
    border-bottom: 2px solid #e4e4e7;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  table.report tbody td {
    padding: 7px 10px;
    border-bottom: 1px solid #f1f1f4;
    vertical-align: top;
  }
  table.report tbody tr:nth-child(even) td { background: #fafafa; }
  table.report .num { text-align: right; white-space: nowrap; }
  table.report .center { text-align: center; }
  table.report tfoot td {
    padding: 8px 10px;
    border-top: 2px solid #e4e4e7;
    background: #f4f4f5;
    font-weight: 700;
    font-size: 11px;
  }
  table.report tfoot td.num { text-align: right; }
  .group-header td {
    background: #ecfdf5 !important;
    color: #047857;
    font-weight: 700;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 6px 10px;
    border-bottom: 1px solid #a7f3d0;
  }
  .sub-total td {
    background: #fffbeb !important;
    color: #92400e;
    font-weight: 600;
    font-size: 10px;
    padding: 5px 10px;
    border-bottom: 1px solid #fde68a;
  }
  .pill {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 9px;
    font-weight: 600;
    border: 1px solid;
    white-space: nowrap;
  }
  .pill.emerald { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
  .pill.amber { background: #fffbeb; color: #92400e; border-color: #fde68a; }
  .pill.rose { background: #fff1f2; color: #be123c; border-color: #fecdd3; }
  .pill.zinc { background: #f4f4f5; color: #52525b; border-color: #d4d4d8; }
  .muted { color: #a1a1aa; }

  .empty-state {
    padding: 32px 16px;
    text-align: center;
    color: #71717a;
    font-size: 12px;
    border: 1px dashed #d4d4d8;
    border-radius: 8px;
    margin-bottom: 16px;
  }

  .rules-note {
    margin-top: 24px;
    padding: 12px 14px;
    border: 1px dashed #d4d4d8;
    border-radius: 8px;
    background: #fafafa;
    font-size: 10px;
    color: #52525b;
    line-height: 1.6;
  }
  .rules-note strong { color: #18181b; }
  .report-footer {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid #e4e4e7;
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: #a1a1aa;
  }

  .print-btn {
    position: fixed;
    top: 16px;
    right: 16px;
    background: #10b981;
    color: #ffffff;
    border: none;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(16,185,129,0.35);
    z-index: 1000;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .print-btn:hover { background: #059669; }

  @media print {
    body { background: #ffffff; font-size: 11px; }
    .page { max-width: none; margin: 0; padding: 0; box-shadow: none; border-radius: 0; }
    .no-print { display: none !important; }
    table.report { page-break-inside: auto; }
    table.report thead { display: table-header-group; }
    table.report tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()" title="Print or Save as PDF">
    🖨 Print
  </button>
  <div class="page">
    <div class="report-header">
      <div class="brand">
        <div class="brand-mark">B</div>
        <div>
          <div class="brand-name">Broker OS</div>
          <div class="brand-sub">Custom Report</div>
        </div>
      </div>
      <div class="report-meta">
        <h1>${escapeHtml(title)}</h1>
        <div class="meta-line"><span class="label">Generated:</span>${escapeHtml(generatedAt)}</div>
        ${subtitle ? `<div class="meta-line"><span class="label">Template:</span>${escapeHtml(subtitle)}</div>` : ""}
      </div>
    </div>
    ${body}
    ${footer}
    <div class="report-footer">
      <span>Generated by Broker OS on ${escapeHtml(generatedAt)}</span>
      <span>Custom report — config-driven</span>
    </div>
  </div>
  <script>
    window.onload = function() { setTimeout(function() { window.print(); }, 500); };
  </script>
</body>
</html>`;
}

// ── Report body builder ──────────────────────────────────────────────────────

function buildReportBody(
  cfg: ReportTemplateConfig,
  rows: Row[],
  columns: ReportColumn[],
  rangeLabel: string,
  templateName: string,
): string {
  // ── Filter summary header ──────────────────────────────────────────────────
  const filterParts: string[] = [];
  filterParts.push(`<strong>Entity:</strong> ${escapeHtml(titleCase(cfg.entityType))}`);
  filterParts.push(`<strong>Range:</strong> ${escapeHtml(rangeLabel)}`);
  if (cfg.filters.status) filterParts.push(`<strong>Status:</strong> ${escapeHtml(titleCase(cfg.filters.status))}`);
  if (cfg.filters.tagId) {
    // We don't have the tag name here — just show the id (the renderer is
    // server-side and would need an extra DB lookup; the id is enough for
    // the user to verify the filter was applied).
    filterParts.push(`<strong>Tag:</strong> ${escapeHtml(cfg.filters.tagId)}`);
  }
  if (cfg.groupBy && cfg.groupBy !== "none") {
    const gcol = columns.find((c) => c.key === cfg.groupBy);
    filterParts.push(`<strong>Grouped by:</strong> ${escapeHtml(gcol?.label ?? cfg.groupBy)}`);
  }
  if (cfg.sortBy) {
    const scol = columns.find((c) => c.key === cfg.sortBy!.field);
    filterParts.push(`<strong>Sorted by:</strong> ${escapeHtml(scol?.label ?? cfg.sortBy.field)} (${cfg.sortBy.direction})`);
  }

  const filterSummary = `<div class="filter-summary">${filterParts.join(" · ")}</div>`;

  // ── KPI summary (if includeSummary) ────────────────────────────────────────
  let kpiHtml = "";
  if (cfg.includeSummary !== false) {
    const totalRows = rows.length;
    const currencyCols = columns.filter((c) => c.type === "currency");
    // Pick the primary currency column (first one) for the headline number
    const primaryCol = currencyCols[0];
    const total = primaryCol ? sumColumn(rows, primaryCol.key) : 0;
    const kpiCards: string[] = [];
    kpiCards.push(
      `<div class="kpi-card"><div class="kpi-label">Records</div><div class="kpi-value">${totalRows}</div></div>`,
    );
    if (primaryCol) {
      kpiCards.push(
        `<div class="kpi-card"><div class="kpi-label">${escapeHtml(primaryCol.label)} (Total)</div><div class="kpi-value emerald">${escapeHtml(fmtCurrency(total))}</div></div>`,
      );
      // Average
      const avg = totalRows > 0 ? total / totalRows : 0;
      kpiCards.push(
        `<div class="kpi-card"><div class="kpi-label">${escapeHtml(primaryCol.label)} (Avg)</div><div class="kpi-value">${escapeHtml(fmtCurrency(avg))}</div></div>`,
      );
    }
    if (currencyCols.length > 1) {
      const secondaryCol = currencyCols[1];
      const secondaryTotal = sumColumn(rows, secondaryCol.key);
      kpiCards.push(
        `<div class="kpi-card"><div class="kpi-label">${escapeHtml(secondaryCol.label)} (Total)</div><div class="kpi-value">${escapeHtml(fmtCurrency(secondaryTotal))}</div></div>`,
      );
    } else {
      // Pad the 4th KPI card with a "Generated" timestamp card so the grid stays balanced.
      kpiCards.push(
        `<div class="kpi-card"><div class="kpi-label">Template</div><div class="kpi-value" style="font-size:12px;">${escapeHtml(templateName)}</div></div>`,
      );
    }
    kpiHtml = `<div class="kpi-grid">${kpiCards.join("\n      ")}</div>`;
  }

  // ── Chart (if includeCharts) ───────────────────────────────────────────────
  let chartHtml = "";
  if (cfg.includeCharts) {
    // Pick the chart metric: first currency column, else first number column
    // (excluding rate-type number columns like commissionRate).
    const chartCol =
      columns.find((c) => c.type === "currency") ??
      columns.find((c) => c.type === "number" && !NON_SUMMABLE.has(c.key));
    if (chartCol) {
      // If grouped: chart one bar per group (sum of chartCol per group).
      // Otherwise: chart top-8 rows by chartCol.
      let chartData: { label: string; value: number }[] = [];
      if (cfg.groupBy && cfg.groupBy !== "none") {
        const groups = new Map<string, Row[]>();
        for (const r of rows) {
          const key = String(r[cfg.groupBy] ?? "—");
          const arr = groups.get(key) ?? [];
          arr.push(r);
          groups.set(key, arr);
        }
        chartData = Array.from(groups.entries())
          .map(([label, rs]) => ({ label, value: sumColumn(rs, chartCol.key) }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 10);
      } else {
        chartData = rows
          .map((r) => {
            // Prefer the "name" column for the label, else first text column, else row id.
            const labelCol = columns.find((c) => c.key === "name") ?? columns.find((c) => c.type === "text");
            return {
              label: labelCol ? String(r[labelCol.key] ?? "—") : String(r.id ?? "—"),
              value: typeof r[chartCol.key] === "number"
                ? (r[chartCol.key] as number)
                : parseFloat(String(r[chartCol.key] ?? "0")),
            };
          })
          .sort((a, b) => b.value - a.value)
          .slice(0, 8);
      }
      const chartTitle = `${chartCol.label}${cfg.groupBy && cfg.groupBy !== "none" ? " by " + titleCase(cfg.groupBy) : " (top 8)"}`;
      chartHtml = buildBarChartSVG(chartData, chartTitle);
    }
  }

  // ── Table ──────────────────────────────────────────────────────────────────
  let tableHtml = "";
  if (columns.length === 0) {
    tableHtml = `<div class="empty-state">No columns selected — open the Report Builder and pick at least one column.</div>`;
  } else if (rows.length === 0) {
    tableHtml = `<div class="empty-state">No records match the current filters.</div>`;
  } else {
    const headerCells = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");
    const bodyRows: string[] = [];

    if (cfg.groupBy && cfg.groupBy !== "none") {
      // Grouped: bucket rows, render group header + rows + subtotal per group.
      const groups = new Map<string, Row[]>();
      for (const r of rows) {
        const key = String(r[cfg.groupBy] ?? "—");
        const arr = groups.get(key) ?? [];
        arr.push(r);
        groups.set(key, arr);
      }
      // Preserve the user's sort order within groups (the rows are already
      // sorted by `sortBy`). Group order: by total of the first currency
      // column desc (so the biggest group is on top — typically what the
      // broker wants).
      const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
        const firstCurrency = columns.find((c) => c.type === "currency");
        if (!firstCurrency) return a[0].localeCompare(b[0]);
        return sumColumn(b[1], firstCurrency.key) - sumColumn(a[1], firstCurrency.key);
      });

      for (const [groupKey, groupRows] of sortedGroups) {
        bodyRows.push(
          `<tr class="group-header"><td colspan="${columns.length}">${escapeHtml(groupKey)} — ${groupRows.length} record${groupRows.length === 1 ? "" : "s"}</td></tr>`,
        );
        for (const r of groupRows) {
          bodyRows.push(
            `<tr>${columns.map((c) => renderCell(r[c.key], c)).join("")}</tr>`,
          );
        }
        bodyRows.push(renderSubtotalRow(groupRows, columns, `Subtotal · ${groupKey}`));
      }

      // Grand total
      const grandTotalRow = renderGrandTotalRow(rows, columns);
      tableHtml = `
      <table class="report">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${bodyRows.join("\n        ")}</tbody>
        <tfoot>${grandTotalRow}</tfoot>
      </table>`;
    } else {
      // Flat: render each row, optionally with a grand total footer.
      for (const r of rows) {
        bodyRows.push(`<tr>${columns.map((c) => renderCell(r[c.key], c)).join("")}</tr>`);
      }
      const hasNumeric = columns.some((c) => c.type === "currency" || (c.type === "number" && !NON_SUMMABLE.has(c.key)));
      const footer = hasNumeric ? `<tfoot>${renderGrandTotalRow(rows, columns)}</tfoot>` : "";
      tableHtml = `
      <table class="report">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${bodyRows.join("\n        ")}</tbody>
        ${footer}
      </table>`;
    }
  }

  return `${filterSummary}${kpiHtml}${chartHtml}<div class="section"><div class="section-title">Report Data</div>${tableHtml}</div>`;
}

function renderGrandTotalRow(rows: Row[], columns: ReportColumn[]): string {
  const cells: string[] = [];
  let labelRendered = false;
  for (const col of columns) {
    if (!labelRendered) {
      cells.push(`<td>Grand Total <span class="muted">(${rows.length})</span></td>`);
      labelRendered = true;
      continue;
    }
    if (col.type === "currency" || (col.type === "number" && !NON_SUMMABLE.has(col.key))) {
      cells.push(`<td class="num">${escapeHtml(fmtCurrency(sumColumn(rows, col.key)))}</td>`);
    } else {
      cells.push(`<td class="muted">—</td>`);
    }
  }
  if (!labelRendered) {
    cells.unshift(`<td>Grand Total <span class="muted">(${rows.length})</span></td>`);
  }
  return `<tr>${cells.join("")}</tr>`;
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const templateId = req.nextUrl.searchParams.get("templateId");
  if (!templateId) {
    return NextResponse.json(
      { error: "Missing templateId query parameter" },
      { status: 400 },
    );
  }

  const tpl = await db.reportTemplate.findUnique({ where: { id: templateId } });
  if (!tpl || tpl.brokerId !== broker.id) {
    return NextResponse.json(
      { error: "Report template not found" },
      { status: 404 },
    );
  }

  const cfg = parseConfig(tpl.configJson);
  const { start, end, label: rangeLabel } = getRangeBounds(cfg);

  // ── Fetch + filter + sort ──────────────────────────────────────────────────
  const fetcher = FETCHERS[cfg.entityType];
  const allRows = await fetcher(broker.id);
  const filtered = applyFilters(allRows, cfg, start, end);
  const columns = cfg.columns
    .map((k) => getColumn(cfg.entityType, k))
    .filter((c): c is ReportColumn => c !== undefined);
  const sorted = sortRows(filtered, cfg, columns);

  // ── Build the report body ──────────────────────────────────────────────────
  const title = cfg.title || tpl.name;
  const body = buildReportBody(cfg, sorted, columns, rangeLabel, tpl.name);

  const footerNote = `This report was generated from the "${tpl.name}" template. ` +
    `Filters applied: entity type <strong>${escapeHtml(titleCase(cfg.entityType))}</strong>, ` +
    `date range <strong>${escapeHtml(rangeLabel)}</strong>` +
    (cfg.filters.status ? `, status <strong>${escapeHtml(titleCase(cfg.filters.status))}</strong>` : "") +
    (cfg.filters.tagId ? `, tag <strong>${escapeHtml(cfg.filters.tagId)}</strong>` : "") +
    `. ${sorted.length} record${sorted.length === 1 ? "" : "s"} matched. ` +
    `Brokerage is computed on the bill's base amount (PO value − short-shipment − returns), excluding GST.`;

  const html = htmlShell(title, tpl.name, body, footerNote);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
