import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

// PATCH /api/notifications/bulk
// Body: { ids: string[], action: "done" | "dismissed" | "pending" }
// Updates all notifications with the given IDs to the requested status,
// writes a single AuditLog entry summarizing the bulk action, and returns
// the count actually updated.
export async function PATCH(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const ids: unknown = body?.ids;
  const action: unknown = body?.action;

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

  if (action !== "done" && action !== "dismissed" && action !== "pending") {
    return NextResponse.json(
      { error: "`action` must be one of: done, dismissed, pending" },
      { status: 400 },
    );
  }

  // Capture the "before" snapshot for the audit trail — scoped to this broker.
  const before = await db.notification.findMany({
    where: { id: { in: ids }, brokerId: broker.id },
    select: { id: true, title: true, type: true, status: true },
  });

  if (before.length === 0) {
    return NextResponse.json({ updated: 0 });
  }

  const scopedIds = before.map((n) => n.id);

  const result = await db.notification.updateMany({
    where: { id: { in: scopedIds }, brokerId: broker.id },
    data: { status: action },
  });

  // One consolidated audit-log entry summarizing the bulk action.
  // `entityId` is required by the schema — use the first affected id as the
  // anchor and encode the full id set + before snapshot in the after/reason
  // fields so an auditor can reconstruct the full batch.
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "Notification",
      entityId: before[0].id,
      action: "update",
      before: JSON.stringify(before),
      after: JSON.stringify({ status: action, ids: scopedIds }),
      userName: "Broker",
      reason: `Bulk update: ${result.count} notification(s) → ${action}`,
    },
  });

  return NextResponse.json({ updated: result.count });
}
