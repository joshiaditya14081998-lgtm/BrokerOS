"use client";

import * as React from "react";
import {
  Scale, Download, Check, X, RefreshCw, Calendar,
} from "lucide-react";
import { useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { useTranslation } from "@/hooks/use-translation";
import { toast } from "sonner";

type AccountType = "asset" | "income" | "expense" | "liability";

type TrialAccount = {
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
};

type TrialBalanceResponse = {
  asOf: string;
  accounts: TrialAccount[];
  totals: { totalDebit: number; totalCredit: number; isBalanced: boolean };
};

const TYPE_LABEL_KEY: Record<AccountType, string> = {
  asset: "trialBalance.asset",
  income: "trialBalance.income",
  expense: "trialBalance.expense",
  liability: "trialBalance.liability",
};

const TYPE_BADGE_CLASS: Record<AccountType, string> = {
  asset: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  income: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  expense: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  liability: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

function todayIsoDate(): string {
  // Local date in YYYY-MM-DD so the <input type="date"> value matches what
  // the user sees (avoids timezone off-by-one with toISOString).
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function TrialBalanceView() {
  const { t } = useTranslation();
  const { format: fmtCurrency } = useCurrencyFormat();

  const [asOf, setAsOf] = React.useState<string>(todayIsoDate());
  // asOf end-of-day ISO — so a same-day snapshot captures the whole day.
  const asOfIso = React.useMemo(() => {
    const d = new Date(`${asOf}T00:00:00`);
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }, [asOf]);

  const { data, loading, error, refresh } = useApi<TrialBalanceResponse>(
    `/api/reports/trial-balance?asOf=${encodeURIComponent(asOfIso)}`,
  );

  React.useEffect(() => {
    if (error) toast.error(t("trialBalance.loadFailed"));
  }, [error, t]);

  const accounts = data?.accounts ?? [];
  const totals = data?.totals ?? { totalDebit: 0, totalCredit: 0, isBalanced: true };
  const isEmpty = accounts.length > 0 && accounts.every((a) => a.debit === 0 && a.credit === 0);

  const exportPdf = () => {
    const url = `/api/reports?type=trial-balance&asOf=${encodeURIComponent(asOfIso)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("trialBalance.title")}
        description={t("trialBalance.subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} className="gap-2">
              <RefreshCw className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={exportPdf} className="gap-2">
              <Download className="size-4" />
              <span className="hidden sm:inline">{t("trialBalance.exportPdf")}</span>
            </Button>
          </div>
        }
      />

      {/* Toolbar — As-of date picker */}
      <GlassCard className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tb-as-of" className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Calendar className="size-3" />
              {t("trialBalance.asOf")}
            </Label>
            <Input
              id="tb-as-of"
              type="date"
              value={asOf}
              max={todayIsoDate()}
              onChange={(e) => setAsOf(e.target.value)}
              className="w-full sm:w-48"
            />
          </div>
          {data ? (
            <p className="text-xs text-muted-foreground">
              {formatDate(data.asOf)}
            </p>
          ) : null}
        </div>
      </GlassCard>

      {loading && !data ? (
        <SkeletonTable />
      ) : isEmpty ? (
        <GlassCard className="p-6">
          <EmptyState
            title={t("trialBalance.noData")}
            hint={t("trialBalance.noDataHint")}
            icon={<Scale className="size-6" />}
          />
        </GlassCard>
      ) : (
        <GlassCard className="p-4 sm:p-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-left">{t("trialBalance.account")}</TableHead>
                <TableHead className="text-left">{t("trialBalance.type")}</TableHead>
                <TableHead className="text-right">{t("trialBalance.debit")}</TableHead>
                <TableHead className="text-right">{t("trialBalance.credit")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.name}>
                  <TableCell className="font-medium text-foreground">{a.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`capitalize ${TYPE_BADGE_CLASS[a.type]}`}
                    >
                      {t(TYPE_LABEL_KEY[a.type])}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {a.debit > 0 ? fmtCurrency(a.debit) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {a.credit > 0 ? fmtCurrency(a.credit) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-bold">{t("trialBalance.total")}</TableCell>
                <TableCell />
                <TableCell className="text-right font-mono font-bold tabular-nums">
                  {fmtCurrency(totals.totalDebit)}
                </TableCell>
                <TableCell className="text-right font-mono font-bold tabular-nums">
                  {fmtCurrency(totals.totalCredit)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={2} className="font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {totals.isBalanced ? (
                      <>
                        <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-emerald-700 dark:text-emerald-300">{t("trialBalance.balanced")}</span>
                      </>
                    ) : (
                      <>
                        <X className="size-4 text-rose-600 dark:text-rose-400" />
                        <span className="text-rose-700 dark:text-rose-300">{t("trialBalance.unbalanced")}</span>
                      </>
                    )}
                  </span>
                </TableCell>
                <TableCell colSpan={2} className="text-right">
                  {!totals.isBalanced ? (
                    <span className="font-mono text-xs text-rose-700 dark:text-rose-300">
                      Δ {fmtCurrency(Math.abs(totals.totalDebit - totals.totalCredit))}
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </GlassCard>
      )}
    </div>
  );
}

function SkeletonTable() {
  return (
    <GlassCard className="p-4 sm:p-6">
      <div className="space-y-3">
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: 11 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
        <Skeleton className="h-12 w-full" />
      </div>
    </GlassCard>
  );
}
