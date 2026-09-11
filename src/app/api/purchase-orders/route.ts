import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

// GET /api/purchase-orders
export async function GET(_req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pos = await db.purchaseOrder.findMany({
    where: { brokerId: broker.id },
    include: {
      client: { select: { name: true } },
      supplier: { select: { name: true } },
      booking: { select: { id: true, bookingDate: true } },
      dispatches: { select: { id: true, dispatchDate: true, dispatchedQty: true, status: true }, orderBy: { dispatchDate: "desc" } },
      bill: { select: { id: true, billNumber: true, status: true, finalAmount: true, paidAmount: true } },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = pos.map((po) => {
    const items = JSON.parse(po.lineItemsJson) as { setQty: number }[];
    const orderedQty = items.reduce((s, i) => s + i.setQty, 0);
    const dispatchedQty = po.dispatches.reduce((s, d) => s + d.dispatchedQty, 0);
    const fulfillment = orderedQty ? Math.round((dispatchedQty / orderedQty) * 100) : 0;
    return { ...po, orderedQty, dispatchedQty, fulfillment, tags: po.tags.map((et) => et.tag) };
  });
  return NextResponse.json({ purchaseOrders: rows });
}
