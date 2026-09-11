"use client";

import * as React from "react";
import { Phone, Mail, MapPin, FileText, Calendar, Receipt, BadgePercent, Wallet, Printer, Clock, TrendingDown, AlertTriangle } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/lib/api";
import { formatCurrency, formatDate, formatDateTime, titleCase } from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { StatusChip, EmptyState } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { TagPicker } from "@/components/tag-picker";
import { PortalAccessSection } from "@/components/portal-access-section";

type Detail = {
  client: {
    id: string; name: string; contactPerson: string | null; phone: string | null; email: string | null;
    userId: string | null;
    address: string | null; gstNo: string | null; defaultPaymentCycleDays: number; payoutCadence: string;
    gstRate: number; notes: string | null; createdAt: string;
    visits: { id: string; status: string; plannedDate: string; bookings: { id: string; supplierId: string }[] }[];
    bills: {
      id: string; billNumber: string; status: string; baseAmount: number; gstAmount: number; finalAmount: number; paidAmount: number;
      createdAt: string; po: { poNumber: string; supplier: { name: string } };
      payments: { id: string; amount: number; date: string; mode: string; reference: string | null }[];
      brokerage: { id: string; brokerageAmount: number; eligible: boolean; payoutStatus: string } | null;
    }[];
    brokerages: { id: string; brokerageAmount: number; eligible: boolean; payoutStatus: string; createdAt: string; bill: { billNumber: string }; supplier: { name: string }; payout: { id: string; status: string; paidAt: string | null } | null }[];
  };
  ledger: { date: string; type: string; ref: string; debit: number; credit: number; balance: number }[];
  stats: { totalBusiness: number; outstanding: number; brokerageEarned: number; brokeragePaid: number; visitCount: number; billCount: number; avgPaymentDelay: number; returnRate: number; creditExposure: number };
  deliverySummary: { poNumber: string; status: string; ordered: number; orderedQty: number; dispatchedQty: number; fulfillment: number; supplierName: string; expectedDispatchDate: string | null; revisedDispatchDate: string | null }[];
};

