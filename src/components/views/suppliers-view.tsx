"use client";

import * as React from "react";
import { Plus, Factory, Phone, Mail, Percent, FileText, Gauge, Download, TrendingUp, AlertCircle } from "lucide-react";
import { useApi, api } from "@/lib/api";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { GlassCard, SectionHeader, StatusChip, EmptyState } from "@/components/shared";
import { Sparkline } from "@/components/sparkline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUI } from "@/lib/ui-store";
import { useTranslation } from "@/hooks/use-translation";
import { toast } from "sonner";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { TagBadge } from "@/components/tag-badge";
import { TagFilterBar, filterByTags } from "@/components/tag-filter-bar";

type TagLike = { id: string; name: string; color: string };

type Row = {
  id: string; name: string; contactPerson: string | null; phone: string | null; email: string | null;
  address: string | null; gstNo: string | null; defaultCommissionRate: number; defaultGstRate: number;
  notes: string | null;
  totalSupplied: number; outstandingBrokerage: number; paidBrokerage: number;
  fulfillment: number; shortShipmentRate: number; dispatchCount: number; billCount: number;
  volumeTrend?: { label: string; value: number }[];
  tags?: TagLike[];
};

function statusFromFulfillment(f: number): string {
  if (f >= 100) return "fully_delivered";
  if (f >= 50) return "partially_delivered";
  return "short_shipment";
}

export function SuppliersView() {
  const { data, loading, refresh } = useApi<{ suppliers: Row[] }>("/api/suppliers?detail=true");
  const { format: fmtCurrency } = useCurrencyFormat();
  const { t } = useTranslation();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [tagFilter, setTagFilter] = React.useState<Set<string>>(new Set());
  const { openDetail } = useUI();

  const toggleTag = (id: string) => {
    setTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rows = filterByTags(
    (data?.suppliers ?? []).filter((s) =>
      s.name.toLowerCase().includes(q.toLowerCase()) ||
      (s.contactPerson ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (s.phone ?? "").includes(q)
    ),
    tagFilter,
  );

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("suppliers.title")}
        description={t("suppliers.subtitle")}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => window.open("/api/export?type=suppliers", "_blank")}>
              <Download className="mr-1.5 size-4" />{t("common.export")}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="mr-1.5 size-4" />{t("suppliers.new")}</Button>
              </DialogTrigger>
              <NewSupplierDialog onDone={() => { setOpen(false); refresh(); }} />
            </Dialog>
          </div>
        }
      />

      <GlassCard className="p-3">
        <Input
          placeholder={t("suppliers.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border-0 bg-transparent shadow-none focus-visible:ring-1"
        />
      </GlassCard>

      <GlassCard className="p-3">
        <TagFilterBar
          selected={tagFilter}
          onToggle={toggleTag}
          onClear={() => setTagFilter(new Set())}
          entityTypeCount="suppliers"
        />
      </GlassCard>

      <PullToRefresh onRefresh={refresh}>
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        ) : rows.length === 0 ? (
          <GlassCard className="p-8">
            <EmptyState
              title="No suppliers yet"
              hint="Add your first manufacturer to start booking POs and dispatches."
              icon={<Factory className="size-5" />}
            />
          </GlassCard>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((s) => (
              <button
                key={s.id}
                onClick={() => openDetail("Supplier", s.id)}
                className="glass hover-lift rounded-2xl p-5 text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-foreground">{s.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.contactPerson || "—"}</p>
                  </div>
                  <StatusChip status={statusFromFulfillment(s.fulfillment)} />
                </div>
                {s.tags && s.tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {s.tags.map((t) => <TagBadge key={t.id} tag={t} size="sm" />)}
                  </div>
                ) : null}
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <Metric label="Total supplied" value={fmtCurrency(s.totalSupplied, { compact: true })} />
                  <Metric
                    label="Outstanding brokerage"
                    value={fmtCurrency(s.outstandingBrokerage, { compact: true })}
                    tone={s.outstandingBrokerage > 0 ? "amber" : "default"}
                  />
                  <Metric label="Paid brokerage" value={fmtCurrency(s.paidBrokerage, { compact: true })} tone="emerald" />
                  <Metric label="Dispatches" value={`${s.dispatchCount}`} />
                </div>
                {s.volumeTrend && s.volumeTrend.length > 0 ? (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-card/30 px-2.5 py-1.5">
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <TrendingUp className="size-3" />6-mo supplied
                    </span>
                    <Sparkline data={s.volumeTrend.map((v) => v.value)} width={110} height={28} stroke="oklch(0.6 0.12 200)" fill="oklch(0.6 0.12 200 / 0.12)" />
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                  {s.phone ? <span className="inline-flex items-center gap-1"><Phone className="size-3" />{s.phone}</span> : null}
                  {s.email ? <span className="inline-flex items-center gap-1"><Mail className="size-3" />{s.email}</span> : null}
                  <span className="inline-flex items-center gap-1"><Percent className="size-3" />Comm {s.defaultCommissionRate}%</span>
                  <span className="inline-flex items-center gap-1"><FileText className="size-3" />GST {s.defaultGstRate}%</span>
                  <span className="inline-flex items-center gap-1"><Gauge className="size-3" />Fulfill {s.fulfillment}%</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </PullToRefresh>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "emerald" | "amber" }) {
  const toneClass =
    tone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "amber" ? "text-amber-600 dark:text-amber-400"
    : "text-foreground";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`kpi-num text-sm font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function NewSupplierDialog({ onDone }: { onDone: () => void }) {
  const [form, setForm] = React.useState({
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    gstNo: "",
    defaultCommissionRate: 5,
    defaultGstRate: 5,
    notes: "",
  });
  const [saving, setSaving] = React.useState(false);
  // Gap 11 — inline field validation (red border + message below the field).
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({});

  const submit = async () => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Name is required";
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      toast.error("Please fix the highlighted fields");
      return;
    }
    setFormErrors({});
    setSaving(true);
    try {
      await api("/api/suppliers", { method: "POST", body: JSON.stringify(form) });
      toast.success("Supplier created");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
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
        <DialogTitle>New supplier</DialogTitle>
        <DialogDescription className="sr-only">Register a new manufacturer with default commission and GST rates.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <Field label="Name *" error={formErrors.name}>
          <Input
            value={form.name}
            onChange={(e) => { setForm({ ...form, name: e.target.value }); clearField("name"); }}
            className={formErrors.name ? "border-rose-500 focus-visible:ring-rose-500" : ""}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact person"><Input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="GST no."><Input value={form.gstNo} onChange={(e) => setForm({ ...form, gstNo: e.target.value })} /></Field>
        </div>
        <Field label="Address"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Commission rate %"><Input type="number" value={form.defaultCommissionRate} onChange={(e) => setForm({ ...form, defaultCommissionRate: Number(e.target.value) })} /></Field>
          <Field label="Default GST rate %"><Input type="number" value={form.defaultGstRate} onChange={(e) => setForm({ ...form, defaultGstRate: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Create supplier"}</Button>
      </DialogFooter>
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
