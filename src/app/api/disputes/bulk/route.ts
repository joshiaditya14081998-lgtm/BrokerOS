import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

// PATCH /api/disputes/bulk
// Body: { ids: string[], action: "resolve" | "reject", resolution?: string }
//
// For "resolve": sets status="resolved" + resolution text on all matching
// disputes, and recomputes any linked bills for defective_return disputes
// (matching the single-dispute PATCH behaviour).
// For "reject":  sets status="rejected" on all matching disputes.
//
// A single AuditLog entry summarizing the bulk action is written. Returns
// the count actually updated.
export async function PATCH(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const ids: unknown = body?.ids;
  const action: unknown = body?.action;
  const resolution: unknown = body?.resolution;

  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((id) => typeof id === "string")
  ) {
    return NextResponse.json(
      { error: "`ids` must be a non-empty array of strings" },
      { status: 400 },
    );
  }

  if (action !== "resolve" && action !== "reject") {
    return NextResponse.json(
      { error: "`action` must be one of: resolve, reject" },
      { status: 400 },
    );
  }

  if (resolution !== undefined && typeof resolution !== "string") {
    return NextResponse.json(
      { error: "`resolution` must be a string when provided" },
      { status: 400 },
    );
  }

  const newStatus = action === "resolve" ? "resolved" : "rejected";
  const resolutionText =
    action === "resolve"
      ? (typeof resolution === "string" ? resolution.trim() : "") || "Bulk resolved."
      : null;

  // Capture "before" snapshot (with PO linkage for downstream bill recompute).
  // Scope by brokerId — a tenant can only bulk-act on its own disputes.
  const beforeDisputes = await db.dispute.findMany({
    where: { id: { in: ids }, brokerId: broker.id },
    include: { po: { select: { poNumber: true } } },
  });

  if (beforeDisputes.length === 0) {
    return NextResponse.json({ updated: 0 });
  }

  // Only the dispute IDs that actually belong to this broker — protects the
  // updateMany from touching another tenant's rows.
  const scopedIds = beforeDisputes.map((d) => d.id);

  const affectedPoIds = Array.from(
    new Set(beforeDisputes.map((d) => d.poId)),
  );

  const result = await db.dispute.updateMany({
    where: { id: { in: scopedIds }, brokerId: broker.id },
    data: {
      status: newStatus,
      ...(action === "resolve" ? { resolution: resolutionText } : {}),
    },
  });

  // If resolving, recompute bills for any PO that has at least one
  // defective_return dispute in the batch (mirrors the single-dispute flow).
  let billsRecomputed = 0;
  if (action === "resolve") {
    for (const poId of affectedPoIds) {
      // Confirm the PO has a resolved defective_return dispute after the bulk update.
      const po = await db.purchaseOrder.findUnique({
        where: { id: poId, brokerId: broker.id },
        include: { dispatches: true, disputes: true },
      });
      if (!po) continue;
      const hasResolvedDefective = po.disputes.some(
        (d) => d.type === "defective_return" && d.status === "resolved",
      );
      if (!hasResolvedDefective) continue;

      const bill = await db.bill.findUnique({ where: { poId } });
      if (!bill || bill.brokerId !== broker.id) continue;

      const poItems = JSON.parse(po.lineItemsJson) as {
        setQty: number;
        unitPrice: number;
      }[];
      const poValue = poItems.reduce((s, i) => s + i.setQty * i.unitPrice, 0);
      const totalOrderedQty = poItems.reduce((s, i) => s + i.setQty, 0);
      const totalDispatchedQty = po.dispatches.reduce(
        (s, d) => s + d.dispatchedQty,
        0,
      );
      const shortShipmentValue =
        totalOrderedQty > totalDispatchedQty
          ? poValue * (1 - totalDispatchedQty / totalOrderedQty)
          : 0;
      const returnsValue = po.disputes
        .filter((d) => d.type === "defective_return" && d.status === "resolved")
        .reduce((s, d) => s + d.valueAffected, 0);
      const base = Math.max(0, poValue - shortShipmentValue - returnsValue);
      const gst = Math.round(base * (bill.gstRate / 100));
      const final = base + gst;

      const beforeBill = { ...bill };
      // updateMany scoped to brokerId for tenant safety.
      await db.bill.updateMany({
        where: { id: bill.id, brokerId: broker.id },
        data: { baseAmount: base, gstAmount: gst, finalAmount: final },
      });
      const updatedBill = { ...bill, baseAmount: base, gstAmount: gst, finalAmount: final };
      billsRecomputed += 1;

      await db.auditLog.create({
        data: {
          brokerId: broker.id,
          entityType: "Bill",
          entityId: bill.id,
          action: "update",
          before: JSON.stringify(beforeBill),
          after: JSON.stringify(updatedBill),
          userName: "System",
          reason:
            "Recomputed after dispute resolved (bulk).",
        },
      });
    }
  }

  // One consolidated audit-log entry for the dispute bulk action.
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "Dispute",
      entityId: beforeDisputes[0].id,
      action: "update",
      before: JSON.stringify(
        beforeDisputes.map((d) => ({
          id: d.id,
          poNumber: d.po.poNumber,
          status: d.status,
        })),
      ),
      after: JSON.stringify({
        status: newStatus,
        ids: beforeDisputes.map((d) => d.id),
        resolution: resolutionText,
        billsRecomputed,
      }),
      userName: "Broker",
      reason: `Bulk ${action}: ${result.count} dispute(s) → ${newStatus}` +
        (billsRecomputed > 0 ? ` (recomputed ${billsRecomputed} bill(s))` : ""),
    },
  });

  return NextResponse.json({ updated: result.count });
}
