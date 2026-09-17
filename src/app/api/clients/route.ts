import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { getCurrentBroker } from "@/lib/auth";
import { checkLimit } from "@/lib/usage-limits";
import { withRateLimit } from "@/lib/api-middleware";

const ClientSchema = z.object({
  name: z.string().min(1).max(100),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  gstNo: z.string().optional().nullable(),
  defaultPaymentCycleDays: z.number().int().min(0).default(120),
  payoutCadence: z.enum(["immediate", "4_month_cumulative", "12_month_cumulative"]).default("immediate"),
  gstRate: z.number().min(0).max(100).default(5),
  notes: z.string().optional().nullable(),
});

// GET /api/clients  ?detail=true returns full ledger/stats per client
export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const detail = searchParams.get("detail") === "true";
  if (detail) {
    const clients = await db.client.findMany({
      where: { brokerId: broker.id },
      include: {
        visits: { select: { id: true, status: true, plannedDate: true }, orderBy: { plannedDate: "desc" }, take: 5 },
        bills: { select: { id: true, finalAmount: true, paidAmount: true, status: true, createdAt: true } },
        brokerages: { select: { id: true, brokerageAmount: true, eligible: true, payoutStatus: true } },
        tags: { include: { tag: { select: { id: true, name: true, color: true } } }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    const now = new Date();
    const months: { label: string; start: Date; end: Date }[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      months.push({ label: start.toLocaleDateString("en-IN", { month: "short" }), start, end });
    }
    const rows = clients.map((c) => {
      const outstanding = c.bills.reduce((s, b) => s + (b.finalAmount - b.paidAmount), 0);
      const totalBusiness = c.bills.reduce((s, b) => s + b.finalAmount, 0);
      const brokerageEarned = c.brokerages.filter((b) => b.eligible).reduce((s, b) => s + b.brokerageAmount, 0);
      const openPOs = c.bills.filter((b) => b.status !== "fully_paid").length;
      const volumeTrend = months.map((m) => ({
        label: m.label,
        value: c.bills.filter((b) => b.createdAt >= m.start && b.createdAt < m.end).reduce((s, b) => s + b.finalAmount, 0),
      }));
      return {
        id: c.id, name: c.name, contactPerson: c.contactPerson, phone: c.phone, email: c.email, address: c.address,
        gstNo: c.gstNo, defaultPaymentCycleDays: c.defaultPaymentCycleDays, payoutCadence: c.payoutCadence,
        gstRate: c.gstRate, notes: c.notes,
        totalBusiness, outstanding, brokerageEarned, openPOs,
        visitCount: c.visits.length, lastVisit: c.visits[0]?.plannedDate ?? null,
        volumeTrend,
        tags: c.tags.map((et) => et.tag),
      };
    });
    return NextResponse.json({ clients: rows });
  }
  const clients = await db.client.findMany({ where: { brokerId: broker.id }, orderBy: { name: "asc" } });
  return NextResponse.json({ clients });
}

// POST /api/clients — create a client (rate-limited at 30 creates/min per IP).
export const POST = withRateLimit(
  async (req: NextRequest) => {
    const broker = await getCurrentBroker();
    if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const parsed = ClientSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    // Usage-limit check — refuse to create if the broker's plan is at capacity.
    // 402 Payment Required is the conventional HTTP code for "upgrade to do this".
    const limit = await checkLimit(broker.id, "clients");
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: "Client limit reached. Upgrade to add more clients.",
          current: limit.current,
          limit: limit.limit,
          planName: limit.planName,
        },
        { status: 402 },
      );
    }

    const client = await db.client.create({ data: { ...parsed.data, brokerId: broker.id } });
    await db.auditLog.create({
      data: { brokerId: broker.id, entityType: "Client", entityId: client.id, action: "create", after: JSON.stringify(client), userName: broker.fullName },
    });
    return NextResponse.json({ client });
  },
  30,
  60_000,
);
