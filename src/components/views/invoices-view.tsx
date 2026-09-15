"use client";

import * as React from "react";
import {
  FileText, Plus, Trash2, Search, Download, Check, X, AlertCircle, Printer,
} from "lucide-react";
import { useApi, api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { useTranslation } from "@/hooks/use-translation";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Invoices — GST-compliant invoice ledger.
//
// Mirrors the expenses-view layout: SectionHeader + toolbar (filter + search +
// Export CSV + Create), table with status chips + per-row actions, empty /
// loading states, and a Create dialog with a dynamic line-items editor + live
// totals preview. Row click opens a Sheet with the parsed line items.
// ─────────────────────────────────────────────────────────────────────────────

type Client = { id: string; name: string };

type InvoiceItem = {
  description: string;
  hsnCode?: string | null;
  quantity: number;
  rate: number;
  amount: number;
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  clientId: string;
  issueDate: string;
  dueDate: string | null;
  itemsJson: string;
  subtotal: number;
  gstRate: number;
  gstAmount: number;
  roundOff: number;
  totalAmount: number;
  status: string;
  notes: string | null;
  placeOfSupply: string | null;
  createdAt: string;
  client: { id: string; name: string; gstNo?: string | null };
};

type InvoiceDetail = Invoice & { items: InvoiceItem[] };

const STATUSES = ["all", "pending", "paid", "cancelled"] as const;
type StatusFilter = (typeof STATUSES)[number];

// Status chip palette — amber for pending, emerald for paid, zinc for cancelled.
function statusChipClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "paid") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (s === "pending") return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
  if (s === "cancelled") return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30";
  return "bg-primary/10 text-primary border-primary/25";
}

function statusLabel(t: (k: string) => string, status: string): string {
  const s = status.toLowerCase();
  if (s === "pending") return t("invoices.statusPending");
  if (s === "paid") return t("invoices.statusPaid");
  if (s === "cancelled") return t("invoices.statusCancelled");
  return status;
}