export function ClientDetailSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, refresh } = useApi<Detail>(`/api/clients/${id}`);
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="glass-strong w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-lg">{loading ? "Loading…" : data?.client.name}</SheetTitle>
              <SheetDescription className="sr-only">Client detail</SheetDescription>
            </div>
            {data && !loading ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(`/api/reports?type=client-ledger&clientId=${data.client.id}`, "_blank")}
              >
                <Printer className="mr-1.5 size-4" />Print ledger
              </Button>
            ) : null}
          </div>
        </SheetHeader>
        {loading || !data ? (
          <div className="space-y-3 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        ) : (
          <ClientDetailBody data={data} onLinkedChange={refresh} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ClientDetailBody({ data, onLinkedChange }: { data: Detail; onLinkedChange?: () => void }) {
  const { client, stats, ledger, deliverySummary } = data;
  const { format: fmtCurrency } = useCurrencyFormat();
  return (
    <div className="space-y-4 px-4 pb-8">
      {/* Contact */}
      <div className="glass rounded-xl p-4">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {client.phone ? <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5" />{client.phone}</span> : null}
          {client.email ? <span className="inline-flex items-center gap-1.5"><Mail className="size-3.5" />{client.email}</span> : null}
          {client.address ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" />{client.address}</span> : null}
          {client.gstNo ? <span className="inline-flex items-center gap-1.5"><FileText className="size-3.5" />GST {client.gstNo}</span> : null}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat icon={<Receipt className="size-4" />} label="Total business" value={fmtCurrency(stats.totalBusiness, { compact: true })} />
          <Stat icon={<Wallet className="size-4" />} label="Outstanding" value={fmtCurrency(stats.outstanding, { compact: true })} tone="amber" />
          <Stat icon={<BadgePercent className="size-4" />} label="Brokerage earned" value={fmtCurrency(stats.brokerageEarned, { compact: true })} tone="emerald" />
          <Stat icon={<Calendar className="size-4" />} label="Visits / Bills" value={`${stats.visitCount} / ${stats.billCount}`} />
          {/* §5.1 client credit metrics */}
          <Stat
            icon={<Clock className="size-4" />}
            label="Avg payment delay"
            value={`${stats.avgPaymentDelay} days`}
            tone={stats.avgPaymentDelay === 0 ? "default" : stats.avgPaymentDelay <= 30 ? "emerald" : stats.avgPaymentDelay <= 90 ? "amber" : "rose"}
          />
          <Stat
            icon={<TrendingDown className="size-4" />}
            label="Return rate"
            value={`${stats.returnRate}%`}
            tone={stats.returnRate < 5 ? "emerald" : stats.returnRate <= 15 ? "amber" : "rose"}
          />
          <Stat
            icon={<AlertTriangle className="size-4" />}
            label="Credit exposure"
            value={fmtCurrency(stats.creditExposure, { compact: true })}
            tone={stats.creditExposure > 0 ? "amber" : "default"}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full border border-border/60 bg-card/50 px-2 py-0.5">Payment cycle: {client.defaultPaymentCycleDays}d</span>
          <span className="rounded-full border border-border/60 bg-card/50 px-2 py-0.5">GST: {client.gstRate}%</span>
          <span className="rounded-full border border-border/60 bg-card/50 px-2 py-0.5">Brokerage: {titleCase(client.payoutCadence)}</span>
        </div>
        <div className="mt-3 border-t border-border/40 pt-3">
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Tags</p>
          <TagPicker entityType="Client" entityId={client.id} />
        </div>
        <div className="mt-3">
          <PortalAccessSection
            partyType="client"
            partyId={client.id}
            userId={client.userId}
            partyEmail={client.email}
            onLinkedChange={onLinkedChange}
          />
        </div>
      </div>

      <Tabs defaultValue="bills" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="bills">Bills</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
          <TabsTrigger value="brokerage">Brokerage</TabsTrigger>
        </TabsList>

        <TabsContent value="bills" className="mt-3 space-y-2">
          {client.bills.length === 0 ? <EmptyState title="No bills yet" /> : client.bills.map((b) => (
            <div key={b.id} className="glass rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{b.billNumber}</p>
                  <p className="truncate text-xs text-muted-foreground">{b.po.poNumber} · {b.po.supplier.name}</p>
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

        <TabsContent value="ledger" className="mt-3">
          {ledger.length === 0 ? <EmptyState title="No ledger entries" /> : (
            <div className="glass overflow-hidden rounded-xl">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-left font-medium">Ref</th>
                    <th className="px-3 py-2 text-right font-medium">Debit</th>
                    <th className="px-3 py-2 text-right font-medium">Credit</th>
                    <th className="px-3 py-2 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((e, i) => (
                    <tr key={i} className="border-t border-border/40">
                      <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(e.date)}</td>
                      <td className="px-3 py-1.5">{titleCase(e.type)}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{e.ref}</td>
                      <td className="px-3 py-1.5 text-right">{e.debit ? fmtCurrency(e.debit) : "—"}</td>
                      <td className="px-3 py-1.5 text-right text-emerald-600 dark:text-emerald-400">{e.credit ? fmtCurrency(e.credit) : "—"}</td>
                      <td className="px-3 py-1.5 text-right font-medium">{fmtCurrency(e.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="deliveries" className="mt-3 space-y-2">
          {deliverySummary.length === 0 ? <EmptyState title="No POs yet" /> : deliverySummary.map((d) => (
            <div key={d.poNumber} className="glass rounded-xl p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{d.poNumber}</p>
                <StatusChip status={d.status} />
              </div>
              <p className="text-xs text-muted-foreground">{d.supplierName}</p>
              <div className="mt-2">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{d.dispatchedQty} / {d.orderedQty} sets · {fmtCurrency(d.ordered)}</span>
                  <span>{d.fulfillment}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${d.fulfillment}%` }} />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Expected: {formatDate(d.expectedDispatchDate)}
                {d.revisedDispatchDate ? ` · Revised: ${formatDate(d.revisedDispatchDate)}` : ""}
              </p>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="brokerage" className="mt-3 space-y-2">
          {client.brokerages.length === 0 ? <EmptyState title="No brokerage entries" /> : client.brokerages.map((b) => (
            <div key={b.id} className="glass rounded-xl p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{b.bill.billNumber}</p>
                <StatusChip status={b.eligible ? b.payoutStatus : "pending"} />
              </div>
              <p className="text-xs text-muted-foreground">{b.supplier.name}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <KV label="Amount" value={fmtCurrency(b.brokerageAmount)} tone="emerald" />
                <KV label="Eligible" value={b.eligible ? "Yes" : "No"} />
              </div>
              {b.payout ? <p className="mt-2 text-[11px] text-muted-foreground">Payout: {titleCase(b.payout.status)}{b.payout.paidAt ? ` · ${formatDate(b.payout.paidAt)}` : ""}</p> : null}
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ icon, label, value, tone = "default" }: { icon: React.ReactNode; label: string; value: string; tone?: "default" | "emerald" | "amber" | "rose" }) {
  const toneClass =
    tone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "amber" ? "text-amber-600 dark:text-amber-400"
    : tone === "rose" ? "text-rose-600 dark:text-rose-400"
    : "text-foreground";
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">{icon}<span className="text-[10px] uppercase tracking-wider">{label}</span></div>
      <p className={`kpi-num mt-1 text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function KV({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "emerald" | "amber" }) {
  const toneClass = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-foreground";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${toneClass}`}>{value}</p>
    </div>
  );
}
