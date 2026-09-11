import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/settings → returns all system settings + derived defaults.
//
// NOTE: SystemSetting is system-wide (no brokerId in the schema), so all
// settings are shared across brokers for now. The auth check still runs so
// only authenticated brokers can read/write them — a future migration could
// add brokerId to scope per-broker overrides.
export async function GET() {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await db.systemSetting.findMany({ orderBy: { key: "asc" } });

  // Convenience map for the UI
  const byKey: Record<string, { value: string; notes: string | null }> = {};
  for (const s of settings) byKey[s.key] = { value: s.value, notes: s.notes };

  const lastBackupRaw = byKey.last_backup_at?.value ?? null;
  const lastBackupAt = lastBackupRaw && !Number.isNaN(new Date(lastBackupRaw).getTime()) ? lastBackupRaw : null;

  const defaults = {
    defaultGstRate: Number(byKey.default_gst_rate?.value ?? "5"),
    defaultCommissionRate: Number(byKey.default_commission_rate?.value ?? "5"),
    brokerageOnGst: String(byKey.brokerage_on_gst?.value ?? "false").toLowerCase() === "true",
    autoGenerateNotifications: String(byKey.auto_generate_notifications?.value ?? "true").toLowerCase() === "true",
    autoBackupEnabled: String(byKey.auto_backup_enabled?.value ?? "false").toLowerCase() === "true",
    lastBackupAt,
    autoDigestEnabled: String(byKey.auto_digest_enabled?.value ?? "true").toLowerCase() === "true",
    digestEmail: byKey.digest_email?.value ?? "",
    // Email notification digest (Sprint 3 — outbound email plumbing).
    // Defaults: disabled (off until the broker opts in), daily cadence,
    // and a blank recipient (the broker's profile email is the fallback
    // at send time — see POST /api/notifications/email).
    emailNotificationsEnabled: String(byKey.email_notifications_enabled?.value ?? "false").toLowerCase() === "true",
    emailDigestFrequency: byKey.email_digest_frequency?.value ?? "daily",
    emailAddress: byKey.email_address?.value ?? "",
  };

  return NextResponse.json({ settings, defaults });
}

const SettingSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.string().min(0).max(2048),
  notes: z.string().optional().nullable(),
});

// POST /api/settings → upsert a setting by key, audit-logged.
export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = SettingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { key, value, notes } = parsed.data;

  const existing = await db.systemSetting.findUnique({ where: { key } });
  const before = existing ? JSON.stringify(existing) : null;

  const setting = await db.systemSetting.upsert({
    where: { key },
    create: { key, value, notes: notes ?? null },
    update: { value, notes: notes ?? null },
  });

  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: "SystemSetting",
      entityId: setting.id,
      action: existing ? "update" : "create",
      before,
      after: JSON.stringify(setting),
      userName: broker.fullName,
      reason: `Setting "${key}" ${existing ? "updated" : "created"}.`,
    },
  });

  return NextResponse.json({ setting });
}
