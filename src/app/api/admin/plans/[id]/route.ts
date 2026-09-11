import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { getCurrentSuperAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/admin/plans/[id] — update a plan (price, features, limits, etc.).
// Changes are audit-logged with before/after snapshots.
const PatchPlanSchema = z.object({
  displayName: z.string().min(1).max(40).optional(),
  priceMonthly: z.number().min(0).optional(),
  priceYearly: z.number().min(0).optional(),
  maxClients: z.number().int().optional(),
  maxSuppliers: z.number().int().optional(),
  maxPOs: z.number().int().optional(),
  maxPhotos: z.number().int().optional(),
  portalAccess: z.boolean().optional(),
  aiDigest: z.boolean().optional(),
  customReports: z.boolean().optional(),
  advancedAnalytics: z.boolean().optional(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const admin = await getCurrentSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = PatchPlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const existing = await db.plan.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const updated = await db.plan.update({ where: { id }, data });

  await db.adminAuditLog.create({
    data: {
      adminId: admin.id,
      action: "update_plan",
      targetType: "Plan",
      targetId: id,
      before: JSON.stringify(existing),
      after: JSON.stringify(updated),
      reason: null,
    },
  });

  return NextResponse.json({ plan: updated });
}

// DELETE /api/admin/plans/[id] — deactivate a plan (soft delete).
// The plan row is kept for historical subscription references; `isActive`
// is set to false so it can no longer be chosen for new subscriptions.
// A hard delete is forbidden because existing Subscription rows reference
// the Plan — deleting would cascade-cancel historical billing records.
export async function DELETE(req: NextRequest, { params }: Params) {
  const admin = await getCurrentSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const existing = await db.plan.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // Refuse to deactivate the "free" plan — brokers always need at least one
  // active plan to fall back to.
  if (existing.name === "free") {
    return NextResponse.json(
      { error: "The Free plan cannot be deactivated — brokers need at least one fallback plan." },
      { status: 400 },
    );
  }

  const updated = await db.plan.update({
    where: { id },
    data: { isActive: false },
  });

  await db.adminAuditLog.create({
    data: {
      adminId: admin.id,
      action: "deactivate_plan",
      targetType: "Plan",
      targetId: id,
      before: JSON.stringify(existing),
      after: JSON.stringify(updated),
      reason: null,
    },
  });

  return NextResponse.json({ success: true, plan: updated });
}
