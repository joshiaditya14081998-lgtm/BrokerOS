import { NextResponse } from "next/server";
import { runFix, ALL_FIX_TYPES, type FixType, type FixResult } from "@/lib/data-health-fix";
import { getCurrentBroker } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/data-health/fix-all
//
// Runs every auto-fix type in sequence (the 5 safe-to-apply categories). This
// is the "Fix everything" button — used when the broker wants to clear all
// programmatically-resolvable data health issues in one click.
//
// Each individual fix is independent; a failure in one doesn't abort the
// others (we catch + record the error, then keep going).
//
// Response:
//   { results: [{ fixType, fixed, error? }], totalFixed: N }
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

type BatchResult =
  | { fixType: FixType; fixed: number; error?: undefined }
  | { fixType: FixType; fixed: 0; error: string };

export async function POST() {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const results: BatchResult[] = [];
  let totalFixed = 0;

  // Run each fix sequentially. We use a for-of loop (not Promise.all) so the
  // DB writes don't contend with each other and the audit log ordering
  // matches the fix ordering — easier to read in the Audit Trail.
  for (const fixType of ALL_FIX_TYPES) {
    try {
      const result: FixResult = await runFix(fixType, null, broker.id);
      results.push({ fixType, fixed: result.fixed });
      totalFixed += result.fixed;
    } catch (e) {
      results.push({
        fixType,
        fixed: 0,
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  return NextResponse.json({ results, totalFixed });
}
