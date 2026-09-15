"use client";

import * as React from "react";
import {
  FileSpreadsheet, Download, Info, CalendarRange, CalendarDays, CalendarClock,
  TrendingUp, TrendingDown, Receipt,
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
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
  TableFooter,
} from "@/components/ui/table";
import { useTranslation } from "@/hooks/use-translation";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// GST Filing Report — GSTR-1-style summary of GST collected on bills raised
// in the selected period (month / quarter / custom). Output GST is computed
// from `bill.gstAmount` (already aggregated at billing time); input GST is a
// placeholder until expenses carry a GST component.
//
// Data source: GET /api/reports/gst-filing?range=<>&from=<>&to=<> (JSON).
// PDF export: opens GET /api/reports?type=gst-filing&range=<>&from=<>&to=<>
// in a new tab — the route returns print-optimized HTML with window.print().
// ─────────────────────────────────────────────────────────────────────────────

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

type GstFilingResponse = {
  range: { start: string; end: string; label: string };
  outputGst: {
    byRate: ByRate[];
    totalBase: number;
    totalGst: number;
  };
  inputGst: {
    totalGst: number;
    breakdown: never[];
  };
  netGst: {
    liability: number;
    isLiability: boolean;
  };
  clientBreakdown: ClientBreakdownRow[];
};

type RangeOption = "month" | "quarter" | "custom";

