import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { z } from "zod";
import { reportError } from "@/lib/error-report";
import { invalidateBrokerCache } from "@/lib/cache";
import { withRateLimit } from "@/lib/api-middleware";

const PaymentSchema = z.object({
  billId: z.string().min(1),
  amount: z.number().min(0.01),
  date: z.string(),
  mode: z.enum(["cash", "cheque", "bank_transfer", "upi", "other"]).default("bank_transfer"),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// GET /api/payments
export async function GET(_req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payments = await db.payment.findMany({
    where: { brokerId: broker.id },
    include: { bill: { select: { billNumber: true, po: { select: { poNumber: true } } } }, client: { select: { name: true } } },
    orderBy: { date: "desc" },
  });
  invalidateBrokerCache(broker.id); return NextResponse.json({ payments });
}

// POST /api/payments — logs a payment, updates bill paidAmount + status, triggers brokerage eligibility on full payment.
// Rate-limited at 20 req/min per IP — financial mutation surface, so stricter
// than the entity-create endpoints.
export const POST = withRateLimit(
  async (req: NextRequest) => {
    try {
      const broker = await getCurrentBroker();
      if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const body = await req.json();
      const parsed = PaymentSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      const { billId, amount, date, mode, reference, notes } = parsed.data;

      // Bill must belong to this broker.
      const bill = await db.bill.findUnique({ where: { id: billId, brokerId: broker.id }, include: { client: true } });
      if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 400 });

      const payment = await db.payment.create({
        data: { brokerId: broker.id, billId, clientId: bill.clientId, amount, date: new Date(date), mode, reference, notes },
      });

      // Update bill running totals + status — use updateMany scoped to brokerId for safety.
      const allPayments = await db.payment.findMany({ where: { billId, brokerId: broker.id } });
      const totalPaid = allPayments.reduce((s, p) => s + p.amount, 0);
      const newStatus = totalPaid >= bill.finalAmount ? "fully_paid" : totalPaid > 0 ? "partially_paid" : "pending";

      await db.bill.updateMany({ where: { id: billId, brokerId: broker.id }, data: { paidAmount: totalPaid, status: newStatus } });
      const updatedBill = { ...bill, paidAmount: totalPaid, status: newStatus };

      // If bill just became fully paid → mark brokerage eligible
      if (newStatus === "fully_paid" && bill.status !== "fully_paid") {
        // Brokerage is unique per bill AND scoped to broker.
        const brokerage = await db.brokerage.findUnique({ where: { billId } });
        if (brokerage && brokerage.brokerId === broker.id && !brokerage.eligible) {
          await db.brokerage.update({
            where: { id: brokerage.id },
            data: { eligible: true, eligibleAt: new Date(), payoutStatus: brokerage.payoutStatus === "accrued" ? "scheduled" : brokerage.payoutStatus },
          });
          await db.auditLog.create({
            data: {
              brokerId: broker.id,
              entityType: "Brokerage", entityId: brokerage.id, action: "force_eligible",
              after: JSON.stringify({ eligible: true, eligibleAt: new Date() }),
              userName: "System", reason: "Auto-eligible: Bill status became fully_paid.",
            },
          });

          // For immediate-cadence clients, auto-create payout as scheduled
          if (bill.client.payoutCadence === "immediate") {
            const payout = await db.brokeragePayout.create({
              data: {
                brokerId: broker.id,
                clientId: bill.clientId, cadence: "immediate",
                periodStart: new Date(), periodEnd: new Date(),
                totalAmount: brokerage.brokerageAmount, status: "scheduled",
                brokerages: { connect: { id: brokerage.id } },
              },
            });
            await db.brokerage.update({
              where: { id: brokerage.id },
              data: { payoutStatus: "scheduled", payoutId: payout.id },
            });
            await db.auditLog.create({
              data: {
                brokerId: broker.id,
                entityType: "BrokeragePayout", entityId: payout.id, action: "create",
                after: JSON.stringify(payout), userName: "System",
                reason: "Auto-scheduled: client cadence = immediate.",
              },
            });
          }
        }
      }

      await db.auditLog.create({
        data: {
          brokerId: broker.id,
          entityType: "Payment", entityId: payment.id, action: "create",
          after: JSON.stringify(payment), userName: "Broker",
          reason: `Bill ${bill.billNumber} status → ${newStatus}.`,
        },
      });
      invalidateBrokerCache(broker.id); return NextResponse.json({ payment, bill: updatedBill });
    } catch (error) {
      reportError(error, { path: "/api/payments", method: "POST" });
      return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
    }
  },
  20,
  60_000,
);
