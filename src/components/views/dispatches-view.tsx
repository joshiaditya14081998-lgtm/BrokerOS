"use client";

import * as React from "react";
import { Plus, Truck, Search, CloudOff } from "lucide-react";
import { useApi, api } from "@/lib/api";
import { formatCurrency, formatDate, formatNumber, safeParse, titleCase } from "@/lib/format";
import { GlassCard, SectionHeader, StatusChip, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useUI } from "@/lib/ui-store";
import { useTranslation } from "@/hooks/use-translation";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { toast } from "sonner";
import { saveDraft } from "@/lib/offline-db";

type DispatchItem = { styleName: string; color?: string | null; qty: number };
type POLineItem = { styleName: string; color?: string | null; setQty: number; unitPrice: number; lineTotal: number };

type Dispatch = {
  id: string;
  poId: string;
  supplierId: string;
  dispatchDate: string;
  itemsJson: string;
  dispatchedQty: number;
  status: string;
  notes: string | null;
  createdAt: string;
  po: { poNumber: string; totalValue: number; client: { name: string }; supplier: { name: string } };
  photos: { id: string }[];
};

type PO = {
  id: string;
  poNumber: string;
  supplierId: string;
  totalValue: number;
  status: string;
  lineItemsJson: string;
  orderedQty: number;
  dispatchedQty: number;
  fulfillment: number;
  client: { name: string };
  supplier: { name: string };
};