const RANGE_OPTIONS: { key: RangeOption; labelKey: string; icon: React.ElementType }[] = [
  { key: "month", labelKey: "gstFiling.thisMonth", icon: CalendarDays },
  { key: "quarter", labelKey: "gstFiling.thisQuarter", icon: CalendarRange },
  { key: "custom", labelKey: "gstFiling.custom", icon: CalendarClock },
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

export function GstFilingView() {
  const { t } = useTranslation();
  const { format: fmtCurrency } = useCurrencyFormat();

  const [range, setRange] = React.useState<RangeOption>("month");
  // Default `from`/`to` to the current month so the custom option doesn't
  // open with empty inputs — the broker can still adjust them.
  const now = React.useMemo(() => new Date(), []);
  const monthStart = React.useMemo(() => {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return toDateInputValue(d.toISOString());
  }, [now]);
  const monthEnd = React.useMemo(() => {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return toDateInputValue(d.toISOString());
  }, [now]);
  const [from, setFrom] = React.useState<string>(monthStart);
  const [to, setTo] = React.useState<string>(monthEnd);

  // Build the query string for the JSON endpoint. Custom range passes
  // `from` + `to`; month/quarter just pass `range`.
  const query = React.useMemo(() => {
    const params = new URLSearchParams({ range });
    if (range === "custom" && from && to) {
      params.set("from", new Date(from).toISOString());
      params.set("to", new Date(to).toISOString());
    }
    return params.toString();
  }, [range, from, to]);

  const { data, loading, error } = useApi<GstFilingResponse>(
    `/api/reports/gst-filing?${query}`,
  );

  // Surface load failures via toast — the hook stores the error string but
  // doesn't toast on its own so the view can localize the message.
  React.useEffect(() => {
    if (error) toast.error(t("gstFiling.loadFailed"));
  }, [error, t]);

  const handleExportPdf = () => {
    const params = new URLSearchParams({ type: "gst-filing", range });
    if (range === "custom" && from && to) {
      params.set("from", new Date(from).toISOString());
      params.set("to", new Date(to).toISOString());
    }
    window.open(`/api/reports?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const summary = data?.outputGst;
  const isEmpty =
    !!data && data.outputGst.totalGst === 0 && data.clientBreakdown.length === 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("gstFiling.title")}
        description={t("gstFiling.subtitle")}
        action={
          <Button
            onClick={handleExportPdf}
            variant="outline"
            className="glass border-border/60 hover-lift"
            size="sm"
          >
            <Download className="size-4" />
            <span className="hidden sm:inline">{t("gstFiling.exportPdf")}</span>
          </Button>
        }
      />

      {/* ── Toolbar: range ToggleGroup + custom date inputs ─────────────────── */}
      <GlassCard className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("gstFiling.custom").startsWith("Custom") ? "Range" : "Period"}
          </Label>
          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(v) => v && setRange(v as RangeOption)}
            size="sm"
            className="glass rounded-lg border border-border/60 p-0.5"
            aria-label="GST filing date range"
          >
            {RANGE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <ToggleGroupItem
                  key={opt.key}
                  value={opt.key}
                  aria-label={t(opt.labelKey)}
                  className="rounded-md px-3 text-xs font-medium data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-700 dark:data-[state=on]:text-emerald-300"
                >
                  <Icon className="size-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">{t(opt.labelKey)}</span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>

        {range === "custom" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:items-end lg:gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="gst-from" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("gstFiling.from")}
              </Label>
              <Input
                id="gst-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="glass h-9 w-full border-border/60 lg:w-44"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gst-to" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("gstFiling.to")}
              </Label>
              <Input
                id="gst-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="glass h-9 w-full border-border/60 lg:w-44"
              />
            </div>
          </div>
        ) : null}

        {data ? (
          <div className="text-xs text-muted-foreground lg:text-right">
            <span className="font-medium text-foreground">{data.range.label}</span>
            <span className="mx-1.5 text-border">·</span>
            <span>{formatDate(data.range.start)} → {formatDate(data.range.end)}</span>
          </div>
        ) : null}
      </GlassCard>

      {/* ── Loading skeleton ───────────────────────────────────────────────── */}
      {loading ? (
        <GstFilingSkeleton />
      ) : error ? (
        <GlassCard className="p-6">
          <EmptyState
            title={t("gstFiling.loadFailed")}
            icon={<FileSpreadsheet className="size-6" />}
          />
        </GlassCard>
      ) : isEmpty ? (
        <GlassCard className="p-6">
          <EmptyState
            title={t("gstFiling.noData")}
            hint={t("gstFiling.noDataHint")}
            icon={<Receipt className="size-6" />}
          />
        </GlassCard>
      ) : data ? (
        <>
          {/* ── Summary KPI strip ───────────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <KpiCard
              label={t("gstFiling.outputGst")}
              value={fmtCurrency(data.outputGst.totalGst)}
              sub={`${data.outputGst.byRate.length} rate${data.outputGst.byRate.length === 1 ? "" : "s"} · ${data.clientBreakdown.reduce((s, c) => s + c.billCount, 0)} bills`}
              icon={<TrendingUp className="size-5" />}
              accent="amber"
            />
            <KpiCard
              label={t("gstFiling.inputGst")}
              value={fmtCurrency(data.inputGst.totalGst)}
              sub="Expenses GST — coming soon"
              icon={<TrendingDown className="size-5" />}
              accent="teal"
            />
            <KpiCard
              label={data.netGst.isLiability ? t("gstFiling.netGst") : t("gstFiling.netRefund")}
              value={fmtCurrency(Math.abs(data.netGst.liability))}
              sub={data.netGst.isLiability ? "Pay to government" : "Refund due"}
              icon={<FileSpreadsheet className="size-5" />}
              accent={data.netGst.isLiability ? "rose" : "emerald"}
            />
          </div>

          {/* ── Output GST by Rate ──────────────────────────────────────────── */}
          <GlassCard className="p-4 sm:p-6">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{t("gstFiling.byRate")}</h3>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">{t("gstFiling.gstRate")}</TableHead>
                    <TableHead className="text-right">{t("gstFiling.baseAmount")}</TableHead>
                    <TableHead className="text-right">{t("gstFiling.gstAmount")}</TableHead>
                    <TableHead className="text-right">{t("gstFiling.billCount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.outputGst.byRate.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                        {t("gstFiling.noData")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.outputGst.byRate.map((r) => (
                      <TableRow key={r.rate}>
                        <TableCell className="font-medium text-foreground">
                          <span className="inline-flex items-center gap-2">
                            <span className="inline-block rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                              {r.rate.toFixed(1).replace(/\.0$/, "")}%
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtCurrency(r.baseAmount)}</TableCell>
                        <TableCell className="text-right tabular-nums text-amber-700 dark:text-amber-300">
                          {fmtCurrency(r.gstAmount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.billCount}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                {data.outputGst.byRate.length > 0 ? (
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {fmtCurrency(data.outputGst.totalBase)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-amber-700 dark:text-amber-300">
                        {fmtCurrency(data.outputGst.totalGst)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {data.outputGst.byRate.reduce((s, r) => s + r.billCount, 0)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                ) : null}
              </Table>
            </div>
          </GlassCard>

          {/* ── Client-wise breakdown (GSTR-1 style) ────────────────────────── */}
          <GlassCard className="p-4 sm:p-6">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{t("gstFiling.clientBreakdown")}</h3>
            </div>
            <div className="max-h-96 overflow-y-auto overflow-x-auto pr-1">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur">
                  <TableRow>
                    <TableHead className="min-w-[160px]">{t("gstFiling.client")}</TableHead>
                    <TableHead className="min-w-[160px]">{t("gstFiling.gstin")}</TableHead>
                    <TableHead className="text-right">{t("gstFiling.baseAmount")}</TableHead>
                    <TableHead className="text-right">{t("gstFiling.gstRate")}</TableHead>
                    <TableHead className="text-right">{t("gstFiling.gstAmount")}</TableHead>
                    <TableHead className="text-right">{t("gstFiling.billCount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.clientBreakdown.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                        {t("gstFiling.noData")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.clientBreakdown.map((row, idx) => (
                      <TableRow key={`${row.clientName}-${row.gstRate}-${idx}`}>
                        <TableCell className="font-medium text-foreground">{row.clientName}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.gstin ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtCurrency(row.baseAmount)}</TableCell>
                        <TableCell className="text-right">
                          <span className="inline-block rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                            {row.gstRate.toFixed(1).replace(/\.0$/, "")}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-amber-700 dark:text-amber-300">
                          {fmtCurrency(row.gstAmount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.billCount}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                {data.clientBreakdown.length > 0 ? (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={4} className="font-semibold">Total</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-amber-700 dark:text-amber-300">
                        {fmtCurrency(data.clientBreakdown.reduce((s, c) => s + c.gstAmount, 0))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {data.clientBreakdown.reduce((s, c) => s + c.billCount, 0)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                ) : null}
              </Table>
            </div>
          </GlassCard>

          {/* ── Disclaimer ──────────────────────────────────────────────────── */}
          <GlassCard className="flex items-start gap-3 border-amber-500/20 bg-amber-500/5 p-4">
            <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("gstFiling.disclaimer")}
            </p>
          </GlassCard>
        </>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton — 3 KPI tiles + 2 tables. Matches the loaded layout so the page
// doesn't shift on data arrival.
// ─────────────────────────────────────────────────────────────────────────────
function GstFilingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <GlassCard key={i} className="p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-8 w-32" />
            <Skeleton className="mt-2 h-3 w-20" />
          </GlassCard>
        ))}
      </div>
      <GlassCard className="p-6">
        <Skeleton className="mb-4 h-4 w-40" />
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </GlassCard>
      <GlassCard className="p-6">
        <Skeleton className="mb-4 h-4 w-56" />
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
