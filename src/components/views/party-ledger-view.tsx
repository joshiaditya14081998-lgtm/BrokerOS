"use client";

import * as React from "react";
import {
  BookOpen, Users, Factory, Receipt, Wallet, FileText, Truck, AlertTriangle,
  Download, Phone, Mail, MapPin, BadgeCheck, CalendarDays, X,
} from "lucide-react";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ToggleGroup, ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { useApi } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";
import { useCurrencyFormat } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirror the API response shape from /api/party-ledger.
// ─────────────────────────────────────────────────────────────────────────────

type PartyType = "client" | "supplier";

type LedgerEntryType = "bill" | "payment" | "po" | "dispatch" | "dispute";

type LedgerEntry = {
  date: string;
  type: LedgerEntryType;
  ref: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  meta?: Record<string, string | number | boolean | null> | undefined;
};

type PartyInfo = {
  id: string;
  name: string;
  type: PartyType;
  contactInfo: {
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    gstNo: string | null;
  };
};

type ClientStats = {
  totalBusiness: number;
  totalReceived: number;
  totalPayable: number;
  balance: number;
};

type SupplierStats = {
  totalSupplied: number;
  totalBrokerage: number;
  outstandingBrokerage: number;
  paidBrokerage: number;
};

type PartyLedgerResponse = {
  party: PartyInfo;
  ledger: LedgerEntry[];
  stats: ClientStats | SupplierStats;
};

type PartyOption = { id: string; name: string };

// ─────────────────────────────────────────────────────────────────────────────
// Per-type icon + accent mapping for the timeline.
// ─────────────────────────────────────────────────────────────────────────────

const ENTRY_ICON: Record<LedgerEntryType, React.ComponentType<{ className?: string }>> = {
  bill: Receipt,
  payment: Wallet,
  po: FileText,
  dispatch: Truck,
  dispute: AlertTriangle,
};

const ENTRY_BORDER: Record<LedgerEntryType, string> = {
  bill: "border-l-rose-500/60",
  payment: "border-l-emerald-500/60",
  po: "border-l-amber-500/60",
  dispatch: "border-l-teal-500/60",
  dispute: "border-l-zinc-500/60",
};

const ENTRY_ICON_BG: Record<LedgerEntryType, string> = {
  bill: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  payment: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  po: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  dispatch: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  dispute: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
};

const ENTRY_LABEL: Record<LedgerEntryType, string> = {
  bill: "Bill",
  payment: "Payment",
  po: "Purchase Order",
  dispatch: "Dispatch",
  dispute: "Dispute",
};

// ─────────────────────────────────────────────────────────────────────────────
// Main view.
// ─────────────────────────────────────────────────────────────────────────────

