"use client";

import * as React from "react";
import {
  Banknote, Download, ArrowDownRight, ArrowUpRight, RefreshCw, TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  Cell, ReferenceLine,
} from "recharts";
import { api, useApi } from "@/lib/api";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { GlassCard, KpiCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { useTranslation } from "@/hooks/use-translation";
import { toast } from "sonner";

type RangeKey = "month" | "quarter" | "year" | "custom";

type CashFlowResponse = {
  range: { start: string; end: string; label: string };
  inflows: { brokeragePayouts: number; invoicePayments: number; totalInflow: number };
  outflows: { byCategory: Record<string, number>; totalOutflow: number };
  net: { cashFlow: number; openingBalance: number; closingBalance: number };
};

// Trend row — one per month for the last 6 months.
type TrendRow = {
  monthLabel: string; // e.g. "Sep"
  fullLabel: string;  // e.g. "Sep 2026"
  cashFlow: number;
};

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  travel: "Travel",
  phone: "Phone",
  staff_salary: "Staff Salary",
  office_rent: "Office Rent",
  marketing: "Marketing",
  miscellaneous: "Miscellaneous",
};

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function firstOfMonthIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

// Build the last 6 calendar-month boundaries (oldest → newest) ending with the
// current month. Each entry is {start, end, label} used to call the cash-flow
// API once per month in parallel.
function lastSixMonths(): Array<{ start: Date; end: Date; label: string; full: string }> {
  const out: Array<{ start: Date; end: Date; label: string; full: string }> = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const y = now.getFullYear();
    const m = now.getMonth() - i;
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
    out.push({
      start,
      end,
      label: start.toLocaleDateString("en-IN", { month: "short" }),
      full: start.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

export function CashFlowView() {
  const { t } = useTranslation();
  const { format: fmtCurrency } = useCurrencyFormat();

  const [range, setRange] = React.useState<RangeKey>("month");
  const [from, setFrom] = React.useState<string>(firstOfMonthIsoDate());
  const [to, setTo] = React.useState<string>(todayIsoDate());

  // Build the API URL based on range selection
  const apiUrl = React.useMemo(() => {
    const params = new URLSearchParams({ range });
    if (range === "custom") {
      params.set("from", from);
      params.set("to", to);
    }
    return `/api/reports/cash-flow?${params.toString()}`;
  }, [range, from, to]);

  const { data, loading, error, refresh } = useApi<CashFlowResponse>(apiUrl);

  React.useEffect(() => {
    if (error) toast.error(t("cashFlow.loadFailed"));
  }, [error, t]);

  // ── 6-month trend (computed in parallel on the client) ────────────────────
  const [trend, setTrend] = React.useState<TrendRow[] | null>(null);
  const [trendLoading, setTrendLoading] = React.useState<boolean>(true);

  React.useEffect(() => {
    let cancelled = false;
    setTrendLoading(true);
    const months = lastSixMonths();
    Promise.all(
      months.map((m) => {
        const params = new URLSearchParams({
          range: "custom",
          from: m.start.toISOString(),
          to: m.end.toISOString(),
        });
        return api<CashFlowResponse>(`/api/reports/cash-flow?${params.toString()}`)
          .then((r) => ({ monthLabel: m.label, fullLabel: m.full, cashFlow: r.net.cashFlow }))
          .catch(() => ({ monthLabel: m.label, fullLabel: m.full, cashFlow: 0 }));
      }),
    ).then((rows) => {
      if (!cancelled) {
        setTrend(rows);
        setTrendLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const inflows = data?.inflows ?? { brokeragePayouts: 0, invoicePayments: 0, totalInflow: 0 };
  const outflows = data?.outflows ?? { byCategory: {}, totalOutflow: 0 };
  const net = data?.net ?? { cashFlow: 0, openingBalance: 0, closingBalance: 0 };
  const isEmpty = inflows.totalInflow === 0 && outflows.totalOutflow === 0;

  const exportPdf = () => {
    const params = new URLSearchParams({ type: "cash-flow", range });
    if (range === "custom") {
      params.set("from", from);
      params.set("to", to);
    }
    window.open(`/api/reports?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  // Outflow rows — only show categories with non-zero spend, but always show
  // at least the labelled rows so the user knows the categories exist.
  const outflowRows = Object.keys(EXPENSE_CATEGORY_LABELS)
    .map((cat) => ({ cat, amount: outflows.byCategory?.[cat] ?? 0 }))
    .filter((r) => r.amount > 0);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("cashFlow.title")}
        description={t("cashFlow.subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} className="gap-2">
              <RefreshCw className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={exportPdf} className="gap-2">
              <Download className="size-4" />
              <span className="hidden sm:inline">{t("cashFlow.exportPdf")}</span>
            </Button>
          </div>
        }
      />

      {/* Toolbar — range toggle + custom date pickers */}
      <GlassCard className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(v) => { if (v) setRange(v as RangeKey); }}
            variant="outline"
            size="sm"
            className="rounded-full border border-border/60 bg-card/40"
          >
            <ToggleGroupItem
              value="month"
              className="rounded-full px-3 text-xs data-[state=on]:border-emerald-500/40 data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-700 dark:data-[state=on]:text-emerald-300"
            >
              {t("cashFlow.thisMonth")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="quarter"
              className="rounded-full px-3 text-xs data-[state=on]:border-emerald-500/40 data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-700 dark:data-[state=on]:text-emerald-300"
            >
              {t("cashFlow.thisQuarter")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="year"
              className="rounded-full px-3 text-xs data-[state=on]:border-emerald-500/40 data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-700 dark:data-[state=on]:text-emerald-300"
            >
              {t("cashFlow.thisYear")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="custom"
              className="rounded-full px-3 text-xs data-[state=on]:border-emerald-500/40 data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-700 dark:data-[state=on]:text-emerald-300"
            >
              {t("cashFlow.custom")}
            </ToggleGroupItem>
          </ToggleGroup>

          {range === "custom" ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cf-from" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("cashFlow.from")}
                </Label>
                <Input
                  id="cf-from"
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full sm:w-44"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cf-to" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("cashFlow.to")}
                </Label>
                <Input
                  id="cf-to"
                  type="date"
                  value={to}
                  min={from}
                  max={todayIsoDate()}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full sm:w-44"
                />
              </div>
            </div>
          ) : null}

          {data ? (
            <p className="text-xs text-muted-foreground">{data.range.label}</p>
          ) : null}
        </div>
      </GlassCard>

      {loading && !data ? (
        <SkeletonSummary />
      ) : isEmpty ? (
        <GlassCard className="p-6">
          <EmptyState
            title={t("cashFlow.noData")}
            hint={t("cashFlow.noDataHint")}
            icon={<Banknote className="size-6" />}
          />
        </GlassCard>
      ) : (
        <>
          {/* Summary KPIs — 3 tiles */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              label={t("cashFlow.totalInflow")}
              value={fmtCurrency(inflows.totalInflow, { compact: true })}
              icon={<ArrowDownRight className="size-5" />}
              accent="emerald"
              sub={
                <span className="flex items-center gap-2">
                  <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                    {fmtCurrency(inflows.brokeragePayouts, { compact: true })}
                  </Badge>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("cashFlow.brokeragePayouts")}</span>
                </span>
              }
            />
            <KpiCard
              label={t("cashFlow.totalOutflow")}
              value={fmtCurrency(outflows.totalOutflow, { compact: true })}
              icon={<ArrowUpRight className="size-5" />}
              accent="rose"
              sub={
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("cashFlow.byCategory")}
                </span>
              }
            />
            <KpiCard
              label={t("cashFlow.netCashFlow")}
              value={fmtCurrency(net.cashFlow, { compact: true })}
              icon={<TrendingUp className="size-5" />}
              accent={net.cashFlow >= 0 ? "emerald" : "rose"}
              sub={
                <span className={net.cashFlow >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}>
                  {net.cashFlow >= 0 ? "▲" : "▼"} {Math.abs(net.cashFlow / Math.max(1, inflows.totalInflow) * 100).toFixed(1)}%
                </span>
              }
            />
          </div>

          {/* Balance card — opening + closing */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <KpiCard
              label={t("cashFlow.openingBalance")}
              value={fmtCurrency(net.openingBalance, { compact: true })}
              icon={<Banknote className="size-5" />}
              accent="default"
            />
            <KpiCard
              label={t("cashFlow.closingBalance")}
              value={fmtCurrency(net.closingBalance, { compact: true })}
              icon={<Banknote className="size-5" />}
              accent={net.closingBalance >= 0 ? "teal" : "rose"}
            />
          </div>

          {/* Inflows + Outflows tables */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <GlassCard className="p-4 sm:p-6">
              <h3 className="mb-3 text-sm font-semibold text-foreground">{t("cashFlow.inflows")}</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-left">{t("cashFlow.inflows")}</TableHead>
                    <TableHead className="text-right">₹</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">{t("cashFlow.brokeragePayouts")}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
                      {fmtCurrency(inflows.brokeragePayouts)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">{t("cashFlow.invoicePayments")}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
                      {fmtCurrency(inflows.invoicePayments)}
                    </TableCell>
                  </TableRow>
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">{t("cashFlow.totalInflow")}</TableCell>
                    <TableCell className="text-right font-mono font-bold tabular-nums">
                      {fmtCurrency(inflows.totalInflow)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </GlassCard>

            <GlassCard className="p-4 sm:p-6">
              <h3 className="mb-3 text-sm font-semibold text-foreground">{t("cashFlow.outflows")}</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-left">{t("cashFlow.byCategory")}</TableHead>
                    <TableHead className="text-right">₹</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outflowRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="py-6 text-center text-xs text-muted-foreground">
                        —
                      </TableCell>
                    </TableRow>
                  ) : (
                    outflowRows.map((r) => (
                      <TableRow key={r.cat}>
                        <TableCell className="font-medium">{EXPENSE_CATEGORY_LABELS[r.cat] ?? r.cat}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-rose-700 dark:text-rose-300">
                          {fmtCurrency(r.amount)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">{t("cashFlow.totalOutflow")}</TableCell>
                    <TableCell className="text-right font-mono font-bold tabular-nums">
                      {fmtCurrency(outflows.totalOutflow)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </GlassCard>
          </div>

          {/* Monthly trend chart */}
          <GlassCard className="p-4 sm:p-6">
            <h3 className="mb-1 text-sm font-semibold text-foreground">{t("cashFlow.monthlyTrend")}</h3>
            <p className="mb-4 text-xs text-muted-foreground">{data?.range.label}</p>
            {trendLoading || !trend ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.7 0.02 160 / 0.2)" vertical={false} />
                    <XAxis
                      dataKey="monthLabel"
                      tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "oklch(0.5 0.02 165)" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => fmtCurrency(v as number, { compact: true })}
                      width={55}
                    />
                    <Tooltip
                      cursor={{ fill: "oklch(0.7 0.02 160 / 0.08)" }}
                      contentStyle={{
                        background: "oklch(0.16 0.012 170 / 0.92)",
                        border: "1px solid oklch(1 0 0 / 0.12)",
                        borderRadius: 12,
                        color: "white",
                        backdropFilter: "blur(12px)",
                      }}
                      labelFormatter={(_, payload) => {
                        const row = payload?.[0]?.payload as TrendRow | undefined;
                        return row?.fullLabel ?? "";
                      }}
                      formatter={(v: number) => [fmtCurrency(v), "Net"] as [string, string]}
                    />
                    <ReferenceLine y={0} stroke="oklch(0.5 0.02 165 / 0.5)" />
                    <Bar dataKey="cashFlow" radius={[4, 4, 0, 0]}>
                      {trend.map((row, idx) => (
                        <Cell
                          key={idx}
                          fill={row.cashFlow >= 0 ? "#10b981" : "#f43f5e"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
}

function SkeletonSummary() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-28 w-full rounded-2xl" />
      </div>
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}
