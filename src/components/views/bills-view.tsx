"use client";

import * as React from "react";
import { Plus, Receipt, Search, BadgePercent, Download, Filter, X } from "lucide-react";
import { useApi, api } from "@/lib/api";
import { formatNumber, safeParse, titleCase } from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { GlassCard, SectionHeader, StatusChip, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useUI } from "@/lib/ui-store";
import { useTranslation } from "@/hooks/use-translation";
import { useUrlState } from "@/hooks/use-url-state";
import { toast } from "sonner";
import { usePagination } from "@/hooks/use-pagination";
import { PaginationBar } from "@/components/pagination-bar";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { SavedViewsBar } from "@/components/saved-views-bar";
import { ShareLinkButton } from "@/components/share-link-button";
import { isFilterActive } from "@/lib/saved-views";

type Bill = {
  id: string;
  billNumber: string;
  poId: string;
  clientId: string;
  supplierId: string;
  baseAmount: number;
  gstRate: number;
  gstAmount: number;
  finalAmount: number;
  paidAmount: number;
  status: string;
  createdAt: string;
  po: { poNumber: string; supplier: { name: string } };
  client: { name: string };
  payments: { id: string; amount: number; date: string; mode: string; reference: string | null }[];
  brokerage: { id: string; brokerageAmount: number; eligible: boolean; payoutStatus: string } | null;
};

type PO = {
  id: string;
  poNumber: string;
  supplierId: string;
  totalValue: number;
  gstRate: number;
  status: string;
  lineItemsJson: string;
  orderedQty: number;
  dispatchedQty: number;
  fulfillment: number;
  client: { name: string };
  supplier: { name: string };
  bill: { id: string } | null;
  dispatches: { id: string }[];
};