export function PartyLedgerView() {
  const { format: fmtCurrency } = useCurrencyFormat();
  const [partyType, setPartyType] = React.useState<PartyType>("client");
  const [partyId, setPartyId] = React.useState<string>("");
  const [fromDate, setFromDate] = React.useState<string>("");
  const [toDate, setToDate] = React.useState<string>("");

  // Reset party selection whenever the type toggles (client → supplier or
  // vice-versa) so we never send a stale cross-type id to the API.
  React.useEffect(() => {
    setPartyId("");
  }, [partyType]);

  // Fetch the list of parties for the active type — used to populate the
  // Select dropdown. We use the lightweight (non-`detail=true`) endpoints
  // since we only need {id, name}.
  const partiesPath = partyType === "client" ? "/api/clients" : "/api/suppliers";
  const { data: partiesData, loading: partiesLoading } = useApi<{ clients?: PartyOption[]; suppliers?: PartyOption[] }>(
    partiesPath,
  );
  const partyList: PartyOption[] = (partyType === "client" ? partiesData?.clients : partiesData?.suppliers) ?? [];

  // Fetch the ledger once a party is selected. We pass `null` while no party
  // is selected so `useApi` skips the request entirely (and `loading` flips
  // back to `false` immediately so we don't show the skeleton).
  const ledgerPath = partyId ? `/api/party-ledger?type=${partyType}&id=${partyId}` : null;
  const { data, loading, error } = useApi<PartyLedgerResponse>(ledgerPath);

  const party = data?.party;
  const ledger = data?.ledger ?? [];
  const stats = data?.stats;

  // Client-side date-range filter applied to the already-fetched ledger.
  // The API returns the full timeline; this just narrows what's rendered.
  const filteredLedger = React.useMemo(() => {
    if (!fromDate && !toDate) return ledger;
    const from = fromDate ? new Date(fromDate + "T00:00:00") : null;
    const to = toDate ? new Date(toDate + "T23:59:59.999") : null;
    return ledger.filter((e) => {
      const d = new Date(e.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [ledger, fromDate, toDate]);

  const hasFilter = !!fromDate || !!toDate;
  const clearFilter = () => {
    setFromDate("");
    setToDate("");
  };

  const exportUrl = partyId
    ? `/api/reports?type=party-ledger&partyType=${partyType}&partyId=${partyId}`
    : null;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Party Ledger"
        description="Universal transaction history — client or supplier"
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={!exportUrl}
            onClick={() => {
              if (exportUrl) window.open(exportUrl, "_blank", "noopener,noreferrer");
            }}
            title={exportUrl ? "Open the print-optimized PDF report in a new tab" : "Select a party first"}
          >
            <Download className="mr-1.5 size-4" />
            Export PDF
          </Button>
        }
      />

      {/* Filter bar — wraps on small screens. */}
      <GlassCard className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          {/* Party type toggle */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Party type
            </Label>
            <ToggleGroup
              type="single"
              value={partyType}
              onValueChange={(v) => { if (v === "client" || v === "supplier") setPartyType(v); }}
              size="sm"
              className="glass rounded-lg border border-border/60 p-0.5"
              aria-label="Party type"
            >
              <ToggleGroupItem
                value="client"
                aria-label="Client ledger"
                className="rounded-md px-3 text-xs font-medium data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-700 dark:data-[state=on]:text-emerald-300"
              >
                <Users className="mr-1.5 size-3.5" />
                Client
              </ToggleGroupItem>
              <ToggleGroupItem
                value="supplier"
                aria-label="Supplier ledger"
                className="rounded-md px-3 text-xs font-medium data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-700 dark:data-[state=on]:text-emerald-300"
              >
                <Factory className="mr-1.5 size-3.5" />
                Supplier
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* Party picker */}
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="party-select" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Select party
            </Label>
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger
                id="party-select"
                className="h-9 w-full lg:max-w-md"
                aria-label="Select party"
              >
                <SelectValue
                  placeholder={partiesLoading ? "Loading…" : `Choose a ${partyType}…`}
                />
              </SelectTrigger>
              <SelectContent>
                {partyList.length === 0 && !partiesLoading ? (
                  <SelectItem value="__none__" disabled>
                    No {partyType}s found
                  </SelectItem>
                ) : (
                  partyList.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Date range */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              From
            </Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-9 w-full lg:w-40"
              aria-label="Filter from date"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              To
            </Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-9 w-full lg:w-40"
              aria-label="Filter to date"
            />
          </div>
        </div>

        {hasFilter && (
          <div className="mt-3 flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            >
              <CalendarDays className="mr-1 size-3" />
              {fromDate || "∞"} → {toDate || "now"}
              <button
                type="button"
                onClick={clearFilter}
                aria-label="Clear date range filter"
                className="ml-1 inline-flex size-3.5 items-center justify-center rounded-full hover:bg-emerald-500/20"
              >
                <X className="size-3" />
              </button>
            </Badge>
          </div>
        )}
      </GlassCard>

      {/* Body: empty state | loading | party header + stats + timeline */}
      {!partyId ? (
        <EmptyState
          title="Select a client or supplier to view their ledger"
          hint="Use the filter bar above to pick a party. The full timeline — bills, payments, POs, dispatches, and disputes — appears below."
          icon={<BookOpen className="size-5" />}
        />
      ) : loading ? (
        <PartyLedgerSkeleton />
      ) : error ? (
        <GlassCard className="p-6">
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <AlertTriangle className="size-6 text-rose-500" />
            <p className="text-sm font-medium text-foreground">Failed to load ledger</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        </GlassCard>
      ) : !party ? (
        <EmptyState
          title="Party not found"
          hint="The selected party no longer exists. Pick another from the dropdown."
          icon={<AlertTriangle className="size-5" />}
        />
      ) : (
        <>
          <PartyHeaderCard party={party} />
          <StatsStrip type={party.type} stats={stats} fmtCurrency={fmtCurrency} />
          <LedgerTimeline
            entries={filteredLedger}
            fmtCurrency={fmtCurrency}
            hasFilter={hasFilter}
            totalCount={ledger.length}
          />
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Party header card — name, type badge, contact info.
// ─────────────────────────────────────────────────────────────────────────────

function PartyHeaderCard({ party }: { party: PartyInfo }) {
  const { contactInfo } = party;
  return (
    <GlassCard className="overflow-hidden p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-semibold text-foreground">{party.name}</h3>
            <Badge
              variant="outline"
              className={cn(
                "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              )}
            >
              {party.type === "client" ? (
                <><Users className="mr-1 size-3" />Client</>
              ) : (
                <><Factory className="mr-1 size-3" />Supplier</>
              )}
            </Badge>
          </div>
          {contactInfo.contactPerson && (
            <p className="mt-1 text-sm text-muted-foreground">{contactInfo.contactPerson}</p>
          )}
        </div>
        {contactInfo.gstNo && (
          <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 text-xs">
            <BadgeCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-muted-foreground">GST:</span>
            <span className="font-mono font-medium text-foreground">{contactInfo.gstNo}</span>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {contactInfo.phone && (
          <ContactItem icon={<Phone className="size-3.5" />} label="Phone" value={contactInfo.phone} />
        )}
        {contactInfo.email && (
          <ContactItem icon={<Mail className="size-3.5" />} label="Email" value={contactInfo.email} />
        )}
        {contactInfo.address && (
          <ContactItem icon={<MapPin className="size-3.5" />} label="Address" value={contactInfo.address} />
        )}
      </div>
    </GlassCard>
  );
}

function ContactItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-card/30 px-3 py-2">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="truncate text-xs font-medium text-foreground" title={value}>{value}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats strip — 4 KPI mini-cards, shape varies per party type.
// ─────────────────────────────────────────────────────────────────────────────

function StatsStrip({
  type,
  stats,
  fmtCurrency,
}: {
  type: PartyType;
  stats: ClientStats | SupplierStats | undefined;
  fmtCurrency: (n: number, opts?: { compact?: boolean }) => string;
}) {
  if (!stats) return null;

  if (type === "client") {
    const s = stats as ClientStats;
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiMini icon={<Receipt className="size-4" />} label="Total Business" value={fmtCurrency(s.totalBusiness, { compact: true })} hint="Sum of all bills raised" accent="default" />
        <KpiMini icon={<Wallet className="size-4" />} label="Total Received" value={fmtCurrency(s.totalReceived, { compact: true })} hint="Sum of all payments" accent="emerald" />
        <KpiMini icon={<AlertTriangle className="size-4" />} label="Outstanding" value={fmtCurrency(s.totalPayable, { compact: true })} hint="Pending receivable" accent="amber" />
        <KpiMini icon={<BadgeCheck className="size-4" />} label="Balance" value={fmtCurrency(s.balance, { compact: true })} hint="Final outstanding" accent={s.balance > 0 ? "rose" : "emerald"} />
      </div>
    );
  }
  const s = stats as SupplierStats;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiMini icon={<Truck className="size-4" />} label="Total Supplied" value={fmtCurrency(s.totalSupplied, { compact: true })} hint="Base amount (excl GST)" accent="default" />
      <KpiMini icon={<BadgeCheck className="size-4" />} label="Total Brokerage" value={fmtCurrency(s.totalBrokerage, { compact: true })} hint="Commission earned" accent="emerald" />
      <KpiMini icon={<AlertTriangle className="size-4" />} label="Outstanding Brokerage" value={fmtCurrency(s.outstandingBrokerage, { compact: true })} hint="Eligible, unpaid" accent="amber" />
      <KpiMini icon={<Wallet className="size-4" />} label="Paid Brokerage" value={fmtCurrency(s.paidBrokerage, { compact: true })} hint="Settled via payouts" accent="emerald" />
    </div>
  );
}

function KpiMini({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint: string;
  accent: "default" | "emerald" | "amber" | "rose";
}) {
  const accentClass: Record<string, string> = {
    default: "bg-primary/10 text-primary",
    emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    rose: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  };
  return (
    <GlassCard className="hover-lift p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="kpi-num mt-1.5 text-2xl font-light text-foreground">{value}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
        </div>
        <div className={`grid size-9 shrink-0 place-items-center rounded-xl ${accentClass[accent]}`}>
          {icon}
        </div>
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Vertical timeline — newest-first, color-coded by entry type.
// ─────────────────────────────────────────────────────────────────────────────

function LedgerTimeline({
  entries,
  fmtCurrency,
  hasFilter,
  totalCount,
}: {
  entries: LedgerEntry[];
  fmtCurrency: (n: number, opts?: { compact?: boolean }) => string;
  hasFilter: boolean;
  totalCount: number;
}) {
  if (entries.length === 0) {
    return (
      <GlassCard className="p-6">
        <EmptyState
          title={hasFilter ? "No entries in this date range" : "No ledger entries yet"}
          hint={
            hasFilter
              ? `Try widening the date range. ${totalCount} entr${totalCount === 1 ? "y" : "ies"} exist outside this window.`
              : "Once a bill, payment, PO, dispatch, or dispute is recorded for this party, it will appear here."
          }
          icon={<BookOpen className="size-5" />}
        />
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Transaction timeline</h3>
          <p className="text-xs text-muted-foreground">
            {entries.length} entr{entries.length === 1 ? "y" : "ies"}
            {hasFilter ? ` · filtered from ${totalCount}` : ""}
            {" · newest first"}
          </p>
        </div>
      </div>

      <ol className="relative">
        {entries.map((e, i) => (
          <TimelineEntry
            key={`${e.type}-${e.ref}-${e.date}-${i}`}
            entry={e}
            isLast={i === entries.length - 1}
            fmtCurrency={fmtCurrency}
          />
        ))}
      </ol>
    </GlassCard>
  );
}

function TimelineEntry({
  entry,
  isLast,
  fmtCurrency,
}: {
  entry: LedgerEntry;
  isLast: boolean;
  fmtCurrency: (n: number, opts?: { compact?: boolean }) => string;
}) {
  const Icon = ENTRY_ICON[entry.type];
  const hasAmount = entry.debit > 0 || entry.credit > 0;
  return (
    <li className="relative pl-9">
      {/* Spine + node */}
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[14px] top-7 bottom-0 w-px bg-border/60"
        />
      )}
      <span
        aria-hidden
        className={cn(
          "absolute left-1 top-1.5 grid size-7 place-items-center rounded-full ring-4 ring-background",
          ENTRY_ICON_BG[entry.type],
        )}
      >
        <Icon className="size-3.5" />
      </span>

      {/* Card */}
      <div
        className={cn(
          "mb-4 rounded-xl border border-border/50 border-l-4 bg-card/40 px-4 py-3 transition-colors hover:bg-card/60",
          ENTRY_BORDER[entry.type],
        )}
      >
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                {ENTRY_LABEL[entry.type]}
              </Badge>
              <span className="font-mono text-xs font-medium text-foreground/80" title={entry.ref}>
                {entry.ref}
              </span>
              <span className="text-[11px] text-muted-foreground">· {formatDate(entry.date)}</span>
            </div>
            <p className="mt-1 text-sm text-foreground">{entry.description}</p>
          </div>

          {/* Amount + balance column */}
          <div className="flex shrink-0 items-center gap-4 sm:flex-col sm:items-end sm:gap-0.5">
            {hasAmount ? (
              <div className="text-right">
                {entry.debit > 0 ? (
                  <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">
                    − {fmtCurrency(entry.debit, { compact: true })}
                  </p>
                ) : (
                  <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                    + {fmtCurrency(entry.credit, { compact: true })}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance</p>
              <p className="text-xs font-medium text-foreground">{fmtCurrency(entry.balance, { compact: true })}</p>
            </div>
          </div>
        </div>

        {/* Optional meta strip — show only for non-bill/payment types or when extra context is meaningful. */}
        {entry.meta && (entry.type === "dispatch" || entry.type === "dispute" || entry.type === "po") && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            {entry.meta.status != null && (
              <span className="rounded-full border border-border/60 bg-background/50 px-2 py-0.5 font-medium">
                {titleCase(String(entry.meta.status))}
              </span>
            )}
            {entry.meta.valueAffected != null && Number(entry.meta.valueAffected) > 0 && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
                Value affected: {fmtCurrency(Number(entry.meta.valueAffected), { compact: true })}
              </span>
            )}
            {entry.meta.dispatchedQty != null && Number(entry.meta.dispatchedQty) > 0 && (
              <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 font-medium text-teal-700 dark:text-teal-300">
                Qty: {formatNumberSafe(entry.meta.dispatchedQty)} sets
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function formatNumberSafe(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-IN").format(v);
}

function PartyLedgerSkeleton() {
  return (
    <div className="space-y-4">
      {/* Header card skeleton */}
      <GlassCard className="p-5 sm:p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      </GlassCard>

      {/* KPI strip skeleton */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>

      {/* Timeline skeleton */}
      <GlassCard className="p-4 sm:p-5">
        <div className="mb-4 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <Skeleton className="h-16 flex-1 rounded-xl" />
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