export function DispatchesView() {
  const { t } = useTranslation();
  const { data, loading, refresh } = useApi<{ dispatches: Dispatch[] }>("/api/dispatches");
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const { openDetail, newEntityTrigger } = useUI();

  // Auto-open the "Record dispatch" dialog when the user fires the "n d"
  // keyboard shortcut.
  React.useEffect(() => {
    if (newEntityTrigger?.view === "dispatches") {
      setOpen(true);
    }
  }, [newEntityTrigger]);

  const rows = (data?.dispatches ?? []).filter((d) => {
    const s = q.toLowerCase();
    return (
      d.po.poNumber.toLowerCase().includes(s) ||
      d.po.client.name.toLowerCase().includes(s) ||
      d.po.supplier.name.toLowerCase().includes(s) ||
      d.status.toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("dispatches.title")}
        description={t("dispatches.subtitle")}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1.5 size-4" />{t("dispatches.record")}</Button>
            </DialogTrigger>
            <RecordDispatchDialog onDone={() => { setOpen(false); refresh(); }} />
          </Dialog>
        }
      />

      <GlassCard className="p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("dispatches.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border-0 bg-transparent pl-9 shadow-none focus-visible:ring-1"
          />
        </div>
      </GlassCard>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : rows.length === 0 ? (
        <GlassCard className="p-8">
          <EmptyState
            title={t("dispatches.noDispatchesYet")}
            hint={t("dispatches.noDispatchesHint")}
            icon={<Truck className="size-5" />}
          />
        </GlassCard>
      ) : (
        <GlassCard className="overflow-hidden p-0">
          <div className="max-h-[70vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                <TableRow>
                  <TableHead className="pl-4">{t("dispatches.dispatchDate")}</TableHead>
                  <TableHead>{t("dispatches.poNumber")}</TableHead>
                  <TableHead>{t("portals.buyer")}</TableHead>
                  <TableHead>{t("portals.supplier")}</TableHead>
                  <TableHead className="text-right">{t("dispatches.dispatchedQty")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead className="pr-4">{t("payments.notes")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => {
                  const items = safeParse<DispatchItem[]>(d.itemsJson, []);
                  return (
                    <TableRow
                      key={d.id}
                      className="cursor-pointer"
                      onClick={() => openDetail("PurchaseOrder", d.poId)}
                    >
                      <TableCell className="pl-4 font-medium text-foreground">{formatDate(d.dispatchDate)}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                          {d.po.poNumber}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate text-muted-foreground">{d.po.client.name}</TableCell>
                      <TableCell className="max-w-[160px] truncate text-muted-foreground">{d.po.supplier.name}</TableCell>
                      <TableCell className="text-right">
                        <span className="kpi-num font-semibold">{formatNumber(d.dispatchedQty)}</span>
                        <span className="ml-1 text-[10px] text-muted-foreground">sets</span>
                        {items.length > 0 ? (
                          <span className="ml-2 hidden text-[10px] text-muted-foreground sm:inline">
                            {items.length} line{items.length > 1 ? "s" : ""}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell><StatusChip status={d.status} /></TableCell>
                      <TableCell className="pr-4 max-w-[220px] truncate text-xs text-muted-foreground">
                        {d.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </GlassCard>
      )}
    </div>
  );
}

function RecordDispatchDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { isOnline } = useOnlineStatus();
  const { data: poData, loading: poLoading } = useApi<{ purchaseOrders: PO[] }>("/api/purchase-orders");
  const pos = poData?.purchaseOrders ?? [];

  const [poId, setPoId] = React.useState<string>("");
  const [items, setItems] = React.useState<DispatchItem[]>([]);
  const [dispatchDate, setDispatchDate] = React.useState<string>(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = React.useState<"delivered" | "short_shipment" | "in_transit">("delivered");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const selectedPo = pos.find((p) => p.id === poId) ?? null;

  const onPickPo = (id: string) => {
    setPoId(id);
    const po = pos.find((p) => p.id === id);
    if (!po) {
      setItems([]);
      return;
    }
    const lines = safeParse<POLineItem[]>(po.lineItemsJson, []);
    setItems(lines.map((l) => ({ styleName: l.styleName, color: l.color ?? "", qty: l.setQty })));
  };

  const setItemQty = (idx: number, qty: number) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, qty: Math.max(0, Math.floor(qty)) } : it)));
  };

  const totalQty = items.reduce((s, i) => s + i.qty, 0);

  // "Save as draft" — persists the dispatch form to IndexedDB so the broker
  // can finish it when they're back online. Drafts the same payload the
  // live submit sends (only line items with qty > 0 are kept). Requires a
  // selected PO so the server can route the dispatch on replay.
  const saveAsDraft = async () => {
    if (!selectedPo) {
      toast.error("Select a purchase order before saving as draft");
      return;
    }
    const valid = items.filter((i) => i.qty > 0);
    if (valid.length === 0) {
      toast.error("Add at least one line with qty > 0 before saving as draft");
      return;
    }
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await saveDraft({
        id,
        type: "dispatch",
        data: {
          poId: selectedPo.id,
          supplierId: selectedPo.supplierId,
          dispatchDate: new Date(dispatchDate).toISOString(),
          items: valid.map(({ styleName, color, qty }) => ({ styleName, color: color || null, qty })),
          status,
          notes: notes.trim() || null,
        },
        createdAt: new Date().toISOString(),
        status: "pending",
        retryCount: 0,
      });
      toast.success("Dispatch saved as draft — will sync when online.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save draft");
    }
  };

  const submit = async () => {
    if (!selectedPo) { toast.error("Select a purchase order"); return; }
    const valid = items.filter((i) => i.qty > 0);
    if (valid.length === 0) { toast.error("At least one line with qty > 0 is required"); return; }
    setSaving(true);
    try {
      const res = await api<{ dispatch: Dispatch; poStatus: string }>("/api/dispatches", {
        method: "POST",
        body: JSON.stringify({
          poId: selectedPo.id,
          supplierId: selectedPo.supplierId,
          dispatchDate: new Date(dispatchDate).toISOString(),
          items: valid.map(({ styleName, color, qty }) => ({ styleName, color: color || null, qty })),
          status,
          notes: notes.trim() || null,
        }),
      });
      toast.success(`Dispatch recorded — PO status: ${titleCase(res.poStatus)}`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record dispatch");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="glass-strong max-h-[92vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("dispatches.record")}</DialogTitle>
        <DialogDescription className="sr-only">Log a dispatch against a purchase order. Line items prefill from the PO and the PO status updates based on fulfillment.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <Field label={`${t("dispatches.purchaseOrder")} *`}>
          <Select value={poId} onValueChange={onPickPo} disabled={poLoading}>
            <SelectTrigger><SelectValue placeholder={poLoading ? t("common.loading") : t("dispatches.selectPo")} /></SelectTrigger>
            <SelectContent>
              {pos.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("dispatches.noPurchaseOrders")}</div>
              ) : pos.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.poNumber} · {p.client.name} · {p.supplier.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {selectedPo ? (
          <GlassCard className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
            <KV label={t("dispatches.poValue")} value={formatCurrency(selectedPo.totalValue, { compact: true })} />
            <KV label={t("dispatches.ordered")} value={`${formatNumber(selectedPo.orderedQty)} sets`} />
            <KV label={t("dispatches.alreadyDispatched")} value={`${formatNumber(selectedPo.dispatchedQty)} sets`} tone={selectedPo.dispatchedQty > 0 ? "emerald" : "default"} />
            <KV label={t("dispatches.fulfillment")} value={`${selectedPo.fulfillment}%`} tone={selectedPo.fulfillment >= 100 ? "emerald" : "amber"} />
          </GlassCard>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`${t("dispatches.dispatchDate")} *`}>
            <Input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
          </Field>
          <Field label={`${t("common.status")} *`}>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="delivered">{t("status.delivered")}</SelectItem>
                <SelectItem value="short_shipment">{t("status.short_shipment")}</SelectItem>
                <SelectItem value="in_transit">{t("status.in_transit")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">{t("dispatches.itemsQtyEditable")}</Label>
            <span className="text-[11px] text-muted-foreground">{t("dispatches.totalThisDispatch")}: <span className="font-semibold text-foreground">{formatNumber(totalQty)}</span> {t("dispatches.sets")}</span>
          </div>
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
              {t("dispatches.prefillHint")}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 items-center gap-2 rounded-xl border border-border/40 bg-card/40 p-2">
                  <Input
                    readOnly
                    value={it.styleName}
                    className="col-span-5 h-9 border-0 bg-transparent shadow-none focus-visible:ring-1"
                  />
                  <Input
                    readOnly
                    value={it.color ?? ""}
                    placeholder="—"
                    className="col-span-3 h-9 border-0 bg-transparent text-muted-foreground shadow-none focus-visible:ring-1"
                  />
                  <div className="col-span-4 flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      value={it.qty}
                      onChange={(e) => setItemQty(idx, Number(e.target.value))}
                      className="h-9 text-right"
                    />
                    <span className="text-[10px] text-muted-foreground">{t("dispatches.sets")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label={t("payments.notes")}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("dispatches.notesPlaceholder")} /></Field>
      </div>
      <DialogFooter
        className={
          !isOnline
            ? "rounded-lg border border-amber-500/30 bg-amber-500/5 -mx-1 px-3 py-3"
            : undefined
        }
      >
        <Button
          variant="outline"
          onClick={saveAsDraft}
          disabled={saving || !selectedPo}
          className={
            !isOnline
              ? "border-amber-500/50 text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-200"
              : undefined
          }
        >
          {t("common.saveDraft")}
        </Button>
        <Button onClick={submit} disabled={saving || !selectedPo}>
          {saving ? t("dispatches.recording") : t("dispatches.record")}
        </Button>
      </DialogFooter>
      {/* Offline hint — shown below the footer when the broker is offline.
          The amber-tinted footer above visually emphasizes the "Save as
          draft" affordance so the broker notices the local-save path even
          when the primary submit is unreachable. */}
      {!isOnline && (
        <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          <CloudOff className="size-3 shrink-0" />
          <span>You're offline — tap &ldquo;Save as draft&rdquo; to save locally.</span>
        </div>
      )}
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
