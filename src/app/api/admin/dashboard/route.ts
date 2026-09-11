import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth";
import { ensureDefaultPlans } from "@/lib/admin-helpers";

export const dynamic = "force-dynamic";

// GET /api/admin/dashboard — platform-wide stats.
//
// Returns:
//   - totals: { brokers, activeTrials, paidSubscribers, suspended, superAdmins }
//   - mrr: sum of priceMonthly across all active/past_due subscriptions
//   - usageTotals: total clients/suppliers/POs/bills across ALL brokers
//   - newBrokersPerMonth: [{ label, value }] — last 6 months
//   - revenueByPlan: [{ name, displayName, price, subscribers, mrr }] —
//       per-plan distribution
//   - recentSignups: last 5 brokers
//
// This is the panel entry-point: a 403 from this route means the logged-in
// user is not a super admin, which the admin pages use to redirect to
// `/admin/login`.
export async function GET(_req: NextRequest) {
  let admin;
  try {
    admin = await requireSuperAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Ensure the four canonical plans exist (idempotent — no-op if seeded).
  await ensureDefaultPlans();

  const [
    brokers,
    suspended,
    superAdmins,
    activeTrials,
    paidSubscribers,
    totalClients,
    totalSuppliers,
    totalPOs,
    totalBills,
    subscriptionsWithPlan,
    recentSignupsRaw,
  ] = await Promise.all([
    db.broker.count(),
    db.broker.count({ where: { isSuspended: true } }),
    db.broker.count({ where: { isSuperAdmin: true } }),
    db.subscription.count({ where: { status: "trialing" } }),
    db.subscription.count({ where: { status: { in: ["active", "past_due"] } } }),
    db.client.count(),
    db.supplier.count(),
    db.purchaseOrder.count(),
    db.bill.count(),
    db.subscription.findMany({
      where: { status: { in: ["active", "past_due", "trialing"] } },
      include: { plan: true },
    }),
    db.broker.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { subscription: { include: { plan: true } } },
    }),
  ]);

  // MRR — sum of priceMonthly across active + past_due subscriptions.
  // Trialing brokers are excluded (they have not started paying yet).
  const mrr = subscriptionsWithPlan
    .filter((s) => s.status === "active" || s.status === "past_due")
    .reduce((sum, s) => sum + (s.plan?.priceMonthly ?? 0), 0);

  // New brokers per month — last 6 months.
  const now = new Date();
  const months: { label: string; start: Date; end: Date }[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    months.push({
      label: start.toLocaleDateString("en-IN", { month: "short" }),
      start,
      end,
    });
  }

  const allBrokersForTrend = await db.broker.findMany({
    select: { createdAt: true },
  });
  const newBrokersPerMonth = months.map((m) => ({
    label: m.label,
    value: allBrokersForTrend.filter((b) => b.createdAt >= m.start && b.createdAt < m.end).length,
  }));

  // Revenue by plan — per-plan distribution.
  const allPlans = await db.plan.findMany({
    orderBy: { priceMonthly: "asc" },
    include: { subscriptions: { where: { status: { in: ["active", "past_due", "trialing"] } } } },
  });
  const revenueByPlan = allPlans.map((p) => {
    const subscribers = p.subscriptions.length;
    const paying = p.subscriptions.filter((s) => s.status === "active" || s.status === "past_due").length;
    return {
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      price: p.priceMonthly,
      subscribers,
      payingSubscribers: paying,
      mrr: p.priceMonthly * paying,
    };
  });

  return NextResponse.json({
    admin: {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
    },
    totals: {
      brokers,
      suspended,
      superAdmins,
      activeTrials,
      paidSubscribers,
    },
    mrr,
    usageTotals: {
      clients: totalClients,
      suppliers: totalSuppliers,
      pos: totalPOs,
      bills: totalBills,
    },
    newBrokersPerMonth,
    revenueByPlan,
    recentSignups: recentSignupsRaw.map((b) => ({
      id: b.id,
      email: b.email,
      fullName: b.fullName,
      isSuspended: b.isSuspended,
      isSuperAdmin: b.isSuperAdmin,
      createdAt: b.createdAt.toISOString(),
      plan: b.subscription?.plan?.displayName ?? null,
      status: b.subscription?.status ?? null,
    })),
  });
}
