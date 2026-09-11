"use client";

import * as React from "react";
import {
  Users, Factory, Store, Info, Package, Truck, Wallet,
  BadgePercent, Phone, Mail, MapPin, FileText, CalendarClock,
  CheckCircle2, Clock3, AlertCircle, ArrowRightCircle,
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from "recharts";
import { useApi } from "@/lib/api";
import { formatCurrency, formatDate, formatNumber, titleCase } from "@/lib/format";
import { GlassCard, KpiCard, SectionHeader, StatusChip, EmptyState } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

// ─────────────────────────────────────────────────────────────────────────────
// Types — match the portal API response shapes.
// ─────────────────────────────────────────────────────────────────────────────
type Persona = "supplier" | "client";

type SupplierProfile = {
  id: string; name: string; contactPerson: string | null; phone: string | null;
  email: string | null; address: string | null; gstNo: string | null;
  defaultCommissionRate: number; defaultGstRate: number; notes: string | null;
  createdAt: string;
};

type ClientProfile = {
  id: string; name: string; contactPerson: string | null; phone: string | null;
  email: string | null; address: string | null; gstNo: string | null;
  defaultPaymentCycleDays: number; payoutCadence: string; gstRate: number;
  notes: string | null; createdAt: string;
};

type SupplierPerformance = {
  fulfillment: number;
  onTimeRate: number;
  shortShipmentRate: number;
  totalSupplied: number;
  brokerageEarned: number;
  outstandingBrokerage: number;
  paidBrokerage: number;
  poCount: number;
  dispatchCount: number;
};

type ClientSummary = {
  totalBusiness: number;
  outstanding: number;
  totalPaid: number;
  brokerageEarned: number;
  brokeragePaid: number;
  billCount: number;
  poCount: number;
};

type PoAwaitingDispatch = {
  id: string; poNumber: string; buyer: string; status: string;
  orderedQty: number; dispatchedQty: number;
  expectedDispatchDate: string | null; revisedDispatchDate: string | null;
  billStatus: string | null; createdAt: string;
};

type RecentDispatch = {
  id: string; poNumber: string; buyer: string; dispatchDate: string;
  dispatchedQty: number; orderedQty: number; status: string;
};

type BrokerageEntry = {
  id: string; billNumber: string; buyer?: string; supplier?: string;
  baseAmount: number; commissionRate: number; brokerageAmount: number;
  eligible: boolean; payoutStatus: string; eligibleAt: string | null;
  createdAt: string;
  payout?: { id: string; status: string; paidAt: string | null; totalAmount: number } | null;
};

type OutstandingBill = {
  id: string; billNumber: string; poNumber: string; supplier: string;
  finalAmount: number; paidAmount: number; dueAmount: number; status: string;
  createdAt: string; dueDate: string; overdue: boolean;
};

type PaymentHistoryEntry = {
  id: string; billNumber: string; poNumber: string;
  amount: number; date: string; mode: string; reference: string | null;
};

type MyOrder = {
  id: string; poNumber: string; supplier: string; status: string;
  orderedQty: number; dispatchedQty: number; fulfillment: number;
  expectedDispatchDate: string | null; revisedDispatchDate: string | null;
  lastDispatch: string | null; billStatus: string | null;
  finalAmount: number; paidAmount: number; createdAt: string;
};

type RecentDelivery = {
  id: string; poNumber: string; supplier: string; dispatchDate: string;
  dispatchedQty: number; orderedQty: number; status: string;
};

type SupplierPortalData = {
  persona: "supplier";
  profile: SupplierProfile;
  performance: SupplierPerformance;
  sections: {
    posAwaitingDispatch: PoAwaitingDispatch[];
    recentDispatches: RecentDispatch[];
    brokerage: BrokerageEntry[];
  };
};

type ClientPortalData = {
  persona: "client";
  profile: ClientProfile;
  summary: ClientSummary;
  sections: {
    myOrders: MyOrder[];
    outstandingBills: OutstandingBill[];
    paymentHistory: PaymentHistoryEntry[];
    recentDeliveries: RecentDelivery[];
    brokerage: BrokerageEntry[];
  };
};

type PortalData = SupplierPortalData | ClientPortalData;

// Re-export portal types + dashboard components so the real `/portal` login
// route (Task S3B) can reuse these dashboards without re-implementing them.
export type {
  Persona,
  SupplierProfile,
  ClientProfile,
  SupplierPerformance,
  ClientSummary,
  PoAwaitingDispatch,
  RecentDispatch,
  BrokerageEntry,
  OutstandingBill,
  PaymentHistoryEntry,
  MyOrder,
  RecentDelivery,
  SupplierPortalData,
  ClientPortalData,
  PortalData,
};

// Emerald / teal / amber / rose chart palette — no indigo/blue.
const PIE_COLORS = ["oklch(0.7 0.15 162)", "oklch(0.78 0.14 85)", "oklch(0.65 0.2 27)", "oklch(0.7 0.02 165)"];

type Option = { id: string; name: string };

// ─────────────────────────────────────────────────────────────────────────────
// Main portal view
// ─────────────────────────────────────────────────────────────────────────────
export function PortalView() {
  const { t } = useTranslation();
  const [persona, setPersona] = useStateWithUrl<Persona>("supplier", "persona");
  const [entityId, setEntityId] = useStateWithUrl<string>("", "id");

  // Fetch the picker list for the active persona.
  const pickerPath = persona === "supplier" ? "/api/suppliers" : "/api/clients";
  const { data: pickerData, loading: pickerLoading } = useApi<{ suppliers?: Option[]; clients?: Option[] }>(pickerPath);
  const options: Option[] = (persona === "supplier" ? pickerData?.suppliers : pickerData?.clients) ?? [];

  // Auto-pick the first entity when the list arrives and nothing is selected
  // (or when the persona switches and the current id no longer applies).
  // We intentionally key on options.length rather than options (a fresh array
  // each render) to avoid an infinite update loop.
  React.useEffect(() => {
    if (options.length === 0) return;
    if (!entityId || !options.some((o) => o.id === entityId)) {
      setEntityId(options[0].id);
    }
  }, [persona, options.length, entityId, options, setEntityId]);

  // Fetch the portal payload only when both persona + id are set.
  const portalPath = entityId ? `/api/portal?persona=${persona}&id=${entityId}` : null;
  const { data, loading, error } = useApi<PortalData>(portalPath);

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("portals.title")}
        description={t("portals.subtitle")}
        action={
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <Info className="size-3" />
            {t("portals.readOnlyMockup")}
          </Badge>
        }
      />

      {/* Preview-mode info banner */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="font-semibold">{t("portals.previewMode")} —</span> This is a read-only mockup of the supplier/client
          portal experience. In production, each party would log in to see only their own data.
        </p>
      </div>

      {/* Persona switcher + entity picker */}
      <GlassCard className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="w-full lg:max-w-sm">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("portals.viewAs")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <PersonaButton
                active={persona === "supplier"}
                onClick={() => setPersona("supplier")}
                icon={<Factory className="size-4" />}
                label={t("portals.supplierPortal")}
              />
              <PersonaButton
                active={persona === "client"}
                onClick={() => setPersona("client")}
                icon={<Users className="size-4" />}
                label={t("portals.clientPortal")}
              />
            </div>
          </div>
          <div className="w-full lg:max-w-sm">
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {persona === "supplier" ? "Select supplier" : "Select client"}
            </label>
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger className="w-full" disabled={pickerLoading || options.length === 0}>
                <SelectValue
                  placeholder={pickerLoading ? "Loading…" : options.length === 0 ? "No records" : "Pick one…"}
                />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </GlassCard>

      {/* Portal dashboard body */}
      {!entityId ? (
        <EmptyState
          title={persona === "supplier" ? "No supplier selected" : "No client selected"}
          hint="Use the picker above to choose a record to preview as."
          icon={<Store className="size-5" />}
        />
      ) : loading ? (
        <PortalSkeleton persona={persona} />
      ) : error ? (
        <EmptyState
          title="Couldn't load portal data"
          hint={error}
          icon={<AlertCircle className="size-5" />}
        />
      ) : !data ? (
        <EmptyState title="No data" icon={<Store className="size-5" />} />
      ) : persona === "supplier" && data.persona === "supplier" ? (
        <SupplierPortalDashboard data={data} />
      ) : persona === "client" && data.persona === "client" ? (
        <ClientPortalDashboard data={data} />
      ) : (
        <PortalSkeleton persona={persona} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────
function PersonaButton({
  active, onClick, icon, label,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all",
        active
          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 shadow-sm dark:text-emerald-300"
          : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70 hover:text-foreground",
      )}
    >
      <span className={cn(active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

// Tiny URL-synced state hook so the persona + entity survive navigations away
// and back via the sidebar (the picker state stays scoped to this view).
function useStateWithUrl<T>(initial: T, _key: string): [T, (v: T) => void] {
  const [value, setValue] = React.useState<T>(initial);
  return [value, setValue];
}

function ContactStrip({ phone, email, address, gstNo }: {
  phone?: string | null; email?: string | null; address?: string | null; gstNo?: string | null;
}) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
      {phone ? <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5" />{phone}</span> : null}
      {email ? <span className="inline-flex items-center gap-1.5"><Mail className="size-3.5" />{email}</span> : null}
      {address ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" />{address}</span> : null}
      {gstNo ? <span className="inline-flex items-center gap-1.5"><FileText className="size-3.5" />GST {gstNo}</span> : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading skeleton
// ─────────────────────────────────────────────────────────────────────────────
function PortalSkeleton({ persona }: { persona: Persona }) {
  return (
    <div className="space-y-6">
      <Skeleton className="h-32 rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
      </div>
      <Skeleton className="h-72 rounded-2xl" />
      <Skeleton className="h-56 rounded-2xl" />
      {persona === "client" && <Skeleton className="h-56 rounded-2xl" />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Supplier portal dashboard — action-oriented
// ─────────────────────────────────────────────────────────────────────────────
export function SupplierPortalDashboard({ data }: { data: SupplierPortalData }) {
  const { t } = useTranslation();
  const { profile, performance: p, sections } = data;

  // Guard against stale/partial data during persona switches.
  if (!sections || !Array.isArray(sections.posAwaitingDispatch)) {
    return <PortalSkeleton persona="supplier" />;
  }

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <GlassCard className="overflow-hidden p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              <Factory className="mr-1 inline size-3" />{t("portals.supplierPortal")}
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {t("portals.welcome")}, {profile.name}
            </h2>
            <div className="mt-2">
              <ContactStrip phone={profile.phone} email={profile.email} address={profile.address} gstNo={profile.gstNo} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <Badge variant="outline" className="border-border/60 bg-card/50">
                <BadgePercent className="size-3" />Commission {profile.defaultCommissionRate}%
              </Badge>
              <Badge variant="outline" className="border-border/60 bg-card/50">GST {profile.defaultGstRate}%</Badge>
              <Badge variant="outline" className="border-border/60 bg-card/50">{p.poCount} POs</Badge>
              <Badge variant="outline" className="border-border/60 bg-card/50">{p.dispatchCount} dispatches</Badge>
              <Badge variant="outline" className="border-border/60 bg-card/50">
                Since {formatDate(profile.createdAt)}
              </Badge>
            </div>
          </div>
          <div className="shrink-0">
            <ScoreRing score={Math.round((p.fulfillment + p.onTimeRate + (100 - p.shortShipmentRate)) / 3)} size={72} />
          </div>
        </div>
      </GlassCard>

      {/* Performance KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Fulfillment"
          value={`${p.fulfillment}%`}
          sub="Dispatched vs ordered"
          icon={<Package className="size-5" />}
          accent={p.fulfillment >= 85 ? "emerald" : p.fulfillment >= 70 ? "amber" : "rose"}
        />
        <KpiCard
          label="On-time rate"
          value={`${p.onTimeRate}%`}
          sub="Dispatches by expected date"
          icon={<Clock3 className="size-5" />}
          accent={p.onTimeRate >= 85 ? "emerald" : p.onTimeRate >= 60 ? "amber" : "rose"}
        />
        <KpiCard
          label="Short-ship rate"
          value={`${p.shortShipmentRate}%`}
          sub="Defective / short dispatches"
          icon={<AlertCircle className="size-5" />}
          accent={p.shortShipmentRate === 0 ? "emerald" : p.shortShipmentRate >= 20 ? "rose" : "amber"}
        />
        <KpiCard
          label="Total supplied"
          value={formatCurrency(p.totalSupplied, { compact: true })}
          sub="Across all buyers"
          icon={<Wallet className="size-5" />}
          accent="teal"
        />
      </div>

      {/* POs awaiting dispatch — the action list */}
      <GlassCard className="p-5">
        <SectionHeader
          title={t("portals.posAwaitingDispatch")}
          description="Open and partially delivered POs you need to act on"
          action={
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
              <ArrowRightCircle className="size-3" />
              {sections.posAwaitingDispatch.length} {t("portals.awaiting")}
            </Badge>
          }
        />
        <div className="mt-4">
          {sections.posAwaitingDispatch.length === 0 ? (
            <EmptyState
              title="Nothing awaiting dispatch"
              hint="All your POs are fully delivered or closed. Great work!"
              icon={<CheckCircle2 className="size-5" />}
            />
          ) : (
            <div className="space-y-3">
              {sections.posAwaitingDispatch.map((po) => {
                const remaining = po.orderedQty - po.dispatchedQty;
                const expected = po.revisedDispatchDate ?? po.expectedDispatchDate;
                const overdue = expected ? new Date() > new Date(expected) : false;
                return (
                  <div key={po.id} className="rounded-xl border border-border/60 bg-card/40 p-4 hover-lift">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="kpi-num truncate text-sm font-semibold">{po.poNumber}</p>
                          <StatusChip status={po.status} />
                          {overdue ? (
                            <Badge variant="outline" className="border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300">
                              <Clock3 className="size-3" />Overdue
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Buyer: <span className="font-medium text-foreground">{po.buyer}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                        <div className="text-xs text-muted-foreground">
                          Expected dispatch: <span className={overdue ? "font-medium text-rose-600 dark:text-rose-400" : "font-medium text-foreground"}>
                            {formatDate(expected)}
                          </span>
                        </div>
                        {po.billStatus ? (
                          <div className="text-[11px] text-muted-foreground">
                            Bill: <StatusChip status={po.billStatus} className="ml-1" />
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{formatNumber(po.dispatchedQty)} / {formatNumber(po.orderedQty)} sets dispatched</span>
                        <span className="font-medium text-amber-600 dark:text-amber-400">{formatNumber(remaining)} to go</span>
                      </div>
                      <Progress
                        value={po.orderedQty ? (po.dispatchedQty / po.orderedQty) * 100 : 0}
                        className="mt-1.5 h-2 bg-amber-500/15"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </GlassCard>

      {/* Recent dispatches + Brokerage earned (side-by-side on large screens) */}
      <div className="grid gap-4 lg:grid-cols-5">
        <GlassCard className="p-5 lg:col-span-3">
          <SectionHeader
            title={t("portals.recentDispatches")}
            description="Your last 5 shipments"
            action={<Badge variant="outline" className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300">
              <Truck className="size-3" />{sections.recentDispatches.length}
            </Badge>}
          />
          <div className="mt-4">
            {sections.recentDispatches.length === 0 ? (
              <EmptyState title="No dispatches yet" hint="Your dispatch history will appear here." icon={<Truck className="size-5" />} />
            ) : (
              <div className="space-y-2">
                {sections.recentDispatches.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card/30 px-4 py-2.5 hover-lift">
                    <div className="min-w-0">
                      <p className="kpi-num truncate text-sm font-medium">{d.poNumber}</p>
                      <p className="truncate text-xs text-muted-foreground">{d.buyer} · {formatDate(d.dispatchDate)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-muted-foreground">{formatNumber(d.dispatchedQty)} sets</span>
                      <StatusChip status={d.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5 lg:col-span-2">
          <SectionHeader
            title={t("portals.brokerageEarned")}
            description="Commission on each settled bill"
          />
          <div className="mt-4 mb-4">
            <KpiCard
              label={t("portals.outstandingBrokerage")}
              value={formatCurrency(p.outstandingBrokerage, { compact: true })}
              sub={`${formatCurrency(p.paidBrokerage, { compact: true })} ${t("portals.alreadyPaid")}`}
              icon={<BadgePercent className="size-5" />}
              accent={p.outstandingBrokerage > 0 ? "amber" : "emerald"}
            />
          </div>
          <div className="mt-2 max-h-72 overflow-y-auto pr-1">
            {sections.brokerage.length === 0 ? (
              <EmptyState title="No brokerage entries" hint="Earned commission will appear here." icon={<BadgePercent className="size-5" />} />
            ) : (
              <div className="space-y-2">
                {sections.brokerage.slice(0, 8).map((b) => (
                  <div key={b.id} className="rounded-xl border border-border/50 bg-card/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="kpi-num truncate text-xs font-medium">{b.billNumber}</p>
                      <StatusChip status={b.eligible ? b.payoutStatus : "pending"} />
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Buyer: {b.buyer}</p>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{b.commissionRate}% of {formatCurrency(b.baseAmount, { compact: true })}</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(b.brokerageAmount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Client portal dashboard — obligation-oriented
// ─────────────────────────────────────────────────────────────────────────────
export function ClientPortalDashboard({ data }: { data: ClientPortalData }) {
  const { t } = useTranslation();
  const { profile, summary: s, sections } = data;

  // Donut chart data — order status breakdown. Guard against stale data during persona switches.
  const orders = sections?.myOrders ?? [];
  const statusBuckets = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) m.set(o.status, (m.get(o.status) ?? 0) + 1);
    return Array.from(m.entries()).map(([name, value]) => ({ name: titleCase(name), value }));
  }, [orders]);

  // Guard against stale/partial data during persona switches.
  if (!sections || !Array.isArray(sections.myOrders)) {
    return <PortalSkeleton persona="client" />;
  }

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <GlassCard className="overflow-hidden p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              <Users className="mr-1 inline size-3" />{t("portals.clientPortal")}
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {t("portals.welcome")}, {profile.name}
            </h2>
            <div className="mt-2">
              <ContactStrip phone={profile.phone} email={profile.email} address={profile.address} gstNo={profile.gstNo} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <Badge variant="outline" className="border-border/60 bg-card/50">
                <CalendarClock className="size-3" />{profile.defaultPaymentCycleDays}d payment cycle
              </Badge>
              <Badge variant="outline" className="border-border/60 bg-card/50">
                <BadgePercent className="size-3" />{titleCase(profile.payoutCadence.replace(/_/g, " "))}
              </Badge>
              <Badge variant="outline" className="border-border/60 bg-card/50">{s.billCount} bills</Badge>
              <Badge variant="outline" className="border-border/60 bg-card/50">{s.poCount} orders</Badge>
              <Badge variant="outline" className="border-border/60 bg-card/50">Since {formatDate(profile.createdAt)}</Badge>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Summary KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total business"
          value={formatCurrency(s.totalBusiness, { compact: true })}
          sub={`Across ${s.billCount} bills`}
          icon={<Wallet className="size-5" />}
          accent="teal"
        />
        <KpiCard
          label="Outstanding"
          value={formatCurrency(s.outstanding, { compact: true })}
          sub="What you currently owe"
          icon={<AlertCircle className="size-5" />}
          accent={s.outstanding > 0 ? "rose" : "emerald"}
        />
        <KpiCard
          label="Paid to date"
          value={formatCurrency(s.totalPaid, { compact: true })}
          sub="Lifetime payments"
          icon={<CheckCircle2 className="size-5" />}
          accent="emerald"
        />
        <KpiCard
          label="Brokerage earned"
          value={formatCurrency(s.brokerageEarned, { compact: true })}
          sub={`${formatCurrency(s.brokeragePaid, { compact: true })} paid to broker`}
          icon={<BadgePercent className="size-5" />}
          accent="amber"
        />
      </div>

      {/* My Orders (with donut chart) */}
      <div className="grid gap-4 lg:grid-cols-5">
        <GlassCard className="p-5 lg:col-span-3">
          <SectionHeader
            title={t("portals.myOrders")}
            description="What you've ordered — supplier, status & fulfillment"
            action={<Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              {sections.myOrders.length} {t("portals.orders")}
            </Badge>}
          />
          <div className="mt-4">
            {sections.myOrders.length === 0 ? (
              <EmptyState title="No orders yet" hint="Your purchase orders will appear here." icon={<Package className="size-5" />} />
            ) : (
              <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
                {sections.myOrders.map((o) => (
                  <div key={o.id} className="rounded-xl border border-border/60 bg-card/40 p-4 hover-lift">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="kpi-num truncate text-sm font-semibold">{o.poNumber}</p>
                          <StatusChip status={o.status} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Supplier: <span className="font-medium text-foreground">{o.supplier}</span>
                          {o.billStatus ? <> · Bill <StatusChip status={o.billStatus} className="ml-1" /></> : null}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-xs text-muted-foreground">
                        <p>Expected: <span className="font-medium text-foreground">{formatDate(o.revisedDispatchDate ?? o.expectedDispatchDate)}</span></p>
                        {o.lastDispatch ? <p className="mt-0.5">Last delivery: {formatDate(o.lastDispatch)}</p> : null}
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{formatNumber(o.dispatchedQty)} / {formatNumber(o.orderedQty)} sets delivered</span>
                        <span className={o.fulfillment >= 100 ? "font-medium text-emerald-600 dark:text-emerald-400" : "font-medium text-foreground"}>
                          {o.fulfillment}% fulfilled
                        </span>
                      </div>
                      <Progress
                        value={o.fulfillment}
                        className={cn(
                          "mt-1.5 h-2",
                          o.fulfillment >= 100 ? "bg-emerald-500/15" : o.fulfillment >= 50 ? "bg-amber-500/15" : "bg-rose-500/15",
                        )}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5 lg:col-span-2">
          <SectionHeader title="Order Status" description="Breakdown of your orders by status" />
          <div className="mt-4 h-56 w-full">
            {statusBuckets.length === 0 ? (
              <EmptyState title="No orders to chart" icon={<Package className="size-5" />} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusBuckets}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={80}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {statusBuckets.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "oklch(0.16 0.012 170 / 0.92)",
                      border: "1px solid oklch(1 0 0 / 0.12)",
                      borderRadius: 12,
                      color: "white",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {statusBuckets.map((b, i) => (
              <Badge key={b.name} variant="outline" className="border-border/60 bg-card/50">
                <span
                  className="size-2 rounded-full"
                  style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                />
                {b.name}: {b.value}
              </Badge>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Outstanding bills (action-oriented for the client) */}
      <GlassCard className="p-5">
        <SectionHeader
          title={t("portals.outstandingBills")}
          description="What you currently owe — pay before the due date"
          action={
            <Badge variant="outline" className={cn(
              s.outstanding > 0
                ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            )}>
              <Wallet className="size-3" />
              {formatCurrency(s.outstanding, { compact: true })}
            </Badge>
          }
        />
        <div className="mt-4">
          {sections.outstandingBills.length === 0 ? (
            <EmptyState
              title="All bills settled"
              hint="You have no outstanding dues. Thank you for your prompt payments!"
              icon={<CheckCircle2 className="size-5" />}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {sections.outstandingBills.map((b) => (
                <div key={b.id} className="rounded-xl border border-border/60 bg-card/40 p-4 hover-lift">
                  <div className="flex items-center justify-between gap-2">
                    <p className="kpi-num truncate text-sm font-semibold">{b.billNumber}</p>
                    {b.overdue ? (
                      <Badge variant="outline" className="border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300">
                        <Clock3 className="size-3" />Overdue
                      </Badge>
                    ) : (
                      <StatusChip status={b.status} />
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {b.poNumber} · {b.supplier}
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Final</p>
                      <p className="font-medium">{formatCurrency(b.finalAmount, { compact: true })}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Paid</p>
                      <p className="font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(b.paidAmount, { compact: true })}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Due</p>
                      <p className={b.overdue ? "font-semibold text-rose-600 dark:text-rose-400" : "font-semibold text-amber-600 dark:text-amber-400"}>
                        {formatCurrency(b.dueAmount, { compact: true })}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[11px]">
                    <span className="text-muted-foreground">
                      Due: <span className={b.overdue ? "font-medium text-rose-600 dark:text-rose-400" : "font-medium text-foreground"}>{formatDate(b.dueDate)}</span>
                    </span>
                    <span className="text-muted-foreground">Billed {formatDate(b.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </GlassCard>

      {/* Payment history + Recent deliveries */}
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <SectionHeader
            title={t("portals.paymentHistory")}
            description="Your recent payments"
            action={<Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-3" />{sections.paymentHistory.length}
            </Badge>}
          />
          <div className="mt-4">
            {sections.paymentHistory.length === 0 ? (
              <EmptyState title="No payments yet" hint="Payments you make will appear here." icon={<Wallet className="size-5" />} />
            ) : (
              <div className="space-y-2">
                {sections.paymentHistory.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card/30 px-4 py-2.5 hover-lift">
                    <div className="min-w-0">
                      <p className="kpi-num truncate text-sm font-medium">{p.billNumber}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.poNumber} · {formatDate(p.date)} · {titleCase(p.mode)}{p.reference ? ` · ${p.reference}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(p.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <SectionHeader
            title={t("portals.recentDeliveries")}
            description="What's been delivered to you"
            action={<Badge variant="outline" className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300">
              <Truck className="size-3" />{sections.recentDeliveries.length}
            </Badge>}
          />
          <div className="mt-4">
            {sections.recentDeliveries.length === 0 ? (
              <EmptyState title="No deliveries yet" hint="Your received shipments will appear here." icon={<Truck className="size-5" />} />
            ) : (
              <div className="space-y-2">
                {sections.recentDeliveries.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card/30 px-4 py-2.5 hover-lift">
                    <div className="min-w-0">
                      <p className="kpi-num truncate text-sm font-medium">{d.poNumber}</p>
                      <p className="truncate text-xs text-muted-foreground">{d.supplier} · {formatDate(d.dispatchDate)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-muted-foreground">{formatNumber(d.dispatchedQty)} sets</span>
                      <StatusChip status={d.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ScoreRing — small circular SVG progress indicator reused from analytics.
// ─────────────────────────────────────────────────────────────────────────────
function ScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 85 ? "oklch(0.7 0.15 162)"
    : score >= 70 ? "oklch(0.65 0.12 200)"
    : score >= 55 ? "oklch(0.78 0.14 85)"
    : "oklch(0.65 0.2 27)";
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="oklch(0.7 0.02 160 / 0.2)" strokeWidth={5} />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="kpi-num text-lg font-semibold leading-none" style={{ color }}>{score}</p>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">score</p>
        </div>
      </div>
    </div>
  );
}
