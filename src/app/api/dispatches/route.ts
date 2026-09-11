import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { getCurrentBroker } from "@/lib/auth";

const DispatchItemSchema = z.object({
  styleName: z.string(),
  color: z.string().optional().nullable(),
  qty: z.number().int().min(0),
});

const DispatchSchema = z.object({
  poId: z.string().min(1),
  supplierId: z.string().min(1),
  dispatchDate: z.string(),
  items: z.array(DispatchItemSchema).min(1),
  status: z.enum(["in_transit", "delivered", "short_shipment"]).default("delivered"),
  notes: z.string().optional().nullable(),
});

// GET /api/dispatches
export async function GET(_req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dispatches = await db.dispatch.findMany({
    where: { brokerId: broker.id },
    include: {
      po: { include: { client: { select: { name: true } }, supplier: { select: { name: true } } } },
      photos: true,
    },
    orderBy: { dispatchDate: "desc" },
  });
  return NextResponse.json({ dispatches });
}

// POST /api/dispatches — logs a dispatch (full or partial), updates PO status
export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = DispatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { poId, supplierId, dispatchDate, items, status, notes } = parsed.data;

  const po = await db.purchaseOrder.findUnique({ where: { id: poId } });
  if (!po || po.brokerId !== broker.id) return NextResponse.json({ error: "PO not found" }, { status: 400 });

  const dispatchedQty = items.reduce((s, i) => s + i.qty, 0);
  const poItems = JSON.parse(po.lineItemsJson) as { setQty: number }[];
  const orderedQty = poItems.reduce((s, i) => s + i.setQty, 0);
  const priorDispatched = await db.dispatch.aggregate({ where: { poId, brokerId: broker.id }, _sum: { dispatchedQty: true } });
  const totalDispatched = (priorDispatched._sum.dispatchedQty ?? 0) + dispatchedQty;

  const dispatch = await db.dispatch.create({
    data: {
      brokerId: broker.id,
      poId, supplierId,
      dispatchDate: new Date(dispatchDate),
      itemsJson: JSON.stringify(items),
      dispatchedQty,
      status,
      notes,
    },
  });

  // Update PO status based on cumulative delivery
  let newPoStatus = po.status;
  if (totalDispatched >= orderedQty && status !== "short_shipment") {
    newPoStatus = "fully_delivered";
  } else if (totalDispatched > 0) {
    newPoStatus = "partially_delivered";
  }
  await db.purchaseOrder.update({ where: { id: poId }, data: { status: newPoStatus } });

  // Recompute bill if it exists (adjust base for short-shipments) — only this broker's bill.
  const existingBill = await db.bill.findUnique({ where: { poId } });
  if (existingBill && existingBill.brokerId === broker.id) {
    await recomputeBill(existingBill.id, broker.id);
  }

  await db.auditLog.create({ data: { brokerId: broker.id, entityType: "Dispatch", entityId: dispatch.id, action: "create", after: JSON.stringify(dispatch), userName: broker.fullName, reason: `Dispatch logged. PO status → ${newPoStatus}.` } });
  return NextResponse.json({ dispatch, poStatus: newPoStatus });
}

// Recompute bill base from current PO/dispatch/dispute state
async function recomputeBill(billId: string, brokerId: string) {
  const bill = await db.bill.findUnique({ where: { id: billId }, include: { po: { include: { dispatches: true, disputes: true } } } });
  if (!bill || bill.brokerId !== brokerId) return;

  const poItems = JSON.parse(bill.po.lineItemsJson) as { setQty: number; unitPrice: number; styleName: string; color?: string | null }[];
  const poValue = poItems.reduce((s, i) => s + i.setQty * i.unitPrice, 0);

  // Sum delivered value (proportionally by qty)
  const totalOrderedQty = poItems.reduce((s, i) => s + i.setQty, 0);
  const totalDispatchedQty = bill.po.dispatches.reduce((s, d) => s + d.dispatchedQty, 0);
  const shortShipmentValue = totalOrderedQty > totalDispatchedQty ? poValue * (1 - totalDispatchedQty / totalOrderedQty) : 0;

  // Returns/defects value
  const returnsValue = bill.po.disputes
    .filter((d) => d.type === "defective_return" && d.status === "resolved")
    .reduce((s, d) => s + d.valueAffected, 0);

  const base = Math.max(0, poValue - shortShipmentValue - returnsValue);
  const gst = Math.round(base * (bill.gstRate / 100));
  const final = base + gst;

  const updated = await db.bill.update({
    where: { id: billId },
    data: { baseAmount: base, gstAmount: gst, finalAmount: final },
  });
  await db.auditLog.create({
    data: {
      brokerId,
      entityType: "Bill", entityId: billId, action: "update",
      before: JSON.stringify({ baseAmount: bill.baseAmount, gstAmount: bill.gstAmount, finalAmount: bill.finalAmount }),
      after: JSON.stringify({ baseAmount: base, gstAmount: gst, finalAmount: final }),
      userName: "System", reason: "Recomputed after dispatch/dispute change.",
    },
  });
  return updated;
}
