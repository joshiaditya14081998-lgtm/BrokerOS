import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidEntityType, type TagEntityType } from "@/lib/tags";
import { getCurrentBroker } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics — combined analytics view: supplier reliability,
// client credit exposure, brokerage forecast, business volume trends,
// and a deep forecasting section (6-mo brokerage with confidence interval,
// 12-mo seasonal trend analysis, client order velocity, supplier capacity).
//
// Optional query params:
//   ?tagId=X                  — filter all sections to entities tagged with X.
//   &entityType=Client|Supplier|PurchaseOrder
//                             — only filter that entity type; the other two
//                               remain unfiltered. If omitted, the tag filter
//                               applies to all three entity types.
//
// When a tag filter is active, the response includes `appliedFilter`
// ({ tagId, tagName, tagColor, entityType }) plus a `tagInsights` block with
// side-by-side "tagged vs all" comparisons the broker can use to size up the
// tagged segment's share of overall business.
//
// All values are computed on-read from existing tables (no denormalisation).
// ─────────────────────────────────────────────────────────────────────────────

function tierFor(score: number): "excellent" | "good" | "average" | "needs attention" {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 55) return "average";
  return "needs attention";
}

// Parse line items JSON safely into a typed shape.
type LineItem = { styleName: string; color?: string | null; setQty: number; unitPrice: number; lineTotal?: number };
function parseLineItems(raw: string | null | undefined): LineItem[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as LineItem[]) : [];
  } catch {
    return [];
  }
}

