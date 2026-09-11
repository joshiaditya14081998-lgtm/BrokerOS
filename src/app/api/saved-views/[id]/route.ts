import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import {
  isValidSavedViewIcon,
  toSavedViewDTO,
} from "@/lib/saved-views";
import { getCurrentBroker } from "@/lib/auth";

// DELETE /api/saved-views/[id]
//
// Removes a single SavedView. The bar / management page both call this from
// the user's "delete" affordance (after a confirm dialog on the client).
//
// Response: { ok: true }
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const before = await db.savedView.findUnique({ where: { id } });
  if (!before || before.brokerId !== broker.id) {
    return NextResponse.json({ error: "Saved view not found" }, { status: 404 });
  }
  await db.savedView.deleteMany({ where: { id, brokerId: broker.id } });
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "SavedView",
      entityId: id,
      action: "delete",
      before: JSON.stringify(before),
      userName: broker.fullName,
      reason: `Deleted saved view "${before.name}" (${before.view})`,
    },
  });
  return NextResponse.json({ ok: true });
}

const PatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  filterJson: z.string().min(2).optional(),
  icon: z.string().max(20).optional(),
});

// PATCH /api/saved-views/[id]
//
// Body: { name?, filterJson?, icon? }
//
// Updates one or more of: the saved view's display name, its stored filter
// state (e.g. when the user re-saves an existing preset with the current
// filter), or its icon. `view` and `entityType` are intentionally NOT
// patchable — a saved view's view-type is fixed at creation; if the user
// wants to change it they should delete + recreate.
//
// Response: { savedView: SavedViewDTO }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const before = await db.savedView.findUnique({ where: { id } });
  if (!before || before.brokerId !== broker.id) {
    return NextResponse.json({ error: "Saved view not found" }, { status: 404 });
  }

  const data: { name?: string; filterJson?: string; icon?: string } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
  if (parsed.data.filterJson !== undefined) {
    // Validate JSON shape — refuse to persist invalid JSON.
    try {
      JSON.parse(parsed.data.filterJson);
    } catch {
      return NextResponse.json(
        { error: "filterJson must be valid JSON" },
        { status: 400 },
      );
    }
    data.filterJson = parsed.data.filterJson;
  }
  if (parsed.data.icon !== undefined) {
    if (!isValidSavedViewIcon(parsed.data.icon)) {
      return NextResponse.json({ error: "Invalid icon" }, { status: 400 });
    }
    data.icon = parsed.data.icon;
  }

  const updateResult = await db.savedView.updateMany({ where: { id, brokerId: broker.id }, data });
  if (updateResult.count === 0) {
    return NextResponse.json({ error: "Saved view not found" }, { status: 404 });
  }
  const sv = await db.savedView.findUnique({ where: { id } });
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "SavedView",
      entityId: id,
      action: "update",
      before: JSON.stringify(before),
      after: JSON.stringify(sv),
      userName: broker.fullName,
      reason: `Updated saved view "${sv!.name}"`,
    },
  });
  return NextResponse.json({ savedView: toSavedViewDTO(sv!) });
}
