import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

export async function GET(_req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const notifications = await db.notification.findMany({
    where: { brokerId: broker.id },
    orderBy: { dueDate: "asc" },
  });
  return NextResponse.json({ notifications });
}

export async function PATCH(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, status } = body as { id: string; status: string };

  // updateMany scoped to brokerId — a no-op if the notification belongs to another broker.
  const result = await db.notification.updateMany({
    where: { id, brokerId: broker.id },
    data: { status },
  });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const notification = await db.notification.findUnique({ where: { id } });
  return NextResponse.json({ notification });
}
