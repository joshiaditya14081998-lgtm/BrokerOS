"use client";

import * as React from "react";
import {
  CreditCard, Shield, Loader2, Filter,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip,
} from "recharts";
import { useApi } from "@/lib/api";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { AdminGate } from "@/lib/admin-client";

type SubscriptionRow = {
  id: string;
  brokerId: string;
  broker: { id: string; email: string; fullName: string | null; isSuspended: boolean };
  plan: {
    id: string; name: string; displayName: string; priceMonthly: number;
  } | null;
  status: string;
  trialStart: string | null;
  trialEnd: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  createdAt: string;
};

type SubscriptionsResponse = {
  subscriptions: SubscriptionRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  byStatus: Record<string, number>;
};

const PIE_COLORS = ["#0d9488", "#14b8a6", "#2dd4bf", "#5eead4", "#99f6e4"];

const STATUS_BADGES: Record<string, string> = {
  trialing: "border-amber-500/40 text-amber-700 dark:text-amber-300",
  active: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  past_due: "border-rose-500/40 text-rose-700 dark:text-rose-300",
  canceled: "border-zinc-500/40 text-zinc-600 dark:text-zinc-300",
  paused: "border-teal-500/40 text-teal-700 dark:text-teal-300",
};

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "trialing", label: "Trialing" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Past due" },
  { value: "paused", label: "Paused" },
  { value: "canceled", label: "Canceled" },
] as const;

const PAGE_SIZE = 20;

export default function AdminSubscriptionsPage() {
  return (
    <AdminGate>
      <AdminSubscriptionsContent />
    </AdminGate>
  );
}

function AdminSubscriptionsContent() {
  const [status, setStatus] = React.useState<string>("all");
  const [page, setPage] = React.useState(1);

  const query = React.useMemo(() => {
    const p = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      status,
    });
    return `?${p.toString()}`;
  }, [page, status]);

  const { data, error, loading } = useApi<SubscriptionsResponse>(`/api/admin/subscriptions${query}`);

  // Pie chart data — subscribers per status.
  const pieData = React.useMemo(() => {
    if (!data) return [];
    return Object.entries(data.byStatus).map(([name, value]) => ({ name, value }));
  }, [data]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Subscriptions"
        description="Every broker's subscription across the platform — status, plan, MRR contribution."
      />

      {/* Filter + pie chart */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassCard className="p-4 lg:col-span-2">
          <div className="flex items-center gap-3">
            <Filter className="size-4 text-muted-foreground" />
            <Label htmlFor="sub-status-filter" className="text-sm">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => { setStatus(v); setPage(1); }}
            >
              <SelectTrigger id="sub-status-filter" className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {data ? (
              <span className="ml-auto text-xs text-muted-foreground">
                {formatNumber(data.total)} subscription{data.total === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Distribution by status
          </p>
          {pieData.length === 0 || pieData.every((d) => d.value === 0) ? (
            <div className="mt-4 flex h-[140px] items-center justify-center">
              <EmptyState title="No subscriptions yet" icon={<CreditCard className="size-4" />} />
            </div>
          ) : (
            <div className="mt-2 h-[140px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={32}
                    outerRadius={56}
                    paddingAngle={2}
                    stroke="oklch(1 0 0 / 60%)"
                  >
                    {pieData.map((_entry, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "oklch(1 0 0 / 92%)",
                      border: "1px solid oklch(0.86 0.01 160 / 55%)",
                      borderRadius: "12px",
                      fontSize: 12,
                    }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </GlassCard>
      </div>

      {/* Table */}
      <GlassCard className="p-0">
        {loading && !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6">
            <EmptyState title="Failed to load subscriptions" hint={error} icon={<CreditCard />} />
          </div>
        ) : !data || data.subscriptions.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No subscriptions found"
              hint="Brokers will appear here once they sign up and a subscription is created."
              icon={<CreditCard />}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Broker</TableHead>
                  <TableHead className="hidden md:table-cell">Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Trial End</TableHead>
                  <TableHead className="hidden lg:table-cell">Current Period</TableHead>
                  <TableHead className="text-right">MRR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.subscriptions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="text-sm font-medium leading-tight">
                            {s.broker.fullName ?? s.broker.email}
                          </p>
                          <p className="text-xs text-muted-foreground">{s.broker.email}</p>
                        </div>
                        {s.broker.isSuspended ? (
                          <Badge variant="outline" className="border-rose-500/40 text-rose-700 dark:text-rose-300">
                            Suspended
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {s.plan ? (
                        <Badge variant="secondary">{s.plan.displayName}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">No plan</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`capitalize ${STATUS_BADGES[s.status] ?? ""}`}
                      >
                        {s.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {s.trialEnd ? formatDate(s.trialEnd) : "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {/* Only "active" / "past_due" subscriptions count toward MRR */}
                      {(s.status === "active" || s.status === "past_due") && s.plan
                        ? formatCurrency(s.plan.priceMonthly)
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {data && data.totalPages > 1 ? (
          <div className="border-t border-border px-4 py-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Page {data.page} of {data.totalPages} · {formatNumber(data.total)} total
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={data.page <= 1}
                onClick={() => setPage(data.page - 1)}
              >
                Prev
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={data.page >= data.totalPages}
                onClick={() => setPage(data.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </GlassCard>

      {loading && data ? (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Refreshing…
        </div>
      ) : null}
    </div>
  );
}
