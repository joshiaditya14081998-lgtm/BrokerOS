import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Stable key under SystemSetting. When this is "true", the onboarding wizard
// has been completed (or skipped) at least once.
const ONBOARDING_KEY = "onboarding_completed";

// GET /api/onboarding → onboarding state for the wizard gate.
//
// `needsOnboarding` is true when either:
//   (a) the DB has no clients AND no suppliers (truly first run), OR
//   (b) the `onboarding_completed` system setting is not "true" (explicitly
//       cleared by the "Replay onboarding" action in Settings, or never set).
export async function GET() {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [clientCount, supplierCount, setting] = await Promise.all([
    db.client.count(),
    db.supplier.count(),
    db.systemSetting.findUnique({ where: { key: ONBOARDING_KEY } }),
  ]);

  const hasCompletedOnboarding = setting?.value === "true";
  const needsOnboarding =
    (clientCount === 0 && supplierCount === 0) || !hasCompletedOnboarding;

  return NextResponse.json({
    needsOnboarding,
    clientCount,
    supplierCount,
    hasCompletedOnboarding,
  });
}

const ActionSchema = z.object({
  action: z.enum(["complete", "skip", "load_demo", "reset"]),
});

// POST /api/onboarding → mutate onboarding state.
//   - "complete": mark onboarding as done (user finished all steps).
//   - "skip":     same DB effect as complete — user chose to skip; both mark
//                 `onboarding_completed` = "true" so the wizard doesn't
//                 reappear on the next load.
//   - "load_demo": re-run the seed script (reuses the same spawnSync pattern as
//                 /api/seed), then mark onboarding as done.
//   - "reset":    delete the `onboarding_completed` setting so the wizard
//                 shows again next load (used by Settings → "Replay onboarding").
export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { action } = parsed.data;

  if (action === "reset") {
    await db.systemSetting.deleteMany({ where: { key: ONBOARDING_KEY } });
    return NextResponse.json({ ok: true, action: "reset" });
  }

  // "load_demo" — actually re-run the seed in a child process (same pattern as
  // /api/seed). The seed script wipes SystemSetting too, so we set
  // `onboarding_completed` AFTER the seed finishes (otherwise the seed would
  // erase it).
  if (action === "load_demo") {
    const seedPath = resolve(process.cwd(), "src/lib/seed.ts");
    try {
      const result = spawnSync("bun", ["run", seedPath], {
        encoding: "utf-8",
        timeout: 60_000,
        env: process.env,
      });
      if (result.status !== 0) {
        const msg =
          (result.stderr || result.stdout || "").trim() ||
          `Exit code ${result.status}`;
        return NextResponse.json(
          { ok: false, error: msg, action: "load_demo" },
          { status: 500 },
        );
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return NextResponse.json(
        { ok: false, error: `Seed failed: ${message}`, action: "load_demo" },
        { status: 500 },
      );
    }
  }

  // For complete / skip / load_demo — upsert the completion flag.
  await db.systemSetting.upsert({
    where: { key: ONBOARDING_KEY },
    create: {
      key: ONBOARDING_KEY,
      value: "true",
      notes: `Onboarding ${action === "load_demo" ? "completed via demo load" : action === "skip" ? "skipped by user" : "completed"} on ${new Date().toISOString()}.`,
    },
    update: {
      value: "true",
      notes: `Onboarding ${action === "load_demo" ? "completed via demo load" : action === "skip" ? "skipped by user" : "completed"} on ${new Date().toISOString()}.`,
    },
  });

  // Audit-log the onboarding state transition.
  await db.auditLog.create({
    data: {
      entityType: "SystemSetting",
      entityId: ONBOARDING_KEY,
      action: action === "load_demo" ? "create" : "update",
      after: JSON.stringify({ key: ONBOARDING_KEY, value: "true" }),
      userName: "Broker",
      reason: `Onboarding action: ${action}.`,
    },
  });

  return NextResponse.json({
    ok: true,
    action,
    message:
      action === "load_demo"
        ? "Demo data loaded. Onboarding marked complete."
        : action === "skip"
          ? "Onboarding skipped."
          : "Onboarding marked complete.",
  });
}
