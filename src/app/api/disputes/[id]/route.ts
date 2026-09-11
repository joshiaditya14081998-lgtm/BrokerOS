import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

// PATCH — resolve/reject a dispute; if resolved and defective_return, recompute bill
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const before = await db.dispute.findUnique({ where: { id } });
  if (!before || before.brokerId !== broker.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { status, resolution, ...rest } = body;
  const dispute = await db.dispute.update({ where: { id }, data: { ...rest, status, resolution } });
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "Dispute", entityId: id, action: "update",
      before: JSON.stringify(before), after: JSON.stringify(dispute),
      userName: "Broker", reason: `Status → ${status}`,
    },
  });

  // If resolved defective return → recompute bill
  if (status === "resolved" && before.type === "defective_return") {
    const bill = await db.bill.findUnique({ where: { poId: dispute.poId } });
    if (bill && bill.brokerId === broker.id) {
      const po = await db.purchaseOrder.findUnique({
        where: { id: dispute.poId, brokerId: broker.id },
        include: { dispatches: true, disputes: true },
      });
      if (po) {
        const poItems = JSON.parse(po.lineItemsJson) as { setQty: number; unitPrice: number }[];
        const poValue = poItems.reduce((s, i) => s + i.setQty * i.unitPrice, 0);
        const totalOrderedQty = poItems.reduce((s, i) => s + i.setQty, 0);
        const totalDispatchedQty = po.dispatches.reduce((s, d) => s + d.dispatchedQty, 0);
        const shortShipmentValue = totalOrderedQty > totalDispatchedQty ? poValue * (1 - totalDispatchedQty / totalOrderedQty) : 0;
        const returnsValue = po.disputes.filter((d) => d.type === "defective_return" && d.status === "resolved").reduce((s, d) => s + d.valueAffected, 0);
        const base = Math.max(0, poValue - shortShipmentValue - returnsValue);
        const gst = Math.round(base * (bill.gstRate / 100));
        const final = base + gst;
        // updateMany scoped to brokerId for tenant safety.
        await db.bill.updateMany({
          where: { id: bill.id, brokerId: broker.id },
          data: { baseAmount: base, gstAmount: gst, finalAmount: final },
        });
        const updated = { ...bill, baseAmount: base, gstAmount: gst, finalAmount: final };
        await db.auditLog.create({
          data: {
            brokerId: broker.id,
            entityType: "Bill", entityId: bill.id, action: "update",
            before: JSON.stringify(bill), after: JSON.stringify(updated),
            userName: "System", reason: "Recomputed after dispute resolved.",
          },
        });
      }
    }
  }
  return NextResponse.json({ dispute });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // deleteMany scoped to brokerId — a no-op if the row belongs to another broker.
  const result = await db.dispute.deleteMany({ where: { id, brokerId: broker.id } });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "Dispute", entityId: id, action: "delete", userName: "Broker",
    },
  });
  return NextResponse.json({ ok: true });
}
