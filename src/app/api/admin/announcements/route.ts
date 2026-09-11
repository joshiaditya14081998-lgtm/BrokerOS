import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { getCurrentSuperAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/admin/announcements — broadcast a notification to ALL brokers.
//
// Body: { title, message, type }
//   - type: one of "info" | "warning" | "maintenance" | "billing" (default "info")
//
// Creates one Notification row per broker (so each broker's bell badge
// reflects the announcement) and a single AdminAuditLog entry recording
// the broadcast.
const AnnouncementSchema = z.object({
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(2000),
  type: z.enum(["info", "warning", "maintenance", "billing"]).default("info"),
});

export async function POST(req: NextRequest) {
  const admin = await getCurrentSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = AnnouncementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { title, message, type } = parsed.data;

  // All brokers — including suspended ones, so the announcement reaches
  // everyone when they next log in.
  const brokers = await db.broker.findMany({ select: { id: true } });
  if (brokers.length === 0) {
    return NextResponse.json({ success: true, recipients: 0, message: "No brokers to notify." });
  }

  // Build one notification row per broker — due 1 hour from now so it surfaces
  // in the broker's bell badge immediately.
  const due = new Date(Date.now() + 60 * 60 * 1000);
  await db.notification.createMany({
    data: brokers.map((b) => ({
      brokerId: b.id,
      type: `announcement_${type}`,
      title,
      message,
      dueDate: due,
      status: "pending",
    })),
    skipDuplicates: false,
  });

  // Audit log entry — one row recording the broadcast (recipient count +
  // the title so we can see what was sent without leaking the message body).
  await db.adminAuditLog.create({
    data: {
      adminId: admin.id,
      action: "send_announcement",
      targetType: "Notification",
      targetId: null,
      before: null,
      after: JSON.stringify({
        title,
        type,
        recipientCount: brokers.length,
        messageLength: message.length,
      }),
      reason: null,
    },
  });

  return NextResponse.json({
    success: true,
    recipients: brokers.length,
    title,
    type,
  });
}