export function BillsView() {
  const { data, loading, refresh } = useApi<{ bills: Bill[] }>("/api/bills");
  const { format: fmtCurrency } = useCurrencyFormat();
  const { t } = useTranslation();
  // URL-persisted filter state (Task 19-b). `q` (search) and `due`
  // (due-only boolean) sync to URL query params so a refresh or shared link
  // preserves the filter.
  const [q, setQ] = useUrlState<string>("q", "");
  const [dueOnly, setDueOnly] = useUrlState<boolean>("due", false);
  const [open, setOpen] = React.useState(false);
  const { openDetail, drillFilter, clearDrill, newEntityTrigger } = useUI();

  // Auto-open the "Generate bill" dialog when the user fires the "n b"
  // keyboard shortcut.
  React.useEffect(() => {
    if (newEntityTrigger?.view === "bills") {
      setOpen(true);
    }
  }, [newEntityTrigger]);

  // Consume any incoming drill-down preset exactly once on mount (or when the
  // drillFilter changes after navigation). We use a ref to avoid re-applying
  // on unrelated re-renders. Because `setDueOnly` is now backed by useUrlState,
  // the drill-down also syncs to the URL — so a refresh after a drill-down
  // preserves the due-only filter via `?due=1`. The URL on mount takes
  // precedence for the initial state (useUrlState reads it in a useEffect);
  // this drill effect only fires when a new drillFilter arrives after mount.
  const consumedDrill = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!drillFilter) return;
    const key = `${drillFilter.view}:${drillFilter.preset}`;
    if (consumedDrill.current === key) return;
    if (drillFilter.view === "bills" && drillFilter.preset === "due") {
      setDueOnly(true);
      consumedDrill.current = key;
      clearDrill();
    }
  }, [drillFilter, clearDrill, setDueOnly]);

  const rows = (data?.bills ?? []).filter((b) => {
    const s = q.toLowerCase();
    const matchesText =
      b.billNumber.toLowerCase().includes(s) ||
      b.po.poNumber.toLowerCase().includes(s) ||
      b.client.name.toLowerCase().includes(s) ||
      b.po.supplier.name.toLowerCase().includes(s) ||
      b.status.toLowerCase().includes(s);
    const due = b.finalAmount - b.paidAmount;
    const matchesDue = !dueOnly || due > 0;
    return matchesText && matchesDue;
  });

  // Apply pagination to the filtered bills — default page size 10.
  const {
    paginated, currentPage, totalPages, size, setPage, setSize, range,
  } = usePagination<Bill>(rows, 10);

  // Reset to page 1 whenever the search query or due-only filter changes so
  // the user is never stuck on a page that no longer exists.
  React.useEffect(() => {
    setPage(1);
  }, [q, dueOnly, setPage]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("bills.title")}
        description={t("bills.subtitle")}
        action={
          <div className="flex items-center gap-2">
            <ShareLinkButton />
            <Button size="sm" variant="outline" onClick={() => window.open("/api/export?type=bills", "_blank")}>
              <Download className="mr-1.5 size-4" />{t("common.export")}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="mr-1.5 size-4" />{t("bills.generate")}</Button>
              </DialogTrigger>
              <GenerateBillDialog onDone={() => { setOpen(false); refresh(); }} />
            </Dialog>
          </div>
        }
      />

      <SavedViewsBar
        view="bills"
        currentFilter={{ q, dueOnly }}
        isFilterActive={isFilterActive({ q, dueOnly })}
        onApply={(f) => {
          setQ(typeof f.q === "string" ? f.q : "");
          setDueOnly(f.dueOnly === true);
        }}
      />

      <GlassCard className="p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by bill, PO, client, supplier, status…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="border-0 bg-transparent pl-9 shadow-none focus-visible:ring-1"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant={dueOnly ? "default" : "outline"}
            onClick={() => setDueOnly(!dueOnly)}
            className="h-9 shrink-0"
            aria-pressed={dueOnly}
          >
            <Filter className="mr-1.5 size-3.5" />
            Due only
          </Button>
        </div>
        {dueOnly && (
          <div className="mt-3">
            <Badge
              variant="outline"
              className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            >
              <Filter className="mr-1 size-3" />
              Filtered: due only
              <button
                type="button"
                onClick={() => setDueOnly(false)}
                aria-label="Clear due-only filter"
                className="ml-1 inline-flex size-3.5 items-center justify-center rounded-full hover:bg-emerald-500/20"
              >
                <X className="size-3" />
              </button>
            </Badge>
          </div>
        )}
      </GlassCard>

      <PullToRefresh onRefresh={refresh}>
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
        ) : rows.length === 0 ? (
          <GlassCard className="p-8">
            <EmptyState
              title="No bills yet"
              hint="Generate a bill against a dispatched purchase order — base auto-adjusts for short-shipments and returns."
              icon={<Receipt className="size-5" />}
            />
          </GlassCard>
        ) : (
          <>
            <GlassCard className="overflow-hidden p-0">
              <div className="max-h-[70vh] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                    <TableRow>
                      <TableHead className="pl-4">Bill Number</TableHead>
                      <TableHead>PO</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Base</TableHead>
                      <TableHead className="text-right">GST</TableHead>
                      <TableHead className="text-right">Final</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Due</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="pr-4">Brokerage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.map((b) => {
                      const due = b.finalAmount - b.paidAmount;
                      return (
                        <TableRow
                          key={b.id}
                          className="cursor-pointer"
                          onClick={() => openDetail("PurchaseOrder", b.poId)}
                        >
                          <TableCell className="pl-4 font-medium text-foreground">{b.billNumber}</TableCell>
                          <TableCell className="font-medium text-primary hover:underline">{b.po.poNumber}</TableCell>
                          <TableCell className="max-w-[140px] truncate text-muted-foreground">{b.client.name}</TableCell>
                          <TableCell className="max-w-[140px] truncate text-muted-foreground">{b.po.supplier.name}</TableCell>
                          <TableCell className="text-right">{fmtCurrency(b.baseAmount)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {fmtCurrency(b.gstAmount)}
                            <span className="ml-1 text-[10px]">@{b.gstRate}%</span>
                          </TableCell>
                          <TableCell className="text-right font-bold text-foreground">{fmtCurrency(b.finalAmount)}</TableCell>
                          <TableCell className="text-right text-emerald-600 dark:text-emerald-400">{fmtCurrency(b.paidAmount)}</TableCell>
                          <TableCell className={`text-right ${due > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                            {fmtCurrency(due)}
                          </TableCell>
                          <TableCell><StatusChip status={b.status} /></TableCell>
                          <TableCell className="pr-4">
                            {b.brokerage ? (
                              <div className="flex flex-col gap-1">
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                  <BadgePercent className="size-3" />
                                  {fmtCurrency(b.brokerage.brokerageAmount)}
                                </span>
                                <BrokerageChip eligible={b.brokerage.eligible} payoutStatus={b.brokerage.payoutStatus} />
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </GlassCard>
            <PaginationBar
              currentPage={currentPage}
              totalPages={totalPages}
              range={range}
              onPageChange={setPage}
              pageSize={size}
              onPageSizeChange={setSize}
            />
          </>
        )}
      </PullToRefresh>
    </div>
  );
}

function BrokerageChip({ eligible, payoutStatus }: { eligible: boolean; payoutStatus: string }) {
  if (!eligible) {
    return (
      <span className="inline-flex w-fit items-center rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
        Accrued
      </span>
    );
  }
  const label = payoutStatus === "paid" ? "Paid" : "Eligible";
  return (
    <span className="inline-flex w-fit items-center rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
      {label}
    </span>
  );
}

function GenerateBillDialog({ onDone }: { onDone: () => void }) {
  const { data: poData, loading: poLoading } = useApi<{ purchaseOrders: PO[] }>("/api/purchase-orders");
  const { format: fmtCurrency } = useCurrencyFormat();
  const pos = (poData?.purchaseOrders ?? []).filter((p) => p.bill === null && p.dispatches.length > 0);

  const [poId, setPoId] = React.useState<string>("");
  const [saving, setSaving] = React.useState(false);

  const selectedPo = pos.find((p) => p.id === poId) ?? null;

  const preview = React.useMemo(() => {
    if (!selectedPo) return null;
    const poValue = selectedPo.totalValue;
    const ordered = selectedPo.orderedQty;
    const dispatched = selectedPo.dispatchedQty;
    const shortShipValue = ordered > dispatched ? poValue * (1 - dispatched / ordered) : 0;
    const base = Math.max(0, poValue - shortShipValue);
    const gstRate = selectedPo.gstRate;
    const gst = Math.round(base * (gstRate / 100));
    const final = base + gst;
    return { poValue, ordered, dispatched, shortShipValue, base, gstRate, gst, final };
  }, [selectedPo]);

  const submit = async () => {
    if (!selectedPo) { toast.error("Select a purchase order"); return; }
    setSaving(true);
    try {
      const res = await api<{ bill: Bill }>("/api/bills", {
        method: "POST",
        body: JSON.stringify({ poId: selectedPo.id }),
      });
      toast.success(`Bill ${res.bill.billNumber} generated — brokerage accrued`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate bill");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="glass-strong max-h-[92vh] max-w-xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Generate bill</DialogTitle>
        <DialogDescription className="sr-only">Create a bill for a dispatched purchase order. The base amount auto-adjusts for short-shipments and resolved defective returns, then GST and brokerage are computed.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <Field label="Purchase order *">
          <Select value={poId} onValueChange={setPoId} disabled={poLoading}>
            <SelectTrigger><SelectValue placeholder={poLoading ? "Loading POs…" : "Select PO (dispatched & unbilled)"} /></SelectTrigger>
            <SelectContent>
              {pos.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No dispatched, unbilled POs available
                </div>
              ) : pos.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.poNumber} · {p.client.name} · {p.supplier.name} · {fmtCurrency(p.totalValue, { compact: true })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {preview ? (
          <GlassCard className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Computed preview</p>
              <span className="text-[10px] text-muted-foreground">Final values computed server-side</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <KV label="PO value" value={fmtCurrency(preview.poValue, { compact: true })} />
              <KV label="Ordered qty" value={`${formatNumber(preview.ordered)} sets`} />
              <KV label="Dispatched qty" value={`${formatNumber(preview.dispatched)} sets`} tone="emerald" />
              <KV
                label="Short-shipment"
                value={preview.shortShipValue > 0 ? `− ${fmtCurrency(preview.shortShipValue, { compact: true })}` : "—"}
                tone={preview.shortShipValue > 0 ? "amber" : "default"}
              />
              <KV label="Base (adjusted)" value={fmtCurrency(preview.base, { compact: true })} />
              <KV label={`GST @ ${preview.gstRate}%`} value={fmtCurrency(preview.gst, { compact: true })} />
            </div>
            <div className="flex items-center justify-between border-t border-border/50 pt-3">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Final amount</span>
              <span className="kpi-num text-xl font-bold text-foreground">{fmtCurrency(preview.final)}</span>
            </div>
          </GlassCard>
        ) : null}
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving || !selectedPo}>
          {saving ? "Generating…" : "Generate bill"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function KV({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "emerald" | "amber" }) {
  const toneClass = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-foreground";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`kpi-num text-sm font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
