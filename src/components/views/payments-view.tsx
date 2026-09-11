"use client";

import * as React from "react";
import { Plus, Wallet, Search, TrendingUp, CalendarDays, Hash, Download, ImageIcon, AlertCircle, CloudOff } from "lucide-react";
import { useApi, api } from "@/lib/api";
import { formatDate, formatNumber, titleCase } from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PhotoUpload } from "@/components/photo-upload";
import { useUI } from "@/lib/ui-store";
import { useUrlState } from "@/hooks/use-url-state";
import { toast } from "sonner";
import { usePagination } from "@/hooks/use-pagination";
import { PaginationBar } from "@/components/pagination-bar";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { ShareLinkButton } from "@/components/share-link-button";
import { useTranslation } from "@/hooks/use-translation";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { saveDraft } from "@/lib/offline-db";

type Payment = {
  id: string;
  billId: string;
  amount: number;
  date: string;
  mode: string;
  reference: string | null;
  notes: string | null;
  clientId: string;
  bill: { billNumber: string; po: { poNumber: string } };
  client: { name: string };
};

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

type Mode = "cash" | "cheque" | "bank_transfer" | "upi" | "other";

export function PaymentsView() {
  const { t } = useTranslation();
  const { data, loading, refresh } = useApi<{ payments: Payment[] }>("/api/payments");
  const { format: fmtCurrency } = useCurrencyFormat();
  // URL-persisted search query (Task 19-b) — syncs to `?q=` so a refresh or
  // shared link preserves the search.
  const [q, setQ] = useUrlState<string>("q", "");
  const [open, setOpen] = React.useState(false);
  const { newEntityTrigger } = useUI();

  // Auto-open the "Record payment" dialog when the user fires the "n y"
  // keyboard shortcut.
  React.useEffect(() => {
    if (newEntityTrigger?.view === "payments") {
      setOpen(true);
    }
  }, [newEntityTrigger]);

  const payments = data?.payments ?? [];
  const filtered = payments.filter((p) => {
    const s = q.toLowerCase();
    return (
      p.bill.billNumber.toLowerCase().includes(s) ||
      p.bill.po.poNumber.toLowerCase().includes(s) ||
      p.client.name.toLowerCase().includes(s) ||
      p.mode.toLowerCase().includes(s) ||
      (p.reference ?? "").toLowerCase().includes(s)
    );
  });

  // Apply pagination to the filtered payments — default page size 10.
  const {
    paginated, currentPage, totalPages, size, setPage, setSize, range,
  } = usePagination<Payment>(filtered, 10);

  // Reset to page 1 whenever the search query changes so the user is never
  // stuck on a page that no longer exists.
  React.useEffect(() => {
    setPage(1);
  }, [q, setPage]);

  // KPIs
  const totalCollected = payments.reduce((s, p) => s + p.amount, 0);
  const now = new Date();
  const monthCollected = payments
    .filter((p) => {
      const d = new Date(p.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, p) => s + p.amount, 0);
  const count = payments.length;

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("payments.title")}
        description={t("payments.subtitle")}
        action={
          <div className="flex items-center gap-2">
            <ShareLinkButton />
            <Button size="sm" variant="outline" onClick={() => window.open("/api/export?type=payments", "_blank")}>
              <Download className="mr-1.5 size-4" />{t("common.export")}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="mr-1.5 size-4" />{t("payments.record")}</Button>
              </DialogTrigger>
              <RecordPaymentDialog onDone={() => { setOpen(false); refresh(); }} />
            </Dialog>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiMini
          icon={<TrendingUp className="size-4" />}
          label={t("payments.totalCollected")}
          value={fmtCurrency(totalCollected, { compact: true })}
          sub={fmtCurrency(totalCollected)}
          tone="emerald"
        />
        <KpiMini
          icon={<CalendarDays className="size-4" />}
          label={t("payments.thisMonth")}
          value={fmtCurrency(monthCollected, { compact: true })}
          sub={now.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          tone="teal"
        />
        <KpiMini
          icon={<Hash className="size-4" />}
          label={t("payments.count")}
          value={formatNumber(count)}
          sub={t("payments.allTime")}
        />
      </div>

      <GlassCard className="p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("payments.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border-0 bg-transparent pl-9 shadow-none focus-visible:ring-1"
          />
        </div>
      </GlassCard>

      <PullToRefresh onRefresh={refresh}>
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
        ) : filtered.length === 0 ? (
          <GlassCard className="p-8">
            <EmptyState
              title={t("payments.noPaymentsYet")}
              hint={t("payments.noPaymentsHint")}
              icon={<Wallet className="size-5" />}
            />
          </GlassCard>
        ) : (
          <>
            <GlassCard className="overflow-hidden p-0">
              <div className="max-h-[60vh] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                    <TableRow>
                      <TableHead className="pl-4">{t("payments.date")}</TableHead>
                      <TableHead>{t("payments.billNumber")}</TableHead>
                      <TableHead>{t("visits.client")}</TableHead>
                      <TableHead className="text-right">{t("payments.amount")}</TableHead>
                      <TableHead>{t("payments.mode")}</TableHead>
                      <TableHead>{t("payments.reference")}</TableHead>
                      <TableHead>{t("payments.notes")}</TableHead>
                      <TableHead className="pr-4 text-right">{t("payments.proof")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="pl-4 font-medium text-foreground whitespace-nowrap">{formatDate(p.date)}</TableCell>
                        <TableCell>
                          <span className="inline-flex flex-col">
                            <span className="font-medium text-primary hover:underline">{p.bill.billNumber}</span>
                            <span className="text-[10px] text-muted-foreground">{p.bill.po.poNumber}</span>
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[160px] truncate text-muted-foreground">{p.client.name}</TableCell>
                        <TableCell className="text-right font-semibold text-emerald-600 dark:text-emerald-400">
                          {fmtCurrency(p.amount)}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-2 py-0.5 text-xs">
                            {titleCase(p.mode)}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[160px] truncate text-muted-foreground">{p.reference ?? "—"}</TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">{p.notes ?? "—"}</TableCell>
                        <TableCell className="pr-4 text-right">
                          <PaymentProofButton payment={p} />
                        </TableCell>
                      </TableRow>
                    ))}
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

function KpiMini({
  icon, label, value, sub, tone = "default",
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; tone?: "default" | "emerald" | "amber" | "teal";
}) {
  const toneText =
    tone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "amber" ? "text-amber-600 dark:text-amber-400"
    : tone === "teal" ? "text-teal-600 dark:text-teal-400"
    : "text-foreground";
  const iconWrap =
    tone === "emerald" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
    : tone === "amber" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
    : tone === "teal" ? "bg-teal-500/15 text-teal-600 dark:text-teal-400"
    : "bg-primary/10 text-primary";
  return (
    <GlassCard className="relative overflow-hidden p-4 hover-lift">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className={`kpi-num mt-1 text-2xl font-light ${toneText}`}>{value}</p>
          {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
        </div>
        <div className={`grid size-9 shrink-0 place-items-center rounded-xl ${iconWrap}`}>{icon}</div>
      </div>
    </GlassCard>
  );
}

function PaymentProofButton({ payment }: { payment: Payment }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const { format: fmtCurrency } = useCurrencyFormat();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2 text-[11px]"
          aria-label={`View payment proof photos for ${payment.bill.billNumber}`}
        >
          <ImageIcon className="size-3.5" />
          <span className="hidden sm:inline">{t("payments.photos")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="glass-strong max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("payments.paymentProof")} — {payment.bill.billNumber}</DialogTitle>
          <DialogDescription className="sr-only">
            Upload or view payment proof photos for {payment.bill.billNumber} ({fmtCurrency(payment.amount)} on {formatDate(payment.date)}).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-border/50 bg-card/40 p-3 text-xs">
            <KV label={t("payments.amount")} value={fmtCurrency(payment.amount, { compact: true })} tone="emerald" />
            <KV label={t("payments.mode")} value={titleCase(payment.mode)} />
            <KV label={t("payments.reference")} value={payment.reference ?? "—"} />
          </div>
          <PhotoUpload
            entityType="Payment"
            entityId={payment.id}
            stage="payment"
            label={t("payments.photos")}
            hint="UTR screenshot, cheque photo, bank transfer confirmation — anything that supports this payment."
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecordPaymentDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { isOnline } = useOnlineStatus();
  const { data: billData, loading: billLoading } = useApi<{ bills: Bill[] }>("/api/bills");
  const { format: fmtCurrency } = useCurrencyFormat();
  const bills = (billData?.bills ?? []).filter((b) => b.status !== "fully_paid");

  const [billId, setBillId] = React.useState<string>("");
  const [amount, setAmount] = React.useState<string>("");
  const [date, setDate] = React.useState<string>(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = React.useState<Mode>("bank_transfer");
  const [reference, setReference] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  // Gap 11 — inline field validation. billId (Select) + amount (number Input)
  // are validated. amount must be > 0 (not just present).
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({});

  const selectedBill = bills.find((b) => b.id === billId) ?? null;
  const due = selectedBill ? selectedBill.finalAmount - selectedBill.paidAmount : 0;

  // "Save as draft" — persists the payment form to IndexedDB so the broker
  // can finish it when they're back online. Requires a bill selection; the
  // amount is captured as a string (matching the live form) and parsed at
  // save time so we don't store an empty-string payload.
  const saveAsDraft = async () => {
    if (!selectedBill) {
      toast.error("Select a bill before saving as draft");
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Amount must be greater than 0 before saving as draft");
      return;
    }
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await saveDraft({
        id,
        type: "payment",
        data: {
          billId: selectedBill.id,
          amount: amt,
          date: new Date(date).toISOString(),
          mode,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        },
        createdAt: new Date().toISOString(),
        status: "pending",
        retryCount: 0,
      });
      toast.success("Payment saved as draft — will sync when online.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save draft");
    }
  };

  const onPickBill = (id: string) => {
    setBillId(id);
    // Clear the billId error as soon as a valid selection is made.
    setFormErrors((prev) => {
      if (!prev.billId) return prev;
      const next = { ...prev };
      delete next.billId;
      return next;
    });
    const b = bills.find((x) => x.id === id);
    if (b) {
      setAmount(String(Math.max(0, b.finalAmount - b.paidAmount)));
    }
  };

  const submit = async () => {
    const amt = Number(amount);
    const errors: Record<string, string> = {};
    if (!selectedBill) errors.billId = "Select a bill";
    if (!Number.isFinite(amt) || amt <= 0) errors.amount = "Amount must be greater than 0";
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      toast.error("Please fix the highlighted fields");
      return;
    }
    setFormErrors({});
    if (!selectedBill) return; // belt-and-braces — already checked above, but
                              // keeps TS happy about non-null narrowing below.
    setSaving(true);
    try {
      const res = await api<{ payment: Payment; bill: Bill }>("/api/payments", {
        method: "POST",
        body: JSON.stringify({
          billId: selectedBill.id,
          amount: amt,
          date: new Date(date).toISOString(),
          mode,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      toast.success(`Payment recorded — bill status: ${titleCase(res.bill.status)}`);
      if (res.bill.status === "fully_paid" && selectedBill.status !== "fully_paid") {
        toast.success("Brokerage now eligible!");
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record payment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="glass-strong max-h-[92vh] max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("payments.record")}</DialogTitle>
        <DialogDescription className="sr-only">Log a client payment against an open bill. The bill status updates automatically and brokerage becomes eligible on full payment.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <Field label={`${t("payments.bill")} *`} error={formErrors.billId}>
          <Select value={billId} onValueChange={onPickBill} disabled={billLoading}>
            <SelectTrigger className={formErrors.billId ? "border-rose-500 focus-visible:ring-rose-500" : ""}>
              <SelectValue placeholder={billLoading ? t("common.loading") : t("payments.selectBill")} />
            </SelectTrigger>
            <SelectContent>
              {bills.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("payments.noOpenBills")}</div>
              ) : bills.map((b) => {
                const d = b.finalAmount - b.paidAmount;
                return (
                  <SelectItem key={b.id} value={b.id}>
                    {b.billNumber} · {b.client.name} · {fmtCurrency(b.finalAmount, { compact: true })} (due {fmtCurrency(d, { compact: true })})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </Field>

        {selectedBill ? (
          <GlassCard className="grid grid-cols-3 gap-3 p-3">
            <KV label={t("payments.final")} value={fmtCurrency(selectedBill.finalAmount, { compact: true })} />
            <KV label={t("payments.paid")} value={fmtCurrency(selectedBill.paidAmount, { compact: true })} tone="emerald" />
            <KV label={t("payments.due")} value={fmtCurrency(due, { compact: true })} tone={due > 0 ? "amber" : "default"} />
          </GlassCard>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("payments.amount")} *`} error={formErrors.amount}>
            <Input
              type="number"
              min={0}
              step="any"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setFormErrors((prev) => {
                  if (!prev.amount) return prev;
                  const next = { ...prev };
                  delete next.amount;
                  return next;
                });
              }}
              placeholder="0"
              className={formErrors.amount ? "border-rose-500 focus-visible:ring-rose-500" : ""}
            />
          </Field>
          <Field label={`${t("payments.date")} *`}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("payments.mode")}>
            <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bank_transfer">{t("payments.bankTransfer")}</SelectItem>
                <SelectItem value="upi">{t("payments.upi")}</SelectItem>
                <SelectItem value="cash">{t("payments.cash")}</SelectItem>
                <SelectItem value="cheque">{t("payments.cheque")}</SelectItem>
                <SelectItem value="other">{t("payments.other")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("payments.reference")}>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("payments.utrPlaceholder")} />
          </Field>
        </div>

        <Field label={t("payments.notes")}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("payments.optionalPlaceholder")} /></Field>
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
          disabled={saving || !selectedBill}
          className={
            !isOnline
              ? "border-amber-500/50 text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-200"
              : undefined
          }
        >
          {t("common.saveDraft")}
        </Button>
        <Button onClick={submit} disabled={saving || !selectedBill}>
          {saving ? t("payments.recording") : t("payments.record")}
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

function KV({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "emerald" | "amber" }) {
  const toneClass = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-foreground";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`kpi-num text-sm font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
