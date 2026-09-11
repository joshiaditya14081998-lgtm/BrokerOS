"use client";

import * as React from "react";
import {
  BadgePercent, Wallet, CheckCircle2, XCircle, Plus, Zap, ChevronDown, Download, Filter, X, FileText,
} from "lucide-react";
import { useApi, api } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { GlassCard, KpiCard, StatusChip, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useUI } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { toast } from "sonner";

type BrokerageRow = {
  id: string;
  billId: string;
  supplierId: string;
  clientId: string;
  commissionRate: number;
  baseAmount: number;
  brokerageAmount: number;
  eligible: boolean;
  forceEligible: boolean;
  forceReason: string | null;
  eligibleAt: string | null;
  payoutId: string | null;
  payoutStatus: string;
  createdAt: string;
  bill: { billNumber: string; finalAmount: number; baseAmount: number; status: string; po: { poNumber: string } };
  client: { name: string; payoutCadence: string };
  supplier: { name: string };
  payout: { id: string; status: string; paidAt: string | null } | null;
};

type PayoutRow = {
  id: string;
  clientId: string;
  cadence: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  status: string;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  client: { name: string };
  brokerages: { id: string; brokerageAmount: number; bill: { billNumber: string } }[];
};

type EligFilter = "all" | "eligible" | "pending";

const ELIG_FILTERS: { key: EligFilter; labelKey: string }[] = [
  { key: "all", labelKey: "brokerage.all" },
  { key: "eligible", labelKey: "brokerage.eligible" },
  { key: "pending", labelKey: "brokerage.pending" },
];

