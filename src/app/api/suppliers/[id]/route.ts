import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Supplier reliability score — mirrors the formula in /api/analytics (§8.2):
//   fulfillment (40) + onTime (30) + (100 - shortShip) (20) + (100 - dispute) (10)
// Computed on-read from existing tables; nothing denormalised.
// ─────────────────────────────────────────────────────────────────────────────
type LineItem = { styleName: string; color?: string | null; setQty: number; unitPrice: number };
function parseLineItems(json: string): LineItem[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function tierFor(score: number): "excellent" | "good" | "average" | "needs-attention" {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 55) return "average";
  return "needs-attention";
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supplier = await db.supplier.findUnique({
    where: { id },
    include: {
      bills: {
        include: { client: { select: { name: true } }, po: { select: { poNumber: true } }, brokerage: true, payments: { orderBy: { date: "desc" } } },
        orderBy: { createdAt: "desc" },
      },
      dispatches: { include: { po: { select: { poNumber: true, totalValue: true, lineItemsJson: true, expectedDispatchDate: true, revisedDispatchDate: true, status: true, client: { select: { name: true } } } } }, orderBy: { dispatchDate: "desc" } },
      brokerages: { include: { bill: { select: { billNumber: true, baseAmount: true } }, client: { select: { name: true } }, payout: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!supplier || supplier.brokerId !== broker.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const totalSupplied = supplier.bills.reduce((a, b) => a + b.baseAmount, 0);
  const outstandingBrokerage = supplier.brokerages.filter((b) => b.eligible && b.payoutStatus !== "paid").reduce((a, b) => a + b.brokerageAmount, 0);
  const paidBrokerage = supplier.brokerages.filter((b) => b.payoutStatus === "paid").reduce((a, b) => a + b.brokerageAmount, 0);

  const dispatches = supplier.dispatches.map((d) => {
    const orderedQty = JSON.parse(d.po.lineItemsJson).reduce((s: number, i: { setQty: number }) => s + i.setQty, 0);
    return {
      id: d.id, poNumber: d.po.poNumber, clientName: d.po.client.name, dispatchDate: d.dispatchDate,
      status: d.status, dispatchedQty: d.dispatchedQty, orderedQty,
      poStatus: d.po.status, expected: d.po.expectedDispatchDate, revised: d.po.revisedDispatchDate,
    };
  });

  // Avg dispatch delay (days between expected & actual)
  const delays = supplier.dispatches
    .filter((d) => d.po.expectedDispatchDate)
    .map((d) => Math.round((d.dispatchDate.getTime() - d.po.expectedDispatchDate!.getTime()) / 86400000));
  const avgDispatchDelay = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;

  // ── Reliability score (mirrors /api/analytics §8.2) ──────────────────────────
  // Need the supplier's POs + disputes to compute the dispute rate.
  const supplierPos = await db.purchaseOrder.findMany({
    where: { supplierId: id, brokerId: broker.id },
    select: { id: true },
  });
  const disputes = supplierPos.length > 0
    ? await db.dispute.findMany({ where: { poId: { in: supplierPos.map((p) => p.id) }, brokerId: broker.id }, select: { id: true, poId: true } })
    : [];
  const disputesByPo = new Map<string, number>();
  for (const d of disputes) {
    disputesByPo.set(d.poId, (disputesByPo.get(d.poId) ?? 0) + 1);
  }

  // Fulfillment rate: avg dispatchedQty/orderedQty across dispatches.
  let fulfillment = 100;
  if (supplier.dispatches.length > 0) {
    let sumRatio = 0;
    for (const d of supplier.dispatches) {
      const ordered = parseLineItems(d.po.lineItemsJson).reduce((a, i) => a + (i.setQty || 0), 0);
      const ratio = ordered > 0 ? Math.min(1, (d.dispatchedQty || 0) / ordered) : 0;
      sumRatio += ratio;
    }
    fulfillment = Math.round((sumRatio / supplier.dispatches.length) * 100);
  }

  // On-time dispatch: % of dispatches where dispatchDate <= expectedDispatchDate
  // (use revisedDispatchDate if present).
  let onTimeRate = 100;
  if (supplier.dispatches.length > 0) {
    const withDates = supplier.dispatches.filter((d) => d.po.expectedDispatchDate || d.po.revisedDispatchDate);
    if (withDates.length > 0) {
      const onTime = withDates.filter((d) => {
        const expected = d.po.revisedDispatchDate ?? d.po.expectedDispatchDate;
        return expected && new Date(d.dispatchDate) <= new Date(expected);
      }).length;
      onTimeRate = Math.round((onTime / withDates.length) * 100);
    }
  }

  // Short-shipment rate: % of dispatches marked short_shipment
  const shortShipmentRate = supplier.dispatches.length > 0
    ? Math.round((supplier.dispatches.filter((d) => d.status === "short_shipment").length / supplier.dispatches.length) * 100)
    : 0;

  // Dispute rate: disputes linked to this supplier's POs / total POs × 100
  let disputeRate = 0;
  if (supplierPos.length > 0) {
    const dispCount = supplierPos.reduce((acc, p) => acc + (disputesByPo.get(p.id) ?? 0), 0);
    disputeRate = Math.round((dispCount / supplierPos.length) * 100);
  }

  const reliabilityScore = Math.max(
    0,
    Math.min(100, Math.round(
      (fulfillment * 0.4) + (onTimeRate * 0.3) + ((100 - shortShipmentRate) * 0.2) + ((100 - disputeRate) * 0.1),
    )),
  );
  const tier = tierFor(reliabilityScore);

  return NextResponse.json({
    supplier,
    stats: {
      totalSupplied,
      outstandingBrokerage,
      paidBrokerage,
      avgDispatchDelay,
      billCount: supplier.bills.length,
      dispatchCount: supplier.dispatches.length,
      reliabilityScore,
      tier,
      fulfillment,
      onTimeRate,
      shortShipmentRate,
      disputeRate,
    },
    dispatches,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const before = await db.supplier.findUnique({ where: { id } });
  if (!before || before.brokerId !== broker.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id: _id, createdAt: _c, updatedAt: _u, brokerId: _b, ...data } = body;
  const supplier = await db.supplier.update({ where: { id }, data });
  await db.auditLog.create({ data: { brokerId: broker.id, entityType: "Supplier", entityId: id, action: "update", before: JSON.stringify(before), after: JSON.stringify(supplier), userName: broker.fullName } });
  return NextResponse.json({ supplier });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await db.supplier.deleteMany({ where: { id, brokerId: broker.id } });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.auditLog.create({ data: { brokerId: broker.id, entityType: "Supplier", entityId: id, action: "delete", userName: broker.fullName } });
  return NextResponse.json({ ok: true });
}
