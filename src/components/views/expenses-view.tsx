"use client";

import * as React from "react";
import {
  ReceiptIndianRupee, Plus, Download, Trash2, Pencil, Search, CalendarDays,
  TrendingDown, CalendarRange, Crown, X, AlertCircle,
} from "lucide-react";
import { useApi, api } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { GlassCard, SectionHeader, StatusChip, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { useUI } from "@/lib/ui-store";
import { useUrlState } from "@/hooks/use-url-state";
import { useTranslation } from "@/hooks/use-translation";
import { usePagination } from "@/hooks/use-pagination";
import { PaginationBar } from "@/components/pagination-bar";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { ShareLinkButton } from "@/components/share-link-button";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Categories — mirrors the server enum from /api/expenses/route.ts. Kept in
// sync so the Select dropdown + the chip color map show every valid value
// (and no more).
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORIES = [
  "travel",
  "phone",
  "staff_salary",
  "office_rent",
  "marketing",
  "miscellaneous",
] as const;
type Category = (typeof CATEGORIES)[number];

// Per-category Tailwind chip colors. Matches the design spec exactly:
// travel=teal, phone=teal, staff_salary=emerald, office_rent=amber,
// marketing=plum (using `purple` — closest default Tailwind shade to the
// chart-5 plum token), miscellaneous=zinc.
const CATEGORY_COLORS: Record<Category, string> = {
  travel: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30",
  phone: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30",
  staff_salary: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  office_rent: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  marketing: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
  miscellaneous: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30",
};

// Friendly category labels — used in dropdowns + the table chip. Title-cased
// snake_case so "staff_salary" renders as "Staff Salary".
function categoryLabel(c: string): string {
  return titleCase(c);
}

type Expense = {
  id: string;
  category: string;
  amount: number;
  date: string;
  description: string | null;
  vendor: string | null;
  receiptUrl: string | null;
  createdAt: string;
};

type Summary = {
  total: number;
  byCategory: Record<string, number>;
};

export function ExpensesView() {
  const { t } = useTranslation();
  const { data, loading, refresh } = useApi<{ expenses: Expense[]; summary: Summary }>(
    "/api/expenses",
  );
  const { format: fmtCurrency } = useCurrencyFormat();
  const { newEntityTrigger } = useUI();

  // URL-persisted filters so a refresh or shared link preserves them.
  // `c` = category, `q` = search text, `from`/`to` = ISO date range.
  const [q, setQ] = useUrlState<string>("q", "");
  const [categoryFilter, setCategoryFilter] = useUrlState<string>("c", "all");
  const [from, setFrom] = useUrlState<string>("from", "");
  const [to, setTo] = useUrlState<string>("to", "");

  const [addOpen, setAddOpen] = React.useState(false);
  const [editExpense, setEditExpense] = React.useState<Expense | null>(null);
  const [deleteExpense, setDeleteExpense] = React.useState<Expense | null>(null);

  // Auto-open the "Add Expense" dialog when the user fires the "n e" shortcut.
  React.useEffect(() => {
    if (newEntityTrigger?.view === "expenses") {
      setAddOpen(true);
    }
  }, [newEntityTrigger]);

  const expenses = data?.expenses ?? [];
  const summary = data?.summary ?? { total: 0, byCategory: {} as Record<string, number> };

  // ── KPI roll-ups ─────────────────────────────────────────────────────────
  // Computed client-side from the (unfiltered-by-default) list — but the
  // category filter / date range are explicit user intent, so the KPIs
  // reflect the *current month + year-to-date* regardless of the active
  // filter bar.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const inRange = (e: Expense, start: Date, end: Date) => {
    const d = new Date(e.date);
    return d >= start && d <= end;
  };
  const thisMonth = expenses
    .filter((e) => inRange(e, monthStart, now))
    .reduce((s, e) => s + e.amount, 0);
  const lastMonth = expenses
    .filter((e) => inRange(e, lastMonthStart, lastMonthEnd))
    .reduce((s, e) => s + e.amount, 0);
  const ytd = expenses
    .filter((e) => inRange(e, yearStart, now))
    .reduce((s, e) => s + e.amount, 0);

  // Top category — the highest-spend category in the byCategory roll-up.
  const topCategory = React.useMemo(() => {
    const entries = Object.entries(summary.byCategory).filter(([, v]) => v > 0);
    if (entries.length === 0) return null;
    return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
  }, [summary.byCategory]);

  // ── Filtered rows (category + date range + search) ───────────────────────
  const filtered = expenses.filter((e) => {
    if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
    if (from) {
      const fd = new Date(from);
      if (!Number.isNaN(fd.getTime()) && new Date(e.date) < fd) return false;
    }
    if (to) {
      const td = new Date(to);
      if (!Number.isNaN(td.getTime())) {
        td.setHours(23, 59, 59, 999);
        if (new Date(e.date) > td) return false;
      }
    }
    const s = q.toLowerCase();
    if (s) {
      const matches =
        (e.description ?? "").toLowerCase().includes(s) ||
        (e.vendor ?? "").toLowerCase().includes(s) ||
        e.category.toLowerCase().includes(s);
      if (!matches) return false;
    }
    return true;
  });

  const {
    paginated, currentPage, totalPages, size, setPage, setSize, range,
  } = usePagination<Expense>(filtered, 10);

  // Reset to page 1 whenever any filter changes so the broker doesn't land on
  // a page that no longer exists.
  React.useEffect(() => { setPage(1); }, [q, categoryFilter, from, to, setPage]);

  const clearFilters = () => {
    setQ("");
    setCategoryFilter("all");
    setFrom("");
    setTo("");
  };

  const hasActiveFilters =
    q !== "" || categoryFilter !== "all" || from !== "" || to !== "";

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t("expenses.title")}
        description={t("expenses.subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ShareLinkButton />
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open("/api/export?type=expenses", "_blank")}
            >
              <Download className="mr-1.5 size-4" />
              {t("common.export")}
            </Button>
            <Button
              size="sm"
              onClick={() => { setEditExpense(null); setAddOpen(true); }}
            >
              <Plus className="mr-1.5 size-4" />
              {t("expenses.add")}
            </Button>
            <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setEditExpense(null); }}>
              <ExpenseDialog
                editing={editExpense}
                onDone={() => { setAddOpen(false); setEditExpense(null); refresh(); }}
              />
            </Dialog>
          </div>
        }
      />

      {/* ── KPI strip ─────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiMini
          icon={<CalendarDays className="size-4" />}
          label={t("expenses.thisMonth")}
          value={fmtCurrency(thisMonth, { compact: true })}
          sub={now.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          tone="emerald"
        />
        <KpiMini
          icon={<TrendingDown className="size-4" />}
          label={t("expenses.lastMonth")}
          value={fmtCurrency(lastMonth, { compact: true })}
          sub={lastMonthStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          tone="teal"
        />
        <KpiMini
          icon={<CalendarRange className="size-4" />}
          label={t("expenses.ytd")}
          value={fmtCurrency(ytd, { compact: true })}
          sub={`${now.getFullYear()} · ${fmtCurrency(ytd)}`}
        />
        <KpiMini
          icon={<Crown className="size-4" />}
          label={t("expenses.topCategory")}
          value={topCategory ? categoryLabel(topCategory[0]) : "—"}
          sub={topCategory ? fmtCurrency(topCategory[1]) : t("expenses.noExpensesYet")}
          tone="amber"
        />
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <GlassCard className="p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("expenses.searchPlaceholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="border-0 bg-transparent pl-9 shadow-none focus-visible:ring-1"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue placeholder={t("expenses.allCategories")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("expenses.allCategories")}</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 w-[150px]"
              aria-label={t("expenses.from")}
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 w-[150px]"
              aria-label={t("expenses.to")}
            />
            {hasActiveFilters ? (
              <Button size="sm" variant="ghost" className="h-9" onClick={clearFilters}>
                <X className="mr-1 size-3.5" />
                {t("common.clear")}
              </Button>
            ) : null}
          </div>
        </div>
        {hasActiveFilters ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/40 px-2 py-0.5">
              {categoryFilter !== "all" ? (
                <span>{t("expenses.category")}: {categoryLabel(categoryFilter)}</span>
              ) : (
                <span>{t("expenses.allCategories")}</span>
              )}
            </span>
            {(from || to) ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/40 px-2 py-0.5">
                {from || "…"} → {to || "…"}
              </span>
            ) : null}
            {q ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/40 px-2 py-0.5">
                “{q}”
              </span>
            ) : null}
          </div>
        ) : null}
      </GlassCard>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <PullToRefresh onRefresh={refresh}>
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}</div>
        ) : filtered.length === 0 ? (
          <GlassCard className="p-8">
            <EmptyState
              title={t("expenses.noExpensesYet")}
              hint={t("expenses.noExpensesHint")}
              icon={<ReceiptIndianRupee className="size-5" />}
            />
          </GlassCard>
        ) : (
          <>
            <GlassCard className="overflow-hidden p-0">
              <div className="max-h-[70vh] overflow-x-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                    <TableRow>
                      <TableHead className="pl-4">{t("expenses.date")}</TableHead>
                      <TableHead>{t("expenses.category")}</TableHead>
                      <TableHead>{t("expenses.description")}</TableHead>
                      <TableHead>{t("expenses.vendor")}</TableHead>
                      <TableHead className="text-right">{t("expenses.amount")}</TableHead>
                      <TableHead className="pr-4 text-right">{t("expenses.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.map((e) => (
                      <TableRow
                        key={e.id}
                        className="cursor-pointer"
                        onClick={() => { setEditExpense(e); setAddOpen(true); }}
                      >
                        <TableCell className="pl-4 whitespace-nowrap font-medium text-foreground">
                          {formatDate(e.date)}
                        </TableCell>
                        <TableCell>
                          <CategoryChip category={e.category} />
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-muted-foreground">
                          {e.description ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-[160px] truncate text-muted-foreground">
                          {e.vendor ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-bold text-foreground whitespace-nowrap">
                          {fmtCurrency(e.amount)}
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <div className="flex items-center justify-end gap-1" onClick={(e2) => e2.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-8 p-0"
                              aria-label={t("common.edit")}
                              onClick={() => { setEditExpense(e); setAddOpen(true); }}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-8 p-0 text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
                              aria-label={t("common.delete")}
                              onClick={() => setDeleteExpense(e)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
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

      {/* ── Delete confirm ────────────────────────────────────────────────── */}
      <AlertDialog
        open={!!deleteExpense}
        onOpenChange={(o) => { if (!o) setDeleteExpense(null); }}
      >
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("expenses.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteExpense ? (
                <>
                  {fmtCurrency(deleteExpense.amount)} · {categoryLabel(deleteExpense.category)}
                  {deleteExpense.vendor ? ` · ${deleteExpense.vendor}` : ""}
                  <br />
                  {t("expenses.deleteConfirmHint")}
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={async () => {
                if (!deleteExpense) return;
                try {
                  await api(`/api/expenses/${deleteExpense.id}`, { method: "DELETE" });
                  toast.success(t("expenses.deleted"));
                  setDeleteExpense(null);
                  refresh();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : t("expenses.deleteFailed"));
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

// CategoryChip — colored chip per the design spec. Uses CATEGORY_COLORS for
// the explicit per-category palette (teal / emerald / amber / plum / zinc).
// Falls back to the muted primary palette if an unknown category sneaks in.
function CategoryChip({ category }: { category: string }) {
  const isKnown = (CATEGORIES as readonly string[]).includes(category);
  const colorClass = isKnown
    ? CATEGORY_COLORS[category as Category]
    : "bg-primary/10 text-primary border-primary/25";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${colorClass}`}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {categoryLabel(category)}
    </span>
  );
}

function KpiMini({
  icon, label, value, sub, tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "emerald" | "amber" | "teal";
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
          {sub ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p> : null}
        </div>
        <div className={`grid size-9 shrink-0 place-items-center rounded-xl ${iconWrap}`}>{icon}</div>
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add / Edit dialog — same form, different submit verb. When `editing` is
// provided we PATCH /api/expenses/[id]; otherwise we POST /api/expenses.
// ─────────────────────────────────────────────────────────────────────────────
function ExpenseDialog({
  editing,
  onDone,
}: {
  editing: Expense | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { format: fmtCurrency } = useCurrencyFormat();

  const [category, setCategory] = React.useState<Category>("travel");
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = React.useState("");
  const [vendor, setVendor] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({});

  // Pre-fill the form when editing. Re-runs whenever `editing` changes — e.g.
  // the broker clicks Edit on a row while the dialog is already open.
  React.useEffect(() => {
    if (editing) {
      setCategory(editing.category as Category);
      setAmount(String(editing.amount));
      setDate(new Date(editing.date).toISOString().slice(0, 10));
      setDescription(editing.description ?? "");
      setVendor(editing.vendor ?? "");
    } else {
      setCategory("travel");
      setAmount("");
      setDate(new Date().toISOString().slice(0, 10));
      setDescription("");
      setVendor("");
    }
    setFormErrors({});
  }, [editing]);

  const submit = async () => {
    const amt = Number(amount);
    const errors: Record<string, string> = {};
    if (!Number.isFinite(amt) || amt <= 0) errors.amount = t("expenses.amountInvalid");
    if (!date) errors.date = t("expenses.dateInvalid");
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      toast.error(t("common.fixFields"));
      return;
    }
    setFormErrors({});
    setSaving(true);
    try {
      const payload = {
        category,
        amount: amt,
        date: new Date(date).toISOString(),
        description: description.trim() || null,
        vendor: vendor.trim() || null,
      };
      if (editing) {
        const res = await api<{ expense: Expense }>(
          `/api/expenses/${editing.id}`,
          { method: "PATCH", body: JSON.stringify(payload) },
        );
        toast.success(`${t("expenses.updated")} — ${fmtCurrency(res.expense.amount)}`);
      } else {
        const res = await api<{ expense: Expense }>(
          "/api/expenses",
          { method: "POST", body: JSON.stringify(payload) },
        );
        toast.success(`${t("expenses.recorded")} — ${fmtCurrency(res.expense.amount)}`);
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("expenses.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="glass-strong max-h-[92vh] max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{editing ? t("expenses.edit") : t("expenses.add")}</DialogTitle>
        <DialogDescription className="sr-only">
          {editing
            ? t("expenses.editDescription")
            : t("expenses.addDescription")}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <Field label={`${t("expenses.category")} *`}>
          <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  <span className="inline-flex items-center gap-2">
                    <span className={`size-1.5 rounded-full ${CATEGORY_COLORS[c].split(" ")[0]}`} />
                    {categoryLabel(c)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("expenses.amount")} *`} error={formErrors.amount}>
            <Input
              type="number"
              min={0}
              step="any"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setFormErrors((p) => { if (!p.amount) return p; const n = { ...p }; delete n.amount; return n; });
              }}
              placeholder="0"
              className={formErrors.amount ? "border-rose-500 focus-visible:ring-rose-500" : ""}
            />
          </Field>
          <Field label={`${t("expenses.date")} *`} error={formErrors.date}>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={formErrors.date ? "border-rose-500 focus-visible:ring-rose-500" : ""}
            />
          </Field>
        </div>

        <Field label={t("expenses.vendor")}>
          <Input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder={t("expenses.vendorPlaceholder")}
          />
        </Field>

        <Field label={t("expenses.description")}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("expenses.descriptionPlaceholder")}
            rows={3}
          />
        </Field>

        {/* StatusChip — surfaces the chosen category as a chip preview so the
            broker sees the exact color the row will render with. */}
        <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">{t("expenses.preview")}:</span>
          <StatusChip status={category} />
          <span className="ml-auto text-muted-foreground">
            {amount ? fmtCurrency(Number(amount)) : "—"}
          </span>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving}>
          {saving
            ? (editing ? t("expenses.saving") : t("expenses.recording"))
            : (editing ? t("common.save") : t("expenses.record"))}
        </Button>
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


