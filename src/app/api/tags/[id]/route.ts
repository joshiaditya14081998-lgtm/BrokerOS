import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { isValidTagColor } from "@/lib/tags";
import { getCurrentBroker } from "@/lib/auth";

// DELETE /api/tags/[id] → cascade-deletes the tag + all its EntityTag entries.
// The cascade is configured on the Tag → EntityTag relation in schema.prisma,
// so a single delete handles both.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const before = await db.tag.findUnique({ where: { id } });
  if (!before || before.brokerId !== broker.id) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }
  await db.tag.deleteMany({ where: { id, brokerId: broker.id } });
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "Tag",
      entityId: id,
      action: "delete",
      before: JSON.stringify(before),
      userName: broker.fullName,
    },
  });
  return NextResponse.json({ ok: true });
}

const PatchSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().optional(),
});

// PATCH /api/tags/[id] → updates name and/or colour.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const before = await db.tag.findUnique({ where: { id } });
  if (!before || before.brokerId !== broker.id) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }
  const data: { name?: string; color?: string } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
  if (parsed.data.color !== undefined) {
    if (!isValidTagColor(parsed.data.color)) {
      return NextResponse.json({ error: "Invalid colour" }, { status: 400 });
    }
    data.color = parsed.data.color;
  }
  // If renaming, ensure the new name isn't already taken by another tag.
  if (data.name && data.name !== before.name) {
    const clash = await db.tag.findUnique({ where: { name: data.name } });
    if (clash) {
      return NextResponse.json(
        { error: "A tag with that name already exists." },
        { status: 409 },
      );
    }
  }
  const updateResult = await db.tag.updateMany({ where: { id, brokerId: broker.id }, data });
  if (updateResult.count === 0) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }
  const after = await db.tag.findUnique({ where: { id } });
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "Tag",
      entityId: id,
      action: "update",
      before: JSON.stringify(before),
      after: JSON.stringify(after),
      userName: broker.fullName,
    },
  });
  return NextResponse.json({
    tag: {
      id: after!.id,
      name: after!.name,
      color: after!.color,
      createdAt: after!.createdAt.toISOString(),
    },
  });
}
