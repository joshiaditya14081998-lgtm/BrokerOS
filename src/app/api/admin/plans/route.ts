import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { getCurrentSuperAdmin } from "@/lib/auth";
import { ensureDefaultPlans } from "@/lib/admin-helpers";

export const dynamic = "force-dynamic";

// GET /api/admin/plans — all plans, ordered by price ascending.
// Auto-creates the four canonical plans if any are missing.
export async function GET() {
  const admin = await getCurrentSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const plans = await ensureDefaultPlans();
  return NextResponse.json({
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      priceMonthly: p.priceMonthly,
      priceYearly: p.priceYearly,
      maxClients: p.maxClients,
      maxSuppliers: p.maxSuppliers,
      maxPOs: p.maxPOs,
      maxPhotos: p.maxPhotos,
      portalAccess: p.portalAccess,
      aiDigest: p.aiDigest,
      customReports: p.customReports,
      advancedAnalytics: p.advancedAnalytics,
      description: p.description,
      isActive: p.isActive,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
}

// POST /api/admin/plans — create a new plan.
const CreatePlanSchema = z.object({
  name: z.string().min(2).max(40).regex(/^[a-z0-9_]+$/, "name must be lowercase + underscore"),
  displayName: z.string().min(1).max(40),
  priceMonthly: z.number().min(0).default(0),
  priceYearly: z.number().min(0).default(0),
  maxClients: z.number().int().default(-1),
  maxSuppliers: z.number().int().default(-1),
  maxPOs: z.number().int().default(-1),
  maxPhotos: z.number().int().default(-1),
  portalAccess: z.boolean().default(false),
  aiDigest: z.boolean().default(false),
  customReports: z.boolean().default(false),
  advancedAnalytics: z.boolean().default(false),
  description: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  const admin = await getCurrentSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = CreatePlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // Enforce unique name at the DB layer — return a clean 409 if it collides.
  const existing = await db.plan.findUnique({ where: { name: data.name } });
  if (existing) {
    return NextResponse.json(
      { error: `A plan named "${data.name}" already exists.` },
      { status: 409 },
    );
  }

  const plan = await db.plan.create({ data });

  await db.adminAuditLog.create({
    data: {
      adminId: admin.id,
      action: "create_plan",
      targetType: "Plan",
      targetId: plan.id,
      before: null,
      after: JSON.stringify(plan),
      reason: null,
    },
  });

  return NextResponse.json({ plan }, { status: 201 });
}
