import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      client: true, supplier: true,
      booking: { include: { visit: true, lineItems: true, photos: true } },
      dispatches: { include: { photos: true, disputes: true }, orderBy: { dispatchDate: "asc" } },
      dispatchDateLogs: { orderBy: { createdAt: "desc" } },
      bill: { include: { payments: { orderBy: { date: "desc" } }, brokerage: { include: { payout: true } } } },
      disputes: { include: { photos: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!po || po.brokerId !== broker.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const items = JSON.parse(po.lineItemsJson);
  const orderedQty = items.reduce((s: number, i: { setQty: number }) => s + i.setQty, 0);
  const dispatchedQty = po.dispatches.reduce((s, d) => s + d.dispatchedQty, 0);
  return NextResponse.json({ po: { ...po, lineItems: items, orderedQty, dispatchedQty, fulfillment: orderedQty ? Math.round((dispatchedQty / orderedQty) * 100) : 0 } });
}

// PATCH — update expected/revised dispatch date, status
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const before = await db.purchaseOrder.findUnique({ where: { id } });
  if (!before || before.brokerId !== broker.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { expectedDispatchDate, revisedDispatchDate, status, revisionReason, ...rest } = body;
  // Strip brokerId so the request body can't reassign tenant ownership.
  delete rest.brokerId;
  const data: Record<string, unknown> = { ...rest };

  // ── Gap 1: "Close PO" transition — validate before mutating.
  // A PO may only be closed when (1) it is already fully_delivered,
  // (2) every linked bill is fully_paid, and (3) no open disputes remain.
  // We run these checks BEFORE the update so a failed close attempt doesn't
  // leave the row in a half-mutated state.
  if (status === "closed") {
    if (before.status !== "fully_delivered") {
      return NextResponse.json(
        { error: `Cannot close PO: status must be "fully_delivered" (currently "${before.status}")` },
        { status: 400 },
      );
    }
    // Linked bills — a PO has at most one bill (see schema: Bill.poId @unique),
    // but we query defensively in case that constraint is ever relaxed.
    const unpaidBills = await db.bill.count({
      where: { poId: id, brokerId: broker.id, status: { not: "fully_paid" } },
    });
    if (unpaidBills > 0) {
      return NextResponse.json(
        { error: `Cannot close PO: ${unpaidBills} bill(s) are not fully paid (pending or partially paid)` },
        { status: 400 },
      );
    }
    const openDisputes = await db.dispute.count({
      where: { poId: id, brokerId: broker.id, status: "open" },
    });
    if (openDisputes > 0) {
      return NextResponse.json(
        { error: `Cannot close PO: ${openDisputes} open dispute(s) must be resolved or rejected first` },
        { status: 400 },
      );
    }
    data.status = "closed";
  } else if (status) {
    data.status = status;
  }

  // If revised date provided, log the date change
  if (revisedDispatchDate) {
    const newDate = new Date(revisedDispatchDate);
    data.revisedDispatchDate = newDate;
    await db.dispatchDateLog.create({
      data: { poId: id, oldDate: before.revisedDispatchDate ?? before.expectedDispatchDate, newDate, reason: revisionReason || "Supplier revised dispatch date" },
    });
  }
  if (expectedDispatchDate) data.expectedDispatchDate = new Date(expectedDispatchDate);

  const po = await db.purchaseOrder.update({ where: { id }, data });
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "PurchaseOrder",
      entityId: id,
      // Distinguish the close transition from generic updates so it can be
      // surfaced specially in the audit trail / timeline.
      action: status === "closed" ? "close" : "update",
      before: JSON.stringify(before),
      after: JSON.stringify(po),
      userName: broker.fullName,
    },
  });
  return NextResponse.json({ po });
}
