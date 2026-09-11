import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getCurrentBroker } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// PDF / print-optimized HTML report API
//
// GET /api/reports?type=<brokerage-statement|client-ledger|supplier-summary|audit-trail>
//                  &range=<month|quarter|year|all>      (brokerage-statement only)
//                  &clientId=<id>                        (client-ledger only)
//                  &supplierId=<id>                      (supplier-summary only)
//                  &from=<ISO>&to=<ISO>&entityType=<T>   (audit-trail only)
//
// Returns a standalone HTML document (Content-Type: text/html) that is fully
// print-optimized. The browser auto-opens the print dialog (window.print()) on
// load — the user picks "Save as PDF" as the destination. A floating "Print"
// button is shown in the on-screen view and hidden in print mode.
// ─────────────────────────────────────────────────────────────────────────────

type ReportType = "brokerage-statement" | "client-ledger" | "supplier-summary" | "audit-trail" | "purchase-order" | "party-ledger";
type Range = "month" | "quarter" | "year" | "all";

const VALID_TYPES: ReportType[] = ["brokerage-statement", "client-ledger", "supplier-summary", "audit-trail", "purchase-order", "party-ledger"];
const VALID_RANGES: Range[] = ["month", "quarter", "year", "all"];

const REPORT_TITLES: Record<ReportType, string> = {
  "brokerage-statement": "Brokerage Statement",
  "client-ledger": "Client Ledger Report",
  "supplier-summary": "Supplier Performance Summary",
  "audit-trail": "Audit Trail Report",
  "purchase-order": "Purchase Order",
  "party-ledger": "Party Ledger Report",
};

// ── Formatting helpers (server-safe — Intl is available in Node) ─────────────