export function BrokerageView() {
  const { t } = useTranslation();
  const { data, loading, refresh } = useApi<{ brokerages: BrokerageRow[]; payouts: PayoutRow[] }>("/api/brokerages");
  const { format: fmtCurrency } = useCurrencyFormat();
  const [q, setQ] = React.useState("");
  const [eligFilter, setEligFilter] = React.useState<EligFilter>("all");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [forceTarget, setForceTarget] = React.useState<BrokerageRow | null>(null);
  const { drillFilter, clearDrill } = useUI();

  // Consume drill-down preset from the dashboard KPI cards:
  //   "eligible" → show only eligible brokerages (the "Brokerage Earned" KPI)
  //   "pending"  → show only not-yet-eligible (the "Pending (not eligible)" KPI)
  const consumedDrill = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!drillFilter) return;
    const key = `${drillFilter.view}:${drillFilter.preset}`;
    if (consumedDrill.current === key) return;
    if (drillFilter.view === "brokerage") {
      if (drillFilter.preset === "eligible") {
        setEligFilter("eligible");
        consumedDrill.current = key;
        clearDrill();
      } else if (drillFilter.preset === "pending") {
        setEligFilter("pending");
        consumedDrill.current = key;
        clearDrill();
      }
    }
  }, [drillFilter, clearDrill]);

  const brokerages = data?.brokerages ?? [];
  const payouts = data?.payouts ?? [];

  const totals = React.useMemo(() => {
    const totalBrokerage = brokerages.reduce((s, b) => s + b.brokerageAmount, 0);
    const eligiblePending = brokerages
      .filter((b) => b.eligible && (b.payoutStatus === "accrued" || b.payoutStatus === "scheduled"))
      .reduce((s, b) => s + b.brokerageAmount, 0);
    const paidOut = brokerages
      .filter((b) => b.payoutStatus === "paid")
      .reduce((s, b) => s + b.brokerageAmount, 0);
    const notEligible = brokerages
      .filter((b) => !b.eligible)
      .reduce((s, b) => s + b.brokerageAmount, 0);
    return { totalBrokerage, eligiblePending, paidOut, notEligible };
  }, [brokerages]);

  const filtered = brokerages.filter((b) => {
    const term = q.toLowerCase().trim();
    const matchesText = !term || (
      b.bill.billNumber.toLowerCase().includes(term) ||
      b.bill.po.poNumber.toLowerCase().includes(term) ||
      b.client.name.toLowerCase().includes(term) ||
      b.supplier.name.toLowerCase().includes(term)
    );
    const matchesElig =
      eligFilter === "all" ||
      (eligFilter === "eligible" && b.eligible) ||
      (eligFilter === "pending" && !b.eligible);
    return matchesText && matchesElig;
  });

  // Eligible-and-unpaid rows are selectable
  const selectableIds = React.useMemo(
    () => new Set(brokerages.filter((b) => b.eligible && !b.payoutId).map((b) => b.id)),
    [brokerages]
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const b of filtered) {
        if (selectableIds.has(b.id)) next.add(b.id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const [creating, setCreating] = React.useState(false);
  const createBatch = async () => {
    const ids = Array.from(selected).filter((id) => selectableIds.has(id));
    if (!ids.length) {
      toast.error("Select at least one eligible, unpaid brokerage");
      return;
    }
    setCreating(true);
    try {
      const res = await api<{ payout: PayoutRow }>("/api/brokerages", {
        method: "POST",
        body: JSON.stringify({ action: "create_payout", payoutIds: ids }),
      });
      toast.success(`Payout batch created — ${fmtCurrency(res.payout.totalAmount)} across ${res.payout.brokerages?.length ?? ids.length} entries`);
      setSelected(new Set());
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create payout");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("brokerage.title")}
        description={t("brokerage.subtitle")}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => window.open("/api/reports?type=brokerage-statement&range=all", "_blank")}>
              <FileText className="mr-1.5 size-4" />{t("brokerage.pdfStatement")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.open("/api/export?type=brokerage", "_blank")}>
              <Download className="mr-1.5 size-4" />{t("common.export")}
            </Button>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("brokerage.totalBrokerage")}
          value={fmtCurrency(totals.totalBrokerage, { compact: true })}
          sub={`${brokerages.length} ${t("brokerage.entries")}`}
          icon={<BadgePercent className="size-5" />}
          accent="emerald"
        />
        <KpiCard
          label={t("brokerage.eligiblePending")}
          value={fmtCurrency(totals.eligiblePending, { compact: true })}
          sub={t("brokerage.eligiblePendingSub")}
          icon={<Wallet className="size-5" />}
          accent="amber"
        />
        <KpiCard
          label={t("brokerage.paidOut")}
          value={fmtCurrency(totals.paidOut, { compact: true })}
          sub={`${payouts.length} ${t("brokerage.batches")}`}
          icon={<CheckCircle2 className="size-5" />}
          accent="emerald"
        />
        <KpiCard
          label={t("brokerage.notEligible")}
          value={fmtCurrency(totals.notEligible, { compact: true })}
          sub={t("brokerage.notEligibleSub")}
          icon={<XCircle className="size-5" />}
          accent="rose"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Ledger */}
        <div className="lg:col-span-2">
          <GlassCard className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{t("brokerage.brokerageLedger")}</h3>
                <p className="text-xs text-muted-foreground">{t("brokerage.brokerageLedgerHint")}</p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder={t("brokerage.searchPlaceholder")}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="h-8 w-full sm:w-56"
                />
              </div>
            </div>

            {/* Eligibility filter chips + active-drill badge */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-border/60 bg-card/30 p-1">
                {ELIG_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setEligFilter(f.key)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                      eligFilter === f.key
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(f.labelKey)}
                    <span className="ml-1.5 text-[10px] opacity-70">
                      {f.key === "all"
                        ? brokerages.length
                        : brokerages.filter((b) =>
                            f.key === "eligible" ? b.eligible : !b.eligible,
                          ).length}
                    </span>
                  </button>
                ))}
              </div>
              {eligFilter !== "all" && (
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                >
                  <Filter className="mr-1 size-3" />
                  {t("audit.filtered")}: {eligFilter === "eligible" ? t("brokerage.eligibleOnly") : t("brokerage.notEligibleOnly")}
                  <button
                    type="button"
                    onClick={() => setEligFilter("all")}
                    aria-label="Clear eligibility filter"
                    className="ml-1 inline-flex size-3.5 items-center justify-center rounded-full hover:bg-emerald-500/20"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              )}
            </div>

            {selected.size > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  {selected.size} {t("common.selected")} ·{" "}
                  {fmtCurrency(
                    Array.from(selected).filter((id) => selectableIds.has(id))
                      .reduce((s, id) => s + (brokerages.find((b) => b.id === id)?.brokerageAmount ?? 0), 0)
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearSelection}>{t("common.clear")}</Button>
                  <Button size="sm" className="h-7" onClick={createBatch} disabled={creating}>
                    <Plus className="mr-1 size-3.5" />{t("brokerage.createPayoutBatch")}
                  </Button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="mt-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-xl" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title={t("brokerage.noBrokerageEntries")}
                  hint={t("brokerage.noBrokerageEntriesHint")}
                  icon={<BadgePercent className="size-5" />}
                />
              </div>
            ) : (
              <div className="mt-4 -mx-2 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/60">
                      <TableHead className="w-9 pl-2">
                        <Checkbox
                          checked={
                            filtered.some((b) => selectableIds.has(b.id)) &&
                            filtered.filter((b) => selectableIds.has(b.id)).every((b) => selected.has(b.id))
                          }
                          onCheckedChange={(v) => (v ? selectAllVisible() : clearSelection())}
                          aria-label="Select all eligible"
                        />
                      </TableHead>
                      <TableHead>{t("brokerage.bill")}</TableHead>
                      <TableHead>{t("visits.client")}</TableHead>
                      <TableHead>{t("portals.supplier")}</TableHead>
                      <TableHead className="text-right">{t("brokerage.base")}</TableHead>
                      <TableHead className="text-right">{t("brokerage.commPercent")}</TableHead>
                      <TableHead className="text-right">{t("brokerage.brokerageAmount")}</TableHead>
                      <TableHead>{t("brokerage.eligible")}</TableHead>
                      <TableHead>{t("brokerage.payout")}</TableHead>
                      <TableHead>{t("brokerage.created")}</TableHead>
                      <TableHead className="text-right pr-2">{t("brokerage.action")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((b) => {
                      const isSelected = selected.has(b.id);
                      const canSelect = selectableIds.has(b.id);
                      return (
                        <TableRow key={b.id} className="border-border/40">
                          <TableCell className="pl-2">
                            <Checkbox
                              checked={isSelected}
                              disabled={!canSelect}
                              onCheckedChange={() => toggleSelect(b.id)}
                              aria-label={`Select ${b.bill.billNumber}`}
                            />
                          </TableCell>
                          <TableCell>
                            <p className="font-medium text-foreground">{b.bill.billNumber}</p>
                            <p className="text-[11px] text-muted-foreground">{b.bill.po.poNumber}</p>
                          </TableCell>
                          <TableCell className="max-w-[140px] truncate" title={b.client.name}>{b.client.name}</TableCell>
                          <TableCell className="max-w-[140px] truncate" title={b.supplier.name}>{b.supplier.name}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{fmtCurrency(b.baseAmount, { compact: true })}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{b.commissionRate.toFixed(1)}%</TableCell>
                          <TableCell className="text-right font-semibold text-emerald-600 dark:text-emerald-400">{fmtCurrency(b.brokerageAmount)}</TableCell>
                          <TableCell>
                            {b.eligible ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                                {b.forceEligible ? t("brokerage.forced") : t("common.yes")}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
                                {t("common.no")}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <StatusChip status={b.payoutStatus} />
                          </TableCell>
                          <TableCell className="text-[11px] text-muted-foreground">{formatDate(b.createdAt)}</TableCell>
                          <TableCell className="pr-2 text-right">
                            {!b.eligible ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[11px] text-amber-700 hover:text-amber-600 dark:text-amber-300"
                                onClick={() => setForceTarget(b)}
                              >
                                <Zap className="mr-1 size-3" />{t("brokerage.force")}
                              </Button>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </GlassCard>
        </div>

        {/* Payout history */}
        <div>
          <GlassCard className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-foreground">{t("brokerage.payoutHistory")}</h3>
            <p className="text-xs text-muted-foreground">{t("brokerage.payoutHistoryHint")}</p>
            <div className="mt-3 max-h-[640px] space-y-3 overflow-y-auto pr-1">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
              ) : payouts.length === 0 ? (
                <EmptyState
                  title={t("brokerage.noPayoutsYet")}
                  hint={t("brokerage.noPayoutsHint")}
                  icon={<Wallet className="size-5" />}
                />
              ) : (
                payouts.map((p) => <PayoutCard key={p.id} payout={p} />)
              )}
            </div>
          </GlassCard>
        </div>
      </div>

      <ForceEligibleDialog
        brokerage={forceTarget}
        onClose={() => setForceTarget(null)}
        onDone={() => { setForceTarget(null); refresh(); }}
      />
    </div>
  );
}

function PayoutCard({ payout }: { payout: PayoutRow }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const { format: fmtCurrency } = useCurrencyFormat();
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="glass hover-lift rounded-2xl border border-border/50 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{payout.client.name}</p>
            <p className="text-[11px] text-muted-foreground">{titleCase(payout.cadence)} · {payout.brokerages.length} entries</p>
          </div>
          <StatusChip status={payout.status} />
        </div>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("brokerage.totalPaid")}</p>
            <p className="kpi-num text-xl font-light text-emerald-600 dark:text-emerald-400">{fmtCurrency(payout.totalAmount)}</p>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <p>{formatDate(payout.periodStart)} → {formatDate(payout.periodEnd)}</p>
            <p>{t("brokerage.paidLabel")}: {payout.paidAt ? formatDate(payout.paidAt) : "—"}</p>
          </div>
        </div>
        {payout.brokerages.length > 0 && (
          <CollapsibleTrigger asChild>
            <button className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-border/60 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-card/40">
              <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
              {open ? t("brokerage.hideBills") : `${t("brokerage.show")} ${payout.brokerages.length} ${t("brokerage.billsNoun")}`}
            </button>
          </CollapsibleTrigger>
        )}
        <CollapsibleContent>
          <ul className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
            {payout.brokerages.map((b) => (
              <li key={b.id} className="flex items-center justify-between text-xs">
                <span className="font-mono text-foreground/80">{b.bill.billNumber}</span>
                <span className="text-emerald-600 dark:text-emerald-400">{fmtCurrency(b.brokerageAmount)}</span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ForceEligibleDialog({
  brokerage,
  onClose,
  onDone,
}: {
  brokerage: BrokerageRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const { format: fmtCurrency } = useCurrencyFormat();

  React.useEffect(() => {
    if (brokerage) setReason("");
  }, [brokerage]);

  const submit = async () => {
    if (!brokerage) return;
    setSaving(true);
    try {
      await api("/api/brokerages", {
        method: "POST",
        body: JSON.stringify({ action: "force_eligible", brokerageId: brokerage.id, reason }),
      });
      toast.success("Brokerage marked eligible");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!brokerage} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="glass-strong max-w-md">
        <DialogHeader>
          <DialogTitle>{t("brokerage.forceBrokerageEligible")}</DialogTitle>
          <DialogDescription className="sr-only">Override the brokerage eligibility gate for this bill. The override reason is recorded in the audit trail.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {brokerage ? (
            <div className="rounded-xl border border-border/60 bg-card/40 p-3 text-xs">
              <p><span className="text-muted-foreground">{t("brokerage.bill")}:</span> <span className="font-medium">{brokerage.bill.billNumber}</span></p>
              <p><span className="text-muted-foreground">{t("brokerage.clientLabel")}:</span> {brokerage.client.name}</p>
              <p><span className="text-muted-foreground">{t("brokerage.brokerageAmount")}:</span> <span className="text-emerald-600 dark:text-emerald-400">{fmtCurrency(brokerage.brokerageAmount)}</span></p>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">{t("brokerage.forceReason")}</Label>
            <Textarea
              placeholder={t("brokerage.forceReasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            This will override the eligibility gate. The override reason is recorded in the audit trail.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? t("brokerage.forcing") : t("brokerage.forceEligible")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
