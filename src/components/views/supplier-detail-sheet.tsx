"use client";

import * as React from "react";
import { Phone, Mail, MapPin, FileText, CalendarClock, Receipt, BadgePercent, Wallet, Truck, Boxes, Printer, Award, Clock, TrendingDown, AlertTriangle } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/lib/api";
import { formatCurrency, formatDate, titleCase } from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { StatusChip, EmptyState } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TagPicker } from "@/components/tag-picker";
import { PortalAccessSection } from "@/components/portal-access-section";

type Bill = {
  id: string; billNumber: string; status: string; baseAmount: number; gstAmount: number; finalAmount: number;
  paidAmount: number; createdAt: string;
  po: { poNumber: string };
  client: { name: string };
  payments: { id: string; amount: number; date: string; mode: string; reference: string | null }[];
  brokerage: { id: string; brokerageAmount: number; eligible: boolean; payoutStatus: string } | null;
};

type Brokerage = {
  id: string; brokerageAmount: number; eligible: boolean; payoutStatus: string; createdAt: string;
  bill: { billNumber: string; baseAmount: number };
  client: { name: string };
  payout: { id: string; status: string; paidAt: string | null } | null;
};

type Supplier = {
  id: string; name: string; contactPerson: string | null; phone: string | null; email: string | null;
  userId: string | null;
  address: string | null; gstNo: string | null; defaultCommissionRate: number; defaultGstRate: number;
  notes: string | null; createdAt: string;
  bills: Bill[];
  brokerages: Brokerage[];
};

type DispatchRow = {
  id: string; poNumber: string; clientName: string; dispatchDate: string;
  status: string; dispatchedQty: number; orderedQty: number; poStatus: string;
  expected: string | null; revised: string | null;
};

type Tier = "excellent" | "good" | "average" | "needs-attention";

type Stats = {
  totalSupplied: number; outstandingBrokerage: number; paidBrokerage: number;
  avgDispatchDelay: number; billCount: number; dispatchCount: number;
  reliabilityScore: number; tier: Tier; fulfillment: number; onTimeRate: number;
  shortShipmentRate: number; disputeRate: number;
};

type Detail = {
  supplier: Supplier;
  stats: Stats;
  dispatches: DispatchRow[];
};

// ─────────────────────────────────────────────────────────────────────────────
// ScoreRing — circular SVG progress, colored by tier (mirrors analytics-view).
// ─────────────────────────────────────────────────────────────────────────────
const RING_COLORS = {
  emerald: "oklch(0.7 0.15 162)",
  teal: "oklch(0.65 0.12 200)",
  amber: "oklch(0.78 0.14 85)",
  rose: "oklch(0.65 0.2 27)",
};

