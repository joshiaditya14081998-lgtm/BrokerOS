"use client";

import * as React from "react";
import {
  Receipt, BadgePercent, Truck, CalendarDays, Banknote, AlertTriangle,
  ArrowRight, Clock, Package, IndianRupee, ChevronRight, Info, Printer,
  Lock, PackageCheck,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useApi, api } from "@/lib/api";
import {
  formatCurrency, formatDate, formatDateTime, titleCase, safeParse,
} from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { toast } from "sonner";
import { StatusChip, EmptyState, GlassCard } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { PhotoUpload } from "@/components/photo-upload";
import { TagPicker } from "@/components/tag-picker";

type LineItem = {
  styleName: string;
  color: string | null;
  setQty: number;
  unitPrice: number;
  lineTotal: number;
};

type DispatchItem = {
  styleName: string;
  color: string | null;
  qty: number;
};

type DispatchDateLog = {
  id: string;
  oldDate: string | null;
  newDate: string | null;
  reason: string | null;
  createdAt: string;
};

type Dispatch = {
  id: string;
  dispatchDate: string;
  itemsJson: string;
  dispatchedQty: number;
  status: string;
  notes: string | null;
  photos: { id: string; url: string; caption: string | null }[];
  disputes: {
    id: string; type: string; description: string | null;
    quantityAffected: number; valueAffected: number; status: string; resolution: string | null;
    createdAt: string;
  }[];
};

type Payment = {
  id: string;
  amount: number;
  date: string;
  mode: string;
  reference: string | null;
  notes: string | null;
};

type Brokerage = {
  id: string;
  commissionRate: number;
  baseAmount: number;
  brokerageAmount: number;
  eligible: boolean;
  forceEligible: boolean;
  forceReason: string | null;
  eligibleAt: string | null;
  payoutStatus: string;
  payout: { id: string; status: string; paidAt: string | null; cadence: string } | null;
};

type Bill = {
  id: string;
  billNumber: string;
  status: string;
  baseAmount: number;
  gstRate: number;
  gstAmount: number;
  finalAmount: number;
  paidAmount: number;
  notes: string | null;
  createdAt: string;
  payments: Payment[];
  brokerage: Brokerage | null;
};

type Dispute = {
  id: string;
  type: string;
  description: string | null;
  quantityAffected: number;
  valueAffected: number;
  status: string;
  resolution: string | null;
  createdAt: string;
};

type PoDetail = {
  id: string;
  poNumber: string;
  totalValue: number;
  commissionRate: number;
  gstRate: number;
  status: string;
  expectedDispatchDate: string | null;
  revisedDispatchDate: string | null;
  createdAt: string;
  client: { id: string; name: string };
  supplier: { id: string; name: string };
  booking: {
    id: string;
    bookingDate: string;
    notes: string | null;
    visit: { id: string; plannedDate: string; status: string };
    lineItems: { id: string; styleName: string; color: string | null; setQty: number; unitPrice: number }[];
  };
  dispatches: Dispatch[];
  dispatchDateLogs: DispatchDateLog[];
  bill: Bill | null;
  disputes: Dispute[];
  lineItems: LineItem[];
  orderedQty: number;
  dispatchedQty: number;
  fulfillment: number;
};

