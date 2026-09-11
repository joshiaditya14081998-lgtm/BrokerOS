import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const before = await db.visit.findUnique({ where: { id } });
  if (!before || before.brokerId !== broker.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id: _id, createdAt: _c, updatedAt: _u, brokerId: _b, plannedDate, actualDate, ...data } = body;
  const visit = await db.visit.update({
    where: { id },
    data: {
      ...data,
      plannedDate: plannedDate ? new Date(plannedDate) : undefined,
      actualDate: actualDate ? new Date(actualDate) : data.actualDate === null ? null : undefined,
    },
  });
  await db.auditLog.create({ data: { brokerId: broker.id, entityType: "Visit", entityId: id, action: "update", before: JSON.stringify(before), after: JSON.stringify(visit), userName: broker.fullName } });
  return NextResponse.json({ visit });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await db.visit.deleteMany({ where: { id, brokerId: broker.id } });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.auditLog.create({ data: { brokerId: broker.id, entityType: "Visit", entityId: id, action: "delete", userName: broker.fullName } });
  return NextResponse.json({ ok: true });
}
