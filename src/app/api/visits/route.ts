import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { getCurrentBroker } from "@/lib/auth";

const VisitSchema = z.object({
  clientId: z.string().min(1),
  plannedDate: z.string(),
  actualDate: z.string().optional().nullable(),
  status: z.enum(["scheduled", "followed_up", "occurred", "no_show"]).default("scheduled"),
  notes: z.string().optional().nullable(),
});

export async function GET(_req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const visits = await db.visit.findMany({
    where: { brokerId: broker.id },
    include: {
      client: { select: { name: true, phone: true } },
      bookings: { include: { supplier: { select: { name: true } }, purchaseOrder: { select: { poNumber: true, status: true, totalValue: true } } } },
    },
    orderBy: { plannedDate: "desc" },
  });
  return NextResponse.json({ visits });
}

export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = VisitSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { plannedDate, actualDate, ...rest } = parsed.data;
  const visit = await db.visit.create({
    data: { ...rest, brokerId: broker.id, plannedDate: new Date(plannedDate), actualDate: actualDate ? new Date(actualDate) : null },
    include: { client: { select: { name: true } } },
  });
  await db.auditLog.create({ data: { brokerId: broker.id, entityType: "Visit", entityId: visit.id, action: "create", after: JSON.stringify(visit), userName: broker.fullName } });
  return NextResponse.json({ visit });
}