const TIER_STYLES: Record<Tier, { badge: string; ring: keyof typeof RING_COLORS; label: string }> = {
  excellent: { badge: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", ring: "emerald", label: "Excellent" },
  good: { badge: "border-teal-500/30 bg-teal-500/15 text-teal-700 dark:text-teal-300", ring: "teal", label: "Good" },
  average: { badge: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300", ring: "amber", label: "Average" },
  "needs-attention": { badge: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300", ring: "rose", label: "Needs Attention" },
};

function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const colorKey: keyof typeof RING_COLORS = score >= 85 ? "emerald" : score >= 70 ? "teal" : score >= 55 ? "amber" : "rose";
  const color = RING_COLORS[colorKey];
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="oklch(0.7 0.02 160 / 0.2)" strokeWidth={4} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold kpi-num" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

export function SupplierDetailSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, refresh } = useApi<Detail>(`/api/suppliers/${id}`);
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="glass-strong w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-lg">{loading ? "Loading…" : data?.supplier.name}</SheetTitle>
              <SheetDescription className="sr-only">Supplier detail</SheetDescription>
            </div>
            {data && !loading ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(`/api/reports?type=supplier-summary&supplierId=${data.supplier.id}`, "_blank")}
              >
                <Printer className="mr-1.5 size-4" />Print summary
              </Button>
            ) : null}
          </div>
        </SheetHeader>
        {loading || !data ? (
          <div className="space-y-3 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        ) : (
          <SupplierDetailBody data={data} onLinkedChange={refresh} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SupplierDetailBody({ data, onLinkedChange }: { data: Detail; onLinkedChange?: () => void }) {
  const { supplier, stats, dispatches } = data;
  const { format: fmtCurrency } = useCurrencyFormat();
  return (
    <div className="space-y-4 px-4 pb-8">
      {/* Contact + stats */}
      <div className="glass rounded-xl p-4">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {supplier.phone ? <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5" />{supplier.phone}</span> : null}
          {supplier.email ? <span className="inline-flex items-center gap-1.5"><Mail className="size-3.5" />{supplier.email}</span> : null}
          {supplier.address ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" />{supplier.address}</span> : null}
          {supplier.gstNo ? <span className="inline-flex items-center gap-1.5"><FileText className="size-3.5" />GST {supplier.gstNo}</span> : null}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat icon={<Receipt className="size-4" />} label="Total supplied" value={fmtCurrency(stats.totalSupplied, { compact: true })} />
          <Stat icon={<Wallet className="size-4" />} label="Outstanding" value={fmtCurrency(stats.outstandingBrokerage, { compact: true })} tone="amber" />
          <Stat icon={<BadgePercent className="size-4" />} label="Paid brokerage" value={fmtCurrency(stats.paidBrokerage, { compact: true })} tone="emerald" />
          <Stat icon={<CalendarClock className="size-4" />} label="Avg delay" value={`${stats.avgDispatchDelay} days`} />
          {/* 5th stat: Reliability Score with ScoreRing */}
          <div className="rounded-xl border border-border/40 bg-card/40 p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Award className="size-4" />
              <span className="text-[10px] uppercase tracking-wider">Reliability score</span>
            </div>
            <div className="mt-1 flex items-center gap-3">
              <ScoreRing score={stats.reliabilityScore} />
              <Badge variant="outline" className={TIER_STYLES[stats.tier].badge}>
                {TIER_STYLES[stats.tier].label}
              </Badge>
            </div>
          </div>
        </div>

        {/* Performance Breakdown */}
        <PerformanceBreakdown
          fulfillment={stats.fulfillment}
          onTimeRate={stats.onTimeRate}
          shortShipmentRate={stats.shortShipmentRate}
          disputeRate={stats.disputeRate}
        />

        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full border border-border/60 bg-card/50 px-2 py-0.5">Commission: {supplier.defaultCommissionRate}%</span>
          <span className="rounded-full border border-border/60 bg-card/50 px-2 py-0.5">GST: {supplier.defaultGstRate}%</span>
          <span className="rounded-full border border-border/60 bg-card/50 px-2 py-0.5">{stats.billCount} bills</span>
          <span className="rounded-full border border-border/60 bg-card/50 px-2 py-0.5">{stats.dispatchCount} dispatches</span>
        </div>
        <div className="mt-3 border-t border-border/40 pt-3">
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Tags</p>
          <TagPicker entityType="Supplier" entityId={supplier.id} />
        </div>
        <div className="mt-3">
          <PortalAccessSection
            partyType="supplier"
            partyId={supplier.id}
            userId={supplier.userId}
            partyEmail={supplier.email}
            onLinkedChange={onLinkedChange}
          />
        </div>
      </div>

      <Tabs defaultValue="bills" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="bills">Bills</TabsTrigger>
          <TabsTrigger value="dispatches">Dispatches</TabsTrigger>
          <TabsTrigger value="brokerage">Brokerage</TabsTrigger>
        </TabsList>

        {/* Bills */}
        <TabsContent value="bills" className="mt-3 space-y-2">
          {supplier.bills.length === 0 ? <EmptyState title="No bills yet" /> : supplier.bills.map((b) => (
            <div key={b.id} className="glass rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{b.billNumber}</p>
                  <p className="truncate text-xs text-muted-foreground">{b.po.poNumber} · {b.client.name}</p>
                </div>
                <StatusChip status={b.status} />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <KV label="Final" value={fmtCurrency(b.finalAmount)} />
                <KV label="Paid" value={fmtCurrency(b.paidAmount)} tone="emerald" />
                <KV label="Due" value={fmtCurrency(b.finalAmount - b.paidAmount)} tone={b.finalAmount - b.paidAmount > 0 ? "amber" : "default"} />
              </div>
              {b.payments.length > 0 ? (
                <div className="mt-2 border-t border-border/40 pt-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Payments</p>
                  {b.payments.map((p) => (
                    <div key={p.id} className="mt-1 flex items-center justify-between text-[11px]">
                      <span>{formatDate(p.date)} · {titleCase(p.mode)}{p.reference ? ` · ${p.reference}` : ""}</span>
                      <span className="font-medium">{fmtCurrency(p.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </TabsContent>

        {/* Dispatches */}
        <TabsContent value="dispatches" className="mt-3 space-y-2">
          {dispatches.length === 0 ? <EmptyState title="No dispatches yet" /> : dispatches.map((d) => {
            const fulfillment = d.orderedQty ? Math.min(100, Math.round((d.dispatchedQty / d.orderedQty) * 100)) : 0;
            return (
              <div key={d.id} className="glass rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{d.poNumber}</p>
                    <p className="truncate text-xs text-muted-foreground">{d.clientName} · dispatched {formatDate(d.dispatchDate)}</p>
                  </div>
                  <StatusChip status={d.status} />
                </div>
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Boxes className="size-3" />{d.dispatchedQty} / {d.orderedQty} sets</span>
                    <span>{fulfillment}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${fulfillment}%` }} />
                  </div>
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Truck className="size-3" />PO: {titleCase(d.poStatus)}</span>
                  <span>Expected: {formatDate(d.expected)}</span>
                  {d.revised ? <span>Revised: {formatDate(d.revised)}</span> : null}
                </p>
              </div>
            );
          })}
        </TabsContent>

        {/* Brokerage */}
        <TabsContent value="brokerage" className="mt-3 space-y-2">
          {supplier.brokerages.length === 0 ? <EmptyState title="No brokerage entries" /> : supplier.brokerages.map((b) => (
            <div key={b.id} className="glass rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{b.bill.billNumber}</p>
                  <p className="truncate text-xs text-muted-foreground">{b.client.name}</p>
                </div>
                <StatusChip status={b.eligible ? b.payoutStatus : "pending"} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <KV label="Brokerage" value={fmtCurrency(b.brokerageAmount)} tone="emerald" />
                <KV label="Eligible" value={b.eligible ? "Yes" : "No"} />
              </div>
              {b.payout ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Payout: {titleCase(b.payout.status)}{b.payout.paidAt ? ` · ${formatDate(b.payout.paidAt)}` : ""}
                </p>
              ) : null}
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ icon, label, value, tone = "default" }: { icon: React.ReactNode; label: string; value: string; tone?: "default" | "emerald" | "amber" }) {
  const toneClass =
    tone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "amber" ? "text-amber-600 dark:text-amber-400"
    : "text-foreground";
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">{icon}<span className="text-[10px] uppercase tracking-wider">{label}</span></div>
      <p className={`kpi-num mt-1 text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PerformanceBreakdown — 4 mini progress bars showing the components of the
// reliability score. Color-coded by metric quality.
// ─────────────────────────────────────────────────────────────────────────────
function PerformanceBreakdown({
  fulfillment, onTimeRate, shortShipmentRate, disputeRate,
}: { fulfillment: number; onTimeRate: number; shortShipmentRate: number; disputeRate: number }) {
  const lowShortShip = 100 - shortShipmentRate;
  const lowDispute = 100 - disputeRate;

  // Color thresholds per spec:
  //   Fulfillment: emerald ≥90, amber 70–89, rose <70.
  //   On-time: emerald ≥85, amber 60–84, rose <60.
  //   Low short-ship & low dispute: emerald ≥85, amber 60–84, rose <60.
  type Tone = "emerald" | "amber" | "rose";
  const toneFor = (v: number, em: number, am: number): Tone =>
    v >= em ? "emerald" : v >= am ? "amber" : "rose";
  const toneClass = (tone: Tone) =>
    tone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "amber" ? "text-amber-600 dark:text-amber-400"
    : "text-rose-600 dark:text-rose-400";
  // Override the shadcn Progress indicator color via the data-slot selector —
  // keeps the shadcn Progress component itself while tinting per metric.
  const progressClass = (tone: Tone) =>
    `h-1.5 [&>[data-slot=progress-indicator]]:transition-all ${
      tone === "emerald" ? "[&>[data-slot=progress-indicator]]:bg-emerald-500"
      : tone === "amber" ? "[&>[data-slot=progress-indicator]]:bg-amber-500"
      : "[&>[data-slot=progress-indicator]]:bg-rose-500"
    }`;

  const fulfillmentTone = toneFor(fulfillment, 90, 70);
  const onTimeTone = toneFor(onTimeRate, 85, 60);
  const lowShortShipTone = toneFor(lowShortShip, 85, 60);
  const lowDisputeTone = toneFor(lowDispute, 85, 60);

  return (
    <div className="mt-3 rounded-xl border border-border/40 bg-card/30 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Award className="size-3.5" />Performance breakdown
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <BreakdownRow
          icon={<Boxes className="size-3.5" />}
          label="Fulfillment"
          value={fulfillment}
          toneClass={toneClass(fulfillmentTone)}
          progressClass={progressClass(fulfillmentTone)}
        />
        <BreakdownRow
          icon={<Clock className="size-3.5" />}
          label="On-time dispatch"
          value={onTimeRate}
          toneClass={toneClass(onTimeTone)}
          progressClass={progressClass(onTimeTone)}
        />
        <BreakdownRow
          icon={<TrendingDown className="size-3.5" />}
          label="Low short-shipment"
          value={lowShortShip}
          toneClass={toneClass(lowShortShipTone)}
          progressClass={progressClass(lowShortShipTone)}
        />
        <BreakdownRow
          icon={<AlertTriangle className="size-3.5" />}
          label="Low dispute rate"
          value={lowDispute}
          toneClass={toneClass(lowDisputeTone)}
          progressClass={progressClass(lowDisputeTone)}
        />
      </div>
    </div>
  );
}

function BreakdownRow({
  icon, label, value, toneClass, progressClass,
}: { icon: React.ReactNode; label: string; value: number; toneClass: string; progressClass: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">{icon}{label}</span>
        <span className={`font-semibold kpi-num ${toneClass}`}>{value}%</span>
      </div>
      <Progress value={value} className={progressClass} aria-label={`${label}: ${value}%`} />
    </div>
  );
}

function KV({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "emerald" | "amber" }) {
  const toneClass =
    tone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "amber" ? "text-amber-600 dark:text-amber-400"
    : "text-foreground";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${toneClass}`}>{value}</p>
    </div>
  );
}