// Build N monthly buckets ending at the current month, oldest first.
function monthlyBuckets(count: number, now: Date): { label: string; start: Date; end: Date; monthIndex: number }[] {
  const out: { label: string; start: Date; end: Date; monthIndex: number }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    out.push({
      label: start.toLocaleDateString("en-IN", { month: "short" }) + (count >= 12 ? ` ${String(start.getFullYear()).slice(-2)}` : ""),
      start,
      end,
      monthIndex: start.getMonth(),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Indian garment-industry season mapping (month 0..11 → season key + label).
// festive  → Oct–Nov (Dussehra / Diwali peak)
// wedding  → Dec–Jan (wedding season)
// summer   → Apr–May (summer stock transition)
// winter   → Aug–Sep (winter stock prep)
// normal   → everything else
// ─────────────────────────────────────────────────────────────────────────────
type SeasonKey = "festive" | "wedding" | "summer" | "winter" | "normal";
function seasonForMonth(monthIndex: number): { key: SeasonKey; label: string } {
  switch (monthIndex) {
    case 11: return { key: "wedding", label: "Wedding season start" };
    case 0:  return { key: "wedding", label: "Wedding season peak" };
    case 2:  return { key: "festive", label: "Holi festive" };
    case 3:  return { key: "summer",  label: "Summer stock transition" };
    case 4:  return { key: "summer",  label: "Summer stock peak" };
    case 7:  return { key: "winter",  label: "Winter stock prep" };
    case 8:  return { key: "winter",  label: "Winter stock loading" };
    case 9:  return { key: "festive", label: "Festive season (Dussehra)" };
    case 10: return { key: "festive", label: "Festive season peak (Diwali)" };
    default: return { key: "normal",  label: "Regular season" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag filter resolution — given a tagId and an optional entityType scope,
// returns the matching set of entity IDs for each filtered entity type.
// When `entityType` is null, the filter applies to all three entity types.
// ─────────────────────────────────────────────────────────────────────────────
type TagFilter = {
  tagId: string;
  tagName: string;
  tagColor: string;
  // null = "all entity types"; otherwise a single type.
  entityType: TagEntityType | null;
  taggedClientIds: Set<string>;
  taggedSupplierIds: Set<string>;
  taggedPoIds: Set<string>;
};

async function resolveTagFilter(tagId: string, entityType: TagEntityType | null, brokerId: string): Promise<TagFilter | null> {
  const tag = await db.tag.findUnique({
    where: { id: tagId },
    select: { id: true, name: true, color: true },
  });
  if (!tag) return null;

  const filterTypes: TagEntityType[] = entityType ? [entityType] : ["Client", "Supplier", "PurchaseOrder"];
  const where = { tagId, entityType: { in: filterTypes }, tag: { brokerId } };
  const rows = await db.entityTag.findMany({
    where,
    select: { entityType: true, entityId: true },
  });
  return {
    tagId: tag.id,
    tagName: tag.name,
    tagColor: tag.color,
    entityType,
    taggedClientIds: new Set(rows.filter((r) => r.entityType === "Client").map((r) => r.entityId)),
    taggedSupplierIds: new Set(rows.filter((r) => r.entityType === "Supplier").map((r) => r.entityId)),
    taggedPoIds: new Set(rows.filter((r) => r.entityType === "PurchaseOrder").map((r) => r.entityId)),
  };
}

export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const url = req.nextUrl;
  const tagIdParam = url.searchParams.get("tagId");
  const entityTypeParam = url.searchParams.get("entityType");
  const entityType = entityTypeParam && isValidEntityType(entityTypeParam) ? entityTypeParam : null;

  let tagFilter: TagFilter | null = null;
  if (tagIdParam) {
    tagFilter = await resolveTagFilter(tagIdParam, entityType, broker.id);
    // If the tagId doesn't resolve to a real tag, we treat the request as
    // unfiltered rather than 404 — analytics should never hard-fail because
    // a stale URL/bookmark pointed at a deleted tag.
  }

  // ── Pull all data we need in parallel ──────────────────────────────────────
  const [
    suppliers,
    clients,
    dispatches,
    pos,
    bills,
    payments,
    disputes,
    brokerages,
  ] = await Promise.all([
    db.supplier.findMany({ where: { brokerId: broker.id }, select: { id: true, name: true } }),
    db.client.findMany({ where: { brokerId: broker.id }, select: { id: true, name: true, payoutCadence: true } }),
    db.dispatch.findMany({
      where: { brokerId: broker.id },
      select: {
        id: true, supplierId: true, poId: true, dispatchDate: true, dispatchedQty: true,
        status: true, po: { select: { totalValue: true, lineItemsJson: true, expectedDispatchDate: true, revisedDispatchDate: true, createdAt: true } },
      },
    }),
    db.purchaseOrder.findMany({
      where: { brokerId: broker.id },
      select: { id: true, supplierId: true, clientId: true, lineItemsJson: true, totalValue: true, createdAt: true, status: true },
    }),
    db.bill.findMany({
      where: { brokerId: broker.id },
      select: { id: true, clientId: true, supplierId: true, poId: true, finalAmount: true, paidAmount: true, status: true, createdAt: true },
    }),
    db.payment.findMany({ where: { brokerId: broker.id }, select: { id: true, billId: true, date: true, createdAt: true } }),
    db.dispute.findMany({ where: { brokerId: broker.id }, select: { id: true, poId: true, type: true, createdAt: true } }),
    db.brokerage.findMany({
      where: { brokerId: broker.id },
      select: {
        id: true, clientId: true, supplierId: true, billId: true, brokerageAmount: true,
        eligible: true, payoutStatus: true, eligibleAt: true, createdAt: true,
        bill: { select: { status: true, finalAmount: true, paidAmount: true } },
      },
    }),
  ]);

  // Quick lookup maps (pre-filter).
  const poById = new Map(pos.map((p) => [p.id, p]));
  const allClientIds = new Set(clients.map((c) => c.id));
  const allSupplierIds = new Set(suppliers.map((s) => s.id));
  const allPoIds = new Set(pos.map((p) => p.id));

  // ── Apply tag filter to the main collections ──────────────────────────────
  // The filter strategy mirrors the task spec:
  //   • Clients → only tagged clients (when Client filter active).
  //   • Suppliers → only tagged suppliers (when Supplier filter active).
  //   • POs → tagged POs OR POs whose client/supplier is tagged
  //           (when PO filter active, OR when client/supplier filter is active
  //            and broker wants PO-level visibility into that segment).
  // When entityType is null, all three filters apply simultaneously; when
  // entityType is set, only that filter applies and the other collections stay
  // unfiltered.
  let fSuppliers = suppliers;
  let fClients = clients;
  let fPos = pos;
  let fDispatches = dispatches;
  let fBills = bills;
  let fPayments = payments;
  let fDisputes = disputes;
  let fBrokerages = brokerages;

  if (tagFilter) {
    const { taggedClientIds, taggedSupplierIds, taggedPoIds } = tagFilter;

    if (tagFilter.entityType === null || tagFilter.entityType === "Supplier") {
      fSuppliers = suppliers.filter((s) => taggedSupplierIds.has(s.id));
    }
    if (tagFilter.entityType === null || tagFilter.entityType === "Client") {
      fClients = clients.filter((c) => taggedClientIds.has(c.id));
    }

    // PO filtering — tag + cascade. A PO survives if:
    //   - the PO itself is tagged (when PO filter active), OR
    //   - its client is tagged (when Client filter active), OR
    //   - its supplier is tagged (when Supplier filter active).
    if (tagFilter.entityType === null) {
      fPos = pos.filter((p) =>
        taggedPoIds.has(p.id) || taggedClientIds.has(p.clientId) || taggedSupplierIds.has(p.supplierId),
      );
    } else if (tagFilter.entityType === "PurchaseOrder") {
      fPos = pos.filter((p) => taggedPoIds.has(p.id));
    } else if (tagFilter.entityType === "Client") {
      fPos = pos.filter((p) => taggedClientIds.has(p.clientId));
    } else if (tagFilter.entityType === "Supplier") {
      fPos = pos.filter((p) => taggedSupplierIds.has(p.supplierId));
    }

    // Cascade: keep only dispatches/bills/payments/disputes/brokerages that
    // reference a surviving PO, client, or supplier.
    const survivingPoIds = new Set(fPos.map((p) => p.id));
    const survivingClientIds = new Set(fClients.map((c) => c.id));
    const survivingSupplierIds = new Set(fSuppliers.map((s) => s.id));

    fDispatches = dispatches.filter((d) => survivingPoIds.has(d.poId));
    fDisputes = disputes.filter((d) => survivingPoIds.has(d.poId));

    // Bills carry their own clientId/supplierId/poId — keep any that match a
    // surviving entity (PO, client, or supplier depending on the active filter).
    fBills = bills.filter((b) => {
      if (survivingPoIds.has(b.poId)) return true;
      if (tagFilter!.entityType === null || tagFilter!.entityType === "Client") {
        if (survivingClientIds.has(b.clientId)) return true;
      }
      if (tagFilter!.entityType === null || tagFilter!.entityType === "Supplier") {
        if (survivingSupplierIds.has(b.supplierId)) return true;
      }
      return false;
    });

    const survivingBillIds = new Set(fBills.map((b) => b.id));
    fPayments = payments.filter((p) => survivingBillIds.has(p.billId));

    // Brokerages have their own clientId/supplierId/billId linkage.
    fBrokerages = brokerages.filter((b) => {
      if (survivingBillIds.has(b.billId)) return true;
      if (tagFilter!.entityType === null || tagFilter!.entityType === "Client") {
        if (survivingClientIds.has(b.clientId)) return true;
      }
      if (tagFilter!.entityType === null || tagFilter!.entityType === "Supplier") {
        if (survivingSupplierIds.has(b.supplierId)) return true;
      }
      return false;
    });
  }

  // Quick lookup maps (post-filter)
  const billsByClient = new Map<string, typeof fBills>();
  for (const b of fBills) {
    const arr = billsByClient.get(b.clientId) ?? [];
    arr.push(b);
    billsByClient.set(b.clientId, arr);
  }
  const disputesByPo = new Map<string, typeof fDisputes>();
  for (const d of fDisputes) {
    const arr = disputesByPo.get(d.poId) ?? [];
    arr.push(d);
    disputesByPo.set(d.poId, arr);
  }
  const posBySupplier = new Map<string, typeof fPos>();
  for (const p of fPos) {
    const arr = posBySupplier.get(p.supplierId) ?? [];
    arr.push(p);
    posBySupplier.set(p.supplierId, arr);
  }
  const dispatchesBySupplier = new Map<string, typeof fDispatches>();
  for (const d of fDispatches) {
    const arr = dispatchesBySupplier.get(d.supplierId) ?? [];
    arr.push(d);
    dispatchesBySupplier.set(d.supplierId, arr);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // (a) Supplier reliability scores
  // ═══════════════════════════════════════════════════════════════════════════
  const supplierScores = fSuppliers.map((s) => {
    const sDispatches = dispatchesBySupplier.get(s.id) ?? [];
    const sPos = posBySupplier.get(s.id) ?? [];

    // Fulfillment rate: avg dispatchedQty/orderedQty across dispatches.
    // No dispatches → treat as 100 (nothing to fulfil, no failures yet).
    let fulfillment = 100;
    let totalSupplied = 0;
    if (sDispatches.length > 0) {
      let sumRatio = 0;
      for (const d of sDispatches) {
        const ordered = parseLineItems(d.po.lineItemsJson).reduce((a, i) => a + (i.setQty || 0), 0);
        const ratio = ordered > 0 ? Math.min(1, (d.dispatchedQty || 0) / ordered) : 0;
        sumRatio += ratio;
        // Approximate supplied value: dispatched qty share × PO total
        const poValue = d.po.totalValue || 0;
        const lineShare = ordered > 0 ? (d.dispatchedQty || 0) / ordered : 0;
        totalSupplied += poValue * lineShare;
      }
      fulfillment = Math.round((sumRatio / sDispatches.length) * 100);
    }

    // On-time dispatch: % of dispatches where dispatchDate <= expectedDispatchDate
    // (use revisedDispatchDate if present). No dispatches/dates → 100.
    let onTimeRate = 100;
    if (sDispatches.length > 0) {
      const withDates = sDispatches.filter((d) => d.po.expectedDispatchDate || d.po.revisedDispatchDate);
      if (withDates.length > 0) {
        const onTime = withDates.filter((d) => {
          const expected = d.po.revisedDispatchDate ?? d.po.expectedDispatchDate;
          return expected && new Date(d.dispatchDate) <= new Date(expected);
        }).length;
        onTimeRate = Math.round((onTime / withDates.length) * 100);
      }
    }

    // Short-shipment rate: % of dispatches marked short_shipment
    const shortShipmentRate = sDispatches.length > 0
      ? Math.round((sDispatches.filter((d) => d.status === "short_shipment").length / sDispatches.length) * 100)
      : 0;

    // Dispute rate: disputes linked to their POs / total POs × 100
    let disputeRate = 0;
    if (sPos.length > 0) {
      const dispCount = sPos.reduce((acc, p) => acc + (disputesByPo.get(p.id)?.length ?? 0), 0);
      disputeRate = Math.round((dispCount / sPos.length) * 100);
    }

    // Composite score (0–100)
    //   fulfillment (40) + onTime (30) + (100 - shortShip) (20) + (100 - dispute) (10)
    const score = Math.round(
      (fulfillment * 0.4) + (onTimeRate * 0.3) + ((100 - shortShipmentRate) * 0.2) + ((100 - disputeRate) * 0.1),
    );

    return {
      supplierId: s.id,
      name: s.name,
      score: Math.max(0, Math.min(100, score)),
      fulfillment,
      onTimeRate,
      shortShipmentRate,
      disputeRate,
      dispatchCount: sDispatches.length,
      totalSupplied: Math.round(totalSupplied),
      tier: tierFor(score),
    };
  });
  supplierScores.sort((a, b) => b.score - a.score);

  // ═══════════════════════════════════════════════════════════════════════════
  // (b) Client credit exposure
  // ═══════════════════════════════════════════════════════════════════════════
  const exposureBuckets = monthlyBuckets(6, now);
  // Group payments by bill for delay computation
  const paymentsByBill = new Map<string, typeof fPayments>();
  for (const p of fPayments) {
    const arr = paymentsByBill.get(p.billId) ?? [];
    arr.push(p);
    paymentsByBill.set(p.billId, arr);
  }

  const clientExposure = fClients.map((c) => {
    const cBills = billsByClient.get(c.id) ?? [];
    const outstanding = cBills.reduce((s, b) => s + (b.finalAmount - b.paidAmount), 0);

    // Exposure trend: outstanding snapshot at end of each of last 6 months.
    // Approximation: include only bills created before month end; use current
    // paidAmount as the running-paid value (no payment history snapshot).
    const exposureTrend = exposureBuckets.map((m) => {
      const val = cBills
        .filter((b) => new Date(b.createdAt) <= m.end)
        .reduce((s, b) => s + (b.finalAmount - b.paidAmount), 0);
      return { month: m.label, value: Math.round(val) };
    });

    // Avg payment delay (days) for fully-paid bills: createdAt → last payment date
    let avgPaymentDelay = 0;
    const paidBills = cBills.filter((b) => b.status === "fully_paid");
    if (paidBills.length > 0) {
      let totalDelay = 0;
      let counted = 0;
      for (const b of paidBills) {
        const bPays = paymentsByBill.get(b.id) ?? [];
        if (bPays.length === 0) continue;
        const lastPay = bPays.reduce((latest, p) => (new Date(p.date) > latest ? new Date(p.date) : latest), new Date(0));
        const diff = Math.round((lastPay.getTime() - new Date(b.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        if (diff >= 0) {
          totalDelay += diff;
          counted += 1;
        }
      }
      avgPaymentDelay = counted > 0 ? Math.round(totalDelay / counted) : 0;
    }

    // Return rate: defective_return disputes / total bills × 100
    // Disputes are linked via PO; need POs that belong to this client.
    const clientPoIds = new Set(fPos.filter((p) => p.clientId === c.id).map((p) => p.id));
    const defectiveReturns = fDisputes.filter((d) => d.type === "defective_return" && clientPoIds.has(d.poId)).length;
    const returnRate = cBills.length > 0 ? Math.round((defectiveReturns / cBills.length) * 100) : 0;

    return {
      clientId: c.id,
      name: c.name,
      outstanding: Math.round(outstanding),
      exposureTrend,
      avgPaymentDelay,
      returnRate,
      billCount: cBills.length,
    };
  });
  clientExposure.sort((a, b) => b.outstanding - a.outstanding);

  // ═══════════════════════════════════════════════════════════════════════════
  // (c) Brokerage forecast
  // ═══════════════════════════════════════════════════════════════════════════
  const pendingTotal = fBrokerages
    .filter((b) => !b.eligible)
    .reduce((s, b) => s + b.brokerageAmount, 0);

  const eligibleUnpaid = fBrokerages.filter((b) => b.eligible && b.payoutStatus !== "paid");
  const eligibleUnpaidTotal = eligibleUnpaid.reduce((s, b) => s + b.brokerageAmount, 0);

  // Breakdown by client cadence
  const clientCadence = new Map(fClients.map((c) => [c.id, c.payoutCadence]));
  const byCadence = { immediate: 0, "4_month": 0, "12_month": 0 };
  for (const b of eligibleUnpaid) {
    const cad = clientCadence.get(b.clientId) ?? "immediate";
    if (cad === "immediate") byCadence.immediate += b.brokerageAmount;
    else if (cad === "4_month_cumulative") byCadence["4_month"] += b.brokerageAmount;
    else if (cad === "12_month_cumulative") byCadence["12_month"] += b.brokerageAmount;
  }

  // Projected next 3 months payout:
  //   immediate → entire amount in current month
  //   4_month  → 1/4 per month for next 4 months (so months 1,2,3 get 1/4 each)
  //   12_month → 1/12 per month for next 12 months (so months 1,2,3 get 1/12 each)
  const projectedByMonth: { month: string; amount: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const mStart = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const label = mStart.toLocaleDateString("en-IN", { month: "short" }) + ` ${String(mStart.getFullYear()).slice(-2)}`;
    const immediateShare = byCadence.immediate * (i === 0 ? 1 : 0);
    const fourShare = byCadence["4_month"] / 4;
    const twelveShare = byCadence["12_month"] / 12;
    projectedByMonth.push({
      month: label,
      amount: Math.round(immediateShare + fourShare + twelveShare),
    });
  }

  const brokerageForecast = {
    pendingTotal: Math.round(pendingTotal),
    eligibleUnpaidTotal: Math.round(eligibleUnpaidTotal),
    projectedByMonth,
    byCadence: {
      immediate: Math.round(byCadence.immediate),
      "4_month": Math.round(byCadence["4_month"]),
      "12_month": Math.round(byCadence["12_month"]),
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // (d) Business volume trends
  // ═══════════════════════════════════════════════════════════════════════════
  const volBuckets = monthlyBuckets(12, now);
  const monthlyBilled = volBuckets.map((m) => ({
    month: m.label,
    value: Math.round(
      fBills
        .filter((b) => new Date(b.createdAt) >= m.start && new Date(b.createdAt) < m.end)
        .reduce((s, b) => s + b.finalAmount, 0),
    ),
  }));

  // Dispatched value per month: approximate each dispatch's value as
  // (dispatchedQty / orderedQty) × po.totalValue, bucketed by dispatchDate.
  const monthlyDispatched = volBuckets.map((m) => {
    let val = 0;
    for (const d of fDispatches) {
      const dd = new Date(d.dispatchDate);
      if (dd < m.start || dd >= m.end) continue;
      const ordered = parseLineItems(d.po.lineItemsJson).reduce((a, i) => a + (i.setQty || 0), 0);
      const share = ordered > 0 ? Math.min(1, (d.dispatchedQty || 0) / ordered) : 0;
      val += (d.po.totalValue || 0) * share;
    }
    return { month: m.label, value: Math.round(val) };
  });

  // Top 5 client/supplier pairs by total business value (bill finalAmount)
  const pairMap = new Map<string, { clientName: string; supplierName: string; value: number }>();
  const clientName = new Map(fClients.map((c) => [c.id, c.name]));
  const supplierName = new Map(fSuppliers.map((s) => [s.id, s.name]));
  // Fall back to ALL clients/suppliers for naming — when a tag filter excludes
  // the client/supplier themselves, the pair may still reference them via a
  // surviving bill (because bill.supplierId matched the tagged PO segment).
  const clientNameAll = new Map(clients.map((c) => [c.id, c.name]));
  const supplierNameAll = new Map(suppliers.map((s) => [s.id, s.name]));
  for (const b of fBills) {
    const key = `${b.clientId}|${b.supplierId}`;
    const existing = pairMap.get(key) ?? {
      clientName: clientName.get(b.clientId) ?? clientNameAll.get(b.clientId) ?? "—",
      supplierName: supplierName.get(b.supplierId) ?? supplierNameAll.get(b.supplierId) ?? "—",
      value: 0,
    };
    existing.value += b.finalAmount;
    pairMap.set(key, existing);
  }
  const topPairs = Array.from(pairMap.values())
    .map((p) => ({ ...p, value: Math.round(p.value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const volumeTrends = { monthlyBilled, monthlyDispatched, topPairs };

  // ═══════════════════════════════════════════════════════════════════════════
  // (e) Deep forecasting — 6-mo brokerage w/ confidence interval,
  //     12-mo seasonal trend analysis, client order velocity,
  //     supplier capacity utilisation.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── (e.1) Historical eligible-brokerage monthly series (last 6 months) ──────
  const histBuckets = monthlyBuckets(6, now);
  const histMonthly = histBuckets.map((m) => {
    const val = fBrokerages
      .filter((b) => {
        if (!b.eligible) return false;
        const ts = b.eligibleAt ? new Date(b.eligibleAt) : new Date(b.createdAt);
        return ts >= m.start && ts < m.end;
      })
      .reduce((s, b) => s + b.brokerageAmount, 0);
    return { label: m.label, value: Math.round(val) };
  });
  const histValues = histMonthly.map((m) => m.value);
  const histMax = histValues.length > 0 ? Math.max(...histValues) : 0;
  const histMin = histValues.length > 0 ? Math.min(...histValues) : 0;
  const histAvg = histValues.length > 0 ? histValues.reduce((a, b) => a + b, 0) / histValues.length : 0;

  // ── (e.2) 6-month brokerage forecast with confidence interval ──────────────
  const pendingShare = brokerageForecast.pendingTotal / 6;
  const cadenceImmediate = byCadence.immediate;
  const cadence4Share = byCadence["4_month"] / 4;
  const cadence12Share = byCadence["12_month"] / 12;
  const brokerage6Month: { month: string; projected: number; upper: number; lower: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const mStart = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const label = mStart.toLocaleDateString("en-IN", { month: "short" }) + ` ${String(mStart.getFullYear()).slice(-2)}`;
    const cadenceShare = (i === 0 ? cadenceImmediate : 0) + (i < 4 ? cadence4Share : 0) + cadence12Share;
    const projected = Math.round(pendingShare + cadenceShare + histAvg);
    const upper = Math.max(projected, Math.round(histMax * 1.2));
    const lower = Math.min(projected, Math.round(histMin * 0.8));
    brokerage6Month.push({ month: label, projected, upper, lower });
  }

  // ── (e.3) 12-month seasonal trend analysis ─────────────────────────────────
  const seasonalTrends = volBuckets.map((m, i) => {
    const value = monthlyBilled[i]?.value ?? 0;
    const prev = i > 0 ? (monthlyBilled[i - 1]?.value ?? 0) : 0;
    const growthRate = prev > 0 ? Math.round(((value - prev) / prev) * 100) : (value > 0 ? 100 : 0);
    const season = seasonForMonth(m.monthIndex);
    return {
      month: m.label,
      value,
      growthRate,
      seasonLabel: season.label,
      seasonKey: season.key,
      isPeak: false,
      isLow: false,
    };
  });
  // Mark top-2 peaks (by value)
  const peakIndices = [...seasonalTrends.map((s, i) => ({ s, i }))]
    .sort((a, b) => b.s.value - a.s.value)
    .slice(0, 2)
    .filter((x) => x.s.value > 0)
    .map((x) => x.i);
  // Mark bottom-2 lows (only among non-zero months)
  const nonZero = seasonalTrends.map((s, i) => ({ s, i })).filter((x) => x.s.value > 0);
  const lowIndices = nonZero
    .sort((a, b) => a.s.value - b.s.value)
    .slice(0, 2)
    .map((x) => x.i);
  for (const i of peakIndices) seasonalTrends[i].isPeak = true;
  for (const i of lowIndices) seasonalTrends[i].isLow = true;

  // ── (e.4) Client business velocity ─────────────────────────────────────────
  const posByClient = new Map<string, typeof fPos>();
  for (const p of fPos) {
    const arr = posByClient.get(p.clientId) ?? [];
    arr.push(p);
    posByClient.set(p.clientId, arr);
  }
  const clientVelocity = fClients
    .map((c) => {
      const cPos = (posByClient.get(c.id) ?? [])
        .map((p) => new Date(p.createdAt).getTime())
        .sort((a, b) => a - b);
      if (cPos.length === 0) {
        return {
          clientId: c.id,
          name: c.name,
          lastOrderDate: null as string | null,
          avgDaysBetweenOrders: 0,
          predictedNextOrderDate: null as string | null,
          orderCount: 0,
        };
      }
      const lastTs = cPos[cPos.length - 1];
      const lastOrderDate = new Date(lastTs).toISOString();
      let avgDays = 0;
      if (cPos.length >= 2) {
        let totalGap = 0;
        for (let i = 1; i < cPos.length; i++) totalGap += (cPos[i] - cPos[i - 1]) / (1000 * 60 * 60 * 24);
        avgDays = Math.round(totalGap / (cPos.length - 1));
      }
      const predictedTs = avgDays > 0 ? lastTs + avgDays * 24 * 60 * 60 * 1000 : null;
      return {
        clientId: c.id,
        name: c.name,
        lastOrderDate,
        avgDaysBetweenOrders: avgDays,
        predictedNextOrderDate: predictedTs ? new Date(predictedTs).toISOString() : null,
        orderCount: cPos.length,
      };
    })
    .filter((c) => c.orderCount > 0)
    .sort((a, b) => {
      // Sort by predicted-next-order-date proximity (closest first), nulls last.
      const aTs = a.predictedNextOrderDate ? new Date(a.predictedNextOrderDate).getTime() : Infinity;
      const bTs = b.predictedNextOrderDate ? new Date(b.predictedNextOrderDate).getTime() : Infinity;
      return aTs - bTs;
    })
    .slice(0, 5);

  // ── (e.5) Supplier capacity utilisation ────────────────────────────────────
  const supplierCapacity = fSuppliers.map((s) => {
    const sDispatches = dispatchesBySupplier.get(s.id) ?? [];
    const sPos = posBySupplier.get(s.id) ?? [];

    // Avg dispatch lead time (only counts dispatches with a valid po.createdAt)
    let avgLeadTimeDays = 0;
    const leadTimes: number[] = [];
    for (const d of sDispatches) {
      const poCreated = d.po.createdAt ? new Date(d.po.createdAt).getTime() : 0;
      if (!poCreated) continue;
      const diff = Math.round((new Date(d.dispatchDate).getTime() - poCreated) / (1000 * 60 * 60 * 24));
      if (diff >= 0) leadTimes.push(diff);
    }
    if (leadTimes.length > 0) {
      avgLeadTimeDays = Math.round(leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length);
    }

    // Pending POs = currently open or partially-delivered
    const pendingPOs = sPos.filter((p) => p.status === "open" || p.status === "partially_delivered").length;

    // Historical monthly avg PO count over the last 12 months
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const recentPOs = sPos.filter((p) => new Date(p.createdAt) >= twelveMonthsAgo).length;
    const monthlyAvgPOs = recentPOs / 12;

    // Status thresholds:
    //   overloaded  — pendingPOs >= 2× monthlyAvgPOs AND pendingPOs >= 5
    //   high        — pendingPOs >  monthlyAvgPOs AND pendingPOs >= 3
    //   normal      — otherwise
    let status: "normal" | "high" | "overloaded" = "normal";
    if (pendingPOs >= 5 && monthlyAvgPOs > 0 && pendingPOs >= 2 * monthlyAvgPOs) status = "overloaded";
    else if (pendingPOs >= 3 && pendingPOs > monthlyAvgPOs) status = "high";

    return {
      supplierId: s.id,
      name: s.name,
      avgLeadTimeDays,
      pendingPOs,
      monthlyAvgPOs: Math.round(monthlyAvgPOs * 10) / 10,
      status,
    };
  });
  // Sort by status severity (overloaded > high > normal), then by pending POs desc
  const statusRank: Record<string, number> = { overloaded: 0, high: 1, normal: 2 };
  supplierCapacity.sort((a, b) => {
    const r = statusRank[a.status] - statusRank[b.status];
    if (r !== 0) return r;
    return b.pendingPOs - a.pendingPOs;
  });

  const forecast = {
    brokerage6Month,
    seasonalTrends,
    clientVelocity,
    supplierCapacity,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Tag insights — when a tag filter is active, compute a tagged-vs-all
  // comparison block. Always uses BOTH the filtered ("tagged") set and the
  // full unfiltered set of entities — the broker needs the side-by-side
  // view to size up the segment's share of overall business.
  // ═══════════════════════════════════════════════════════════════════════════
  let tagInsights: unknown = null;
  let appliedFilter: {
    tagId: string;
    tagName: string;
    tagColor: string;
    entityType: TagEntityType | null;
    clientCount: number;
    supplierCount: number;
    purchaseOrderCount: number;
  } | null = null;

  if (tagFilter) {
    // Total counts for the tag — drawn from ALL entities of each type, not the
    // filtered subset (so the broker sees "this tag has 4 VIP clients out of 9
    // total clients" even when the entityType scope is "Client" only).
    const taggedClientCount = tagFilter.taggedClientIds.size;
    const taggedSupplierCount = tagFilter.taggedSupplierIds.size;
    const taggedPoCount = tagFilter.taggedPoIds.size;

    appliedFilter = {
      tagId: tagFilter.tagId,
      tagName: tagFilter.tagName,
      tagColor: tagFilter.tagColor,
      entityType: tagFilter.entityType,
      clientCount: taggedClientCount,
      supplierCount: taggedSupplierCount,
      purchaseOrderCount: taggedPoCount,
    };

    // ── Client comparison (computed when Client filter active OR all) ────────
    type ClientCompare = {
      taggedCount: number;
      totalCount: number;
      taggedBusiness: number;
      allBusiness: number;
      taggedOutstanding: number;
      allOutstanding: number;
      taggedBrokerage: number;
      allBrokerage: number;
      taggedAvgOutstanding: number;
      allAvgOutstanding: number;
    };
    let clientComparison: ClientCompare | null = null;
    const includeClients = tagFilter.entityType === null || tagFilter.entityType === "Client";
    if (includeClients) {
      const taggedClientIds = tagFilter.taggedClientIds;
      const taggedClientSet = new Set(taggedClientIds);
      // Tagged totals — using ALL bills/brokerages (unfiltered), not fBills,
      // so the comparison reflects the full segment size.
      let tBus = 0, tOut = 0, tBrok = 0;
      let aBus = 0, aOut = 0, aBrok = 0;
      const billsByClientAll = new Map<string, typeof bills>();
      for (const b of bills) {
        const arr = billsByClientAll.get(b.clientId) ?? [];
        arr.push(b);
        billsByClientAll.set(b.clientId, arr);
        aBus += b.finalAmount;
        aOut += (b.finalAmount - b.paidAmount);
      }
      for (const b of brokerages) {
        aBrok += b.brokerageAmount;
      }
      for (const cid of taggedClientSet) {
        const cb = billsByClientAll.get(cid) ?? [];
        for (const b of cb) {
          tBus += b.finalAmount;
          tOut += (b.finalAmount - b.paidAmount);
        }
        for (const b of brokerages) {
          if (b.clientId === cid) tBrok += b.brokerageAmount;
        }
      }
      clientComparison = {
        taggedCount: taggedClientCount,
        totalCount: allClientIds.size,
        taggedBusiness: Math.round(tBus),
        allBusiness: Math.round(aBus),
        taggedOutstanding: Math.round(tOut),
        allOutstanding: Math.round(aOut),
        taggedBrokerage: Math.round(tBrok),
        allBrokerage: Math.round(aBrok),
        taggedAvgOutstanding: taggedClientCount > 0 ? Math.round(tOut / taggedClientCount) : 0,
        allAvgOutstanding: allClientIds.size > 0 ? Math.round(aOut / allClientIds.size) : 0,
      };
    }

    // ── Supplier comparison ──────────────────────────────────────────────────
    type SupplierCompare = {
      taggedCount: number;
      totalCount: number;
      taggedSupplied: number;
      allSupplied: number;
      taggedFulfillment: number;
      allFulfillment: number;
    };
    let supplierComparison: SupplierCompare | null = null;
    const includeSuppliers = tagFilter.entityType === null || tagFilter.entityType === "Supplier";
    if (includeSuppliers) {
      const taggedSupplierSet = new Set(tagFilter.taggedSupplierIds);
      // Build dispatches-by-supplier over ALL dispatches (unfiltered).
      const dispatchesBySupplierAll = new Map<string, typeof dispatches>();
      for (const d of dispatches) {
        const arr = dispatchesBySupplierAll.get(d.supplierId) ?? [];
        arr.push(d);
        dispatchesBySupplierAll.set(d.supplierId, arr);
      }
      const computeSupplierMetrics = (supplierIds: Iterable<string>) => {
        let supplied = 0;
        const ratios: number[] = [];
        for (const sid of supplierIds) {
          const ds = dispatchesBySupplierAll.get(sid) ?? [];
          for (const d of ds) {
            const ordered = parseLineItems(d.po.lineItemsJson).reduce((a, i) => a + (i.setQty || 0), 0);
            const ratio = ordered > 0 ? Math.min(1, (d.dispatchedQty || 0) / ordered) : 0;
            ratios.push(ratio);
            const poValue = d.po.totalValue || 0;
            const lineShare = ordered > 0 ? (d.dispatchedQty || 0) / ordered : 0;
            supplied += poValue * lineShare;
          }
        }
        const fulfillment = ratios.length > 0
          ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100)
          : 0;
        return { supplied: Math.round(supplied), fulfillment };
      };
      const taggedMetrics = computeSupplierMetrics(taggedSupplierSet);
      const allMetrics = computeSupplierMetrics(allSupplierIds);
      supplierComparison = {
        taggedCount: taggedSupplierCount,
        totalCount: allSupplierIds.size,
        taggedSupplied: taggedMetrics.supplied,
        allSupplied: allMetrics.supplied,
        taggedFulfillment: taggedMetrics.fulfillment,
        allFulfillment: allMetrics.fulfillment,
      };
    }

    // ── PO comparison ─────────────────────────────────────────────────────────
    type PoCompare = {
      taggedCount: number;
      totalCount: number;
      taggedValue: number;
      allValue: number;
      taggedFulfillment: number;
      allFulfillment: number;
    };
    let poComparison: PoCompare | null = null;
    const includePos = tagFilter.entityType === null || tagFilter.entityType === "PurchaseOrder";
    if (includePos) {
      const taggedPoSet = new Set(tagFilter.taggedPoIds);
      // Build dispatches-by-po over ALL dispatches (unfiltered).
      const dispatchesByPoAll = new Map<string, typeof dispatches>();
      for (const d of dispatches) {
        const arr = dispatchesByPoAll.get(d.poId) ?? [];
        arr.push(d);
        dispatchesByPoAll.set(d.poId, arr);
      }
      const computePoMetrics = (poIds: Iterable<string>) => {
        let totalValue = 0;
        const ratios: number[] = [];
        for (const pid of poIds) {
          const po = poById.get(pid);
          if (!po) continue;
          totalValue += po.totalValue || 0;
          const ds = dispatchesByPoAll.get(pid) ?? [];
          if (ds.length > 0) {
            const ordered = parseLineItems(po.lineItemsJson).reduce((a, i) => a + (i.setQty || 0), 0);
            const totalDispatched = ds.reduce((s, d) => s + (d.dispatchedQty || 0), 0);
            const ratio = ordered > 0 ? Math.min(1, totalDispatched / ordered) : 0;
            ratios.push(ratio);
          }
        }
        const fulfillment = ratios.length > 0
          ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100)
          : 0;
        return { totalValue: Math.round(totalValue), fulfillment };
      };
      const taggedMetrics = computePoMetrics(taggedPoSet);
      const allMetrics = computePoMetrics(allPoIds);
      poComparison = {
        taggedCount: taggedPoCount,
        totalCount: allPoIds.size,
        taggedValue: taggedMetrics.totalValue,
        allValue: allMetrics.totalValue,
        taggedFulfillment: taggedMetrics.fulfillment,
        allFulfillment: allMetrics.fulfillment,
      };
    }

    tagInsights = {
      client: clientComparison,
      supplier: supplierComparison,
      purchaseOrder: poComparison,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  return NextResponse.json({
    appliedFilter,
    tagInsights,
    // Total (unfiltered) entity counts — the UI uses these to render
    // "(N of M suppliers)" headers when a tag filter narrows the result set.
    totals: {
      supplierCount: allSupplierIds.size,
      clientCount: allClientIds.size,
      purchaseOrderCount: allPoIds.size,
    },
    suppliers: supplierScores,
    clients: clientExposure,
    brokerage: brokerageForecast,
    volume: volumeTrends,
    forecast,
  });
}
