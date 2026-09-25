"use client";

import * as React from "react";
import { Plus, Users, Phone, Mail, MapPin, FileText, Download, TrendingUp, AlertCircle } from "lucide-react";
import { useApi, api } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { GlassCard, SectionHeader, StatusChip, EmptyState } from "@/components/shared";
import { Sparkline } from "@/components/sparkline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUI } from "@/lib/ui-store";
import { useTranslation } from "@/hooks/use-translation";
import { useUrlState } from "@/hooks/use-url-state";
import { toast } from "sonner";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { TagBadge } from "@/components/tag-badge";
import { TagFilterBar, filterByTags } from "@/components/tag-filter-bar";
import { SavedViewsBar } from "@/components/saved-views-bar";
import { ShareLinkButton } from "@/components/share-link-button";
import { isFilterActive } from "@/lib/saved-views";

type TagLike = { id: string; name: string; color: string };

type Row = {
  id: string; name: string; contactPerson: string | null; phone: string | null; email: string | null;
  address: string | null; gstNo: string | null; defaultPaymentCycleDays: number; payoutCadence: string;
  gstRate: number; notes: string | null;
  totalBusiness: number; outstanding: number; brokerageEarned: number; openPOs: number;
  visitCount: number; lastVisit: string | null;
  volumeTrend?: { label: string; value: number }[];
  tags?: TagLike[];
};

