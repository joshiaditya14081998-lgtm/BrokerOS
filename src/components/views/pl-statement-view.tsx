"use client";

import * as React from "react";
import {
  TrendingUp, TrendingDown, Download, CalendarRange, CalendarDays, CalendarClock, Calendar,
  ArrowUpRight, ArrowDownRight, Scale,
} from "lucide-react";
import { useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { GlassCard, KpiCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableFooter,
} from "@/components/ui/table";
import { useTranslation } from "@/hooks/use-translation";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// P&L Statement — Profit & Loss for the broker over a date range.
//   Income = brokerage eligible in range (accrued) + brokerage paid in range
//   Expenses = operating expenses grouped by category
//   Net = Income − Expenses
//   Comparison = same calc for the previous period of equal length
//
// Data source: GET /api/reports/profit-loss?range=<>&from=<>&to=<> (JSON).
// PDF export: opens GET /api/reports?type=profit-loss&range=<>&from=<>&to=<>
// in a new tab — the route returns print-optimized HTML with window.print().
// ─────────────────────────────────────────────────────────────────────────────

type PLResponse = {
  range: { start: string; end: string; label: string };
  income: {
    brokerageEligible: number;
    brokeragePaidOut: number;
    otherIncome: number;
    totalIncome: number;
  };
  expenses: {
    travel?: number;
    phone?: number;
    staff_salary?: number;
    office_rent?: number;
    marketing?: number;
    miscellaneous?: number;
    totalExpenses: number;
  };
  net: {
    profit: number;
    marginPercent: number;
    isProfit: boolean;
  };
  comparison: {
    previousRangeProfit: number;
    changePercent: number;
  };
};

type RangeOption = "month" | "quarter" | "year" | "custom";

const RANGE_OPTIONS: { key: RangeOption; labelKey: string; icon: React.ElementType }[] = [
  { key: "month", labelKey: "plStatement.thisMonth", icon: CalendarDays },
  { key: "quarter", labelKey: "plStatement.thisQuarter", icon: CalendarRange },
  { key: "year", labelKey: "plStatement.thisYear", icon: CalendarClock },
  { key: "custom", labelKey: "plStatement.custom", icon: Calendar },
];

const EXPENSE_CATEGORY_KEYS: { key: string; labelKey: string }[] = [
  { key: "travel", labelKey: "expenses.travel" },
  { key: "phone", labelKey: "expenses.phone" },
  { key: "staff_salary", labelKey: "expenses.staff_salary" },
  { key: "office_rent", labelKey: "expenses.office_rent" },
  { key: "marketing", labelKey: "expenses.marketing" },
  { key: "miscellaneous", labelKey: "expenses.miscellaneous" },
];

// Format an ISO date as `YYYY-MM-DD` for `<input type="date">` value binding.
function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function titleCaseCategory(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PlStatementView() {
  const { t } = useTranslation();
  const { format: fmtCurrency } = useCurrencyFormat();

  const [range, setRange] = React.useState<RangeOption>("month");
  const [customFrom, setCustomFrom] = React.useState<string>(toDateInputValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()));
  const [customTo, setCustomTo] = React.useState<string>(toDateInputValue(new Date().toISOString()));

  // Build the query string for the JSON fetch. The PDF export reuses the same
  // query, so we can derive the export URL from the same state.
  const query = React.useMemo(() => {
    if (range === "custom") {
      return `range=custom&from=${customFrom}&to=${customTo}`;
    }
    return `range=${range}`;
  }, [range, customFrom, customTo]);

  const { data, loading, error, refresh } = useApi<PLResponse>(`/api/reports/profit-loss?${query}`);

  React.useEffect(() => {
    if (error) toast.error(t("plStatement.loadFailed"));
  }, [error, t]);

  const handleExportPdf = () => {
    window.open(`/api/reports?type=profit-loss&${query}`, "_blank");
  };

  const empty =
    !!data && data.income.totalIncome === 0 && data.expenses.totalExpenses === 0;

  // Margin accent: emerald ≥20%, amber 10–20%, rose <10%
  const marginAccent =
    !data ? "default" : data.net.marginPercent >= 20
      ? "emerald"
      : data.net.marginPercent >= 10
        ? "amber"
        : "rose";

  const changeUp = data ? data.comparison.changePercent >= 0 : false;

  // Bar chart data — 3 bars: Income, Expenses, Net
  const chartData = data
    ? [
        { name: t("plStatement.totalIncome"), value: data.income.totalIncome, color: "#10b981" },
        { name: t("plStatement.totalExpenses"), value: data.expenses.totalExpenses, color: "#f43f5e" },
        { name: t("plStatement.netResult"), value: data.net.profit, color: "#14b8a6" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("plStatement.title")}
        description={t("plStatement.subtitle")}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} className="gap-2">
              <Calendar className="size-4" />
              {data ? data.range.label : "—"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPdf} className="gap-2">
              <Download className="size-4" />
              <span className="hidden sm:inline">{t("plStatement.exportPdf")}</span>
            </Button>
          </div>
        }
      />

      {/* Range toggle + custom date pickers */}
      <GlassCard className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("plStatement.from")}
            </Label>
            <ToggleGroup
              type="single"
              value={range}
              onValueChange={(v) => v && setRange(v as RangeOption)}
              className="glass-strong flex flex-wrap gap-1 rounded-xl p-1"
            >
              {RANGE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <ToggleGroupItem
                    key={opt.key}
                    value={opt.key}
                    aria-label={t(opt.labelKey)}
                    className="gap-1.5 data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-600 dark:data-[state=on]:text-emerald-400"
                  >
                    <Icon className="size-3.5" />
                    <span className="hidden sm:inline">{t(opt.labelKey)}</span>
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>

          {range === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="pl-from" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("plStatement.from")}
                </Label>
                <Input
                  id="pl-from"
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-to" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("plStatement.to")}
                </Label>
                <Input
                  id="pl-to"
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-40"
                />
              </div>
            </div>
          )}
        </div>
      </GlassCard>

      {loading ? (
        <PLSkeleton />
      ) : error || !data ? (
        <GlassCard className="p-8">
          <EmptyState
            title={t("plStatement.noData")}
            hint={t("plStatement.noDataHint")}
            icon={<TrendingUp className="size-5" />}
          />
        </GlassCard>
      ) : empty ? (
        <GlassCard className="p-8">
          <EmptyState
            title={t("plStatement.noData")}
            hint={t("plStatement.noDataHint")}
            icon={<TrendingUp className="size-5" />}
          />
        </GlassCard>
      ) : (
        <>
          {/* Summary KPI strip — 4 cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label={t("plStatement.totalIncome")}
              value={<span className="text-emerald-600 dark:text-emerald-400">{fmtCurrency(data.income.totalIncome)}</span>}
              icon={<TrendingUp className="size-5" />}
              accent="emerald"
            />
            <KpiCard
              label={t("plStatement.totalExpenses")}
              value={<span className="text-rose-600 dark:text-rose-400">{fmtCurrency(data.expenses.totalExpenses)}</span>}
              icon={<TrendingDown className="size-5" />}
              accent="rose"
            />
            <KpiCard
              label={data.net.isProfit ? t("plStatement.netProfit") : t("plStatement.netLoss")}
              value={
                <span className={data.net.isProfit ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                  {data.net.isProfit ? "" : "−"}{fmtCurrency(Math.abs(data.net.profit))}
                </span>
              }
              icon={data.net.isProfit ? <TrendingUp className="size-5" /> : <TrendingDown className="size-5" />}
              accent={data.net.isProfit ? "emerald" : "rose"}
            />
            <KpiCard
              label={t("plStatement.margin")}
              value={
                <span className={cn(
                  marginAccent === "emerald" && "text-emerald-600 dark:text-emerald-400",
                  marginAccent === "amber" && "text-amber-600 dark:text-amber-400",
                  marginAccent === "rose" && "text-rose-600 dark:text-rose-400",
                )}>
                  {data.net.marginPercent.toFixed(1)}%
                </span>
              }
              icon={<Scale className="size-5" />}
              accent={marginAccent as "emerald" | "amber" | "rose" | "default"}
            />
          </div>

          {/* Income + Expense breakdown tables side-by-side on desktop */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Income breakdown */}
            <GlassCard className="overflow-hidden">
              <div className="border-b border-border/60 px-5 py-3">
                <h3 className="text-sm font-semibold text-foreground">{t("plStatement.incomeBreakdown")}</h3>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("plStatement.brokerageEligible").split(" ")[0]}</TableHead>
                    <TableHead className="text-right">{t("plStatement.amount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">{t("plStatement.brokerageEligible")}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCurrency(data.income.brokerageEligible)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">{t("plStatement.brokeragePaidOut")}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCurrency(data.income.brokeragePaidOut)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">{t("plStatement.otherIncome")}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{fmtCurrency(data.income.otherIncome)}</TableCell>
                  </TableRow>
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">{t("plStatement.totalIncome")}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {fmtCurrency(data.income.totalIncome)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </GlassCard>

            {/* Expense breakdown */}
            <GlassCard className="overflow-hidden">
              <div className="border-b border-border/60 px-5 py-3">
                <h3 className="text-sm font-semibold text-foreground">{t("plStatement.expenseBreakdown")}</h3>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("plStatement.category")}</TableHead>
                    <TableHead className="text-right">{t("plStatement.amount")}</TableHead>
                    <TableHead className="text-right">{t("plStatement.percentOfTotal")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {EXPENSE_CATEGORY_KEYS.map(({ key, labelKey }) => {
                    const amount = (data.expenses as Record<string, number>)[key] ?? 0;
                    const pct = data.expenses.totalExpenses > 0 ? (amount / data.expenses.totalExpenses) * 100 : 0;
                    const label = t(labelKey);
                    return (
                      <TableRow key={key}>
                        <TableCell className="font-medium">{label === labelKey ? titleCaseCategory(key) : label}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtCurrency(amount)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{pct.toFixed(1)}%</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">{t("plStatement.totalExpenses")}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-rose-600 dark:text-rose-400">
                      {fmtCurrency(data.expenses.totalExpenses)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">100%</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </GlassCard>
          </div>

          {/* Net result + chart */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <GlassCard className={cn(
              "relative overflow-hidden p-6 lg:col-span-1",
              data.net.isProfit
                ? "ring-1 ring-emerald-500/20"
                : "ring-1 ring-rose-500/20",
            )}>
              <div className={cn(
                "pointer-events-none absolute inset-0 bg-gradient-to-br",
                data.net.isProfit
                  ? "from-emerald-500/10 to-emerald-500/0"
                  : "from-rose-500/10 to-rose-500/0",
              )} />
              <div className="relative">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("plStatement.netResult")}
                </p>
                <p className={cn(
                  "kpi-num mt-3 text-4xl font-light",
                  data.net.isProfit
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400",
                )}>
                  {data.net.isProfit ? "" : "−"}{fmtCurrency(Math.abs(data.net.profit))}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.net.isProfit ? t("plStatement.netProfit") : t("plStatement.netLoss")}
                  {" · "}
                  {t("plStatement.margin")} {data.net.marginPercent.toFixed(1)}%
                </p>
                <div className="mt-4 flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">{t("plStatement.vsPrevious")}:</span>
                  <span className={cn(
                    "inline-flex items-center gap-0.5 font-medium",
                    changeUp ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
                  )}>
                    {changeUp ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                    {Math.abs(data.comparison.changePercent).toFixed(1)}%
                  </span>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="p-5 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{t("plStatement.incomeVsExpenses")}</h3>
              </div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" vertical={false} />
                    <XAxis
                      dataKey="name"
                      stroke="currentColor"
                      className="text-[10px] text-muted-foreground"
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="currentColor"
                      className="text-[10px] text-muted-foreground"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => fmtCurrency(v, { compact: true })}
                    />
                    <Tooltip
                      cursor={{ fill: "currentColor", fillOpacity: 0.05 }}
                      contentStyle={{
                        background: "rgba(24, 24, 27, 0.95)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "8px",
                        color: "#fff",
                        fontSize: "12px",
                      }}
                      formatter={(v: number) => fmtCurrency(v)}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={80}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function PLSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
      <Skeleton className="h-56 rounded-2xl" />
    </div>
  );
}
