"use client";

import * as React from "react";
import {
  Award, TrendingUp, Clock, BarChart3,
  Factory, Users, Wallet, ArrowDownRight,
  Calendar, Star, Zap, AlertCircle,
  Tag as TagIcon, Filter, X, PieChart,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis,
  Tooltip, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, Legend,
} from "recharts";
import { useApi } from "@/lib/api";
import { formatCurrency, formatNumber, formatDate, daysBetween } from "@/lib/format";
import { GlassCard, KpiCard, SectionHeader, EmptyState } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TagBadge, type TagLike } from "@/components/tag-badge";
import { TAG_COLOR_CLASS, TAG_SWATCH_CLASS } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { useUrlState } from "@/hooks/use-url-state";
import { ShareLinkButton } from "@/components/share-link-button";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { useTranslation } from "@/hooks/use-translation";

// ─────────────────────────────────────────────────────────────────────────────
// Tier label → translation key. The TIER_STYLES constant below carries only
// the badge CSS classes (not the label string) — labels are looked up via
// `t(TIER_LABEL_KEYS[tier])` at render time so they respect the active locale.
// ─────────────────────────────────────────────────────────────────────────────
const TIER_LABEL_KEYS: Record<Tier, string> = {
  excellent: "analytics.excellent",
  good: "analytics.good",
  average: "analytics.average",
  "needs attention": "analytics.needsAttention",
};

const SUPPLIER_STATUS_LABEL_KEYS: Record<SupplierCapacityPoint["status"], string> = {
  normal: "analytics.normal",
  high: "analytics.highLoad",
  overloaded: "analytics.overloaded",
};

// ─────────────────────────────────────────────────────────────────────────────
// Types — match the API response shape exactly.
// ─────────────────────────────────────────────────────────────────────────────
type Tier = "excellent" | "good" | "average" | "needs attention";

type SupplierScore = {
  supplierId: string;
  name: string;
  score: number;
  fulfillment: number;
  onTimeRate: number;
  shortShipmentRate: number;
  disputeRate: number;
  dispatchCount: number;
  totalSupplied: number;
  tier: Tier;
};

type ClientExposure = {
  clientId: string;
  name: string;
  outstanding: number;
  exposureTrend: { month: string; value: number }[];
  avgPaymentDelay: number;
  returnRate: number;
  billCount: number;
};

type BrokerageForecast = {
  pendingTotal: number;
  eligibleUnpaidTotal: number;
  projectedByMonth: { month: string; amount: number }[];
  byCadence: { immediate: number; "4_month": number; "12_month": number };
};

type VolumeTrends = {
  monthlyBilled: { month: string; value: number }[];
  monthlyDispatched: { month: string; value: number }[];
  topPairs: { clientName: string; supplierName: string; value: number }[];
};

type SeasonKey = "festive" | "wedding" | "summer" | "winter" | "normal";

type Brokerage6MonthPoint = { month: string; projected: number; upper: number; lower: number };

type SeasonalTrendPoint = {
  month: string;
  value: number;
  growthRate: number;
  seasonLabel: string;
  seasonKey: SeasonKey;
  isPeak: boolean;
  isLow: boolean;
};

type ClientVelocityPoint = {
  clientId: string;
  name: string;
  lastOrderDate: string | null;
  avgDaysBetweenOrders: number;
  predictedNextOrderDate: string | null;
  orderCount: number;
};

type SupplierCapacityPoint = {
  supplierId: string;
  name: string;
  avgLeadTimeDays: number;
  pendingPOs: number;
  monthlyAvgPOs: number;
  status: "normal" | "high" | "overloaded";
};

type Forecast = {
  brokerage6Month: Brokerage6MonthPoint[];
  seasonalTrends: SeasonalTrendPoint[];
  clientVelocity: ClientVelocityPoint[];
  supplierCapacity: SupplierCapacityPoint[];
};

// Tag filter shape returned by the API when a tag filter is active.
type AppliedFilter = {
  tagId: string;
  tagName: string;
  tagColor: string;
  entityType: "Client" | "Supplier" | "PurchaseOrder" | null;
  clientCount: number;
  supplierCount: number;
  purchaseOrderCount: number;
};

type ClientComparison = {
  taggedCount: number;
  totalCount: number;
  taggedBusiness: number;
  allBusiness: number;
  taggedOutstanding: number;
  allOutstanding: number;
  taggedBrokerage: number;
  allBrokerage: number;
  taggedAvgOutstanding: number;
  allAvgOutstanding: number;
};

type SupplierComparison = {
  taggedCount: number;
  totalCount: number;
  taggedSupplied: number;
  allSupplied: number;
  taggedFulfillment: number;
  allFulfillment: number;
};

type PoComparison = {
  taggedCount: number;
  totalCount: number;
  taggedValue: number;
  allValue: number;
  taggedFulfillment: number;
  allFulfillment: number;
};

type TagInsights = {
  client: ClientComparison | null;
  supplier: SupplierComparison | null;
  purchaseOrder: PoComparison | null;
};

type AnalyticsData = {
  appliedFilter: AppliedFilter | null;
  tagInsights: TagInsights | null;
  totals: { supplierCount: number; clientCount: number; purchaseOrderCount: number };
  suppliers: SupplierScore[];
  clients: ClientExposure[];
  brokerage: BrokerageForecast;
  volume: VolumeTrends;
  forecast: Forecast;
};

type EntityTypeFilter = "all" | "Client" | "Supplier" | "PurchaseOrder";

type TagWithCounts = TagLike & {
  counts?: { clients: number; suppliers: number; purchaseOrders: number; total: number };
};

// ─────────────────────────────────────────────────────────────────────────────
// Chart palette — emerald / teal / amber / rose / plum (no indigo / blue).
// ─────────────────────────────────────────────────────────────────────────────
const COLORS = {
  emerald: "oklch(0.7 0.15 162)",
  teal: "oklch(0.65 0.12 200)",
  amber: "oklch(0.78 0.14 85)",
  rose: "oklch(0.65 0.2 27)",
  plum: "oklch(0.62 0.15 340)",
};