export function ClientsView() {
  const { data, loading, refresh } = useApi<{ clients: Row[] }>("/api/clients?detail=true");
  const { format: fmtCurrency } = useCurrencyFormat();
  const { t } = useTranslation();
  // URL-persisted filter state (Task 19-b). The search query and tag filter
  // are stored in the URL so a refresh or shared link preserves the filter.
  // `tagsParam` is a comma-separated string of tag IDs — converted to/from a
  // Set at the call site for the existing filterByTags helper.
  const [q, setQ] = useUrlState<string>("q", "");
  const [tagsParam, setTagsParam] = useUrlState<string>("tags", "");
  const tagFilter = React.useMemo<Set<string>>(
    () => new Set(tagsParam ? tagsParam.split(",").filter(Boolean) : []),
    [tagsParam],
  );
  const setTagFilter = React.useCallback(
    (next: Set<string>) => setTagsParam(Array.from(next).join(",")),
    [setTagsParam],
  );
  const [open, setOpen] = React.useState(false);
  const { openDetail, newEntityTrigger } = useUI();

  // Auto-open the "New client" dialog when the user fires the "n c" keyboard
  // shortcut. The store resets `newEntityTrigger` to null on manual navigation,
  // so this only fires for a genuine shortcut invocation.
  React.useEffect(() => {
    if (newEntityTrigger?.view === "clients") {
      setOpen(true);
    }
  }, [newEntityTrigger]);

  const toggleTag = (id: string) => {
    // Read from the memoised `tagFilter` (closure-captured) instead of using
    // a functional updater — useUrlState's setter accepts a value, not an
    // updater function. The closure re-evaluates on every render so the
    // toggled state is always current.
    const next = new Set(tagFilter);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTagFilter(next);
  };

  const rows = filterByTags(
    (data?.clients ?? []).filter((c) =>
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      (c.contactPerson ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (c.phone ?? "").includes(q)
    ),
    tagFilter,
  );

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("clients.title")}
        description={t("clients.subtitle")}
        action={
          <div className="flex items-center gap-2">
            <ShareLinkButton />
            <Button size="sm" variant="outline" onClick={() => window.open("/api/export?type=clients", "_blank")}>
              <Download className="mr-1.5 size-4" />{t("common.export")}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="mr-1.5 size-4" />{t("clients.new")}</Button>
              </DialogTrigger>
              <NewClientDialog onDone={() => { setOpen(false); refresh(); }} />
            </Dialog>
          </div>
        }
      />

      <SavedViewsBar
        view="clients"
        currentFilter={{ q, selectedTagIds: Array.from(tagFilter) }}
        isFilterActive={isFilterActive({ q, selectedTagIds: Array.from(tagFilter) })}
        onApply={(f) => {
          setQ(typeof f.q === "string" ? f.q : "");
          const ids = Array.isArray(f.selectedTagIds)
            ? f.selectedTagIds.filter((x): x is string => typeof x === "string")
            : [];
          setTagFilter(new Set(ids));
        }}
      />

      <GlassCard className="p-3">
        <Input placeholder={t("clients.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} className="border-0 bg-transparent shadow-none focus-visible:ring-1" />
      </GlassCard>

      <GlassCard className="p-3">
        <TagFilterBar
          selected={tagFilter}
          onToggle={toggleTag}
          onClear={() => setTagFilter(new Set())}
          entityTypeCount="clients"
        />
      </GlassCard>

      <PullToRefresh onRefresh={refresh}>
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
        ) : rows.length === 0 ? (
          <GlassCard className="p-8"><EmptyState title="No clients yet" hint="Add your first buyer to start booking visits and POs." icon={<Users className="size-5" />} /></GlassCard>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((c) => (
              <button key={c.id} onClick={() => openDetail("Client", c.id)} className="glass hover-lift rounded-2xl p-5 text-left">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-foreground">{c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{c.contactPerson || "—"}</p>
                  </div>
                  <StatusChip status={c.openPOs > 0 ? "partially_paid" : "fully_paid"} />
                </div>
                {c.tags && c.tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.tags.map((t) => <TagBadge key={t.id} tag={t} size="sm" />)}
                  </div>
                ) : null}
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <Metric label="Total business" value={fmtCurrency(c.totalBusiness, { compact: true })} />
                  <Metric label="Outstanding" value={fmtCurrency(c.outstanding, { compact: true })} tone={c.outstanding > 0 ? "amber" : "default"} />
                  <Metric label="Brokerage earned" value={fmtCurrency(c.brokerageEarned, { compact: true })} tone="emerald" />
                  <Metric label="Open bills" value={`${c.openPOs}`} />
                </div>
                {c.volumeTrend && c.volumeTrend.length > 0 ? (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-card/30 px-2.5 py-1.5">
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <TrendingUp className="size-3" />6-mo volume
                    </span>
                    <Sparkline data={c.volumeTrend.map((v) => v.value)} width={110} height={28} />
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                  {c.phone ? <span className="inline-flex items-center gap-1"><Phone className="size-3" />{c.phone}</span> : null}
                  {c.email ? <span className="inline-flex items-center gap-1"><Mail className="size-3" />{c.email}</span> : null}
                  <span className="inline-flex items-center gap-1"><FileText className="size-3" />{titleCase(c.payoutCadence)}</span>
                  {c.lastVisit ? <span>Last visit: {formatDate(c.lastVisit)}</span> : null}
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
  const toneClass = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-foreground";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`kpi-num text-sm font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function NewClientDialog({ onDone }: { onDone: () => void }) {
  const [form, setForm] = React.useState({
    name: "", contactPerson: "", phone: "", email: "", address: "", gstNo: "",
    defaultPaymentCycleDays: 120, payoutCadence: "immediate" as "immediate" | "4_month_cumulative" | "12_month_cumulative", gstRate: 5, notes: "",
  });
  const [saving, setSaving] = React.useState(false);
  // Gap 11 — inline field validation. Each key maps a field name → an error
  // message. Cleared per-field when the user starts typing in that field
  // (see the `onChange` handler on the validated Input).
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({});

  const submit = async () => {
    // Validate required fields before talking to the server. We populate
    // `formErrors` so the offending Input shows a rose border + inline
    // message; we also keep the toast as a secondary cue (per Gap 11 spec).
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
      await api("/api/clients", { method: "POST", body: JSON.stringify(form) });
      toast.success("Client created");
      // Small delay to ensure the DB write is committed before refresh
      await new Promise(r => setTimeout(r, 300));
      onDone();
    } catch (e) {
      // Empty message = 402 limit reached → UpgradeModal handles the UX
      const msg = e instanceof Error ? e.message : "Failed";
      if (msg) toast.error(msg);
    } finally { setSaving(false); }
  };

  // Clear a single field's error as soon as the user starts editing it —
  // standard UX pattern that prevents stale error states from lingering.
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
        <DialogTitle>New client</DialogTitle>
        <DialogDescription className="sr-only">Register a new buyer with default payment, GST and brokerage cadence settings.</DialogDescription>
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
        <div className="grid grid-cols-3 gap-3">
          <Field label="Payment cycle (days)"><Input type="number" value={form.defaultPaymentCycleDays} onChange={(e) => setForm({ ...form, defaultPaymentCycleDays: Number(e.target.value) })} /></Field>
          <Field label="GST rate %"><Input type="number" value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: Number(e.target.value) })} /></Field>
          <Field label="Brokerage cadence">
            <Select value={form.payoutCadence} onValueChange={(v) => setForm({ ...form, payoutCadence: v as typeof form.payoutCadence })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">Immediate</SelectItem>
                <SelectItem value="4_month_cumulative">4-month cumul.</SelectItem>
                <SelectItem value="12_month_cumulative">12-month cumul.</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Create client"}</Button>
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
