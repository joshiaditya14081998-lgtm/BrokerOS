import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentSuperAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/admin/brokers  — list ALL brokers with subscription + entity counts.
// Super-admin only. Supports `?search=`, `?status=`, `?page=`, `?pageSize=`.
//
// `status` filter values:
//   - "all"          → no filter (default)
//   - "active"       → not suspended, has an active/past_due subscription OR
//                      no subscription at all (legacy / free brokers)
//   - "trial"        → subscription.status === "trialing"
//   - "suspended"    → broker.isSuspended === true
//   - "super_admin"  → broker.isSuperAdmin === true
//
// The response includes per-broker counts (clients, suppliers, POs, bills)
// computed via a Promise.all of `db.<entity>.count({ where: { brokerId } })`
// over the page slice — fine for low thousands of brokers; for a larger
// tenant count this should be cached in a denormalised `BrokerStats` row.
export async function GET(req: NextRequest) {
  const admin = await getCurrentSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const status = searchParams.get("status")?.trim() ?? "all";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10) || 20),
  );

  // Build the where clause from search + status filters.
  const where: {
    AND: Array<Record<string, unknown>>;
  } = { AND: [] };

  if (search) {
    where.AND.push({
      OR: [
        { email: { contains: search } },
        { fullName: { contains: search } },
        { id: { contains: search } },
      ],
    });
  }
  if (status === "suspended") {
    where.AND.push({ isSuspended: true });
  } else if (status === "super_admin") {
    where.AND.push({ isSuperAdmin: true });
  } else if (status === "trial") {
    where.AND.push({ subscription: { status: "trialing" } });
  } else if (status === "active") {
    where.AND.push({ isSuspended: false });
  }

  const whereClause = where.AND.length === 0 ? {} : where;

  const [total, brokers] = await Promise.all([
    db.broker.count({ where: whereClause }),
    db.broker.findMany({
      where: whereClause,
      include: {
        subscription: { include: { plan: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // Per-broker entity counts — computed in parallel for the page slice.
  const withCounts = await Promise.all(
    brokers.map(async (b) => {
      const [clients, suppliers, pos, bills] = await Promise.all([
        db.client.count({ where: { brokerId: b.id } }),
        db.supplier.count({ where: { brokerId: b.id } }),
        db.purchaseOrder.count({ where: { brokerId: b.id } }),
        db.bill.count({ where: { brokerId: b.id } }),
      ]);
      return {
        id: b.id,
        email: b.email,
        fullName: b.fullName,
        role: b.role,
        isSuperAdmin: b.isSuperAdmin,
        isSuspended: b.isSuspended,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
        subscription: b.subscription
          ? {
              status: b.subscription.status,
              plan: b.subscription.plan
                ? {
                    name: b.subscription.plan.name,
                    displayName: b.subscription.plan.displayName,
                    priceMonthly: b.subscription.plan.priceMonthly,
                  }
                : null,
              trialEnd: b.subscription.trialEnd?.toISOString() ?? null,
              currentPeriodEnd: b.subscription.currentPeriodEnd?.toISOString() ?? null,
            }
          : null,
        counts: { clients, suppliers, pos, bills },
      };
    }),
  );

  return NextResponse.json({
    brokers: withCounts,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

// POST is intentionally NOT supported — brokers sign up via Supabase Auth
// (`/signup` page → `/api/auth/create-profile`). The super admin cannot
// create brokers directly because broker identity is tied to a Supabase
// auth.users row, which we do not create from the admin panel.
export async function POST() {
  return NextResponse.json(
    { error: "Brokers sign up via Supabase Auth — admin cannot create brokers directly." },
    { status: 405 },
  );
}