export function PoDetailSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, refresh } = useApi<{ po: PoDetail }>(`/api/purchase-orders/${id}`);
  const po = data?.po;
  const [closing, setClosing] = React.useState(false);

  const closePo = async () => {
    if (!po) return;
    setClosing(true);
    try {
      await api(`/api/purchase-orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "closed" }),
      });
      toast.success("PO closed");
      await refresh();
    } catch (e) {
      // The `api` helper throws an Error whose message embeds the raw response
      // body, e.g. `API /api/purchase-orders/X → 400: {"error":"Cannot close PO: …"}`.
      // Pull the trailing JSON out of the message and parse it with `JSON.parse`
      // (regex capture can't reliably handle escaped quotes inside the message —
      // our error strings contain literal `"` characters around status names).
      const raw = e instanceof Error ? e.message : "Failed to close PO";
      let friendly = raw;
      try {
        const tail = raw.slice(raw.indexOf("{"));
        const parsed = JSON.parse(tail) as { error?: string };
        if (parsed && typeof parsed.error === "string") friendly = parsed.error;
      } catch {
        // Fall back to the raw message if the embedded JSON couldn't be parsed.
      }
      toast.error(friendly);
    } finally {
      setClosing(false);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="glass-strong w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="text-left">
          <div className="flex items-start justify-between gap-2">
            <SheetTitle className="text-lg">
              {loading || !po ? "Loading…" : po.poNumber}
            </SheetTitle>
            {po && (
              <div className="flex shrink-0 items-center gap-2">
                {po.status === "fully_delivered" ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                        disabled={closing}
                      >
                        <Lock className="mr-1.5 size-3.5" />
                        {closing ? "Closing…" : "Close PO"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="glass-strong">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Close PO {po.poNumber}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This action confirms all work is complete — bills paid,
                          disputes resolved, dispatches done. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={closing}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={(e) => {
                            e.preventDefault();
                            closePo();
                          }}
                          disabled={closing}
                          className="bg-emerald-600 text-emerald-50 hover:bg-emerald-700"
                        >
                          {closing ? "Closing…" : "Close PO"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => window.open(`/api/reports?type=purchase-order&poId=${po.id}`, "_blank")}
                >
                  <Printer className="mr-1.5 size-3.5" />Print PO
                </Button>
              </div>
            )}
          </div>
          <SheetDescription className="sr-only">Purchase order detail</SheetDescription>
        </SheetHeader>

        {loading || !po ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : (
          <PoDetailBody po={po} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PoDetailBody({ po }: { po: PoDetail }) {
  const { format: fmtCurrency } = useCurrencyFormat();
  return (
    <div className="space-y-4 px-4 pb-8">
      {/* Header strip */}
      <div className="glass rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="kpi-num text-2xl font-semibold">{po.poNumber}</h2>
          <StatusChip status={po.status} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="font-medium text-foreground">{po.client.name}</span>
            <ArrowRight className="size-3" />
            <span className="font-medium text-foreground">{po.supplier.name}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-3" />Booked: {formatDate(po.booking.bookingDate)}
          </span>
          {po.expectedDispatchDate ? (
            <span className="inline-flex items-center gap-1">
              <Truck className="size-3" />Expected: {formatDate(po.expectedDispatchDate)}
            </span>
          ) : null}
          {po.revisedDispatchDate ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3 text-amber-500" />Revised: {formatDate(po.revisedDispatchDate)}
            </span>
          ) : null}
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Fulfillment</span>
            <span>{po.dispatchedQty}/{po.orderedQty} sets · {po.fulfillment}%</span>
          </div>
          <Progress value={po.fulfillment} className="mt-1 h-1.5" />
        </div>
        <div className="mt-3 border-t border-border/40 pt-3">
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Tags</p>
          <TagPicker entityType="PurchaseOrder" entityId={po.id} />
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat icon={<IndianRupee className="size-4" />} label="Total value" value={fmtCurrency(po.totalValue, { compact: true })} />
        <Stat icon={<BadgePercent className="size-4" />} label="Commission" value={`${po.commissionRate}%`} tone="emerald" />
        <Stat icon={<Receipt className="size-4" />} label="GST rate" value={`${po.gstRate}%`} />
        <Stat icon={<Package className="size-4" />} label="Ordered qty" value={`${po.orderedQty}`} />
        <Stat icon={<Truck className="size-4" />} label="Dispatched qty" value={`${po.dispatchedQty}`} tone="amber" />
        <Stat icon={<Clock className="size-4" />} label="Fulfillment" value={`${po.fulfillment}%`} tone={po.fulfillment === 100 ? "emerald" : "default"} />
      </div>

      {/* Hint for open POs with no dispatches */}
      {po.status === "open" && po.dispatches.length === 0 ? (
        <div className="glass flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>Record a dispatch from the Dispatch Tracking view to start fulfillment on this PO.</span>
        </div>
      ) : null}

      <Tabs defaultValue="items" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="items">Line Items</TabsTrigger>
          <TabsTrigger value="dispatches">Dispatches</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="mt-3 space-y-3">
          <LineItemsTab items={po.lineItems} total={po.totalValue} />
          <PhotoUpload
            entityType="Booking"
            entityId={po.booking.id}
            stage="booking"
            label="Booking photos"
            hint="Style samples, order sheet, swatches — anything captured at booking stage."
          />
        </TabsContent>

        <TabsContent value="dispatches" className="mt-3 space-y-2">
          <DispatchesTab dispatches={po.dispatches} logs={po.dispatchDateLogs} />
          {/* Receiving photos (proof of delivery) — Gap 2.
              Photos captured when goods reach the client (delivery proof,
              unpacking condition, quantity verification). These belong to the
              PurchaseOrder entity itself with stage="receiving". */}
          <div className="glass rounded-xl p-4">
            <div className="mb-2 flex items-center gap-1.5">
              <PackageCheck className="size-4 text-emerald-500" />
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Receiving · proof of delivery
              </p>
            </div>
            <PhotoUpload
              entityType="PurchaseOrder"
              entityId={po.id}
              stage="receiving"
              label="Receiving photos (proof of delivery)"
              hint="Photos taken when goods reach the client — delivery proof, unpacking condition, quantity verification."
            />
          </div>
        </TabsContent>

        <TabsContent value="billing" className="mt-3">
          <BillingTab bill={po.bill} disputes={po.disputes} />
        </TabsContent>

        <TabsContent value="timeline" className="mt-3">
          <TimelineTab po={po} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LineItemsTab({ items, total }: { items: LineItem[]; total: number }) {
  const { format: fmtCurrency } = useCurrencyFormat();
  if (items.length === 0) return <EmptyState title="No line items" />;
  return (
    <div className="glass overflow-hidden rounded-xl">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border/40 hover:bg-transparent">
              <TableHead className="pl-4">Style</TableHead>
              <TableHead>Color</TableHead>
              <TableHead className="text-right">Sets</TableHead>
              <TableHead className="text-right">Unit ₹</TableHead>
              <TableHead className="pr-4 text-right">Line total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it, i) => (
              <TableRow key={i} className="border-border/40">
                <TableCell className="pl-4 font-medium">{it.styleName}</TableCell>
                <TableCell className="text-muted-foreground">{it.color || "—"}</TableCell>
                <TableCell className="text-right">{it.setQty}</TableCell>
                <TableCell className="text-right text-muted-foreground">{fmtCurrency(it.unitPrice)}</TableCell>
                <TableCell className="pr-4 text-right font-semibold">{fmtCurrency(it.lineTotal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between border-t border-border/40 bg-muted/30 px-4 py-2 text-xs">
        <span className="text-muted-foreground">Booking total</span>
        <span className="kpi-num font-semibold text-emerald-600 dark:text-emerald-400">{fmtCurrency(total)}</span>
      </div>
    </div>
  );
}

function DispatchesTab({ dispatches, logs }: { dispatches: Dispatch[]; logs: DispatchDateLog[] }) {
  if (dispatches.length === 0 && logs.length === 0) {
    return <EmptyState title="No dispatches yet" hint="Shipments will appear here once recorded." />;
  }
  return (
    <>
      {dispatches.length === 0 ? null : dispatches.map((d) => {
        const items = safeParse<DispatchItem[]>(d.itemsJson, []);
        return (
          <div key={d.id} className="glass rounded-xl p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{formatDate(d.dispatchDate)}</p>
                <p className="text-xs text-muted-foreground">
                  Dispatched {d.dispatchedQty} sets · {d.photos.length} photo{d.photos.length === 1 ? "" : "s"}
                </p>
              </div>
              <StatusChip status={d.status} />
            </div>
            {items.length > 0 ? (
              <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {items.map((it, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-card/40 px-2 py-1 text-xs">
                    <span className="truncate">
                      <span className="font-medium">{it.styleName}</span>
                      {it.color ? <span className="ml-1 text-muted-foreground">· {it.color}</span> : null}
                    </span>
                    <span className="ml-2 shrink-0 font-semibold">{it.qty}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {d.notes ? <p className="mt-2 text-xs text-muted-foreground">“{d.notes}”</p> : null}
            {d.disputes.length > 0 ? (
              <div className="mt-2 space-y-1 border-t border-border/40 pt-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Disputes</p>
                {d.disputes.map((dis) => (
                  <div key={dis.id} className="flex items-center justify-between text-[11px]">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <AlertTriangle className="size-3 text-rose-500" />
                      {titleCase(dis.type)} · {dis.quantityAffected} affected
                    </span>
                    <StatusChip status={dis.status} />
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-3">
              <PhotoUpload
                entityType="Dispatch"
                entityId={d.id}
                stage="dispatch"
                label="Dispatch photos"
                hint="Loading bay, bale counts, vehicle number, delivery challan."
              />
            </div>
          </div>
        );
      })}

      {logs.length > 0 ? (
        <div className="glass rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Dispatch date revisions</p>
          <div className="mt-2 space-y-2">
            {logs.map((l) => (
              <div key={l.id} className="flex items-start gap-2 text-xs">
                <Clock className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground line-through">{formatDate(l.oldDate)}</span>
                    <ChevronRight className="size-3 text-muted-foreground" />
                    <span className="font-medium">{formatDate(l.newDate)}</span>
                    <span className="text-muted-foreground">· {formatDateTime(l.createdAt)}</span>
                  </div>
                  {l.reason ? <p className="mt-0.5 text-muted-foreground">{l.reason}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function BillingTab({ bill, disputes }: { bill: Bill | null; disputes: Dispute[] }) {
  return (
    <div className="space-y-3">
      {bill ? <BillingCard bill={bill} /> : (
        <GlassCard className="p-8">
          <EmptyState
            title="No bill generated yet"
            hint="A bill is generated once dispatches are recorded and billing is initiated."
            icon={<Receipt className="size-5" />}
          />
        </GlassCard>
      )}

      {disputes.length > 0 ? (
        <div className="glass rounded-xl p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <AlertTriangle className="size-4 text-rose-500" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Disputes · {disputes.length}
            </p>
          </div>
          <div className="space-y-3">
            {disputes.map((d) => (
              <div key={d.id} className="rounded-lg border border-border/50 bg-card/30 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">
                      {titleCase(d.type)} · {d.quantityAffected} affected
                    </p>
                    {d.description ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{d.description}</p>
                    ) : null}
                  </div>
                  <StatusChip status={d.status} />
                </div>
                {d.resolution ? (
                  <p className="mt-1.5 rounded bg-muted/40 px-2 py-1 text-[11px] text-foreground/80">
                    {d.resolution}
                  </p>
                ) : null}
                <div className="mt-2">
                  <PhotoUpload
                    entityType="Dispute"
                    entityId={d.id}
                    stage="dispute"
                    label="Dispute evidence"
                    hint="Defect close-ups, shortage photos, return acknowledgement, debit note."
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BillingCard({ bill }: { bill: Bill }) {
  const due = bill.finalAmount - bill.paidAmount;
  const { format: fmtCurrency } = useCurrencyFormat();
  return (
    <>
      <div className="glass rounded-xl p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-base font-semibold">{bill.billNumber}</p>
            <p className="text-xs text-muted-foreground">Billed: {formatDate(bill.createdAt)}</p>
          </div>
          <StatusChip status={bill.status} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KV label="Base amount" value={fmtCurrency(bill.baseAmount)} />
          <KV label={`GST (${bill.gstRate}%)`} value={fmtCurrency(bill.gstAmount)} />
          <KV label="Final" value={fmtCurrency(bill.finalAmount)} tone="emerald" />
          <KV label="Paid" value={fmtCurrency(bill.paidAmount)} tone="emerald" />
          <KV label="Due" value={fmtCurrency(due)} tone={due > 0 ? "amber" : "default"} />
          <KV label="GST rate" value={`${bill.gstRate}%`} />
        </div>
        {bill.notes ? <p className="mt-2 text-xs text-muted-foreground">“{bill.notes}”</p> : null}
      </div>

      {bill.payments.length > 0 ? (
        <div className="glass rounded-xl p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Banknote className="size-4 text-emerald-500" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Payments · {bill.payments.length}</p>
          </div>
          <div className="space-y-1.5">
            {bill.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-card/40 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="font-medium">{formatDate(p.date)} · <span className="text-muted-foreground">{titleCase(p.mode)}</span></p>
                  {p.reference ? <p className="truncate text-[11px] text-muted-foreground">Ref: {p.reference}</p> : null}
                </div>
                <span className="kpi-num shrink-0 font-semibold text-emerald-600 dark:text-emerald-400">{fmtCurrency(p.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {bill.brokerage ? (
        <BrokerageCard brokerage={bill.brokerage} />
      ) : null}
    </>
  );
}

function BrokerageCard({ brokerage }: { brokerage: Brokerage }) {
  const { format: fmtCurrency } = useCurrencyFormat();
  return (
    <div className="glass rounded-xl p-4">
      <div className="mb-2 flex items-center gap-1.5">
        <BadgePercent className="size-4 text-emerald-500" />
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Brokerage</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KV label="Commission" value={`${brokerage.commissionRate}%`} />
        <KV label="Base (excl GST)" value={fmtCurrency(brokerage.baseAmount)} />
        <KV label="Brokerage amt" value={fmtCurrency(brokerage.brokerageAmount)} tone="emerald" />
        <KV label="Eligible" value={brokerage.eligible ? "Yes" : "No"} tone={brokerage.eligible ? "emerald" : "default"} />
        <KV label="Payout status" value={titleCase(brokerage.payoutStatus)} tone={brokerage.payoutStatus === "paid" ? "emerald" : "default"} />
        {brokerage.eligibleAt ? <KV label="Eligible since" value={formatDate(brokerage.eligibleAt)} /> : null}
      </div>
      {brokerage.forceEligible && brokerage.forceReason ? (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          Force-eligible: {brokerage.forceReason}
        </p>
      ) : null}
      {brokerage.payout ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Payout: {titleCase(brokerage.payout.status)} · {titleCase(brokerage.payout.cadence)}
          {brokerage.payout.paidAt ? ` · paid ${formatDate(brokerage.payout.paidAt)}` : ""}
        </p>
      ) : null}
    </div>
  );
}

type TimelineEntry = {
  id: string;
  date: string;
  kind: "log" | "payment" | "dispute" | "bill";
  title: string;
  detail: string | null;
};

function TimelineTab({ po }: { po: PoDetail }) {
  const { format: fmtCurrency } = useCurrencyFormat();
  const entries: TimelineEntry[] = React.useMemo(() => {
    const list: TimelineEntry[] = [];
    for (const l of po.dispatchDateLogs) {
      list.push({
        id: l.id, date: l.createdAt, kind: "log",
        title: `Dispatch date revised → ${formatDate(l.newDate)}`,
        detail: l.reason || (l.oldDate ? `from ${formatDate(l.oldDate)}` : null),
      });
    }
    if (po.bill) {
      list.push({
        id: `bill-${po.bill.id}`, date: po.bill.createdAt, kind: "bill",
        title: `Bill ${po.bill.billNumber} generated`,
        detail: `Final: ${fmtCurrency(po.bill.finalAmount)} · status: ${titleCase(po.bill.status)}`,
      });
      for (const p of po.bill.payments) {
        list.push({
          id: `pay-${p.id}`, date: p.date, kind: "payment",
          title: `Payment · ${titleCase(p.mode)}`,
          detail: `${fmtCurrency(p.amount)}${p.reference ? ` · ref ${p.reference}` : ""}`,
        });
      }
      if (po.bill.brokerage) {
        const b = po.bill.brokerage;
        list.push({
          id: `brok-${b.id}`, date: b.eligibleAt ?? po.bill.createdAt, kind: "bill",
          title: `Brokerage ${b.eligible ? "eligible" : "accrued"}`,
          detail: `${fmtCurrency(b.brokerageAmount)} · ${titleCase(b.payoutStatus)}`,
        });
      }
    }
    for (const d of po.disputes) {
      list.push({
        id: `disp-${d.id}`, date: d.createdAt, kind: "dispute",
        title: `Dispute · ${titleCase(d.type)}`,
        detail: d.description || `${d.quantityAffected} units · ${fmtCurrency(d.valueAffected)}`,
      });
    }
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [po, fmtCurrency]);

  if (entries.length === 0) {
    return (
      <GlassCard className="p-8">
        <EmptyState title="No timeline events" hint="Dispatches, payments, and disputes will appear here." icon={<Clock className="size-5" />} />
      </GlassCard>
    );
  }

  return (
    <div className="glass rounded-xl p-4">
      <ol className="relative space-y-4 border-l border-border/60 pl-4">
        {entries.map((e) => (
          <li key={e.id} className="relative">
            <span className={`absolute -left-[1.41rem] top-1 grid size-3.5 place-items-center rounded-full border-2 border-background ${kindClass(e.kind)}`}>
              <span className="size-1.5 rounded-full bg-current opacity-80" />
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">{e.title}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {kindLabel(e.kind)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{formatDateTime(e.date)}</p>
            {e.detail ? <p className="mt-0.5 text-xs text-foreground/80">{e.detail}</p> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function kindClass(kind: TimelineEntry["kind"]): string {
  switch (kind) {
    case "payment": return "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400";
    case "log": return "bg-amber-500/20 text-amber-600 dark:text-amber-400";
    case "dispute": return "bg-rose-500/20 text-rose-600 dark:text-rose-400";
    default: return "bg-teal-500/20 text-teal-600 dark:text-teal-400";
  }
}

function kindLabel(kind: TimelineEntry["kind"]): string {
  switch (kind) {
    case "payment": return "Payment";
    case "log": return "Revision";
    case "dispute": return "Dispute";
    default: return "Billing";
  }
}

function Stat({
  icon, label, value, tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "emerald" | "amber";
}) {
  const toneClass = tone === "emerald"
    ? "text-emerald-600 dark:text-emerald-400"
    : tone === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : "text-foreground";
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className={`kpi-num mt-1 text-base font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function KV({
  label, value, tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "emerald" | "amber";
}) {
  const toneClass = tone === "emerald"
    ? "text-emerald-600 dark:text-emerald-400"
    : tone === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : "text-foreground";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${toneClass}`}>{value}</p>
    </div>
  );
}