const TIER_STYLES: Record<Tier, { badge: string; label: string }> = {
  excellent: { badge: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", label: "Excellent" },
  good: { badge: "border-teal-500/30 bg-teal-500/15 text-teal-700 dark:text-teal-300", label: "Good" },
  average: { badge: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300", label: "Average" },
  "needs attention": { badge: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300", label: "Needs attention" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Season palette — Indian garment-industry mapping.
//   festive → emerald (Oct–Nov, Dussehra/Diwali)
//   wedding → rose    (Dec–Jan)
//   summer  → amber   (Apr–May)
//   winter  → teal    (Aug–Sep)
//   normal  → muted
// ─────────────────────────────────────────────────────────────────────────────
const SEASON_STYLES: Record<SeasonKey, { color: string; badge: string; label: string }> = {
  festive: { color: COLORS.emerald, badge: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", label: "Festive" },
  wedding: { color: COLORS.rose, badge: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300", label: "Wedding" },
  summer: { color: COLORS.amber, badge: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300", label: "Summer" },
  winter: { color: COLORS.teal, badge: "border-teal-500/30 bg-teal-500/15 text-teal-700 dark:text-teal-300", label: "Winter" },
  normal: { color: "oklch(0.7 0.02 165)", badge: "border-zinc-500/30 bg-zinc-500/15 text-zinc-600 dark:text-zinc-300", label: "Regular" },
};

const SUPPLIER_STATUS_STYLES: Record<SupplierCapacityPoint["status"], { badge: string; label: string; dot: string }> = {
  normal: { badge: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", label: "Normal", dot: COLORS.emerald },
  high: { badge: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300", label: "High load", dot: COLORS.amber },
  overloaded: { badge: "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300", label: "Overloaded", dot: COLORS.rose },
};

// ─────────────────────────────────────────────────────────────────────────────
// ScoreRing — circular SVG progress for the supplier reliability score.
// ─────────────────────────────────────────────────────────────────────────────
function ScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 85 ? COLORS.emerald
    : score >= 70 ? COLORS.teal
    : score >= 55 ? COLORS.amber
    : COLORS.rose;
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
      <span className="absolute inset-0 grid place-items-center text-xs font-semibold kpi-num" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag filter bar — entity-type ToggleGroup + tag pills. Single-select on the
// tag for v1 (clicking the active pill clears it). The tagId + entityType
// state is URL-persisted by the parent via useUrlState (Task 19-b).
// ─────────────────────────────────────────────────────────────────────────────
function AnalyticsTagFilterBar({
  tags,
  tagId,
  entityType,
  onTagChange,
  onEntityTypeChange,
  onClear,
}: {
  tags: TagWithCounts[];
  // `tagId` is an empty string when no tag is selected (was `null` before
  // Task 19-b — switched to "" so it serialises cleanly to the URL param
  // `?tagId=`). All `if (tagId)` / `tagId ? ... : ...` checks treat "" as
  // falsy, matching the old null semantics.
  tagId: string;
  entityType: EntityTypeFilter;
  onTagChange: (id: string) => void;
  onEntityTypeChange: (t: EntityTypeFilter) => void;
  onClear: () => void;
}) {
  if (tags.length === 0) return null;

  const entityOptions: { value: EntityTypeFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "Client", label: "Clients" },
    { value: "Supplier", label: "Suppliers" },
    { value: "PurchaseOrder", label: "POs" },
  ];

  return (
    <GlassCard className="p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Filter className="size-3.5" />
              Filter by tag
            </span>
            <ToggleGroup
              type="single"
              value={entityType}
              onValueChange={(v) => {
                if (v) onEntityTypeChange(v as EntityTypeFilter);
              }}
              variant="outline"
              size="sm"
              className="rounded-full border border-border/60 bg-card/40"
            >
              {entityOptions.map((o) => (
                <ToggleGroupItem
                  key={o.value}
                  value={o.value}
                  className="rounded-full px-3 text-xs data-[state=on]:border-emerald-500/40 data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-700 dark:data-[state=on]:text-emerald-300"
                >
                  {o.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {tagId ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onClear}
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-300"
            >
              <X className="size-3" />
              Clear filter
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 pr-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <TagIcon className="size-3" />Tags
          </span>
          {tags.map((t) => {
            const active = tagId === t.id;
            const relevantCount = entityType === "all"
              ? t.counts?.total ?? 0
              : entityType === "Client"
                ? t.counts?.clients ?? 0
                : entityType === "Supplier"
                  ? t.counts?.suppliers ?? 0
                  : t.counts?.purchaseOrders ?? 0;
            return (
              <TagBadge
                key={t.id}
                tag={t}
                size="sm"
                active={active}
                onClick={() => onTagChange(active ? "" : t.id)}
                className={cn(relevantCount === 0 && !active && "opacity-50")}
              />
            );
          })}
        </div>
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TagInsightsCard — top-of-view summary card shown when a tag filter is
// active. Surfaces tag name + color, entity counts, total business value,
// average-metric comparison, and a tagged-vs-all share bar.
// ─────────────────────────────────────────────────────────────────────────────
function TagInsightsCard({ appliedFilter, insights }: { appliedFilter: AppliedFilter; insights: TagInsights }) {
  const swatchClass = TAG_SWATCH_CLASS[appliedFilter.tagColor] ?? TAG_SWATCH_CLASS.emerald;
  const colorClass = TAG_COLOR_CLASS[appliedFilter.tagColor] ?? TAG_COLOR_CLASS.emerald;

  // Build the comparison "share of total" bars for the included entity types.
  type ShareRow = {
    label: string;
    tagged: number;
    total: number;
    icon: React.ReactNode;
  };
  const shareRows: ShareRow[] = [];
  if (insights.client) {
    shareRows.push({
      label: "Clients",
      tagged: insights.client.taggedCount,
      total: insights.client.totalCount,
      icon: <Users className="size-3.5" />,
    });
  }
  if (insights.supplier) {
    shareRows.push({
      label: "Suppliers",
      tagged: insights.supplier.taggedCount,
      total: insights.supplier.totalCount,
      icon: <Factory className="size-3.5" />,
    });
  }
  if (insights.purchaseOrder) {
    shareRows.push({
      label: "Purchase Orders",
      tagged: insights.purchaseOrder.taggedCount,
      total: insights.purchaseOrder.totalCount,
      icon: <BarChart3 className="size-3.5" />,
    });
  }

  // Average-metric comparison insights (one per included entity type).
  type InsightRow = {
    label: string;
    taggedValue: string;
    allValue: string;
    delta: number; // % difference vs all
  };
  const insightRows: InsightRow[] = [];
  if (insights.client) {
    const delta = insights.client.allAvgOutstanding > 0
      ? Math.round(((insights.client.taggedAvgOutstanding - insights.client.allAvgOutstanding) / insights.client.allAvgOutstanding) * 100)
      : 0;
    insightRows.push({
      label: "Avg outstanding / client",
      taggedValue: formatCurrency(insights.client.taggedAvgOutstanding, { compact: true }),
      allValue: formatCurrency(insights.client.allAvgOutstanding, { compact: true }),
      delta,
    });
  }
  if (insights.supplier) {
    const delta = insights.supplier.allFulfillment > 0
      ? insights.supplier.taggedFulfillment - insights.supplier.allFulfillment
      : 0;
    insightRows.push({
      label: "Avg fulfillment / supplier",
      taggedValue: `${insights.supplier.taggedFulfillment}%`,
      allValue: `${insights.supplier.allFulfillment}%`,
      delta,
    });
  }
  if (insights.purchaseOrder) {
    const avgTagged = insights.purchaseOrder.taggedCount > 0
      ? insights.purchaseOrder.taggedValue / insights.purchaseOrder.taggedCount
      : 0;
    const avgAll = insights.purchaseOrder.totalCount > 0
      ? insights.purchaseOrder.allValue / insights.purchaseOrder.totalCount
      : 0;
    const delta = avgAll > 0 ? Math.round(((avgTagged - avgAll) / avgAll) * 100) : 0;
    insightRows.push({
      label: "Avg PO value",
      taggedValue: formatCurrency(Math.round(avgTagged), { compact: true }),
      allValue: formatCurrency(Math.round(avgAll), { compact: true }),
      delta,
    });
  }

  return (
    <GlassCard className="relative overflow-hidden p-5">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn("grid size-10 place-items-center rounded-xl border", colorClass)}>
              <TagIcon className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight text-foreground">
                  {appliedFilter.tagName}
                </h3>
                <span className={cn("size-2.5 rounded-full", swatchClass)} aria-hidden />
              </div>
              <p className="text-xs text-muted-foreground">
                {appliedFilter.entityType === null
                  ? "Filter applied across Clients, Suppliers & Purchase Orders"
                  : `Filter scoped to ${appliedFilter.entityType === "PurchaseOrder" ? "Purchase Orders" : `${appliedFilter.entityType}s`}`}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <PieChart className="size-3" />
            Tag insights
          </Badge>
        </div>

        {/* Share-of-total bars */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shareRows.map((row) => {
            const pct = row.total > 0 ? Math.round((row.tagged / row.total) * 100) : 0;
            return (
              <div key={row.label} className="rounded-xl border border-border/50 bg-card/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {row.icon}
                    {row.label}
                  </span>
                  <span className="kpi-num text-xs text-muted-foreground">
                    {row.tagged} of {row.total}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                  <span className="kpi-num w-10 text-right text-xs font-medium text-foreground">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Tagged vs all comparison metrics */}
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Tagged vs. all entities
          </p>
          <div className="overflow-x-auto rounded-xl border border-border/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Tagged</TableHead>
                  <TableHead className="text-right">All</TableHead>
                  <TableHead className="text-right">Δ vs. all</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {insightRows.map((row) => {
                  const positive = row.delta > 0;
                  const neutral = row.delta === 0;
                  const tone = neutral
                    ? "text-muted-foreground"
                    : positive
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400";
                  return (
                    <TableRow key={row.label} className="hover-lift">
                      <TableCell className="font-medium text-foreground">{row.label}</TableCell>
                      <TableCell className="text-right kpi-num text-foreground">{row.taggedValue}</TableCell>
                      <TableCell className="text-right kpi-num text-muted-foreground">{row.allValue}</TableCell>
                      <TableCell className="text-right kpi-num">
                        <span className={tone}>
                          {neutral ? "—" : `${positive ? "+" : ""}${row.delta}${row.label.includes("fulfillment") ? "pp" : "%"}`}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TagComparisonChart — grouped BarChart comparing Tagged vs All across the
// key metrics for each included entity type.
// ─────────────────────────────────────────────────────────────────────────────
function TagComparisonChart({ insights, tagColor }: { insights: TagInsights; tagColor: string }) {
  // Build chart data — one row per entity-type/metric.
  type ChartRow = { metric: string; tagged: number; all: number };
  const rows: ChartRow[] = [];
  if (insights.client) {
    rows.push({ metric: "Client · Business", tagged: insights.client.taggedBusiness, all: insights.client.allBusiness });
    rows.push({ metric: "Client · Outstanding", tagged: insights.client.taggedOutstanding, all: insights.client.allOutstanding });
    rows.push({ metric: "Client · Brokerage", tagged: insights.client.taggedBrokerage, all: insights.client.allBrokerage });
  }
  if (insights.supplier) {
    rows.push({ metric: "Supplier · Supplied", tagged: insights.supplier.taggedSupplied, all: insights.supplier.allSupplied });
    // Fulfillment is a % — scale to ₹10k-per-% so it shows up on the same axis
    // (we surface the raw % in the tooltip via formatter).
    rows.push({
      metric: "Supplier · Fulfillment",
      tagged: insights.supplier.taggedFulfillment * 1000,
      all: insights.supplier.allFulfillment * 1000,
    });
  }
  if (insights.purchaseOrder) {
    rows.push({ metric: "PO · Value", tagged: insights.purchaseOrder.taggedValue, all: insights.purchaseOrder.allValue });
    rows.push({
      metric: "PO · Fulfillment",
      tagged: insights.purchaseOrder.taggedFulfillment * 1000,
      all: insights.purchaseOrder.allFulfillment * 1000,
    });
  }

  if (rows.length === 0) return null;

  const tagSwatchColor = TAG_SWATCH_CLASS[tagColor] ? COLORS[colorsKeyFor(tagColor)] : COLORS.emerald;
  const tooltipFormatter = (value: number, name: string, item: { payload?: { metric?: string } }) => {
    const metric = item?.payload?.metric ?? "";
    if (metric.includes("Fulfillment")) {
      return [`${Math.round(value / 1000)}%`, name];
    }
    return [formatCurrency(value), name];
  };

  return (
    <GlassCard className="p-5">
      <SectionHeader
        title="Tagged vs. All — Comparison"
        description="Side-by-side view of how the tagged segment stacks up against the full portfolio"
        action={
          <div className="hidden items-center gap-3 text-xs sm:flex">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ background: tagSwatchColor }} />
              Tagged
            </span>
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ background: COLORS.teal }} />
              All
            </span>
          </div>
        }
      />
      <div className="mt-4 h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.7 0.02 160 / 0.2)" vertical={false} />
            <XAxis
              dataKey="metric"
              tick={{ fontSize: 10, fill: "oklch(0.5 0.02 165)" }}
              axisLine={false}
              tickLine={false}
              interval={0}
              angle={-25}
              textAnchor="end"
              height={60}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatCurrency(v as number, { compact: true })}
              width={55}
            />
            <Tooltip
              cursor={{ fill: "oklch(0.7 0.02 160 / 0.08)" }}
              contentStyle={{ background: "oklch(0.16 0.012 170 / 0.92)", border: "1px solid oklch(1 0 0 / 0.12)", borderRadius: 12, color: "white", backdropFilter: "blur(12px)" }}
              formatter={(v: number, name: string, item) => tooltipFormatter(v, name, item as { payload?: { metric?: string } })}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              formatter={(v) => (v === "tagged" ? "Tagged" : "All")}
            />
            <Bar dataKey="tagged" name="tagged" fill={tagSwatchColor} radius={[4, 4, 0, 0]} />
            <Bar dataKey="all" name="all" fill={COLORS.teal} radius={[4, 4, 0, 0]} fillOpacity={0.55} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Fulfillment metrics are scaled for visual comparison — hover for the true percentage.
      </p>
    </GlassCard>
  );
}

// Maps a tag color name (from the shared palette) to the oklch chart color so
// the TagComparisonChart bars match the tag's pill swatch.
function colorsKeyFor(color: string): keyof typeof COLORS {
  if (color === "emerald") return "emerald";
  if (color === "amber") return "amber";
  if (color === "rose") return "rose";
  if (color === "teal") return "teal";
  if (color === "plum") return "plum";
  return "emerald";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────────────────────
export function AnalyticsView() {
  const { t } = useTranslation();
  // URL-persisted tag filter state (Task 19-b). `tagId` syncs to `?tagId=`
  // and `entityType` syncs to `?entityType=` so a refresh or shared link
  // preserves the tag filter. Empty `tagId` means "no tag selected" (was
  // `null` before — the existing `if (tagId)` / `tagId ? ... : ...` checks
  // treat "" as falsy, matching the old null semantics).
  //
  // `entityType` keeps "all" as its default (not "" as the spec suggested)
  // because the ToggleGroup's first option has value="all" — using "" as
  // the default would leave nothing highlighted on initial load. This is a
  // minor deviation from the spec; the URL key (`entityType`) matches.
  const [tagId, setTagId] = useUrlState<string>("tagId", "");
  const [entityType, setEntityType] = useUrlState<EntityTypeFilter>("entityType", "all");

  // Build the analytics URL with optional query params.
  const analyticsPath = React.useMemo(() => {
    if (!tagId) return "/api/analytics";
    const params = new URLSearchParams();
    params.set("tagId", tagId);
    if (entityType !== "all") params.set("entityType", entityType);
    return `/api/analytics?${params.toString()}`;
  }, [tagId, entityType]);

  const { data, loading } = useApi<AnalyticsData>(analyticsPath, {
    refreshKey: `${tagId}-${entityType}`,
  });
  const { data: tagsData } = useApi<{ tags: TagWithCounts[] }>("/api/tags");
  const tags = tagsData?.tags ?? [];

  const clearFilter = React.useCallback(() => {
    setTagId("");
    setEntityType("all");
  }, [setTagId, setEntityType]);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  const { suppliers, clients, brokerage, volume, forecast, appliedFilter, tagInsights, totals } = data;
  const filterActive = !!appliedFilter;

  // KPI mini-cards for brokerage forecast
  const projected3moTotal = brokerage.projectedByMonth.reduce((s, m) => s + m.amount, 0);

  // Outstanding-by-client bar data (top 6)
  const outstandingByClient = clients.slice(0, 6).map((c) => ({ name: c.name, value: c.outstanding }));

  // Combined volume area chart data
  const volumeCombined = volume.monthlyBilled.map((b, i) => ({
    month: b.month,
    billed: b.value,
    dispatched: volume.monthlyDispatched[i]?.value ?? 0,
  }));

  // Filtered-count helpers for the section-header "(N of M)" badges.
  const filteredSupplierCount = appliedFilter && (appliedFilter.entityType === null || appliedFilter.entityType === "Supplier")
    ? appliedFilter.supplierCount
    : suppliers.length;
  const filteredClientCount = appliedFilter && (appliedFilter.entityType === null || appliedFilter.entityType === "Client")
    ? appliedFilter.clientCount
    : clients.length;

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("analytics.title")}
        description={t("analytics.subtitle")}
        action={
          <div className="flex items-center gap-2">
            <ShareLinkButton />
            {filterActive ? (
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <TagIcon className="size-3" />
                Filtered by: {appliedFilter.tagName}
              </Badge>
            ) : null}
          </div>
        }
      />

      {/* Tag filter bar */}
      <AnalyticsTagFilterBar
        tags={tags}
        tagId={tagId}
        entityType={entityType}
        onTagChange={setTagId}
        onEntityTypeChange={setEntityType}
        onClear={clearFilter}
      />

      {/* Tag insights + comparison chart — only when a tag filter is active */}
      {filterActive && tagInsights ? (
        <>
          <TagInsightsCard appliedFilter={appliedFilter} insights={tagInsights} />
          <TagComparisonChart insights={tagInsights} tagColor={appliedFilter.tagColor} />
        </>
      ) : null}

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* (a) Supplier Reliability                                            */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <GlassCard className="p-5">
        <SectionHeader
          title={t("analytics.supplierReliability")}
          description="Composite score from fulfillment · on-time dispatch · short-ship · dispute rates"
          action={
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <Award className="size-3" />
              {filterActive && filteredSupplierCount !== totals.supplierCount
                ? `${suppliers.length} of ${totals.supplierCount} suppliers`
                : `${suppliers.length} suppliers`}
            </Badge>
          }
        />
        <div className="mt-4">
          {suppliers.length === 0 ? (
            <EmptyState title="No suppliers yet" hint="Add suppliers to compute reliability scores." icon={<Factory className="size-5" />} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[160px]">Supplier</TableHead>
                  <TableHead>{t("analytics.score")}</TableHead>
                  <TableHead>{t("analytics.tier")}</TableHead>
                  <TableHead className="text-right">{t("analytics.fulfillment")}</TableHead>
                  <TableHead className="text-right">{t("analytics.onTime")}</TableHead>
                  <TableHead className="text-right">{t("analytics.shortShipRate")}</TableHead>
                  <TableHead className="text-right">{t("analytics.disputes")}</TableHead>
                  <TableHead className="text-right">{t("analytics.dispatches")}</TableHead>
                  <TableHead className="text-right">{t("analytics.supplied")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s) => (
                  <TableRow key={s.supplierId} className="hover-lift">
                    <TableCell className="font-medium text-foreground">{s.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ScoreRing score={s.score} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={TIER_STYLES[s.tier].badge}>
                        {t(TIER_LABEL_KEYS[s.tier])}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right kpi-num">
                      <span className={s.fulfillment >= 85 ? "text-emerald-600 dark:text-emerald-400" : s.fulfillment >= 70 ? "" : "text-amber-600 dark:text-amber-400"}>
                        {s.fulfillment}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right kpi-num">
                      <span className={s.onTimeRate >= 85 ? "text-emerald-600 dark:text-emerald-400" : s.onTimeRate < 60 ? "text-rose-600 dark:text-rose-400" : ""}>
                        {s.onTimeRate}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right kpi-num">
                      <span className={s.shortShipmentRate === 0 ? "text-emerald-600 dark:text-emerald-400" : s.shortShipmentRate >= 20 ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}>
                        {s.shortShipmentRate}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right kpi-num">
                      <span className={s.disputeRate === 0 ? "text-emerald-600 dark:text-emerald-400" : s.disputeRate >= 30 ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}>
                        {s.disputeRate}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right kpi-num text-muted-foreground">{formatNumber(s.dispatchCount)}</TableCell>
                    <TableCell className="text-right kpi-num text-muted-foreground">{formatCurrency(s.totalSupplied, { compact: true })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </GlassCard>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* (b) Client Credit Exposure                                          */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-5">
        <GlassCard className="p-5 lg:col-span-3">
          <SectionHeader
            title={t("analytics.clientCreditExposure")}
            description="Outstanding receivables · payment delays · return rates"
            action={
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <Wallet className="size-3" />
                {filterActive && filteredClientCount !== totals.clientCount
                  ? `${clients.length} of ${totals.clientCount} clients`
                  : formatCurrency(clients.reduce((s, c) => s + c.outstanding, 0), { compact: true })}
              </Badge>
            }
          />
          <div className="mt-4">
            {clients.length === 0 ? (
              <EmptyState title="No clients yet" hint="Add clients to see credit exposure." icon={<Users className="size-5" />} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[160px]">Client</TableHead>
                    <TableHead className="text-right">{t("analytics.outstanding")}</TableHead>
                    <TableHead className="text-right">{t("analytics.avgPaymentDelay")}</TableHead>
                    <TableHead className="text-right">{t("analytics.returnRate")}</TableHead>
                    <TableHead className="text-right">{t("analytics.bills")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((c) => {
                    const tone = c.outstanding > 100000
                      ? "text-rose-600 dark:text-rose-400"
                      : c.outstanding > 50000
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-foreground";
                    return (
                      <TableRow key={c.clientId} className="hover-lift">
                        <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                        <TableCell className={`text-right kpi-num ${tone}`}>{formatCurrency(c.outstanding, { compact: true })}</TableCell>
                        <TableCell className="text-right kpi-num">
                          <span className={c.avgPaymentDelay > 120 ? "text-rose-600 dark:text-rose-400" : c.avgPaymentDelay > 60 ? "text-amber-600 dark:text-amber-400" : ""}>
                            {c.avgPaymentDelay > 0 ? `${c.avgPaymentDelay}d` : "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right kpi-num">
                          <span className={c.returnRate === 0 ? "text-emerald-600 dark:text-emerald-400" : c.returnRate >= 10 ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}>
                            {c.returnRate}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right kpi-num text-muted-foreground">{formatNumber(c.billCount)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5 lg:col-span-2">
          <SectionHeader title={t("analytics.outstandingByClient")} description="Top 6 by outstanding balance" />
          <div className="mt-4 h-64 w-full">
            {outstandingByClient.length === 0 || outstandingByClient.every((d) => d.value === 0) ? (
              <EmptyState title="No outstanding receivables" hint="All client bills are fully paid." icon={<Wallet className="size-5" />} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={outstandingByClient} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.7 0.02 160 / 0.2)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v as number, { compact: true })} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }} axisLine={false} tickLine={false} width={110} />
                  <Tooltip
                    cursor={{ fill: "oklch(0.7 0.02 160 / 0.08)" }}
                    contentStyle={{ background: "oklch(0.16 0.012 170 / 0.92)", border: "1px solid oklch(1 0 0 / 0.12)", borderRadius: 12, color: "white" }}
                    formatter={(v: number) => formatCurrency(v)}
                  />
                  <Bar dataKey="value" name="Outstanding" radius={[0, 6, 6, 0]}>
                    {outstandingByClient.map((d, i) => (
                      <Cell
                        key={i}
                        fill={d.value > 100000 ? COLORS.rose : d.value > 50000 ? COLORS.amber : COLORS.emerald}
                        stroke="none"
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </GlassCard>
      </div>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* (c) Brokerage Forecast                                              */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <GlassCard className="p-5">
        <SectionHeader
          title={t("analytics.brokerageForecast")}
          description="Pending eligibility · eligible unpaid · projected payouts by client cadence"
          action={
            <div className="flex items-center gap-2">
              {filterActive ? (
                <span className="text-[11px] text-muted-foreground">
                  {appliedFilter.entityType === null || appliedFilter.entityType === "PurchaseOrder"
                    ? `${appliedFilter.purchaseOrderCount} of ${totals.purchaseOrderCount} POs`
                    : null}
                </span>
              ) : null}
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <TrendingUp className="size-3" />
                Next 3 mo: {formatCurrency(projected3moTotal, { compact: true })}
              </Badge>
            </div>
          }
        />

        {/* KPI mini-cards */}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <KpiCard
            label={t("analytics.pendingNotEligible")}
            value={formatCurrency(brokerage.pendingTotal, { compact: true })}
            sub="Will accrue once bills are fully paid"
            icon={<Clock className="size-5" />}
            accent="rose"
          />
          <KpiCard
            label={t("analytics.eligibleUnpaid")}
            value={formatCurrency(brokerage.eligibleUnpaidTotal, { compact: true })}
            sub="Awaiting payout batch"
            icon={<Wallet className="size-5" />}
            accent="amber"
          />
          <KpiCard
            label={t("analytics.projectedNext3Mo")}
            value={formatCurrency(projected3moTotal, { compact: true })}
            sub="Spread by client cadence"
            icon={<TrendingUp className="size-5" />}
            accent="emerald"
          />
        </div>

        {/* Projected payout chart + cadence breakdown */}
        <div className="mt-4 grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Projected monthly payouts (next 3 months)</p>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={brokerage.projectedByMonth} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gPayout" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.emerald} stopOpacity={0.9} />
                      <stop offset="100%" stopColor={COLORS.emerald} stopOpacity={0.55} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.7 0.02 160 / 0.2)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: "oklch(0.5 0.02 165)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v as number, { compact: true })} width={50} />
                  <Tooltip
                    cursor={{ fill: "oklch(0.7 0.02 160 / 0.08)" }}
                    contentStyle={{ background: "oklch(0.16 0.012 170 / 0.92)", border: "1px solid oklch(1 0 0 / 0.12)", borderRadius: 12, color: "white" }}
                    formatter={(v: number) => formatCurrency(v)}
                  />
                  <Bar dataKey="amount" name="Projected payout" fill="url(#gPayout)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="lg:col-span-2">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Breakdown by cadence (eligible unpaid)</p>
            <div className="space-y-2.5">
              <CadenceRow
                label={t("analytics.immediate")}
                hint="Paid on bill settlement"
                amount={brokerage.byCadence.immediate}
                color={COLORS.emerald}
              />
              <CadenceRow
                label={t("analytics.fourMonthCumulative")}
                hint="Quarterly payout batches"
                amount={brokerage.byCadence["4_month"]}
                color={COLORS.teal}
              />
              <CadenceRow
                label={t("analytics.twelveMonthCumulative")}
                hint="Annual payout batches"
                amount={brokerage.byCadence["12_month"]}
                color={COLORS.plum}
              />
            </div>
          </div>
        </div>
      </GlassCard>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* (e) Forecasting — deep 6-mo brokerage w/ confidence interval,        */}
      {/*     12-mo seasonal trends, client velocity, supplier capacity.       */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <ForecastingSection forecast={forecast} />

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* (d) Business Volume Trends                                          */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-5">
        <GlassCard className="p-5 lg:col-span-3">
          <SectionHeader
            title={t("analytics.volumeTrends")}
            description="Last 12 months — billed vs. dispatched value"
            action={
              <div className="flex flex-wrap items-center gap-3 text-xs">
                {filterActive && (appliedFilter.entityType === null || appliedFilter.entityType === "PurchaseOrder") ? (
                  <span className="text-[11px] text-muted-foreground">
                    {appliedFilter.purchaseOrderCount} of {totals.purchaseOrderCount} POs
                  </span>
                ) : null}
                <span className="hidden items-center gap-1.5 text-muted-foreground sm:flex">
                  <span className="size-2.5 rounded-full" style={{ background: COLORS.emerald }} />
                  Billed
                </span>
                <span className="hidden items-center gap-1.5 text-muted-foreground sm:flex">
                  <span className="size-2.5 rounded-full" style={{ background: COLORS.teal }} />
                  Dispatched
                </span>
              </div>
            }
          />
          <div className="mt-4 h-64 w-full">
            {volumeCombined.every((d) => d.billed === 0 && d.dispatched === 0) ? (
              <EmptyState title="No volume in the last 12 months" hint="Bills and dispatches will appear here." icon={<BarChart3 className="size-5" />} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={volumeCombined} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gBilled" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.emerald} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={COLORS.emerald} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gDispatched" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.teal} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={COLORS.teal} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.7 0.02 160 / 0.2)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(volumeCombined.length / 8))} minTickGap={4} />
                  <YAxis tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v as number, { compact: true })} width={50} />
                  <Tooltip
                    contentStyle={{ background: "oklch(0.16 0.012 170 / 0.92)", border: "1px solid oklch(1 0 0 / 0.12)", borderRadius: 12, color: "white", backdropFilter: "blur(12px)" }}
                    formatter={(v: number) => formatCurrency(v)}
                  />
                  <Area type="monotone" dataKey="billed" name="Billed" stroke={COLORS.emerald} strokeWidth={2} fill="url(#gBilled)" />
                  <Area type="monotone" dataKey="dispatched" name="Dispatched" stroke={COLORS.teal} strokeWidth={2} fill="url(#gDispatched)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5 lg:col-span-2">
          <SectionHeader title={t("analytics.topClientSupplierPairs")} description="By total billed value" />
          <div className="mt-4">
            {volume.topPairs.length === 0 ? (
              <EmptyState title="No paired activity yet" hint="Bills will surface top client–supplier relationships." icon={<Users className="size-5" />} />
            ) : (
              <div className="space-y-2.5">
                {volume.topPairs.map((p, i) => {
                  const max = volume.topPairs[0]?.value || 1;
                  const pct = Math.max(6, Math.round((p.value / max) * 100));
                  return (
                    <div key={`${p.clientName}-${p.supplierName}-${i}`} className="rounded-xl border border-border/50 bg-card/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{p.clientName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            <ArrowDownRight className="mr-0.5 inline size-3 text-muted-foreground/70" />
                            {p.supplierName}
                          </p>
                        </div>
                        <p className="kpi-num shrink-0 text-sm font-medium text-foreground">{formatCurrency(p.value, { compact: true })}</p>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: i === 0 ? COLORS.emerald : i === 1 ? COLORS.teal : i === 2 ? COLORS.amber : i === 3 ? COLORS.plum : COLORS.rose }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CadenceRow — breakdown row for brokerage forecast by client payout cadence.
// ─────────────────────────────────────────────────────────────────────────────
function CadenceRow({ label, hint, amount, color }: { label: string; hint: string; amount: number; color: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
          <div>
            <p className="text-sm font-medium text-foreground">{label}</p>
            <p className="text-[11px] text-muted-foreground">{hint}</p>
          </div>
        </div>
        <p className="kpi-num text-sm font-medium text-foreground">{formatCurrency(amount, { compact: true })}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ForecastingSection — 6-mo brokerage forecast with confidence interval,
// 12-mo seasonal trends with growth-rate overlay, client velocity, supplier
// capacity. The four deep-forecast sub-features requested by the broker.
// ─────────────────────────────────────────────────────────────────────────────
function ForecastingSection({ forecast }: { forecast: Forecast }) {
  const { t } = useTranslation();
  const { brokerage6Month, seasonalTrends, clientVelocity, supplierCapacity } = forecast;

  // Insight card #1 — projected next-month brokerage + confidence range
  const nextMonth = brokerage6Month[0];
  const projectedNextMonth = nextMonth?.projected ?? 0;
  const lowerNext = nextMonth?.lower ?? 0;
  const upperNext = nextMonth?.upper ?? 0;

  // Insight card #2 — peak season (highest-value month + its season label)
  const peakMonth = seasonalTrends
    .slice()
    .sort((a, b) => b.value - a.value)
    .find((m) => m.value > 0);
  const peakLabel = peakMonth ? `${peakMonth.month} · ${peakMonth.seasonLabel}` : "—";

  // Insight card #3 — next expected client order (closest predicted date)
  const nextClient = clientVelocity
    .filter((c) => c.predictedNextOrderDate)
    .map((c) => ({
      ...c,
      daysOut: Math.max(0, daysBetween(new Date(c.predictedNextOrderDate as string), new Date())),
    }))
    .sort((a, b) => a.daysOut - b.daysOut)[0];

  return (
    <GlassCard className="p-5">
      <SectionHeader
        title={t("analytics.forecasting")}
        description="6-month brokerage projection · seasonal trends · client velocity · supplier capacity"
        action={
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <Zap className="size-3" />
            {t("analytics.deepForecast")}
          </Badge>
        }
      />

      {/* ── Insight cards (3) ─────────────────────────────────────────────── */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <KpiCard
          label={t("analytics.projectedNextMonthBrokerage")}
          value={formatCurrency(projectedNextMonth, { compact: true })}
          sub={`Range: ${formatCurrency(lowerNext, { compact: true })} – ${formatCurrency(upperNext, { compact: true })}`}
          icon={<TrendingUp className="size-5" />}
          accent="emerald"
        />
        <KpiCard
          label={t("analytics.peakSeason")}
          value={<span className="text-xl font-medium">{peakLabel}</span>}
          sub={peakMonth ? `Highest billing month (last 12 mo)` : "No billing data yet"}
          icon={<Star className="size-5" />}
          accent="amber"
        />
        <KpiCard
          label={t("analytics.nextExpectedClientOrder")}
          value={
            nextClient ? (
              <span className="text-xl font-medium">
                {nextClient.name}
                <span className="ml-1 text-sm font-normal text-muted-foreground">in {nextClient.daysOut}d</span>
              </span>
            ) : "—"
          }
          sub={nextClient?.predictedNextOrderDate ? `Predicted ${formatDate(nextClient.predictedNextOrderDate)}` : "No predictable cadence yet"}
          icon={<Calendar className="size-5" />}
          accent="teal"
        />
      </div>

      {/* ── 6-Month Brokerage Forecast with Confidence Interval ──────────── */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("analytics.sixMonthForecast")}
          </p>
          <div className="hidden items-center gap-3 text-xs sm:flex">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ background: COLORS.emerald }} />
              {t("analytics.projected")}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ background: COLORS.teal }} />
              {t("analytics.upper")}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ background: COLORS.amber }} />
              {t("analytics.lower")}
            </span>
          </div>
        </div>
        <div className="h-64 w-full">
          {brokerage6Month.every((d) => d.projected === 0 && d.upper === 0 && d.lower === 0) ? (
            <EmptyState title="No forecast data yet" hint="Brokerage projections will appear once bills and brokerages are recorded." icon={<TrendingUp className="size-5" />} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={brokerage6Month} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="gUpper" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.teal} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={COLORS.teal} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gProjected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.emerald} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={COLORS.emerald} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="gLower" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.amber} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={COLORS.amber} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.7 0.02 160 / 0.2)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v as number, { compact: true })} width={50} />
                <Tooltip
                  contentStyle={{ background: "oklch(0.16 0.012 170 / 0.92)", border: "1px solid oklch(1 0 0 / 0.12)", borderRadius: 12, color: "white", backdropFilter: "blur(12px)" }}
                  formatter={(v: number) => formatCurrency(v)}
                />
                <Area type="monotone" dataKey="upper" name="Upper bound" stroke={COLORS.teal} strokeWidth={1.5} strokeDasharray="4 4" fill="url(#gUpper)" />
                <Area type="monotone" dataKey="projected" name="Projected" stroke={COLORS.emerald} strokeWidth={2.5} fill="url(#gProjected)" />
                <Area type="monotone" dataKey="lower" name="Lower bound" stroke={COLORS.amber} strokeWidth={1.5} strokeDasharray="4 4" fill="url(#gLower)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Seasonal Trends (12-mo bar + growth-rate line overlay) ────────── */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("analytics.seasonalTrends")}
          </p>
          <div className="hidden items-center gap-3 text-xs sm:flex">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Star className="size-3 text-amber-500" />
              {t("analytics.peakMonth")}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ background: COLORS.rose }} />
              {t("analytics.growthRate")}
            </span>
          </div>
        </div>
        <div className="h-72 w-full">
          {seasonalTrends.every((d) => d.value === 0) ? (
            <EmptyState title="No billing in the last 12 months" hint="Monthly billed value will surface here with season context." icon={<BarChart3 className="size-5" />} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={seasonalTrends} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.7 0.02 160 / 0.2)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "oklch(0.5 0.02 165)" }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={50} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v as number, { compact: true })} width={50} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={42} />
                <Tooltip
                  cursor={{ fill: "oklch(0.7 0.02 160 / 0.08)" }}
                  contentStyle={{ background: "oklch(0.16 0.012 170 / 0.92)", border: "1px solid oklch(1 0 0 / 0.12)", borderRadius: 12, color: "white", backdropFilter: "blur(12px)" }}
                  formatter={(v: number, name: string) => name === "Growth" ? `${v}%` : formatCurrency(v)}
                />
                <ReferenceLine y={0} yAxisId="right" stroke="oklch(0.7 0.02 165 / 0.4)" />
                <Bar yAxisId="left" dataKey="value" name="Billed" radius={[4, 4, 0, 0]}>
                  {seasonalTrends.map((d, i) => (
                    <Cell
                      key={i}
                      fill={SEASON_STYLES[d.seasonKey].color}
                      fillOpacity={d.isPeak ? 0.95 : d.isLow ? 0.55 : 0.75}
                      stroke={d.isPeak ? COLORS.amber : "none"}
                      strokeWidth={d.isPeak ? 2 : 0}
                    />
                  ))}
                </Bar>
                <Line yAxisId="right" type="monotone" dataKey="growthRate" name="Growth" stroke={COLORS.rose} strokeWidth={2} dot={{ r: 2.5, fill: COLORS.rose }} activeDot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Season legend + peak-month annotations */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: SEASON_STYLES.festive.color }} />
            Festive Season (Oct–Nov)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: SEASON_STYLES.wedding.color }} />
            Wedding Season (Dec–Jan)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: SEASON_STYLES.summer.color }} />
            Summer Transition (Apr–May)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: SEASON_STYLES.winter.color }} />
            Winter Stock (Aug–Sep)
          </span>
        </div>
        {seasonalTrends.filter((m) => m.isPeak).length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Peak months:</span>
            {seasonalTrends.filter((m) => m.isPeak).map((m) => (
              <Badge key={m.month} variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <Star className="size-3" />
                {m.month} — {m.seasonLabel}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* ── Client Velocity + Supplier Capacity (side-by-side on large) ──── */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Client velocity table */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("analytics.clientVelocity")}
          </p>
          {clientVelocity.length === 0 ? (
            <EmptyState title="No client orders yet" hint="POs will surface predicted reorder dates." icon={<Users className="size-5" />} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/50">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">Client</TableHead>
                    <TableHead className="text-right">{t("analytics.lastOrder")}</TableHead>
                    <TableHead className="text-right">{t("analytics.avgGap")}</TableHead>
                    <TableHead className="text-right">{t("analytics.predictedNext")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientVelocity.map((c) => {
                    const daysOut = c.predictedNextOrderDate
                      ? Math.max(0, daysBetween(new Date(c.predictedNextOrderDate), new Date()))
                      : null;
                    const tone = daysOut === null
                      ? "text-muted-foreground"
                      : daysOut <= 14
                        ? "text-emerald-600 dark:text-emerald-400"
                        : daysOut <= 45
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground";
                    return (
                      <TableRow key={c.clientId} className="hover-lift">
                        <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                        <TableCell className="text-right kpi-num text-muted-foreground">
                          {c.lastOrderDate ? formatDate(c.lastOrderDate) : "—"}
                        </TableCell>
                        <TableCell className="text-right kpi-num">
                          {c.avgDaysBetweenOrders > 0 ? `${c.avgDaysBetweenOrders}d` : "—"}
                        </TableCell>
                        <TableCell className="text-right kpi-num">
                          <span className={`inline-flex items-center gap-1.5 ${tone}`}>
                            {daysOut !== null && daysOut <= 14 && (
                              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-700 dark:text-emerald-300">
                                Expected
                              </Badge>
                            )}
                            {c.predictedNextOrderDate ? formatDate(c.predictedNextOrderDate) : "—"}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Supplier capacity table */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("analytics.supplierCapacity")}
          </p>
          {supplierCapacity.length === 0 ? (
            <EmptyState title="No suppliers yet" hint="Add suppliers to compute capacity utilisation." icon={<Factory className="size-5" />} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/50">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">Supplier</TableHead>
                    <TableHead className="text-right">{t("analytics.avgLead")}</TableHead>
                    <TableHead className="text-right">{t("analytics.pendingPOs")}</TableHead>
                    <TableHead className="text-right">{t("analytics.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplierCapacity.map((s) => {
                    const sty = SUPPLIER_STATUS_STYLES[s.status];
                    return (
                      <TableRow key={s.supplierId} className="hover-lift">
                        <TableCell className="font-medium text-foreground">{s.name}</TableCell>
                        <TableCell className="text-right kpi-num text-muted-foreground">
                          {s.avgLeadTimeDays > 0 ? `${s.avgLeadTimeDays}d` : "—"}
                        </TableCell>
                        <TableCell className="text-right kpi-num">
                          <span className={s.pendingPOs >= 5 ? "text-rose-600 dark:text-rose-400" : s.pendingPOs >= 3 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}>
                            {formatNumber(s.pendingPOs)}
                          </span>
                          <span className="ml-1 text-[11px] text-muted-foreground">/ {s.monthlyAvgPOs}/mo avg</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className={sty.badge}>
                            {s.status === "overloaded" && <AlertCircle className="size-3" />}
                            {t(SUPPLIER_STATUS_LABEL_KEYS[s.status])}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}
