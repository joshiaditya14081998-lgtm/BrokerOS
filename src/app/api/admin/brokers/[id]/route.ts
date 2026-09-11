import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { getCurrentSuperAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/brokers/[id] — broker detail with full stats.
export async function GET(_req: NextRequest, { params }: Params) {
  const admin = await getCurrentSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const broker = await db.broker.findUnique({
    where: { id },
    include: {
      subscription: { include: { plan: true } },
    },
  });

  if (!broker) {
    return NextResponse.json({ error: "Broker not found" }, { status: 404 });
  }

  // Full entity counts across the broker's tenant.
  const [clients, suppliers, pos, dispatches, bills, payments, brokerages, payouts, disputes, photos, notifications, auditLogs] =
    await Promise.all([
      db.client.count({ where: { brokerId: id } }),
      db.supplier.count({ where: { brokerId: id } }),
      db.purchaseOrder.count({ where: { brokerId: id } }),
      db.dispatch.count({ where: { brokerId: id } }),
      db.bill.count({ where: { brokerId: id } }),
      db.payment.count({ where: { brokerId: id } }),
      db.brokerage.count({ where: { brokerId: id } }),
      db.brokeragePayout.count({ where: { brokerId: id } }),
      db.dispute.count({ where: { brokerId: id } }),
      db.photo.count({ where: { brokerId: id } }),
      db.notification.count({ where: { brokerId: id } }),
      db.auditLog.count({ where: { brokerId: id } }),
    ]);

  // Financial totals — outstanding bills + total brokerage earned + paid out.
  const financials = await db.bill.aggregate({
    where: { brokerId: id },
    _sum: { finalAmount: true, paidAmount: true },
  });
  const brokerageFinancials = await db.brokerage.aggregate({
    where: { brokerId: id },
    _sum: { brokerageAmount: true },
  });
  const payoutFinancials = await db.brokeragePayout.aggregate({
    where: { brokerId: id, status: "paid" },
    _sum: { totalAmount: true },
  });

  // Recent activity — last 10 audit logs (so the admin can see the broker's
  // latest mutations at a glance).
  const recentActivity = await db.auditLog.findMany({
    where: { brokerId: id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      entityType: true,
      action: true,
      reason: true,
      userName: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    broker: {
      id: broker.id,
      email: broker.email,
      fullName: broker.fullName,
      role: broker.role,
      isSuperAdmin: broker.isSuperAdmin,
      isSuspended: broker.isSuspended,
      createdAt: broker.createdAt.toISOString(),
      updatedAt: broker.updatedAt.toISOString(),
      subscription: broker.subscription
        ? {
            id: broker.subscription.id,
            status: broker.subscription.status,
            trialStart: broker.subscription.trialStart?.toISOString() ?? null,
            trialEnd: broker.subscription.trialEnd?.toISOString() ?? null,
            currentPeriodStart: broker.subscription.currentPeriodStart?.toISOString() ?? null,
            currentPeriodEnd: broker.subscription.currentPeriodEnd?.toISOString() ?? null,
            canceledAt: broker.subscription.canceledAt?.toISOString() ?? null,
            plan: broker.subscription.plan,
          }
        : null,
    },
    counts: {
      clients, suppliers, pos, dispatches, bills, payments, brokerages,
      payouts, disputes, photos, notifications, auditLogs,
    },
    financials: {
      totalBilled: financials._sum.finalAmount ?? 0,
      totalPaid: financials._sum.paidAmount ?? 0,
      outstanding: (financials._sum.finalAmount ?? 0) - (financials._sum.paidAmount ?? 0),
      brokerageEarned: brokerageFinancials._sum.brokerageAmount ?? 0,
      payoutsPaid: payoutFinancials._sum.totalAmount ?? 0,
    },
    recentActivity: recentActivity.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

// PATCH /api/admin/brokers/[id] — suspend/activate or change role.
// Body: { isSuspended?: boolean, role?: "admin"|"broker"|"staff"|"viewer" }
//
// Safety: a super admin cannot suspend or demote themselves, and cannot
// remove their own `isSuperAdmin` flag (defensive — would lock the SaaS
// owner out). The self-guard is enforced here so a buggy UI cannot bypass it.
const PatchSchema = z.object({
  isSuspended: z.boolean().optional(),
  role: z.enum(["admin", "broker", "staff", "viewer"]).optional(),
  isSuperAdmin: z.boolean().optional(),
  reason: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const admin = await getCurrentSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Self-guard: super admin cannot suspend/demote themselves.
  if (id === admin.id) {
    if (parsed.data.isSuspended === true) {
      return NextResponse.json(
        { error: "You cannot suspend your own super admin account." },
        { status: 400 },
      );
    }
    if (parsed.data.isSuperAdmin === false) {
      return NextResponse.json(
        { error: "You cannot remove your own super admin flag." },
        { status: 400 },
      );
    }
    if (parsed.data.role !== undefined && parsed.data.role !== admin.role) {
      return NextResponse.json(
        { error: "You cannot change your own role." },
        { status: 400 },
      );
    }
  }

  const existing = await db.broker.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Broker not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.isSuspended !== undefined) data.isSuspended = parsed.data.isSuspended;
  if (parsed.data.role !== undefined) data.role = parsed.data.role;
  if (parsed.data.isSuperAdmin !== undefined) data.isSuperAdmin = parsed.data.isSuperAdmin;

  const updated = await db.broker.update({ where: { id }, data });

  // AdminAuditLog — snapshot before + after so we can replay the change.
  const action =
    parsed.data.isSuspended === true
      ? "suspend_broker"
      : parsed.data.isSuspended === false
        ? "activate_broker"
        : parsed.data.role !== undefined
          ? "change_role"
          : parsed.data.isSuperAdmin !== undefined
            ? "change_super_admin_flag"
            : "update_broker";

  await db.adminAuditLog.create({
    data: {
      adminId: admin.id,
      action,
      targetType: "Broker",
      targetId: id,
      before: JSON.stringify({
        isSuspended: existing.isSuspended,
        role: existing.role,
        isSuperAdmin: existing.isSuperAdmin,
      }),
      after: JSON.stringify({
        isSuspended: updated.isSuspended,
        role: updated.role,
        isSuperAdmin: updated.isSuperAdmin,
      }),
      reason: parsed.data.reason ?? null,
    },
  });

  return NextResponse.json({
    broker: {
      id: updated.id,
      email: updated.email,
      fullName: updated.fullName,
      role: updated.role,
      isSuperAdmin: updated.isSuperAdmin,
      isSuspended: updated.isSuspended,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}

// DELETE /api/admin/brokers/[id] — delete a broker + all their data (cascade).
//
// All related tables have `onDelete: Cascade` on the `brokerId` FK, so a
// single `db.broker.delete` cascades through clients, suppliers, visits,
// bookings, POs, dispatches, bills, payments, brokerages, payouts, disputes,
// photos, notifications, audit logs, saved views, report templates, tags,
// and the subscription row. We log the action to AdminAuditLog BEFORE the
// delete (with a snapshot of the broker row + their entity counts) so the
// audit trail survives the cascade.
//
// Safety: the super admin cannot delete themselves (would lock the SaaS
// owner out).
export async function DELETE(req: NextRequest, { params }: Params) {
  const admin = await getCurrentSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  if (id === admin.id) {
    return NextResponse.json(
      { error: "You cannot delete your own super admin account." },
      { status: 400 },
    );
  }

  const existing = await db.broker.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Broker not found" }, { status: 404 });
  }

  // Snapshot counts for the audit log (so we can prove what was deleted).
  const [clients, suppliers, pos, bills, payments] = await Promise.all([
    db.client.count({ where: { brokerId: id } }),
    db.supplier.count({ where: { brokerId: id } }),
    db.purchaseOrder.count({ where: { brokerId: id } }),
    db.bill.count({ where: { brokerId: id } }),
    db.payment.count({ where: { brokerId: id } }),
  ]);

  // Audit BEFORE the cascade (Broker row snapshot + counts).
  await db.adminAuditLog.create({
    data: {
      adminId: admin.id,
      action: "delete_broker",
      targetType: "Broker",
      targetId: id,
      before: JSON.stringify({
        broker: {
          id: existing.id,
          email: existing.email,
          fullName: existing.fullName,
          role: existing.role,
          isSuperAdmin: existing.isSuperAdmin,
          isSuspended: existing.isSuspended,
        },
        counts: { clients, suppliers, pos, bills, payments },
      }),
      after: null,
      reason: new URL(req.url).searchParams.get("reason") ?? null,
    },
  });

  // Cascade delete — Prisma handles the cascade through the FK onDelete:
  // Cascade on every related table. The single `broker.delete` removes
  // the broker row and ALL dependent rows.
  await db.broker.delete({ where: { id } });

  return NextResponse.json({ success: true, deletedId: id });
}