export function InvoicesView() {
  const { t } = useTranslation();
  const { format: fmtCurrency } = useCurrencyFormat();

  // Filter state — plain useState (lightweight for a single-page view; the
  // URL-persisted pattern is reserved for views with shared links / deep-link
  // needs, which the invoice list doesn't have in v1).
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [clientFilter, setClientFilter] = React.useState<string>("all");
  const [q, setQ] = React.useState("");

  // Build the query URL with the active filters so the server returns the
  // already-filtered set (saves the client from re-filtering + keeps the
  // broker's URL honest for the CSV export link).
  const listUrl = React.useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (clientFilter !== "all") params.set("clientId", clientFilter);
    return `/api/invoices${params.toString() ? `?${params.toString()}` : ""}`;
  }, [statusFilter, clientFilter]);

  const { data, loading, error, refresh } = useApi<{ invoices: Invoice[] }>(listUrl);
  const clientsState = useApi<{ clients: Client[] }>("/api/clients?limit=100");
  const clients = clientsState.data?.clients ?? [];

  const [createOpen, setCreateOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [markPaidInvoice, setMarkPaidInvoice] = React.useState<Invoice | null>(null);
  const [cancelInvoice, setCancelInvoice] = React.useState<Invoice | null>(null);
  const [deleteInvoice, setDeleteInvoice] = React.useState<Invoice | null>(null);

  // Surface a load failure as a toast — matches the expenses-view convention.
  React.useEffect(() => {
    if (error) toast.error(t("invoices.loadFailed"));
  }, [error, t]);

  const invoices = data?.invoices ?? [];

  // Client-side search by invoice number — the server already filters by
  // status + clientId, but invoice-number search is a UI nicety kept local
  // (it's a small list and avoids a debounce round-trip per keystroke).
  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return invoices;
    return invoices.filter((inv) => inv.invoiceNumber.toLowerCase().includes(s));
  }, [invoices, q]);

  // CSV export link — passes the same status/clientId filters so the export
  // matches what's on screen. (No date range yet — the spec doesn't include
  // one for invoices.)
  const exportUrl = React.useMemo(() => {
    const params = new URLSearchParams({ type: "invoices" });
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (clientFilter !== "all") params.set("clientId", clientFilter);
    return `/api/export?${params.toString()}`;
  }, [statusFilter, clientFilter]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("invoices.title")}
        description={t("invoices.subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(exportUrl, "_blank")}
            >
              <Download className="mr-1.5 size-4" />
              {t("invoices.exportCsv")}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 size-4" />
              {t("invoices.create")}
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <CreateInvoiceDialog
                clients={clients}
                onDone={() => { setCreateOpen(false); refresh(); }}
              />
            </Dialog>
          </div>
        }
      />

      {/* ── Filter toolbar ───────────────────────────────────────────────── */}
      <GlassCard className="p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("invoices.searchPlaceholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="border-0 bg-transparent pl-9 shadow-none focus-visible:ring-1"
              aria-label={t("invoices.searchPlaceholder")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            >
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("invoices.statusAll")}</SelectItem>
                <SelectItem value="pending">{t("invoices.statusPending")}</SelectItem>
                <SelectItem value="paid">{t("invoices.statusPaid")}</SelectItem>
                <SelectItem value="cancelled">{t("invoices.statusCancelled")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("invoices.allClients")}</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(q || statusFilter !== "all" || clientFilter !== "all") ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-9"
                onClick={() => { setQ(""); setStatusFilter("all"); setClientFilter("all"); }}
              >
                <X className="mr-1 size-3.5" />
                {t("common.clear")}
              </Button>
            ) : null}
          </div>
        </div>
      </GlassCard>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-8">
          <EmptyState
            title={t("invoices.noInvoices")}
            hint={t("invoices.noInvoicesHint")}
            icon={<FileText className="size-5" />}
          />
        </GlassCard>
      ) : (
        <GlassCard className="overflow-hidden p-0">
          <div className="max-h-[60vh] overflow-x-auto overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                <TableRow>
                  <TableHead className="pl-4">{t("invoices.invoiceNo")}</TableHead>
                  <TableHead>{t("invoices.client")}</TableHead>
                  <TableHead>{t("invoices.issueDate")}</TableHead>
                  <TableHead>{t("invoices.dueDate")}</TableHead>
                  <TableHead className="text-right">{t("invoices.subtotal")}</TableHead>
                  <TableHead className="text-right">{t("invoices.gst")}</TableHead>
                  <TableHead className="text-right">{t("invoices.total")}</TableHead>
                  <TableHead>{t("invoices.status")}</TableHead>
                  <TableHead className="pr-4 text-right">{t("invoices.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer"
                    onClick={() => setDetailId(inv.id)}
                  >
                    <TableCell className="pl-4 whitespace-nowrap font-medium text-foreground">
                      {inv.invoiceNumber}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">
                      {inv.client?.name ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(inv.issueDate)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(inv.dueDate)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                      {fmtCurrency(inv.subtotal)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                      {fmtCurrency(inv.gstAmount)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap font-bold text-foreground">
                      {fmtCurrency(inv.totalAmount)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusChipClass(inv.status)}`}
                      >
                        <span className="size-1.5 rounded-full bg-current opacity-70" />
                        {statusLabel(t, inv.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="sm"
                          variant="ghost"
                          className="size-8 p-0"
                          aria-label={t("invoices.viewPdf")}
                          title={t("invoices.viewPdf")}
                          onClick={() =>
                            window.open(
                              `/api/reports?type=invoice&invoiceId=${inv.id}`,
                              "_blank",
                            )
                          }
                        >
                          <FileText className="size-3.5" />
                        </Button>
                        {inv.status === "pending" ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-8 p-0 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400"
                              aria-label={t("invoices.markPaid")}
                              title={t("invoices.markPaid")}
                              onClick={() => setMarkPaidInvoice(inv)}
                            >
                              <Check className="size-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-8 p-0 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400"
                              aria-label={t("invoices.cancel")}
                              title={t("invoices.cancel")}
                              onClick={() => setCancelInvoice(inv)}
                            >
                              <X className="size-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-8 p-0 text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
                              aria-label={t("common.delete")}
                              title={t("common.delete")}
                              onClick={() => setDeleteInvoice(inv)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </GlassCard>
      )}

      {/* ── Detail Sheet ────────────────────────────────────────────────── */}
      {detailId ? (
        <InvoiceDetailSheet id={detailId} onClose={() => setDetailId(null)} />
      ) : null}

      {/* ── Mark Paid confirm ──────────────────────────────────────────── */}
      <AlertDialog
        open={!!markPaidInvoice}
        onOpenChange={(o) => { if (!o) setMarkPaidInvoice(null); }}
      >
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("invoices.markPaidConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {markPaidInvoice ? (
                <>{markPaidInvoice.invoiceNumber} · {fmtCurrency(markPaidInvoice.totalAmount)}</>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={async () => {
                if (!markPaidInvoice) return;
                try {
                  await api(`/api/invoices/${markPaidInvoice.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: "paid" }),
                  });
                  toast.success(t("invoices.markedPaid"));
                  setMarkPaidInvoice(null);
                  refresh();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : t("invoices.createFailed"));
                }
              }}
            >
              {t("invoices.markPaid")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Cancel confirm ─────────────────────────────────────────────── */}
      <AlertDialog
        open={!!cancelInvoice}
        onOpenChange={(o) => { if (!o) setCancelInvoice(null); }}
      >
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("invoices.cancelConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelInvoice ? (
                <>
                  {cancelInvoice.invoiceNumber} · {fmtCurrency(cancelInvoice.totalAmount)}
                  <br />
                  {t("invoices.cancelConfirmHint")}
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 text-white hover:bg-amber-700"
              onClick={async () => {
                if (!cancelInvoice) return;
                try {
                  await api(`/api/invoices/${cancelInvoice.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: "cancelled" }),
                  });
                  toast.success(t("invoices.cancelled"));
                  setCancelInvoice(null);
                  refresh();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : t("invoices.createFailed"));
                }
              }}
            >
              {t("invoices.cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete confirm ─────────────────────────────────────────────── */}
      <AlertDialog
        open={!!deleteInvoice}
        onOpenChange={(o) => { if (!o) setDeleteInvoice(null); }}
      >
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("invoices.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteInvoice ? (
                <>
                  {deleteInvoice.invoiceNumber} · {fmtCurrency(deleteInvoice.totalAmount)}
                  <br />
                  {t("invoices.deleteConfirmHint")}
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={async () => {
                if (!deleteInvoice) return;
                try {
                  await api(`/api/invoices/${deleteInvoice.id}`, { method: "DELETE" });
                  toast.success(t("invoices.deleted"));
                  setDeleteInvoice(null);
                  refresh();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : t("invoices.deleteFailed"));
                }
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoice detail Sheet — renders the parsed line items + totals. Fetched via
// the GET /api/invoices/[id] route, which returns `items` already parsed out
// of itemsJson.
// ─────────────────────────────────────────────────────────────────────────────
function InvoiceDetailSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { format: fmtCurrency } = useCurrencyFormat();
  const { data, loading } = useApi<{ invoice: InvoiceDetail }>(`/api/invoices/${id}`);
  const inv = data?.invoice;

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="glass-strong w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="text-left">
          <SheetTitle className="text-lg">
            {loading || !inv ? "Loading…" : inv.invoiceNumber}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("invoices.title")}
          </SheetDescription>
        </SheetHeader>

        {!loading && inv ? (
          <div className="space-y-4 px-4 pb-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusChipClass(inv.status)}`}
              >
                {statusLabel(t, inv.status)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {inv.client?.name ?? "—"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <DetailRow label={t("invoices.issueDate")} value={formatDate(inv.issueDate)} />
              <DetailRow label={t("invoices.dueDate")} value={formatDate(inv.dueDate)} />
              <DetailRow label={t("invoices.placeOfSupply")} value={inv.placeOfSupply ?? "—"} />
              <DetailRow label={t("invoices.gstRate")} value={`${inv.gstRate}%`} />
            </div>

            <div className="rounded-2xl border border-border/60 bg-card/40">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">#</TableHead>
                    <TableHead className="text-xs">{t("invoices.description")}</TableHead>
                    <TableHead className="text-xs">{t("invoices.hsnCode")}</TableHead>
                    <TableHead className="text-right text-xs">{t("invoices.quantity")}</TableHead>
                    <TableHead className="text-right text-xs">{t("invoices.rate")}</TableHead>
                    <TableHead className="text-right text-xs">{t("invoices.amount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(inv.items ?? []).map((it, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-xs">{it.description}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{it.hsnCode ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs">{it.quantity}</TableCell>
                      <TableCell className="text-right text-xs">{fmtCurrency(it.rate)}</TableCell>
                      <TableCell className="text-right text-xs font-medium">{fmtCurrency(it.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="ml-auto w-full max-w-xs space-y-1.5 text-xs">
              <DetailRow label={t("invoices.subtotalLabel")} value={fmtCurrency(inv.subtotal)} />
              <DetailRow
                label={`${t("invoices.gstLabel")} (${inv.gstRate}%)`}
                value={fmtCurrency(inv.gstAmount)}
              />
              <DetailRow label={t("invoices.roundOff")} value={fmtCurrency(inv.roundOff)} />
              <div className="flex items-center justify-between border-t border-border/60 pt-2 text-sm font-bold">
                <span>{t("invoices.totalLabel")}</span>
                <span>{fmtCurrency(inv.totalAmount)}</span>
              </div>
            </div>

            {inv.notes ? (
              <div className="rounded-lg border border-border/50 bg-card/40 p-3 text-xs text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">{t("invoices.notes")}</p>
                {inv.notes}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  window.open(`/api/reports?type=invoice&invoiceId=${inv.id}`, "_blank")
                }
              >
                <Printer className="mr-1.5 size-3.5" />
                {t("invoices.viewPdf")}
              </Button>
              {inv.status === "pending" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10"
                  onClick={async () => {
                    try {
                      await api(`/api/invoices/${inv.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ status: "paid" }),
                      });
                      toast.success(t("invoices.markedPaid"));
                      onClose();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : t("invoices.createFailed"));
                    }
                  }}
                >
                  <Check className="mr-1.5 size-3.5" />
                  {t("invoices.markPaid")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Invoice dialog — dynamic line-items editor + live totals preview.
// Submits POST /api/invoices. Server recomputes totals (never trusts
// client-supplied subtotal/GST/total), but we still show the preview so the
// broker sees the exact numbers that will be persisted.
// ─────────────────────────────────────────────────────────────────────────────
type DraftItem = {
  description: string;
  hsnCode: string;
  quantity: string;
  rate: string;
};

function CreateInvoiceDialog({
  clients,
  onDone,
}: {
  clients: Client[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { format: fmtCurrency } = useCurrencyFormat();

  const today = new Date().toISOString().slice(0, 10);

  const [clientId, setClientId] = React.useState("");
  const [issueDate, setIssueDate] = React.useState(today);
  const [dueDate, setDueDate] = React.useState("");
  const [gstRate, setGstRate] = React.useState("5");
  const [placeOfSupply, setPlaceOfSupply] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [items, setItems] = React.useState<DraftItem[]>([
    { description: "", hsnCode: "9985", quantity: "1", rate: "" },
  ]);
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const updateItem = (i: number, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };

  const addItem = () => {
    setItems((prev) => [...prev, { description: "", hsnCode: "9985", quantity: "1", rate: "" }]);
  };

  const removeItem = (i: number) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  };

  // ── Live totals preview ─────────────────────────────────────────────────
  // Computed via useMemo so a keystroke in any input instantly updates the
  // Subtotal / GST / Round Off / Total lines at the bottom of the dialog.
  const totals = React.useMemo(() => {
    let subtotal = 0;
    for (const it of items) {
      const qty = Number(it.quantity) || 0;
      const rate = Number(it.rate) || 0;
      subtotal += qty * rate;
    }
    const rate = Number(gstRate) || 0;
    const gstAmount = subtotal * (rate / 100);
    const rawTotal = subtotal + gstAmount;
    const totalAmount = Math.round(rawTotal);
    const roundOff = totalAmount - rawTotal;
    return { subtotal, gstAmount, roundOff, totalAmount };
  }, [items, gstRate]);

  const submit = async () => {
    // Client-side guard: a client is required, every item needs a description,
    // and rate/qty must parse to positive numbers. The server re-validates via
    // Zod, but failing fast here avoids a wasted round-trip + gives the broker
    // an inline error rather than a Zod flatten dump.
    if (!clientId) {
      setFormError(t("invoices.clientRequired"));
      toast.error(t("invoices.clientRequired"));
      return;
    }
    for (const it of items) {
      if (!it.description.trim()) {
        setFormError(t("invoices.description"));
        toast.error(t("common.fixFields"));
        return;
      }
      if (!(Number(it.quantity) > 0)) {
        setFormError(t("invoices.quantity"));
        toast.error(t("common.fixFields"));
        return;
      }
      if (Number(it.rate) < 0 || !Number.isFinite(Number(it.rate))) {
        setFormError(t("invoices.rate"));
        toast.error(t("common.fixFields"));
        return;
      }
    }
    setFormError(null);
    setSaving(true);
    try {
      const payload = {
        clientId,
        issueDate: new Date(issueDate).toISOString(),
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        items: items.map((it) => ({
          description: it.description.trim(),
          hsnCode: it.hsnCode.trim() || "9985",
          quantity: Number(it.quantity),
          rate: Number(it.rate),
        })),
        gstRate: Number(gstRate),
        notes: notes.trim() || null,
        placeOfSupply: placeOfSupply.trim() || null,
      };
      const res = await api<{ invoice: Invoice }>("/api/invoices", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast.success(`${t("invoices.created")} — ${res.invoice.invoiceNumber}`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("invoices.createFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="glass-strong max-h-[88vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("invoices.createTitle")}</DialogTitle>
        <DialogDescription>{t("invoices.createDescription")}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`${t("invoices.client")} *`}>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue placeholder={t("invoices.allClients")} />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("invoices.issueDate")} *`}>
              <Input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </Field>
            <Field label={t("invoices.dueDate")}>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Field>
          </div>
        </div>

        {/* ── Line items editor ────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">
              {t("invoices.items")}
            </Label>
            <Button size="sm" variant="outline" onClick={addItem} type="button">
              <Plus className="mr-1.5 size-3.5" />
              {t("invoices.addItem")}
            </Button>
          </div>

          <div className="space-y-2">
            {items.map((it, i) => {
              const qty = Number(it.quantity) || 0;
              const rate = Number(it.rate) || 0;
              const amount = qty * rate;
              return (
                <div
                  key={i}
                  className="rounded-xl border border-border/60 bg-card/40 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      #{i + 1}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="size-7 p-0 text-rose-500 hover:bg-rose-500/10"
                      onClick={() => removeItem(i)}
                      disabled={items.length === 1}
                      aria-label={t("common.delete")}
                      type="button"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                    <div className="sm:col-span-6">
                      <Label className="sr-only">{t("invoices.description")}</Label>
                      <Input
                        value={it.description}
                        onChange={(e) => updateItem(i, { description: e.target.value })}
                        placeholder={t("invoices.descriptionPlaceholder")}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="sr-only">{t("invoices.hsnCode")}</Label>
                      <Input
                        value={it.hsnCode}
                        onChange={(e) => updateItem(i, { hsnCode: e.target.value })}
                        placeholder="9985"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="sr-only">{t("invoices.quantity")}</Label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={it.quantity}
                        onChange={(e) => updateItem(i, { quantity: e.target.value })}
                        placeholder="1"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="sr-only">{t("invoices.rate")}</Label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={it.rate}
                        onChange={(e) => updateItem(i, { rate: e.target.value })}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-end text-xs text-muted-foreground">
                    <span className="mr-1">{t("invoices.amount")}:</span>
                    <span className="font-medium text-foreground">{fmtCurrency(amount)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("invoices.gstRate")}>
            <Input
              type="number"
              min={0}
              step="any"
              value={gstRate}
              onChange={(e) => setGstRate(e.target.value)}
            />
          </Field>
          <Field label={t("invoices.placeOfSupply")}>
            <Input
              value={placeOfSupply}
              onChange={(e) => setPlaceOfSupply(e.target.value)}
              placeholder={t("invoices.placeOfSupplyPlaceholder")}
            />
          </Field>
        </div>

        <Field label={t("invoices.notes")}>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("invoices.notesPlaceholder")}
            rows={2}
          />
        </Field>

        {/* ── Live totals preview ─────────────────────────────────────── */}
        <div className="ml-auto w-full max-w-xs space-y-1.5 rounded-xl border border-border/60 bg-card/40 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("invoices.subtotalLabel")}</span>
            <span className="font-medium text-foreground">{fmtCurrency(totals.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {t("invoices.gstLabel")} ({gstRate || 0}%)
            </span>
            <span className="font-medium text-foreground">{fmtCurrency(totals.gstAmount)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("invoices.roundOff")}</span>
            <span className="font-medium text-foreground">{fmtCurrency(totals.roundOff)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-border/60 pt-1.5 text-sm font-bold">
            <span>{t("invoices.totalLabel")}</span>
            <span>{fmtCurrency(totals.totalAmount)}</span>
          </div>
        </div>

        {formError ? (
          <p className="inline-flex items-center gap-1 text-xs text-rose-500">
            <AlertCircle className="size-3" />
            {formError}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button onClick={submit} disabled={saving}>
          {saving ? t("invoices.creating") : t("invoices.createAction")}
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
