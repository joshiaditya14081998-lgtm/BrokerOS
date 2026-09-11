import { NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export const dynamic = "force-dynamic";

// POST /api/seed — actually re-run the seed script in a child process.
// Wipes all current data and writes a fresh demo dataset. Used by the Settings
// "Re-seed database" action (with an explicit confirm dialog in the UI).
export async function POST() {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const seedPath = resolve(process.cwd(), "src/lib/seed.ts");
  try {
    const result = spawnSync("bun", ["run", seedPath], {
      encoding: "utf-8",
      timeout: 60_000,
      env: process.env,
    });
    if (result.status !== 0) {
      const msg = (result.stderr || result.stdout || "").trim() || `Exit code ${result.status}`;
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      message: "Database re-seeded successfully.",
      output: (result.stdout || "").trim().split("\n").slice(-6),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: `Seed failed: ${message}` }, { status: 500 });
  }
}
