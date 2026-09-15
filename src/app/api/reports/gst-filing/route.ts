import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-middleware";
import { reportError } from "@/lib/error-report";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/gst-filing?range=month|quarter|custom&from=ISO&to=ISO
//
// Returns a JSON summary of GST collected (output) on bills raised in the
// selected period, plus a placeholder input-GST bucket (expenses don't yet
// carry a GST component) and a client-wise GSTR-1-style breakdown.
//
// Auth required (`getCurrentBroker`). All queries are scoped to `brokerId`.
// Rate-limited at 30 req/min — read-only financial summary.
// ─────────────────────────────────────────────────────────────────────────────

type Range = "month" | "quarter" | "custom";

type ByRate = {
  rate: number;
  baseAmount: number;
  gstAmount: number;
  billCount: number;
};

type ClientBreakdownRow = {
  clientName: string;
  gstin: string | null;
  gstRate: number;
  baseAmount: number;
  gstAmount: number;
  billCount: number;
};

// Parse an ISO date query param. Returns null when the value is missing or
// unparseable so the caller can fall back to the default range.
function parseDateParam(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Resolve the [start, end] window + human label for the chosen range.
//
//  - `month`    → first day → last day of the current calendar month
//  - `quarter`  → first day → last day of the current calendar quarter
//  - `custom`   → `from` (start-of-day) → `to` (end-of-day); falls back to
//                 the current month when `from`/`to` are missing/invalid
//
// `end` is always pushed to end-of-day so a same-day custom range captures
// the entire day rather than just midnight.
function resolveRange(
  range: Range,
  from: Date | null,
  to: Date | null,
): { start: Date; end: Date; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  if (range === "custom" && from && to) {
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    const label = `${start.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;
    return { start, end, label };
  }

  if (range === "quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    const start = new Date(y, qStartMonth, 1);
    const end = new Date(y, qStartMonth + 3, 0, 23, 59, 59, 999);
    const qNum = Math.floor(qStartMonth / 3) + 1;
    return { start, end, label: `Q${qNum} ${y}` };
  }

  // `month` (default) — also the fallback when `custom` lacks `from`/`to`.
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
  return {
    start,
    end,
    label: start.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
  };
}

async function handler(req: NextRequest) {
  try {
    const broker = await getCurrentBroker();
    if (!broker) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const rawRange = (searchParams.get("range") ?? "month").toLowerCase();
    // Only honor `custom` when both `from` and `to` are present — otherwise
    // fall back to the month view so the response is never empty-by-accident.
    const from = parseDateParam(searchParams.get("from"));
    const to = parseDateParam(searchParams.get("to"));
    const range: Range =
      rawRange === "quarter"
        ? "quarter"
        : rawRange === "custom" && from && to
          ? "custom"
          : "month";

    const { start, end, label } = resolveRange(range, from, to);

    // Pull every bill raised in the window. We include `client` for the
    // GSTR-1-style breakdown (name + gstNo). Bills are the single source
    // of truth for output GST — base × gstRate = gstAmount is computed
    // upstream in the billing flow, so we trust the stored `gstAmount`.
    const bills = await db.bill.findMany({
      where: {
        brokerId: broker.id,
        createdAt: { gte: start, lte: end },
      },
      include: {
        client: { select: { name: true, gstNo: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // ── Output GST grouped by GST rate ────────────────────────────────────
    const byRateMap = new Map<number, { baseAmount: number; gstAmount: number; billCount: number }>();
    for (const b of bills) {
      const key = b.gstRate;
      const acc = byRateMap.get(key) ?? { baseAmount: 0, gstAmount: 0, billCount: 0 };
      acc.baseAmount += b.baseAmount;
      acc.gstAmount += b.gstAmount;
      acc.billCount += 1;
      byRateMap.set(key, acc);
    }
    const byRate: ByRate[] = Array.from(byRateMap.entries())
      .map(([rate, v]) => ({
        rate,
        baseAmount: v.baseAmount,
        gstAmount: v.gstAmount,
        billCount: v.billCount,
      }))
      .sort((a, b) => a.rate - b.rate);

    const totalBase = byRate.reduce((s, r) => s + r.baseAmount, 0);
    const totalGst = byRate.reduce((s, r) => s + r.gstAmount, 0);

    // ── Input GST placeholder ─────────────────────────────────────────────
    // Expenses don't yet carry a GST component — leave as 0 + empty breakdown
    // so the view renders the "Input GST" tile without surprise zeros from a
    // future schema migration. When expenses gain a `gstRate`/`gstAmount`
    // pair, this is the only block that needs to change.
    const inputGst = {
      totalGst: 0,
      breakdown: [] as never[],
    };

    // ── Net GST = Output − Input ──────────────────────────────────────────
    const liability = totalGst - inputGst.totalGst;
    const netGst = {
      liability,
      isLiability: liability >= 0,
    };

    // ── Client-wise breakdown (GSTR-1 style) ──────────────────────────────
    // One row per (client, rate) pair — a client billed at multiple rates
    // shows up once per rate. Sorted by gstAmount desc so the biggest GST
    // contributors surface to the top of the filing worksheet.
    const byClientMap = new Map<string, ClientBreakdownRow>();
    for (const b of bills) {
      const key = `${b.clientId}__${b.gstRate}`;
      const acc =
        byClientMap.get(key) ??
        ({
          clientName: b.client.name,
          gstin: b.client.gstNo ?? null,
          gstRate: b.gstRate,
          baseAmount: 0,
          gstAmount: 0,
          billCount: 0,
        } as ClientBreakdownRow);
      acc.baseAmount += b.baseAmount;
      acc.gstAmount += b.gstAmount;
      acc.billCount += 1;
      byClientMap.set(key, acc);
    }
    const clientBreakdown = Array.from(byClientMap.values()).sort(
      (a, b) => b.gstAmount - a.gstAmount,
    );

    return NextResponse.json({
      range: {
        start: start.toISOString(),
        end: end.toISOString(),
        label,
      },
      outputGst: { byRate, totalBase, totalGst },
      inputGst,
      netGst,
      clientBreakdown,
    });
  } catch (error) {
    reportError(error, { route: "/api/reports/gst-filing" });
    return NextResponse.json(
      { error: "Failed to compute GST filing data" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(handler, 30, 60_000);