function fmtCurrency(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
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

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Range bounds (reused from dashboard route) ───────────────────────────────

function getRangeBounds(range: Range): { start: Date | undefined; end: Date; label: string } {
  const now = new Date();
  if (range === "all") {
    return { start: undefined, end: now, label: "All time" };
  }
  const y = now.getFullYear();
  const m = now.getMonth();
  let start: Date;
  let label: string;
  if (range === "month") {
    start = new Date(y, m, 1);
    label = start.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  } else if (range === "quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    start = new Date(y, qStartMonth, 1);
    const qNum = Math.floor(qStartMonth / 3) + 1;
    label = `Q${qNum} ${y}`;
  } else {
    start = new Date(y, 0, 1);
    label = `Year ${y}`;
  }
  return { start, end: now, label };
}

// ── HTML document shell ──────────────────────────────────────────────────────

function htmlShell(title: string, rangeLabel: string, body: string, footerNote?: string): string {
  const generatedAt = fmtDateTime(new Date());
  const footer = footerNote
    ? `<div class="rules-note">${footerNote}</div>`
    : "";
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
  /* Header */
  .report-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #10b981;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
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
  .report-meta h1 {
    font-size: 18px; font-weight: 700; color: #18181b; margin: 0 0 4px;
  }
  .report-meta .meta-line { font-size: 11px; color: #52525b; margin: 1px 0; }
  .report-meta .meta-line .label { color: #71717a; margin-right: 4px; }

  /* KPI / summary cards */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 24px;
  }
  .kpi-card {
    border: 1px solid #e4e4e7;
    border-radius: 10px;
    padding: 12px 14px;
    background: #fafafa;
  }
  .kpi-label {
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px;
    color: #71717a; margin-bottom: 4px; font-weight: 600;
  }
  .kpi-value {
    font-size: 16px; font-weight: 700; color: #18181b;
    font-variant-numeric: tabular-nums;
  }
  .kpi-value.emerald { color: #059669; }
  .kpi-value.amber { color: #d97706; }
  .kpi-value.rose { color: #e11d48; }
  .kpi-sub { font-size: 10px; color: #71717a; margin-top: 2px; }

  /* Section heading */
  .section { margin-top: 24px; }
  .section-break { page-break-before: always; }
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
  .section-desc { font-size: 10px; color: #71717a; margin: -8px 0 10px; }

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

  /* Status pills (print-safe) */
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

  /* Subject card (client/supplier info) */
  .subject-card {
    border: 1px solid #e4e4e7;
    border-left: 4px solid #10b981;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 20px;
    background: #fafafa;
  }
  .subject-card h2 { margin: 0 0 6px; font-size: 15px; color: #18181b; }
  .subject-meta {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px 16px;
    font-size: 10px;
  }
  .subject-meta .item .k { color: #71717a; text-transform: uppercase; letter-spacing: 0.4px; font-size: 9px; }
  .subject-meta .item .v { color: #18181b; font-weight: 500; }

  /* Footer / rules note */
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

  /* Floating print button (hidden in print) */
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
    .page {
      max-width: none; margin: 0; padding: 0;
      box-shadow: none; border-radius: 0;
    }
    .no-print { display: none !important; }
    .section-break { page-break-before: always; }
    .page-break-row { page-break-before: always; }
    table.report { page-break-inside: auto; }
    table.report thead { display: table-header-group; }
    table.report tr { page-break-inside: avoid; }
  }
  .nowrap { white-space: nowrap; }

  /* ── Purchase Order specific styles ─────────────────────────────────────── */
  .po-doc-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2px solid #10b981; padding-bottom: 16px; margin-bottom: 24px;
  }
  .po-title-block h1 {
    font-size: 28px; font-weight: 800; color: #10b981; margin: 0;
    letter-spacing: -0.5px; text-transform: uppercase;
  }
  .po-number { font-size: 14px; color: #52525b; margin-top: 8px; }
  .po-number strong { color: #18181b; font-size: 16px; }
  .po-date { font-size: 12px; color: #71717a; margin-top: 2px; }
  .po-status-badge {
    padding: 6px 14px; border-radius: 999px; font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .po-status-badge.status-open { background: #fef3c7; color: #92400e; }
  .po-status-badge.status-partially_delivered { background: #ddd6fe; color: #5b21b6; }
  .po-status-badge.status-fully_delivered { background: #d1fae5; color: #065f46; }
  .po-status-badge.status-closed { background: #e4e4e7; color: #52525b; }

  .party-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;
  }
  .party-card {
    border: 1px solid #e4e4e7; border-radius: 10px; padding: 12px 14px; background: #fafafa;
  }
  .party-label {
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; color: #71717a;
    margin-bottom: 6px; font-weight: 600;
  }
  .party-name { font-size: 13px; font-weight: 700; color: #18181b; margin-bottom: 4px; }
  .party-detail { font-size: 11px; color: #52525b; margin: 2px 0; }

  .dispatch-info {
    background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px;
    padding: 12px 14px; margin-bottom: 20px; display: flex; align-items: center; gap: 24px; flex-wrap: wrap;
  }
  .dispatch-info .info-label {
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; color: #71717a; font-weight: 600;
  }
  .dispatch-info .info-value { font-size: 12px; color: #18181b; font-weight: 500; margin-left: 6px; }
  .revised-tag {
    display: inline-block; font-size: 9px; background: #fef3c7; color: #92400e;
    padding: 1px 6px; border-radius: 4px; margin-left: 4px; font-weight: 600;
  }

  .section-title {
    font-size: 13px; font-weight: 700; color: #18181b; margin: 20px 0 10px;
    padding-bottom: 6px; border-bottom: 1px solid #e4e4e7;
  }

  table.line-items {
    width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px;
  }
  table.line-items th, table.line-items td {
    padding: 8px 10px; border-bottom: 1px solid #e4e4e7; text-align: left;
  }
  table.line-items thead th {
    background: #f4f4f5; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
    color: #52525b; font-weight: 600; border-bottom: 2px solid #d4d4d8;
  }
  table.line-items tbody tr:nth-child(even) { background: #fafafa; }
  table.line-items .num { text-align: right; }
  table.line-items tfoot td {
    border-bottom: none; border-top: 1px solid #e4e4e7; font-weight: 600;
  }
  table.line-items .subtotal-row td { background: #f4f4f5; }
  table.line-items .grand-total-row td {
    background: #10b981; color: #ffffff; font-size: 14px; font-weight: 700;
    border-top: 2px solid #059669;
  }
  table.line-items .grand-total-row td.num { font-size: 16px; }

  .dispatch-instructions {
    background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 14px 16px; margin-bottom: 24px;
  }
  .dispatch-instructions h3 {
    font-size: 12px; font-weight: 700; color: #92400e; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .dispatch-instructions ol { margin: 0; padding-left: 20px; }
  .dispatch-instructions li { font-size: 11px; color: #52525b; margin: 4px 0; line-height: 1.4; }
  .dispatch-instructions strong { color: #18181b; }

  .signature-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; padding-top: 20px;
  }
  .signature-block { text-align: left; }
  .sig-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #71717a; font-weight: 600; margin-bottom: 40px; }
  .sig-line { border-top: 1px solid #52525b; height: 1px; margin-bottom: 6px; }
  .sig-name { font-size: 11px; color: #52525b; font-weight: 500; }
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
          <div class="brand-sub">Garment Brokerage Operations</div>
        </div>
      </div>
      <div class="report-meta">
        <h1>${escapeHtml(title)}</h1>
        <div class="meta-line"><span class="label">Range:</span>${escapeHtml(rangeLabel)}</div>
        <div class="meta-line"><span class="label">Generated:</span>${escapeHtml(generatedAt)}</div>
      </div>
    </div>
    ${body}
    ${footer}
    <div class="report-footer">
      <span>Broker OS — confidential brokerage statement</span>
      <span>Page generated on ${escapeHtml(generatedAt)}</span>
    </div>
  </div>
  <script>
    window.onload = function() { setTimeout(function() { window.print(); }, 500); };
  </script>
</body>
</html>`;
}

// ── Status pill helper ───────────────────────────────────────────────────────

function statusPill(status: string): string {
  const s = status.toLowerCase();
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

function eligiblePill(eligible: boolean, forceEligible?: boolean): string {
  if (!eligible) return `<span class="pill rose">No</span>`;
  return forceEligible
    ? `<span class="pill amber">Forced</span>`
    : `<span class="pill emerald">Yes</span>`;
}

// ── Brokerage statement report ───────────────────────────────────────────────

async function buildBrokerageStatement(brokerId: string, range: Range): Promise<string> {
  const { start, end, label } = getRangeBounds(range);

  const brokerages = await db.brokerage.findMany({
    where: start
      ? {
          brokerId,
          OR: [
            { eligibleAt: { gte: start, lte: end } },
            { eligibleAt: null, createdAt: { gte: start, lte: end } },
          ],
        }
      : { brokerId },
    include: {
      bill: { select: { billNumber: true, baseAmount: true, status: true, po: { select: { poNumber: true } } } },
      client: { select: { name: true } },
      supplier: { select: { name: true } },
      payout: { select: { id: true, status: true, paidAt: true } },
    },
    orderBy: { eligibleAt: "asc" },
  });

  const payouts = await db.brokeragePayout.findMany({
    where: start ? { brokerId, createdAt: { gte: start, lte: end } } : { brokerId },
    include: { client: { select: { name: true } }, brokerages: { select: { id: true, brokerageAmount: true } } },
    orderBy: { createdAt: "desc" },
  });

  const totalBrokerage = brokerages.reduce((s, b) => s + b.brokerageAmount, 0);
  const accruedTotal = brokerages
    .filter((b) => b.eligible && b.payoutStatus === "accrued")
    .reduce((s, b) => s + b.brokerageAmount, 0);
  const scheduledTotal = brokerages
    .filter((b) => b.eligible && b.payoutStatus === "scheduled")
    .reduce((s, b) => s + b.brokerageAmount, 0);
  const paidTotal = brokerages
    .filter((b) => b.payoutStatus === "paid")
    .reduce((s, b) => s + b.brokerageAmount, 0);
  const pendingTotal = brokerages
    .filter((b) => !b.eligible)
    .reduce((s, b) => s + b.brokerageAmount, 0);
  const billsCount = new Set(brokerages.map((b) => b.billId)).size;

  // Group by client for the detail table (multiple sub-totals)
  const byClient = new Map<string, { name: string; rows: typeof brokerages }>();
  for (const b of brokerages) {
    const key = b.clientId;
    if (!byClient.has(key)) {
      byClient.set(key, { name: b.client.name, rows: [] });
    }
    byClient.get(key)!.rows.push(b);
  }
  // Sort clients by name
  const clientGroups = Array.from(byClient.entries())
    .map(([id, g]) => ({ id, name: g.name, rows: g.rows }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Build the detail table — grouped by client with sub-totals
  const detailRows: string[] = [];
  let grandBase = 0;
  let grandBrokerage = 0;
  for (const group of clientGroups) {
    detailRows.push(
      `<tr class="group-header"><td colspan="9">${escapeHtml(group.name)} — ${group.rows.length} entr${group.rows.length === 1 ? "y" : "ies"}</td></tr>`,
    );
    let subBase = 0;
    let subBrokerage = 0;
    for (const b of group.rows) {
      subBase += b.baseAmount;
      subBrokerage += b.brokerageAmount;
      grandBase += b.baseAmount;
      grandBrokerage += b.brokerageAmount;
      detailRows.push(
        `<tr>
          <td>${escapeHtml(b.bill.billNumber)}</td>
          <td>${escapeHtml(b.client.name)}</td>
          <td>${escapeHtml(b.supplier.name)}</td>
          <td class="num">${fmtCurrency(b.baseAmount)}</td>
          <td class="num">${b.commissionRate.toFixed(1)}%</td>
          <td class="num emerald">${fmtCurrency(b.brokerageAmount)}</td>
          <td class="center">${eligiblePill(b.eligible, b.forceEligible)}</td>
          <td class="center">${statusPill(b.payoutStatus)}</td>
          <td>${fmtDate(b.eligibleAt)}</td>
        </tr>`,
      );
    }
    detailRows.push(
      `<tr class="sub-total">
        <td colspan="3">Sub-total — ${escapeHtml(group.name)}</td>
        <td class="num">${fmtCurrency(subBase)}</td>
        <td></td>
        <td class="num">${fmtCurrency(subBrokerage)}</td>
        <td colspan="3"></td>
      </tr>`,
    );
  }

  if (brokerages.length === 0) {
    detailRows.push(
      `<tr><td colspan="9" style="text-align:center;padding:24px;color:#a1a1aa;">No brokerage entries in this range.</td></tr>`,
    );
  }

  // Payout summary table
  const payoutRows = payouts.length
    ? payouts
        .map(
          (p) => `<tr>
        <td>${escapeHtml(p.client.name)}</td>
        <td class="center">${escapeHtml(titleCase(p.cadence))}</td>
        <td>${fmtDate(p.periodStart)}</td>
        <td>${fmtDate(p.periodEnd)}</td>
        <td class="num">${fmtCurrency(p.totalAmount)}</td>
        <td class="center">${statusPill(p.status)}</td>
        <td class="center">${p.paidAt ? fmtDate(p.paidAt) : "—"}</td>
        <td class="num">${p.brokerages.length}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="8" style="text-align:center;padding:24px;color:#a1a1aa;">No payouts in this range.</td></tr>`;

  const body = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total brokerage</div>
        <div class="kpi-value emerald">${fmtCurrency(totalBrokerage)}</div>
        <div class="kpi-sub">${brokerages.length} entries</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Eligible pending</div>
        <div class="kpi-value amber">${fmtCurrency(accruedTotal + scheduledTotal)}</div>
        <div class="kpi-sub">Accrued + scheduled</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Paid out</div>
        <div class="kpi-value emerald">${fmtCurrency(paidTotal)}</div>
        <div class="kpi-sub">${payouts.length} payout batches</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Not eligible</div>
        <div class="kpi-value rose">${fmtCurrency(pendingTotal)}</div>
        <div class="kpi-sub">${billsCount} bills</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Brokerage ledger — grouped by client</div>
      <div class="section-desc">All brokerage entries in the selected range. Sub-totals per client; grand total at the foot.</div>
      <table class="report">
        <thead>
          <tr>
            <th>Bill</th>
            <th>Client</th>
            <th>Supplier</th>
            <th class="num">Base (excl GST)</th>
            <th class="num">Comm %</th>
            <th class="num">Brokerage</th>
            <th class="center">Eligible</th>
            <th class="center">Payout</th>
            <th>Eligible At</th>
          </tr>
        </thead>
        <tbody>
          ${detailRows.join("")}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">Grand total</td>
            <td class="num">${fmtCurrency(grandBase)}</td>
            <td></td>
            <td class="num">${fmtCurrency(grandBrokerage)}</td>
            <td colspan="3"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="section section-break">
      <div class="section-title">Payout history</div>
      <div class="section-desc">Brokerage payout batches created in this range.</div>
      <table class="report">
        <thead>
          <tr>
            <th>Client</th>
            <th class="center">Cadence</th>
            <th>Period start</th>
            <th>Period end</th>
            <th class="num">Total paid</th>
            <th class="center">Status</th>
            <th class="center">Paid at</th>
            <th class="num"># Entries</th>
          </tr>
        </thead>
        <tbody>${payoutRows}</tbody>
      </table>
    </div>
  `;

  const footerNote = `
    <strong>Brokerage business rules.</strong>
    Brokerage is computed on the bill's base amount (PO value − short-shipment − returns), <em>excluding GST</em>.
    A brokerage entry stays <em>accrued</em> until the linked bill is fully paid — eligibility is granted only on full bill payment
    (or via a documented manual override). Eligible brokerages are batched into a payout following the client's cadence
    (immediate · 4-month cumulative · 12-month cumulative). Adjustments for short-shipments and resolved defective returns
    reduce the base amount <em>before</em> GST and brokerage are computed — never after.
  `;

  return htmlShell("Brokerage Statement", label, body, footerNote);
}

// ── Client ledger report ─────────────────────────────────────────────────────

async function buildClientLedger(brokerId: string, clientId: string): Promise<string> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    include: {
      bills: {
        include: {
          po: { select: { poNumber: true, supplier: { select: { name: true } } } },
          payments: { orderBy: { date: "desc" } },
          brokerage: true,
        },
        orderBy: { createdAt: "desc" },
      },
      brokerages: {
        include: {
          bill: { select: { billNumber: true } },
          supplier: { select: { name: true } },
          payout: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!client || client.brokerId !== brokerId) {
    return htmlShell("Client Not Found", "—",
      `<div style="padding:40px;text-align:center;color:#a1a1aa;">The requested client could not be found.</div>`);
  }

  // Build the ledger (bills + payments, running balance)
  type Ledger = { date: Date; type: string; ref: string; debit: number; credit: number; balance: number };
  const entries: Ledger[] = [];
  for (const bill of client.bills) {
    entries.push({ date: bill.createdAt, type: "Bill", ref: bill.billNumber, debit: bill.finalAmount, credit: 0, balance: 0 });
    for (const p of bill.payments) {
      entries.push({ date: p.date, type: "Payment", ref: p.reference || p.id.slice(-6), debit: 0, credit: p.amount, balance: 0 });
    }
  }
  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  let bal = 0;
  for (const e of entries) {
    bal += e.debit - e.credit;
    e.balance = bal;
  }
  // Reverse to show newest first
  entries.reverse();

  const totalBusiness = client.bills.reduce((s, b) => s + b.finalAmount, 0);
  const outstanding = client.bills.reduce((s, b) => s + (b.finalAmount - b.paidAmount), 0);
  const brokerageEarned = client.brokerages.filter((b) => b.eligible).reduce((s, b) => s + b.brokerageAmount, 0);
  const brokeragePaid = client.brokerages.filter((b) => b.payoutStatus === "paid").reduce((s, b) => s + b.brokerageAmount, 0);

  // PO delivery summary
  const pos = await db.purchaseOrder.findMany({
    where: { clientId },
    include: { dispatches: true, supplier: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const deliverySummary = pos.map((p) => {
    const dispatchedQty = p.dispatches.reduce((s, d) => s + d.dispatchedQty, 0);
    let orderedQty = 0;
    try {
      orderedQty = (JSON.parse(p.lineItemsJson) as { setQty: number }[]).reduce((s, i) => s + i.setQty, 0);
    } catch {
      orderedQty = 0;
    }
    return {
      poNumber: p.poNumber,
      status: p.status,
      ordered: p.totalValue,
      orderedQty,
      dispatchedQty,
      fulfillment: orderedQty ? Math.round((dispatchedQty / orderedQty) * 100) : 0,
      supplierName: p.supplier.name,
      expectedDispatchDate: p.expectedDispatchDate,
      revisedDispatchDate: p.revisedDispatchDate,
    };
  });

  const ledgerRows = entries.length
    ? entries
        .map(
          (e) => `<tr>
        <td>${fmtDate(e.date)}</td>
        <td>${escapeHtml(titleCase(e.type))}</td>
        <td>${escapeHtml(e.ref)}</td>
        <td class="num">${e.debit ? fmtCurrency(e.debit) : "—"}</td>
        <td class="num emerald">${e.credit ? fmtCurrency(e.credit) : "—"}</td>
        <td class="num">${fmtCurrency(e.balance)}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="6" style="text-align:center;padding:24px;color:#a1a1aa;">No ledger entries yet.</td></tr>`;

  const deliveryRows = deliverySummary.length
    ? deliverySummary
        .map(
          (d) => `<tr>
        <td>${escapeHtml(d.poNumber)}</td>
        <td>${escapeHtml(d.supplierName)}</td>
        <td class="center">${statusPill(d.status)}</td>
        <td class="num">${d.orderedQty}</td>
        <td class="num">${d.dispatchedQty}</td>
        <td class="num">${d.fulfillment}%</td>
        <td>${fmtDate(d.expectedDispatchDate)}</td>
        <td>${d.revisedDispatchDate ? fmtDate(d.revisedDispatchDate) : "—"}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="8" style="text-align:center;padding:24px;color:#a1a1aa;">No purchase orders yet.</td></tr>`;

  const brokerageRows = client.brokerages.length
    ? client.brokerages
        .map(
          (b) => `<tr>
        <td>${escapeHtml(b.bill.billNumber)}</td>
        <td>${escapeHtml(b.supplier.name)}</td>
        <td class="num">${fmtDate(b.createdAt)}</td>
        <td class="num">${b.commissionRate.toFixed(1)}%</td>
        <td class="num emerald">${fmtCurrency(b.brokerageAmount)}</td>
        <td class="center">${eligiblePill(b.eligible, b.forceEligible)}</td>
        <td class="center">${statusPill(b.payoutStatus)}</td>
        <td>${b.payout?.paidAt ? fmtDate(b.payout.paidAt) : "—"}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="8" style="text-align:center;padding:24px;color:#a1a1aa;">No brokerage entries.</td></tr>`;

  const rangeLabel = `All time · ${fmtDate(client.createdAt)} → ${fmtDate(new Date())}`;

  const body = `
    <div class="subject-card">
      <h2>${escapeHtml(client.name)}</h2>
      <div class="subject-meta">
        <div class="item"><div class="k">Contact</div><div class="v">${escapeHtml(client.contactPerson || "—")}</div></div>
        <div class="item"><div class="k">Phone</div><div class="v">${escapeHtml(client.phone || "—")}</div></div>
        <div class="item"><div class="k">Email</div><div class="v">${escapeHtml(client.email || "—")}</div></div>
        <div class="item"><div class="k">GST</div><div class="v">${escapeHtml(client.gstNo || "—")}</div></div>
        <div class="item"><div class="k">Payment cycle</div><div class="v">${client.defaultPaymentCycleDays} days</div></div>
        <div class="item"><div class="k">Payout cadence</div><div class="v">${escapeHtml(titleCase(client.payoutCadence))}</div></div>
        <div class="item"><div class="k">GST rate</div><div class="v">${client.gstRate}%</div></div>
        <div class="item"><div class="k">Client since</div><div class="v">${fmtDate(client.createdAt)}</div></div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total business</div>
        <div class="kpi-value">${fmtCurrency(totalBusiness)}</div>
        <div class="kpi-sub">${client.bills.length} bills</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Outstanding</div>
        <div class="kpi-value amber">${fmtCurrency(outstanding)}</div>
        <div class="kpi-sub">Pending receivable</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Brokerage earned</div>
        <div class="kpi-value emerald">${fmtCurrency(brokerageEarned)}</div>
        <div class="kpi-sub">Eligible entries</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Brokerage paid</div>
        <div class="kpi-value emerald">${fmtCurrency(brokeragePaid)}</div>
        <div class="kpi-sub">Settled via payouts</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Ledger — running balance</div>
      <div class="section-desc">Bills (debit) and payments (credit) in chronological order. Balance shown running.</div>
      <table class="report">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Reference</th>
            <th class="num">Debit</th>
            <th class="num">Credit</th>
            <th class="num">Balance</th>
          </tr>
        </thead>
        <tbody>${ledgerRows}</tbody>
      </table>
    </div>

    <div class="section section-break">
      <div class="section-title">PO delivery summary</div>
      <div class="section-desc">Purchase orders raised for this client, with dispatch fulfillment.</div>
      <table class="report">
        <thead>
          <tr>
            <th>PO Number</th>
            <th>Supplier</th>
            <th class="center">Status</th>
            <th class="num">Ordered (sets)</th>
            <th class="num">Dispatched</th>
            <th class="num">Fulfillment</th>
            <th>Expected</th>
            <th>Revised</th>
          </tr>
        </thead>
        <tbody>${deliveryRows}</tbody>
      </table>
    </div>

    <div class="section section-break">
      <div class="section-title">Brokerage entries</div>
      <div class="section-desc">All brokerage computed on this client's bills.</div>
      <table class="report">
        <thead>
          <tr>
            <th>Bill</th>
            <th>Supplier</th>
            <th class="num">Created</th>
            <th class="num">Comm %</th>
            <th class="num">Brokerage</th>
            <th class="center">Eligible</th>
            <th class="center">Payout</th>
            <th>Paid at</th>
          </tr>
        </thead>
        <tbody>${brokerageRows}</tbody>
      </table>
    </div>
  `;

  const footerNote = `
    <strong>Reporting basis.</strong>
    Ledger entries are presented in chronological order with a running balance. Outstanding receivable reflects unpaid bill
    balances as of the report generation time. Brokerage is computed on the bill base amount (excluding GST) and becomes
    eligible only on full payment of the linked bill.
  `;

  return htmlShell("Client Ledger Report", rangeLabel, body, footerNote);
}

// ── Supplier performance summary ─────────────────────────────────────────────

async function buildSupplierSummary(brokerId: string, supplierId: string): Promise<string> {
  const supplier = await db.supplier.findUnique({
    where: { id: supplierId },
    include: {
      bills: {
        include: {
          client: { select: { name: true } },
          po: { select: { poNumber: true } },
          brokerage: true,
          payments: { orderBy: { date: "desc" } },
        },
        orderBy: { createdAt: "desc" },
      },
      dispatches: {
        include: {
          po: {
            select: {
              poNumber: true, totalValue: true, lineItemsJson: true,
              expectedDispatchDate: true, revisedDispatchDate: true, status: true,
              client: { select: { name: true } },
            },
          },
        },
        orderBy: { dispatchDate: "desc" },
      },
      brokerages: {
        include: {
          bill: { select: { billNumber: true, baseAmount: true } },
          client: { select: { name: true } },
          payout: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!supplier || supplier.brokerId !== brokerId) {
    return htmlShell("Supplier Not Found", "—",
      `<div style="padding:40px;text-align:center;color:#a1a1aa;">The requested supplier could not be found.</div>`);
  }

  const totalSupplied = supplier.bills.reduce((s, b) => s + b.baseAmount, 0);
  const outstandingBrokerage = supplier.brokerages
    .filter((b) => b.eligible && b.payoutStatus !== "paid")
    .reduce((s, b) => s + b.brokerageAmount, 0);
  const paidBrokerage = supplier.brokerages
    .filter((b) => b.payoutStatus === "paid")
    .reduce((s, b) => s + b.brokerageAmount, 0);

  // Avg dispatch delay (days between expected & actual)
  const delays = supplier.dispatches
    .filter((d) => d.po.expectedDispatchDate)
    .map((d) => Math.round((d.dispatchDate.getTime() - d.po.expectedDispatchDate!.getTime()) / 86400000));
  const avgDispatchDelay = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;

  // Fulfillment %
  const totalOrderedQty = supplier.dispatches.reduce((s, d) => {
    let ordered = 0;
    try {
      ordered = (JSON.parse(d.po.lineItemsJson) as { setQty: number }[]).reduce((x, i) => x + i.setQty, 0);
    } catch {
      ordered = 0;
    }
    return s + ordered;
  }, 0);
  const totalDispatchedQty = supplier.dispatches.reduce((s, d) => s + d.dispatchedQty, 0);
  const fulfillment = totalOrderedQty ? Math.round((totalDispatchedQty / totalOrderedQty) * 100) : 0;
  const shortShipmentRate = supplier.dispatches.length
    ? Math.round((supplier.dispatches.filter((d) => d.status === "short_shipment").length / supplier.dispatches.length) * 100)
    : 0;

  // Bills table
  const billRows = supplier.bills.length
    ? supplier.bills
        .map(
          (b) => `<tr>
        <td>${escapeHtml(b.billNumber)}</td>
        <td>${escapeHtml(b.po.poNumber)}</td>
        <td>${escapeHtml(b.client.name)}</td>
        <td class="num">${fmtCurrency(b.baseAmount)}</td>
        <td class="num">${b.gstRate.toFixed(1)}%</td>
        <td class="num">${fmtCurrency(b.gstAmount)}</td>
        <td class="num">${fmtCurrency(b.finalAmount)}</td>
        <td class="num emerald">${fmtCurrency(b.paidAmount)}</td>
        <td class="num ${b.finalAmount - b.paidAmount > 0 ? "amber" : ""}">${fmtCurrency(b.finalAmount - b.paidAmount)}</td>
        <td class="center">${statusPill(b.status)}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="10" style="text-align:center;padding:24px;color:#a1a1aa;">No bills raised yet.</td></tr>`;

  // Dispatches table
  const dispatchRows = supplier.dispatches.length
    ? supplier.dispatches
        .map((d) => {
          let ordered = 0;
          try {
            ordered = (JSON.parse(d.po.lineItemsJson) as { setQty: number }[]).reduce((x, i) => x + i.setQty, 0);
          } catch {
            ordered = 0;
          }
          const pct = ordered ? Math.min(100, Math.round((d.dispatchedQty / ordered) * 100)) : 0;
          return `<tr>
            <td>${escapeHtml(d.po.poNumber)}</td>
            <td>${escapeHtml(d.po.client.name)}</td>
            <td>${fmtDate(d.dispatchDate)}</td>
            <td class="num">${d.dispatchedQty}</td>
            <td class="num">${ordered}</td>
            <td class="num">${pct}%</td>
            <td class="center">${statusPill(d.status)}</td>
            <td>${fmtDate(d.po.expectedDispatchDate)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="8" style="text-align:center;padding:24px;color:#a1a1aa;">No dispatches yet.</td></tr>`;

  // Brokerage table
  const brokerageRows = supplier.brokerages.length
    ? supplier.brokerages
        .map(
          (b) => `<tr>
        <td>${escapeHtml(b.bill.billNumber)}</td>
        <td>${escapeHtml(b.client.name)}</td>
        <td class="num">${fmtCurrency(b.baseAmount)}</td>
        <td class="num">${b.commissionRate.toFixed(1)}%</td>
        <td class="num emerald">${fmtCurrency(b.brokerageAmount)}</td>
        <td class="center">${eligiblePill(b.eligible, b.forceEligible)}</td>
        <td class="center">${statusPill(b.payoutStatus)}</td>
        <td>${b.payout?.paidAt ? fmtDate(b.payout.paidAt) : "—"}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="8" style="text-align:center;padding:24px;color:#a1a1aa;">No brokerage entries.</td></tr>`;

  const rangeLabel = `All time · ${fmtDate(supplier.createdAt)} → ${fmtDate(new Date())}`;

  const body = `
    <div class="subject-card">
      <h2>${escapeHtml(supplier.name)}</h2>
      <div class="subject-meta">
        <div class="item"><div class="k">Contact</div><div class="v">${escapeHtml(supplier.contactPerson || "—")}</div></div>
        <div class="item"><div class="k">Phone</div><div class="v">${escapeHtml(supplier.phone || "—")}</div></div>
        <div class="item"><div class="k">Email</div><div class="v">${escapeHtml(supplier.email || "—")}</div></div>
        <div class="item"><div class="k">GST</div><div class="v">${escapeHtml(supplier.gstNo || "—")}</div></div>
        <div class="item"><div class="k">Commission rate</div><div class="v">${supplier.defaultCommissionRate}%</div></div>
        <div class="item"><div class="k">GST rate</div><div class="v">${supplier.defaultGstRate}%</div></div>
        <div class="item"><div class="k">Bills</div><div class="v">${supplier.bills.length}</div></div>
        <div class="item"><div class="k">Dispatches</div><div class="v">${supplier.dispatches.length}</div></div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total supplied</div>
        <div class="kpi-value">${fmtCurrency(totalSupplied)}</div>
        <div class="kpi-sub">Base amount (excl GST)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Outstanding brokerage</div>
        <div class="kpi-value amber">${fmtCurrency(outstandingBrokerage)}</div>
        <div class="kpi-sub">Eligible, unpaid</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Paid brokerage</div>
        <div class="kpi-value emerald">${fmtCurrency(paidBrokerage)}</div>
        <div class="kpi-sub">Settled via payouts</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Avg dispatch delay</div>
        <div class="kpi-value ${avgDispatchDelay > 0 ? "amber" : "emerald"}">${avgDispatchDelay >= 0 ? "+" : ""}${avgDispatchDelay} d</div>
        <div class="kpi-sub">${delays.length} dispatches measured</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Fulfillment</div>
        <div class="kpi-value ${fulfillment >= 90 ? "emerald" : fulfillment >= 70 ? "amber" : "rose"}">${fulfillment}%</div>
        <div class="kpi-sub">${totalDispatchedQty} / ${totalOrderedQty} sets</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Short-shipment rate</div>
        <div class="kpi-value ${shortShipmentRate === 0 ? "emerald" : shortShipmentRate <= 10 ? "amber" : "rose"}">${shortShipmentRate}%</div>
        <div class="kpi-sub">Of ${supplier.dispatches.length} dispatches</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Bills</div>
        <div class="kpi-value">${supplier.bills.length}</div>
        <div class="kpi-sub">Total raised</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Dispatches</div>
        <div class="kpi-value">${supplier.dispatches.length}</div>
        <div class="kpi-sub">Total shipped</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Bills raised</div>
      <div class="section-desc">All bills raised against this supplier's POs.</div>
      <table class="report">
        <thead>
          <tr>
            <th>Bill</th>
            <th>PO</th>
            <th>Client</th>
            <th class="num">Base</th>
            <th class="num">GST %</th>
            <th class="num">GST</th>
            <th class="num">Final</th>
            <th class="num">Paid</th>
            <th class="num">Due</th>
            <th class="center">Status</th>
          </tr>
        </thead>
        <tbody>${billRows}</tbody>
      </table>
    </div>

    <div class="section section-break">
      <div class="section-title">Dispatches</div>
      <div class="section-desc">All dispatches from this supplier, with fulfillment against ordered quantity.</div>
      <table class="report">
        <thead>
          <tr>
            <th>PO</th>
            <th>Client</th>
            <th>Dispatch date</th>
            <th class="num">Dispatched</th>
            <th class="num">Ordered</th>
            <th class="num">Fulfillment</th>
            <th class="center">Status</th>
            <th>Expected</th>
          </tr>
        </thead>
        <tbody>${dispatchRows}</tbody>
      </table>
    </div>

    <div class="section section-break">
      <div class="section-title">Brokerage entries</div>
      <div class="section-desc">Brokerage computed on this supplier's bills.</div>
      <table class="report">
        <thead>
          <tr>
            <th>Bill</th>
            <th>Client</th>
            <th class="num">Base</th>
            <th class="num">Comm %</th>
            <th class="num">Brokerage</th>
            <th class="center">Eligible</th>
            <th class="center">Payout</th>
            <th>Paid at</th>
          </tr>
        </thead>
        <tbody>${brokerageRows}</tbody>
      </table>
    </div>
  `;

  const footerNote = `
    <strong>Performance basis.</strong>
    Fulfillment % is computed as total dispatched quantity ÷ total ordered quantity across all POs. Short-shipment rate is
    the share of dispatches marked as <em>short_shipment</em>. Average dispatch delay is the mean of (actual dispatch date −
    expected dispatch date) in days — a positive number means dispatches are typically late. Brokerage is computed on the
    bill base amount (excluding GST) and becomes eligible only on full payment of the linked bill.
  `;

  return htmlShell("Supplier Performance Summary", rangeLabel, body, footerNote);
}

// ── Purchase Order (supplier-facing document) ────────────────────────────────

async function buildPurchaseOrder(brokerId: string, poId: string): Promise<string> {
  const po = await db.purchaseOrder.findUnique({
    where: { id: poId },
    include: {
      client: true,
      supplier: true,
      booking: { include: { visit: true } },
    },
  });
  if (!po || po.brokerId !== brokerId) {
    return htmlShell("Purchase Order", "—",
      `<div style="padding:40px;text-align:center;color:#71717a;">Purchase Order not found.</div>`);
  }

  const lineItems = (typeof po.lineItemsJson === "string" ? JSON.parse(po.lineItemsJson) : []) as
    { styleName: string; color?: string | null; setQty: number; unitPrice: number; lineTotal: number }[];

  // Buyer (client) details
  const buyer = po.client;
  const supplier = po.supplier;
  const visit = po.booking?.visit;

  const lineItemsRows = lineItems.map((li, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${escapeHtml(li.styleName)}</td>
      <td>${escapeHtml(li.color || "—")}</td>
      <td class="num">${li.setQty}</td>
      <td class="num">${fmtCurrency(li.unitPrice)}</td>
      <td class="num">${fmtCurrency(li.lineTotal)}</td>
    </tr>`).join("");

  const gstAmount = Math.round(po.totalValue * (po.gstRate / 100));
  const grandTotal = po.totalValue + gstAmount;

  const body = `
    <div class="po-doc-header">
      <div class="po-title-block">
        <h1>PURCHASE ORDER</h1>
        <div class="po-number">PO No: <strong>${escapeHtml(po.poNumber)}</strong></div>
        <div class="po-date">Date: ${fmtDate(po.createdAt)}</div>
      </div>
      <div class="po-status-badge status-${escapeHtml(po.status)}">${titleCase(po.status).toUpperCase()}</div>
    </div>

    <div class="party-grid">
      <div class="party-card">
        <div class="party-label">From (Broker)</div>
        <div class="party-name">Broker OS</div>
        <div class="party-detail">Garment Brokerage Services</div>
        <div class="party-detail">Surat Textile Market, Gujarat</div>
      </div>
      <div class="party-card">
        <div class="party-label">Supplier (Ship Goods To Order)</div>
        <div class="party-name">${escapeHtml(supplier.name)}</div>
        ${supplier.contactPerson ? `<div class="party-detail">${escapeHtml(supplier.contactPerson)}</div>` : ""}
        ${supplier.phone ? `<div class="party-detail">Ph: ${escapeHtml(supplier.phone)}</div>` : ""}
        ${supplier.email ? `<div class="party-detail">${escapeHtml(supplier.email)}</div>` : ""}
        ${supplier.address ? `<div class="party-detail">${escapeHtml(supplier.address)}</div>` : ""}
        ${supplier.gstNo ? `<div class="party-detail">GST: ${escapeHtml(supplier.gstNo)}</div>` : ""}
      </div>
      <div class="party-card">
        <div class="party-label">Buyer (Bill To)</div>
        <div class="party-name">${escapeHtml(buyer.name)}</div>
        ${buyer.contactPerson ? `<div class="party-detail">${escapeHtml(buyer.contactPerson)}</div>` : ""}
        ${buyer.phone ? `<div class="party-detail">Ph: ${escapeHtml(buyer.phone)}</div>` : ""}
        ${buyer.email ? `<div class="party-detail">${escapeHtml(buyer.email)}</div>` : ""}
        ${buyer.address ? `<div class="party-detail">${escapeHtml(buyer.address)}</div>` : ""}
        ${buyer.gstNo ? `<div class="party-detail">GST: ${escapeHtml(buyer.gstNo)}</div>` : ""}
      </div>
    </div>

    ${visit ? `
    <div class="dispatch-info">
      <div class="info-label">Visit Reference</div>
      <div class="info-value">Visit on ${fmtDate(visit.actualDate || visit.plannedDate)} — ${escapeHtml(visit.notes || "On-spot booking")}</div>
    </div>` : ""}

    <div class="dispatch-info">
      <div class="info-label">Expected Dispatch Date</div>
      <div class="info-value"><strong>${fmtDate(po.revisedDispatchDate || po.expectedDispatchDate)}</strong>${po.revisedDispatchDate ? " <span class='revised-tag'>(revised)</span>" : ""}</div>
      <div class="info-label" style="margin-top:8px">Commission Rate</div>
      <div class="info-value">${po.commissionRate}% (brokerage from supplier)</div>
    </div>

    <h2 class="section-title">Order Details</h2>
    <table class="line-items">
      <thead>
        <tr>
          <th class="num">#</th>
          <th>Style / Product Name</th>
          <th>Color</th>
          <th class="num">Sets (Qty)</th>
          <th class="num">Unit Price</th>
          <th class="num">Line Total</th>
        </tr>
      </thead>
      <tbody>
        ${lineItemsRows}
      </tbody>
      <tfoot>
        <tr class="subtotal-row">
          <td colspan="5" class="num">Subtotal (excl. GST)</td>
          <td class="num">${fmtCurrency(po.totalValue)}</td>
        </tr>
        <tr>
          <td colspan="5" class="num">GST @ ${po.gstRate}%</td>
          <td class="num">${fmtCurrency(gstAmount)}</td>
        </tr>
        <tr class="grand-total-row">
          <td colspan="5" class="num">Grand Total</td>
          <td class="num">${fmtCurrency(grandTotal)}</td>
        </tr>
      </tfoot>
    </table>

    <div class="dispatch-instructions">
      <h3>Dispatch Instructions</h3>
      <ol>
        <li>Please dispatch the goods to the buyer's address mentioned above.</li>
        <li>Ensure all items match the quantities specified. Any shortfall must be communicated immediately.</li>
        <li>Attach a copy of this Purchase Order with the shipment.</li>
        <li>Notify the broker once dispatched with the dispatch date and transport details.</li>
        <li>Goods must reach the buyer by <strong>${fmtDate(po.revisedDispatchDate || po.expectedDispatchDate)}</strong>.</li>
      </ol>
    </div>

    <div class="signature-grid">
      <div class="signature-block">
        <div class="sig-label">Authorized by (Broker)</div>
        <div class="sig-line"></div>
        <div class="sig-name">Broker OS Representative</div>
      </div>
      <div class="signature-block">
        <div class="sig-label">Acknowledged by (Supplier)</div>
        <div class="sig-line"></div>
        <div class="sig-name">${escapeHtml(supplier.name)}</div>
      </div>
    </div>
  `;

  const footerNote = "This is a system-generated Purchase Order from Broker OS. Brokerage commission (" +
    po.commissionRate + "%) is payable to the broker on the base amount (excl. GST) after the buyer's full payment is received.";

  return htmlShell("Purchase Order — " + po.poNumber, `Generated ${fmtDateTime(new Date())}`, body, footerNote);
}

// ── Party ledger report (universal — client or supplier) ─────────────────────
//
// GET /api/reports?type=party-ledger&partyType=<client|supplier>&partyId=<id>
//
// Reuses the same data shape as /api/party-ledger but renders a
// print-optimized HTML document (party header + stats + ledger table) suitable
// for "Save as PDF" via the browser's print dialog.

async function buildPartyLedger(brokerId: string, partyType: string, partyId: string): Promise<string> {
  if (partyType !== "client" && partyType !== "supplier") {
    return htmlShell("Party Ledger Report", "—",
      `<div style="padding:40px;text-align:center;color:#a1a1aa;">partyType must be "client" or "supplier".</div>`);
  }

  // Fetch the party record + ledger timeline via the same logic as the API
  // route, inlined here to keep report rendering self-contained.
  type LedgerEntryType = "bill" | "payment" | "po" | "dispatch" | "dispute";
  type LedgerEntry = {
    date: string;
    type: LedgerEntryType;
    ref: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
    meta?: Record<string, string | number | null> | undefined;
  };

  let partyName = "Unknown";
  let contactInfo = {
    contactPerson: null as string | null,
    phone: null as string | null,
    email: null as string | null,
    address: null as string | null,
    gstNo: null as string | null,
  };
  let ledger: LedgerEntry[] = [];
  let stats: Record<string, number> = {};

  if (partyType === "client") {
    const client = await db.client.findUnique({
      where: { id: partyId },
      select: {
        id: true, name: true, contactPerson: true, phone: true, email: true, address: true, gstNo: true, brokerId: true,
      },
    });
    if (!client || client.brokerId !== brokerId) {
      return htmlShell("Party Ledger Report", "—",
        `<div style="padding:40px;text-align:center;color:#a1a1aa;">The requested client could not be found.</div>`);
    }
    partyName = client.name;
    contactInfo = {
      contactPerson: client.contactPerson,
      phone: client.phone,
      email: client.email,
      address: client.address,
      gstNo: client.gstNo,
    };

    const [bills, pos, dispatches, disputes] = await Promise.all([
      db.bill.findMany({
        where: { brokerId, clientId: partyId },
        include: { po: { select: { poNumber: true } }, payments: true },
        orderBy: { createdAt: "asc" },
      }),
      db.purchaseOrder.findMany({
        where: { brokerId, clientId: partyId },
        select: { poNumber: true, totalValue: true, status: true, createdAt: true, supplier: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      db.dispatch.findMany({
        where: { brokerId, po: { clientId: partyId } },
        select: { dispatchDate: true, dispatchedQty: true, status: true, po: { select: { poNumber: true } } },
        orderBy: { dispatchDate: "asc" },
      }),
      db.dispute.findMany({
        where: { brokerId, po: { clientId: partyId } },
        select: { type: true, description: true, valueAffected: true, status: true, createdAt: true, po: { select: { poNumber: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    for (const b of bills) {
      ledger.push({
        date: b.createdAt.toISOString(), type: "bill", ref: b.billNumber,
        description: `Bill ${b.billNumber} raised for ${b.po.poNumber}`,
        debit: b.finalAmount, credit: 0, balance: 0,
      });
      for (const p of b.payments) {
        ledger.push({
          date: p.date.toISOString(), type: "payment", ref: p.reference || p.id.slice(-6),
          description: `Payment received via ${titleCase(p.mode)}`,
          debit: 0, credit: p.amount, balance: 0,
        });
      }
    }
    for (const p of pos) {
      ledger.push({
        date: p.createdAt.toISOString(), type: "po", ref: p.poNumber,
        description: `PO placed with ${p.supplier.name}`,
        debit: p.totalValue, credit: 0, balance: 0,
      });
    }
    for (const d of dispatches) {
      ledger.push({
        date: d.dispatchDate.toISOString(), type: "dispatch", ref: d.po.poNumber,
        description: `Dispatch of ${d.dispatchedQty} sets`,
        debit: 0, credit: 0, balance: 0,
      });
    }
    for (const d of disputes) {
      ledger.push({
        date: d.createdAt.toISOString(), type: "dispute", ref: d.po.poNumber,
        description: `${titleCase(d.type)} dispute${d.description ? ` — ${d.description}` : ""}`,
        debit: 0, credit: 0, balance: 0,
      });
    }

    // Running balance, oldest-first; then reverse for newest-first display.
    ledger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let bal = 0;
    for (const e of ledger) { bal += e.debit - e.credit; e.balance = bal; }
    ledger.reverse();

    const totalBusiness = bills.reduce((s, b) => s + b.finalAmount, 0);
    const totalReceived = bills.reduce((s, b) => s + b.payments.reduce((sp, p) => sp + p.amount, 0), 0);
    stats = {
      totalBusiness,
      totalReceived,
      totalPayable: totalBusiness - totalReceived,
      balance: totalBusiness - totalReceived,
    };
  } else {
    const supplier = await db.supplier.findUnique({
      where: { id: partyId },
      select: {
        id: true, name: true, contactPerson: true, phone: true, email: true, address: true, gstNo: true, brokerId: true,
      },
    });
    if (!supplier || supplier.brokerId !== brokerId) {
      return htmlShell("Party Ledger Report", "—",
        `<div style="padding:40px;text-align:center;color:#a1a1aa;">The requested supplier could not be found.</div>`);
    }
    partyName = supplier.name;
    contactInfo = {
      contactPerson: supplier.contactPerson,
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.address,
      gstNo: supplier.gstNo,
    };

    const [bills, pos, dispatches, disputes, brokerages] = await Promise.all([
      db.bill.findMany({
        where: { brokerId, supplierId: partyId },
        include: { po: { select: { poNumber: true } }, client: { select: { name: true } }, payments: true },
        orderBy: { createdAt: "asc" },
      }),
      db.purchaseOrder.findMany({
        where: { brokerId, supplierId: partyId },
        select: { poNumber: true, totalValue: true, status: true, createdAt: true, client: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      db.dispatch.findMany({
        where: { brokerId, supplierId: partyId },
        select: { dispatchDate: true, dispatchedQty: true, status: true, po: { select: { poNumber: true, client: { select: { name: true } } } } },
        orderBy: { dispatchDate: "asc" },
      }),
      db.dispute.findMany({
        where: { brokerId, po: { supplierId: partyId } },
        select: { type: true, description: true, valueAffected: true, status: true, createdAt: true, po: { select: { poNumber: true } } },
        orderBy: { createdAt: "asc" },
      }),
      db.brokerage.findMany({
        where: { brokerId, supplierId: partyId },
        select: { brokerageAmount: true, commissionRate: true, eligible: true, payoutStatus: true, createdAt: true, bill: { select: { billNumber: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    for (const b of bills) {
      ledger.push({
        date: b.createdAt.toISOString(), type: "bill", ref: b.billNumber,
        description: `Bill ${b.billNumber} raised for ${b.po.poNumber} (${b.client.name})`,
        debit: b.baseAmount, credit: 0, balance: 0,
      });
      const br = brokerages.find((x) => x.bill.billNumber === b.billNumber);
      if (br) {
        ledger.push({
          date: br.createdAt.toISOString(), type: "payment", ref: `BRK-${br.bill.billNumber}`,
          description: `Brokerage @ ${br.commissionRate.toFixed(1)}% accrued`,
          debit: 0, credit: br.brokerageAmount, balance: 0,
        });
      }
      for (const p of b.payments) {
        ledger.push({
          date: p.date.toISOString(), type: "payment", ref: p.reference || p.id.slice(-6),
          description: `Payment received via ${titleCase(p.mode)}`,
          debit: 0, credit: p.amount, balance: 0,
        });
      }
    }
    for (const p of pos) {
      ledger.push({
        date: p.createdAt.toISOString(), type: "po", ref: p.poNumber,
        description: `PO placed by ${p.client.name}`,
        debit: p.totalValue, credit: 0, balance: 0,
      });
    }
    for (const d of dispatches) {
      ledger.push({
        date: d.dispatchDate.toISOString(), type: "dispatch", ref: d.po.poNumber,
        description: `Dispatch of ${d.dispatchedQty} sets for ${d.po.client.name}`,
        debit: 0, credit: 0, balance: 0,
      });
    }
    for (const d of disputes) {
      ledger.push({
        date: d.createdAt.toISOString(), type: "dispute", ref: d.po.poNumber,
        description: `${titleCase(d.type)} dispute${d.description ? ` — ${d.description}` : ""}`,
        debit: 0, credit: 0, balance: 0,
      });
    }

    ledger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let bal = 0;
    for (const e of ledger) { bal += e.debit - e.credit; e.balance = bal; }
    ledger.reverse();

    const totalSupplied = bills.reduce((s, b) => s + b.baseAmount, 0);
    const totalBrokerage = brokerages.reduce((s, b) => s + b.brokerageAmount, 0);
    const outstandingBrokerage = brokerages
      .filter((b) => b.eligible && b.payoutStatus !== "paid")
      .reduce((s, b) => s + b.brokerageAmount, 0);
    const paidBrokerage = brokerages
      .filter((b) => b.payoutStatus === "paid")
      .reduce((s, b) => s + b.brokerageAmount, 0);
    stats = { totalSupplied, totalBrokerage, outstandingBrokerage, paidBrokerage };
  }

  // KPI grid — 4 cards, labels depend on party type.
  const kpiCards = partyType === "client"
    ? `<div class="kpi-card"><div class="kpi-label">Total business</div><div class="kpi-value">${fmtCurrency(stats.totalBusiness ?? 0)}</div><div class="kpi-sub">All bills raised</div></div>
       <div class="kpi-card"><div class="kpi-label">Total received</div><div class="kpi-value emerald">${fmtCurrency(stats.totalReceived ?? 0)}</div><div class="kpi-sub">All payments</div></div>
       <div class="kpi-card"><div class="kpi-label">Outstanding</div><div class="kpi-value amber">${fmtCurrency(stats.totalPayable ?? 0)}</div><div class="kpi-sub">Pending receivable</div></div>
       <div class="kpi-card"><div class="kpi-label">Balance</div><div class="kpi-value ${Number(stats.balance ?? 0) > 0 ? "rose" : "emerald"}">${fmtCurrency(stats.balance ?? 0)}</div><div class="kpi-sub">Final outstanding</div></div>`
    : `<div class="kpi-card"><div class="kpi-label">Total supplied</div><div class="kpi-value">${fmtCurrency(stats.totalSupplied ?? 0)}</div><div class="kpi-sub">Base (excl GST)</div></div>
       <div class="kpi-card"><div class="kpi-label">Total brokerage</div><div class="kpi-value emerald">${fmtCurrency(stats.totalBrokerage ?? 0)}</div><div class="kpi-sub">Commission earned</div></div>
       <div class="kpi-card"><div class="kpi-label">Outstanding brokerage</div><div class="kpi-value amber">${fmtCurrency(stats.outstandingBrokerage ?? 0)}</div><div class="kpi-sub">Eligible, unpaid</div></div>
       <div class="kpi-card"><div class="kpi-label">Paid brokerage</div><div class="kpi-value emerald">${fmtCurrency(stats.paidBrokerage ?? 0)}</div><div class="kpi-sub">Settled via payouts</div></div>`;

  // Ledger table rows.
  const ledgerRows = ledger.length
    ? ledger.map((e) => `<tr>
        <td>${fmtDate(e.date)}</td>
        <td>${escapeHtml(titleCase(e.type))}</td>
        <td>${escapeHtml(e.ref)}</td>
        <td>${escapeHtml(e.description)}</td>
        <td class="num">${e.debit ? fmtCurrency(e.debit) : "—"}</td>
        <td class="num emerald">${e.credit ? fmtCurrency(e.credit) : "—"}</td>
        <td class="num">${fmtCurrency(e.balance)}</td>
      </tr>`).join("")
    : `<tr><td colspan="7" style="text-align:center;padding:24px;color:#a1a1aa;">No ledger entries yet.</td></tr>`;

  const rangeLabel = `All time · Generated ${fmtDateTime(new Date())}`;

  const body = `
    <div class="subject-card">
      <h2>${escapeHtml(partyName)}</h2>
      <div class="subject-meta">
        <div class="item"><div class="k">Type</div><div class="v">${partyType === "client" ? "Client" : "Supplier"}</div></div>
        <div class="item"><div class="k">Contact</div><div class="v">${escapeHtml(contactInfo.contactPerson || "—")}</div></div>
        <div class="item"><div class="k">Phone</div><div class="v">${escapeHtml(contactInfo.phone || "—")}</div></div>
        <div class="item"><div class="k">Email</div><div class="v">${escapeHtml(contactInfo.email || "—")}</div></div>
        <div class="item"><div class="k">Address</div><div class="v">${escapeHtml(contactInfo.address || "—")}</div></div>
        <div class="item"><div class="k">GST</div><div class="v">${escapeHtml(contactInfo.gstNo || "—")}</div></div>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCards}
    </div>

    <div class="section">
      <div class="section-title">Ledger — running balance</div>
      <div class="section-desc">Bills & POs (debit), payments & brokerage (credit), dispatches & disputes (info-only). Sorted newest first.</div>
      <table class="report">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Reference</th>
            <th>Description</th>
            <th class="num">Debit</th>
            <th class="num">Credit</th>
            <th class="num">Balance</th>
          </tr>
        </thead>
        <tbody>${ledgerRows}</tbody>
      </table>
    </div>
  `;

  const footerNote = `
    <strong>Reporting basis.</strong>
    This is a unified party ledger — every financial and operational event for the chosen ${partyType === "client" ? "client" : "supplier"} is presented as a single chronological timeline.
    Running balance is computed forward from the oldest entry as (debit − credit).
    ${partyType === "client"
      ? "For clients, debit = bills raised + POs placed; credit = payments received."
      : "For suppliers, debit = bills (what the supplier is owed) + POs placed; credit = brokerage accrued + payments received (which flow through to the supplier)."}
    Dispatches and disputes are info-only — they don't carry a debit/credit but are included so the broker has a single end-to-end view.
  `;

  return htmlShell("Party Ledger Report", rangeLabel, body, footerNote);
}

// ── Audit trail report ───────────────────────────────────────────────────────

// Maps an action string to a print-safe pill color (matches UI tone mapping).
function auditActionPill(action: string): string {
  const a = action.toLowerCase();
  if (a === "create" || a === "payout") {
    return `<span class="pill emerald">${escapeHtml(titleCase(action))}</span>`;
  }
  if (a === "update") {
    return `<span class="pill amber">${escapeHtml(titleCase(action))}</span>`;
  }
  if (a === "delete") {
    return `<span class="pill rose">${escapeHtml(titleCase(action))}</span>`;
  }
  if (a === "force_eligible") {
    return `<span class="pill emerald" style="background:#f0fdfa;color:#0f766e;border-color:#99f6e4;">${escapeHtml(titleCase(action))}</span>`;
  }
  return `<span class="pill zinc">${escapeHtml(titleCase(action))}</span>`;
}

async function buildAuditTrail(brokerId: string, params: URLSearchParams): Promise<string> {
  const entityType = params.get("entityType")?.trim();
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

  const [logs, byActionAgg, byEntityAgg, minMax] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    db.auditLog.groupBy({ by: ["action"], where, _count: { _all: true } }),
    db.auditLog.groupBy({ by: ["entityType"], where, _count: { _all: true } }),
    db.auditLog.aggregate({
      where,
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
  ]);

  const byAction: Record<string, number> = {};
  for (const g of byActionAgg) byAction[g.action] = g._count._all;
  const byEntity: Record<string, number> = {};
  for (const g of byEntityAgg) byEntity[g.entityType] = g._count._all;

  const total = logs.length;
  const earliest = minMax._min.createdAt;
  const latest = minMax._max.createdAt;

  // Build the date-range label shown in the report header.
  let rangeLabel: string;
  if (range.gte && range.lte) {
    rangeLabel = `${fmtDate(range.gte)} → ${fmtDate(range.lte)}`;
  } else if (range.gte) {
    rangeLabel = `From ${fmtDate(range.gte)}`;
  } else if (range.lte) {
    rangeLabel = `Up to ${fmtDate(range.lte)}`;
  } else {
    rangeLabel = "All time";
  }
  if (entityType) {
    rangeLabel += ` · ${entityType} only`;
  }

  // KPI grid: total + per-action counts
  const createCount = byAction["create"] ?? 0;
  const updateCount = byAction["update"] ?? 0;
  const deleteCount = byAction["delete"] ?? 0;
  const forceCount = byAction["force_eligible"] ?? 0;
  const payoutCount = byAction["payout"] ?? 0;

  // Action breakdown list (all actions observed, sorted by count desc)
  const actionRows = Object.entries(byAction)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([action, n]) =>
        `<tr><td>${auditActionPill(action)}</td><td class="num">${n}</td><td class="num">${total ? Math.round((n / total) * 100) : 0}%</td></tr>`,
    )
    .join("") ||
    `<tr><td colspan="3" style="text-align:center;padding:24px;color:#a1a1aa;">No entries.</td></tr>`;

  const entityRows = Object.entries(byEntity)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([entity, n]) =>
        `<tr><td>${escapeHtml(titleCase(entity))}</td><td class="num">${n}</td><td class="num">${total ? Math.round((n / total) * 100) : 0}%</td></tr>`,
    )
    .join("") ||
    `<tr><td colspan="3" style="text-align:center;padding:24px;color:#a1a1aa;">No entries.</td></tr>`;

  // Detail table — page break every 50 rows via a wrapper div with class
  // `section-break` on every 50th row group. Simpler approach: insert a
  // page-break row class on every 50th row.
  const PAGE_SIZE = 50;
  const detailRows = logs.length
    ? logs
        .map((l, i) => {
          const breakClass = i > 0 && i % PAGE_SIZE === 0 ? "page-break-row" : "";
          return `<tr class="${breakClass}">
            <td class="nowrap">${escapeHtml(fmtDateTime(l.createdAt))}</td>
            <td>${escapeHtml(l.userName ?? "System")}</td>
            <td>${escapeHtml(titleCase(l.entityType))}</td>
            <td>${auditActionPill(l.action)}</td>
            <td>${escapeHtml(l.reason ?? "—")}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" style="text-align:center;padding:24px;color:#a1a1aa;">No audit entries match these filters.</td></tr>`;

  const body = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total entries</div>
        <div class="kpi-value">${total}</div>
        <div class="kpi-sub">${range.gte || range.lte ? "In selected range" : "All time"}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Created</div>
        <div class="kpi-value emerald">${createCount}</div>
        <div class="kpi-sub">New records</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Updated</div>
        <div class="kpi-value amber">${updateCount}</div>
        <div class="kpi-sub">Field edits</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Deleted</div>
        <div class="kpi-value rose">${deleteCount}</div>
        <div class="kpi-sub">Removals</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Force-eligible</div>
        <div class="kpi-value" style="color:#0f766e;">${forceCount}</div>
        <div class="kpi-sub">Manual overrides</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Payouts</div>
        <div class="kpi-value emerald">${payoutCount}</div>
        <div class="kpi-sub">Brokerage settled</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">First entry</div>
        <div class="kpi-value" style="font-size:13px;">${earliest ? escapeHtml(fmtDate(earliest)) : "—"}</div>
        <div class="kpi-sub">${earliest ? escapeHtml(fmtDateTime(earliest)) : ""}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Latest entry</div>
        <div class="kpi-value" style="font-size:13px;">${latest ? escapeHtml(fmtDate(latest)) : "—"}</div>
        <div class="kpi-sub">${latest ? escapeHtml(fmtDateTime(latest)) : ""}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Breakdown by action</div>
      <table class="report">
        <thead>
          <tr><th>Action</th><th class="num">Count</th><th class="num">Share</th></tr>
        </thead>
        <tbody>${actionRows}</tbody>
      </table>
    </div>

    <div class="section section-break">
      <div class="section-title">Breakdown by entity type</div>
      <table class="report">
        <thead>
          <tr><th>Entity</th><th class="num">Count</th><th class="num">Share</th></tr>
        </thead>
        <tbody>${entityRows}</tbody>
      </table>
    </div>

    <div class="section section-break">
      <div class="section-title">Audit entries</div>
      <div class="section-desc">Every financial mutation is recorded below. Page breaks every ${PAGE_SIZE} entries.</div>
      <table class="report">
        <thead>
          <tr>
            <th>Time</th>
            <th>User</th>
            <th>Entity</th>
            <th>Action</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>${detailRows}</tbody>
      </table>
    </div>
  `;

  const footerNote =
    "Immutable append-only log. Every financial mutation is recorded for dispute resolution and compliance.";

  return htmlShell(REPORT_TITLES["audit-trail"], rangeLabel, body, footerNote);
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const typeParam = (searchParams.get("type") ?? "").toLowerCase() as ReportType;
  if (!VALID_TYPES.includes(typeParam)) {
    return NextResponse.json(
      { error: `Invalid report type. Valid: ${VALID_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    let html: string;
    if (typeParam === "brokerage-statement") {
      const rawRange = (searchParams.get("range") ?? "all").toLowerCase() as Range;
      const range: Range = VALID_RANGES.includes(rawRange) ? rawRange : "all";
      html = await buildBrokerageStatement(broker.id, range);
    } else if (typeParam === "client-ledger") {
      const clientId = searchParams.get("clientId");
      if (!clientId) {
        return NextResponse.json({ error: "clientId is required for client-ledger report" }, { status: 400 });
      }
      html = await buildClientLedger(broker.id, clientId);
    } else if (typeParam === "supplier-summary") {
      const supplierId = searchParams.get("supplierId");
      if (!supplierId) {
        return NextResponse.json({ error: "supplierId is required for supplier-summary report" }, { status: 400 });
      }
      html = await buildSupplierSummary(broker.id, supplierId);
    } else if (typeParam === "purchase-order") {
      const poId = searchParams.get("poId");
      if (!poId) {
        return NextResponse.json({ error: "poId is required for purchase-order report" }, { status: 400 });
      }
      html = await buildPurchaseOrder(broker.id, poId);
    } else if (typeParam === "party-ledger") {
      const partyType = (searchParams.get("partyType") ?? "").toLowerCase();
      const partyId = searchParams.get("partyId");
      if (partyType !== "client" && partyType !== "supplier") {
        return NextResponse.json({ error: "partyType must be 'client' or 'supplier' for party-ledger report" }, { status: 400 });
      }
      if (!partyId) {
        return NextResponse.json({ error: "partyId is required for party-ledger report" }, { status: 400 });
      }
      html = await buildPartyLedger(broker.id, partyType, partyId);
    } else {
      // audit-trail
      html = await buildAuditTrail(broker.id, searchParams);
    }

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Report failed: ${message}` }, { status: 500 });
  }
}
