import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentSuperAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/admin/subscriptions — all subscriptions with broker + plan details.
// Supports `?status=` filter (trialing | active | past_due | canceled | paused | all)
// and `?page=` + `?pageSize=` pagination.
export async function GET(req: NextRequest) {
  const admin = await getCurrentSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status")?.trim() ?? "all";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10) || 20),
  );

  const validStatuses = ["trialing", "active", "past_due", "canceled", "paused"];
  const where = status && status !== "all" && validStatuses.includes(status)
    ? { status }
    : {};

  const [total, subscriptions] = await Promise.all([
    db.subscription.count({ where }),
    db.subscription.findMany({
      where,
      include: {
        broker: { select: { id: true, email: true, fullName: true, isSuspended: true } },
        plan: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // Per-status distribution (for the chart in the admin Subscriptions page).
  const statusGroups = await db.subscription.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const byStatus: Record<string, number> = {};
  for (const g of statusGroups) byStatus[g.status] = g._count._all;

  return NextResponse.json({
    subscriptions: subscriptions.map((s) => ({
      id: s.id,
      brokerId: s.brokerId,
      broker: s.broker,
      plan: s.plan
        ? {
            id: s.plan.id,
            name: s.plan.name,
            displayName: s.plan.displayName,
            priceMonthly: s.plan.priceMonthly,
          }
        : null,
      status: s.status,
      trialStart: s.trialStart?.toISOString() ?? null,
      trialEnd: s.trialEnd?.toISOString() ?? null,
      currentPeriodStart: s.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
      canceledAt: s.canceledAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    byStatus,
  });
}
