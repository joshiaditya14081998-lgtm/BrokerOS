"use client";

import * as React from "react";
import {
  Plus, Calendar, Trash2, CheckCircle2, Phone,
  Package, ArrowRight, MoreHorizontal, Clock, Camera, ChevronDown, AlertCircle,
  CloudOff,
} from "lucide-react";
import { useApi, api } from "@/lib/api";
import { formatCurrency, formatDate, titleCase } from "@/lib/format";
import { GlassCard, SectionHeader, StatusChip, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PhotoUpload } from "@/components/photo-upload";
import { useUI } from "@/lib/ui-store";
import { useTranslation } from "@/hooks/use-translation";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { toast } from "sonner";
import { saveDraft } from "@/lib/offline-db";

type VisitRow = {
  id: string;
  plannedDate: string;
  actualDate: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
  client: { name: string; phone: string | null };
  bookings: {
    id: string;
    supplier: { name: string };
    purchaseOrder: { poNumber: string; status: string; totalValue: number } | null;
  }[];
};

type ClientOption = { id: string; name: string; phone: string | null };

export function VisitsView() {
  const { t } = useTranslation();
  const { data, loading, refresh } = useApi<{ visits: VisitRow[] }>("/api/visits");
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const { newEntityTrigger } = useUI();

  // "n p" keyboard shortcut → trigger the booking/PO flow. POs are created
  // from a visit via "Record booking", so we navigate here (handled in
  // `triggerNewEntity`) and auto-open the RecordBookingDialog for the first
  // occurred visit. If none exists yet, surface a toast guiding the user to
  // mark a visit as occurred first.
  const [bookingOpen, setBookingOpen] = React.useState(false);
  const [bookingVisitId, setBookingVisitId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (newEntityTrigger?.view !== "pos") return;
    const occurred = (data?.visits ?? []).find((v) => v.status === "occurred");
    if (occurred) {
      setBookingVisitId(occurred.id);
      setBookingOpen(true);
      toast.info("Recording a booking against the most recent occurred visit");
    } else {
      toast.error("No occurred visits yet — mark a visit as 'Occurred' first, then record a booking.");
    }
  }, [newEntityTrigger, data]);

  const rows = (data?.visits ?? []).filter((v) =>
    v.client.name.toLowerCase().includes(q.toLowerCase()) ||
    v.status.toLowerCase().includes(q.toLowerCase()) ||
    (v.notes ?? "").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("visits.title")}
        description={t("visits.subtitle")}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1.5 size-4" />{t("visits.new")}</Button>
            </DialogTrigger>
            <NewVisitDialog onDone={() => { setOpen(false); refresh(); }} />
          </Dialog>
        }
      />

      <GlassCard className="p-3">
        <Input
          placeholder={t("visits.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border-0 bg-transparent shadow-none focus-visible:ring-1"
        />
      </GlassCard>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <GlassCard className="p-8">
          <EmptyState
            title={t("visits.noVisitsYet")}
            hint={t("visits.noVisitsHint")}
            icon={<Calendar className="size-5" />}
          />
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {rows.map((v) => (
            <VisitCard
              key={v.id}
              visit={v}
              onChange={() => refresh()}
            />
          ))}
        </div>
      )}

      {/* Global "Record booking" dialog opened by the "n p" keyboard shortcut.
          Rendered at the view level (rather than inside a VisitCard) because
          the shortcut needs to pick which visit to book against on the fly. */}
      <Dialog
        open={bookingOpen}
        onOpenChange={(o) => {
          setBookingOpen(o);
          if (!o) setBookingVisitId(null);
        }}
      >
        {bookingVisitId && (
          <RecordBookingDialog
            visitId={bookingVisitId}
            onDone={() => {
              setBookingOpen(false);
              setBookingVisitId(null);
              refresh();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function VisitCard({
  visit, onChange,
}: {
  visit: VisitRow;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const [bookingOpen, setBookingOpen] = React.useState(false);
  const [photosOpen, setPhotosOpen] = React.useState(false);

  const updateStatus = async (status: string) => {
    const patch: Record<string, unknown> = { status };
    if (status === "occurred") patch.actualDate = new Date().toISOString();
    try {
      await api(`/api/visits/${visit.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      toast.success(`Marked as ${titleCase(status)}`);
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update visit");
    }
  };

  const del = async () => {
    try {
      await api(`/api/visits/${visit.id}`, { method: "DELETE" });
      toast.success("Visit deleted");
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const canRecord = visit.status === "occurred";

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-base font-semibold text-foreground">{visit.client.name}</p>
            <StatusChip status={visit.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3" />{t("visits.plannedDate")}: {formatDate(visit.plannedDate)}
            </span>
            {visit.actualDate ? (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="size-3 text-emerald-500" />{t("visits.actualDate")}: {formatDate(visit.actualDate)}
              </span>
            ) : null}
            {visit.client.phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3" />{visit.client.phone}
              </span>
            ) : null}
          </div>
          {visit.notes ? (
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">“{visit.notes}”</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canRecord ? (
            <Dialog open={bookingOpen} onOpenChange={setBookingOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="default">
                  <Package className="mr-1.5 size-4" />{t("visits.recordBooking")}
                </Button>
              </DialogTrigger>
              <RecordBookingDialog
                visitId={visit.id}
                onDone={() => { setBookingOpen(false); onChange(); }}
              />
            </Dialog>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Visit actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("visits.updateStatus")}
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => updateStatus("scheduled")} disabled={visit.status === "scheduled"}>
                <Clock className="mr-2 size-3.5" />{t("status.scheduled")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateStatus("followed_up")} disabled={visit.status === "followed_up"}>
                <ArrowRight className="mr-2 size-3.5" />{t("status.followed_up")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateStatus("occurred")} disabled={visit.status === "occurred"}>
                <CheckCircle2 className="mr-2 size-3.5" />{t("status.occurred")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updateStatus("no_show")} disabled={visit.status === "no_show"}>
                <Calendar className="mr-2 size-3.5" />{t("status.no_show")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-rose-600 dark:text-rose-400">
                    <Trash2 className="mr-2 size-3.5" />{t("visits.deleteVisit")}
                  </DropdownMenuItem>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("visits.deleteVisitConfirm")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes the visit. Bookings and linked POs will also be deleted. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={del} className="bg-rose-600 hover:bg-rose-700">{t("common.delete")}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {visit.bookings.length > 0 ? (
        <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("visits.bookings")} · {visit.bookings.length}</p>
          {visit.bookings.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-border/40 bg-card/40 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{b.supplier.name}</span>
                <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm text-muted-foreground">
                  {b.purchaseOrder?.poNumber ?? t("visits.poPending")}
                </span>
              </div>
              {b.purchaseOrder ? (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="kpi-num text-sm font-semibold">{formatCurrency(b.purchaseOrder.totalValue, { compact: true })}</span>
                  <StatusChip status={b.purchaseOrder.status} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Collapsible visit photos section */}
      <Collapsible open={photosOpen} onOpenChange={setPhotosOpen} className="mt-3 border-t border-border/50 pt-3">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full justify-between gap-2 text-[11px]"
            aria-label={photosOpen ? "Hide visit photos" : "Show visit photos"}
          >
            <span className="inline-flex items-center gap-1.5">
              <Camera className="size-3.5" />
              {t("visits.visitPhotos")}
            </span>
            <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${photosOpen ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 data-[state=closed]:animate-none">
          <PhotoUpload
            entityType="Visit"
            entityId={visit.id}
            stage="visit"
            label={t("visits.visitPhotos")}
            hint="Storefront, displays, product samples, meeting notes — capture the visit for the audit trail."
          />
        </CollapsibleContent>
      </Collapsible>
    </GlassCard>
  );
}

function NewVisitDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { data: clientsData } = useApi<{ clients: ClientOption[] }>("/api/clients");
  const clients = clientsData?.clients ?? [];

  const [form, setForm] = React.useState({
    clientId: "",
    plannedDate: new Date().toISOString().slice(0, 10),
    status: "scheduled" as "scheduled" | "followed_up" | "occurred" | "no_show",
    notes: "",
  });
  const [saving, setSaving] = React.useState(false);
  // Gap 11 — inline field validation. Both clientId (Select) and plannedDate
  // (date Input) are required; we surface a rose border / error text under the
  // field and also keep the toast as a secondary cue.
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({});

  const submit = async () => {
    const errors: Record<string, string> = {};
    if (!form.clientId) errors.clientId = "Select a client";
    if (!form.plannedDate) errors.plannedDate = "Planned date is required";
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      toast.error("Please fix the highlighted fields");
      return;
    }
    setFormErrors({});
    setSaving(true);
    try {
      await api("/api/visits", {
        method: "POST",
        body: JSON.stringify({
          clientId: form.clientId,
          plannedDate: new Date(form.plannedDate).toISOString(),
          status: form.status,
          notes: form.notes || null,
        }),
      });
      toast.success("Visit scheduled");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create visit");
    } finally { setSaving(false); }
  };

  const clearField = (field: string) => {
    setFormErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  return (
    <DialogContent className="glass-strong max-h-[90vh] max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("visits.new")}</DialogTitle>
        <DialogDescription className="sr-only">Schedule a new client visit with planned date and status.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <Field label={`${t("visits.client")} *`} error={formErrors.clientId}>
          <Select
            value={form.clientId}
            onValueChange={(v) => { setForm({ ...form, clientId: v }); clearField("clientId"); }}
          >
            <SelectTrigger className={formErrors.clientId ? "border-rose-500 focus-visible:ring-rose-500" : ""}>
              <SelectValue placeholder={t("visits.selectClient")} />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("visits.plannedDate")} *`} error={formErrors.plannedDate}>
            <Input
              type="date"
              value={form.plannedDate}
              onChange={(e) => { setForm({ ...form, plannedDate: e.target.value }); clearField("plannedDate"); }}
              className={formErrors.plannedDate ? "border-rose-500 focus-visible:ring-rose-500" : ""}
            />
          </Field>
          <Field label={t("common.status")}>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as typeof form.status })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="scheduled">{t("status.scheduled")}</SelectItem>
                <SelectItem value="followed_up">{t("status.followed_up")}</SelectItem>
                <SelectItem value="occurred">{t("status.occurred")}</SelectItem>
                <SelectItem value="no_show">{t("status.no_show")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label={t("visits.notes")}>
          <Textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder={t("visits.notesPlaceholder")}
          />
        </Field>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving}>{saving ? t("common.saving") : t("visits.scheduleVisit")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

type SupplierOption = {
  id: string; name: string; defaultCommissionRate: number; defaultGstRate: number;
};

type LineItemDraft = {
  styleName: string; color: string; setQty: string; unitPrice: string;
};

function RecordBookingDialog({
  visitId, onDone,
}: {
  visitId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { isOnline } = useOnlineStatus();
  const { data: suppliersData } = useApi<{ suppliers: SupplierOption[] }>("/api/suppliers");
  const suppliers = suppliersData?.suppliers ?? [];

  const [supplierId, setSupplierId] = React.useState("");
  const [commissionRate, setCommissionRate] = React.useState<string>("");
  const [notes, setNotes] = React.useState("");
  const [items, setItems] = React.useState<LineItemDraft[]>([
    { styleName: "", color: "", setQty: "", unitPrice: "" },
  ]);
  const [saving, setSaving] = React.useState(false);

  // When supplier chosen, prefill commission rate
  React.useEffect(() => {
    if (!supplierId) return;
    const s = suppliers.find((x) => x.id === supplierId);
    if (s) setCommissionRate(String(s.defaultCommissionRate));
  }, [supplierId, suppliers]);

  const addLine = () => setItems((prev) => [...prev, { styleName: "", color: "", setQty: "", unitPrice: "" }]);
  const removeLine = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<LineItemDraft>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const total = items.reduce((s, it) => s + (Number(it.setQty) || 0) * (Number(it.unitPrice) || 0), 0);

  // "Save as draft" — persists the current form state to IndexedDB so the
  // broker can finish the booking when they're back online. Drafts the
  // same payload the live submit sends (with one cleanup pass so the
  // server-side validator doesn't reject empty rows on replay). Uses a
  // client-generated UUID as the id so the row is addressable before sync.
  const saveAsDraft = async () => {
    if (!supplierId) {
      toast.error("Select a supplier before saving as draft");
      return;
    }
    const cleaned = items
      .map((it) => ({
        styleName: it.styleName.trim(),
        color: it.color.trim() || null,
        setQty: Number(it.setQty),
        unitPrice: Number(it.unitPrice),
      }))
      .filter((it) => it.styleName && it.setQty >= 1 && Number.isFinite(it.unitPrice) && it.unitPrice >= 0);
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await saveDraft({
        id,
        type: "booking",
        data: {
          visitId,
          supplierId,
          commissionRate: commissionRate === "" ? null : Number(commissionRate),
          notes: notes || null,
          lineItems: cleaned,
        },
        createdAt: new Date().toISOString(),
        status: "pending",
        retryCount: 0,
      });
      toast.success("Booking saved as draft — will sync when online.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save draft");
    }
  };

  const submit = async () => {
    if (!supplierId) { toast.error("Select a supplier"); return; }
    const cleaned = items
      .map((it) => ({
        styleName: it.styleName.trim(),
        color: it.color.trim() || null,
        setQty: Number(it.setQty),
        unitPrice: Number(it.unitPrice),
      }))
      .filter((it) => it.styleName && it.setQty >= 1 && Number.isFinite(it.unitPrice) && it.unitPrice >= 0);
    if (cleaned.length === 0) {
      toast.error("Add at least one valid line item (style, qty ≥ 1, price ≥ 0)");
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ po: { poNumber: string } }>("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          visitId,
          supplierId,
          commissionRate: commissionRate === "" ? null : Number(commissionRate),
          notes: notes || null,
          lineItems: cleaned,
        }),
      });
      toast.success(`Booking recorded — PO ${res.po.poNumber} generated`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record booking");
    } finally { setSaving(false); }
  };

  return (
    <DialogContent className="glass-strong max-h-[92vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("visits.recordBooking")}</DialogTitle>
        <DialogDescription className="sr-only">Record a supplier booking with line items. A purchase order is generated automatically upon save.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`${t("portals.supplier")} *`}>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder={t("portals.selectSupplier")} /></SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={`${t("brokerage.commissionRate")} %`}>
            <Input
              type="number"
              step="0.1"
              min="0"
              placeholder={t("visits.supplierDefaultPlaceholder")}
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
            />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">{t("visits.lineItems")}</Label>
            <Button size="sm" variant="outline" onClick={addLine}>
              <Plus className="mr-1 size-3.5" />{t("common.add")}
            </Button>
          </div>
          <div className="space-y-2">
            <div className="hidden grid-cols-[1fr_1fr_80px_100px_36px] gap-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground sm:grid">
              <span>{t("visits.style")}</span>
              <span>{t("visits.color")}</span>
              <span>{t("visits.sets")}</span>
              <span>{t("visits.unitPrice")}</span>
              <span />
            </div>
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_80px_100px_36px]">
                <Input
                  placeholder={t("visits.styleNamePlaceholder")}
                  value={it.styleName}
                  onChange={(e) => updateLine(i, { styleName: e.target.value })}
                />
                <Input
                  placeholder={t("visits.color")}
                  value={it.color}
                  onChange={(e) => updateLine(i, { color: e.target.value })}
                />
                <Input
                  type="number"
                  min="1"
                  placeholder={t("visits.qtyPlaceholder")}
                  value={it.setQty}
                  onChange={(e) => updateLine(i, { setQty: e.target.value })}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={t("visits.pricePlaceholder")}
                  value={it.unitPrice}
                  onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => items.length > 1 ? removeLine(i) : null}
                  disabled={items.length === 1}
                  aria-label="Remove line item"
                  className="text-rose-500 hover:text-rose-600"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2 rounded-xl border border-border/40 bg-card/40 px-3 py-2 text-sm">
            <span className="text-xs text-muted-foreground">{t("visits.bookingTotal")}</span>
            <span className="kpi-num text-base font-semibold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(total, { compact: true })}
            </span>
          </div>
        </div>

        <Field label={t("visits.notes")}>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("visits.bookingNotesPlaceholder")}
          />
        </Field>
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
          disabled={saving}
          className={
            !isOnline
              ? "border-amber-500/50 text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-200"
              : undefined
          }
        >
          {t("common.saveDraft")}
        </Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? t("visits.creatingPo") : `${t("visits.recordBooking")} & PO`}
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

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {error ? (
        <p className="inline-flex items-center gap-1 text-xs text-rose-500">
          <AlertCircle className="size-3" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
