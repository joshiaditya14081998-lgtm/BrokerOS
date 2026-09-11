"use client";

import * as React from "react";
import {
  Users, CreditCard, TrendingUp, Ban, Loader2, Shield, ShieldCheck,
  Store, FileText, Receipt, Sparkles,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { useApi } from "@/lib/api";
import { GlassCard, SectionHeader, EmptyState, KpiCard } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { formatCurrency, formatNumber, formatDate } from "@/lib/format";
import { AdminGate } from "@/lib/admin-client";

// ── Types ────────────────────────────────────────────────────────────────
type DashboardResponse = {
  admin: { id: string; email: string; fullName: string | null };
  totals: {
    brokers: number;
    suspended: number;
    superAdmins: number;
    activeTrials: number;
    paidSubscribers: number;
  };
  mrr: number;
  usageTotals: { clients: number; suppliers: number; pos: number; bills: number };
  newBrokersPerMonth: { label: string; value: number }[];
  revenueByPlan: {
    id: string; name: string; displayName: string; price: number;
    subscribers: number; payingSubscribers: number; mrr: number;
  }[];
  recentSignups: {
    id: string; email: string; fullName: string | null;
    isSuspended: boolean; isSuperAdmin: boolean;
    createdAt: string; plan: string | null; status: string | null;
  }[];
};

// Chart palette — teal/emerald-forward to match the admin theme.
const PIE_COLORS = ["#0d9488", "#14b8a6", "#2dd4bf", "#5eead4", "#99f6e4", "#ccfbf1"];

export default function AdminDashboardPage() {
  return (
    <AdminGate>
      <AdminDashboardContent />
    </AdminGate>
  );
}

function AdminDashboardContent() {
  const { data, error, loading } = useApi<DashboardResponse>("/api/admin/dashboard");

  if (loading) return <DashboardSkeleton />;
  if (error || !data) {
    return (
      <EmptyState
        title="Could not load admin dashboard"
        hint={error ?? "Unknown error"}
        icon={<Shield />}
      />
    );
  }

  const { totals, mrr, usageTotals, newBrokersPerMonth, revenueByPlan, recentSignups, admin } = data;
  const activeSubscriptions = revenueByPlan.reduce((s, p) => s + p.payingSubscribers, 0);

  return (
    <div className="space-y-6">
      {/* Header — admin identity */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader
          title="Platform Dashboard"
          description={`Signed in as ${admin.fullName ?? admin.email}`}
        />
        <Badge className="w-fit gap-1.5 bg-teal-600 text-white hover:bg-teal-700">
          <ShieldCheck className="size-3.5" />
          Super Admin
        </Badge>
      </div>

      {/* KPI cards — 4 across */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total Brokers"
          value={formatNumber(totals.brokers)}
          sub={`${totals.superAdmins} super admin${totals.superAdmins === 1 ? "" : "s"} · ${totals.suspended} suspended`}
          icon={<Users className="size-5" />}
          accent="teal"
        />
        <KpiCard
          label="Active Trials"
          value={formatNumber(totals.activeTrials)}
          sub="Brokers in their 14-day trial"
          icon={<Sparkles className="size-5" />}
          accent="emerald"
        />
        <KpiCard
          label="Paid Subscribers"
          value={formatNumber(totals.paidSubscribers)}
          sub={`${activeSubscriptions} active subscriptions`}
          icon={<CreditCard className="size-5" />}
          accent="emerald"
        />
        <KpiCard
          label="MRR"
          value={formatCurrency(mrr, { compact: mrr >= 100000 })}
          sub="Monthly recurring revenue"
          icon={<TrendingUp className="size-5" />}
          accent="teal"
        />
      </div>

      {/* Charts — 6-month new brokers line + revenue by plan donut */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassCard className="p-5 lg:col-span-2">
          <SectionHeader
            title="New Brokers"
            description="Last 6 months"
          />
          <div className="mt-4 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={newBrokersPerMonth} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.7 0.02 160 / 0.18)" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="oklch(0.48 0.02 165)" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="oklch(0.48 0.02 165)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "oklch(1 0 0 / 92%)",
                    border: "1px solid oklch(0.86 0.01 160 / 55%)",
                    borderRadius: "12px",
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [`${v} broker${v === 1 ? "" : "s"}`, "Signups"]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#0d9488"
                  strokeWidth={2.5}
                  dot={{ fill: "#0d9488", r: 4 }}
                  activeDot={{ r: 6, fill: "#0f766e" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <SectionHeader
            title="Revenue by Plan"
            description="Paying subscribers per plan"
          />
          {revenueByPlan.every((p) => p.subscribers === 0) ? (
            <div className="mt-4 flex h-[260px] items-center justify-center">
              <EmptyState
                title="No active subscribers yet"
                hint="Subscribers will appear here once brokers upgrade."
                icon={<CreditCard className="size-4" />}
              />
            </div>
          ) : (
            <div className="mt-4 h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={revenueByPlan.filter((p) => p.subscribers > 0)}
                    dataKey="subscribers"
                    nameKey="displayName"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={2}
                    stroke="oklch(1 0 0 / 60%)"
                  >
                    {revenueByPlan
                      .filter((p) => p.subscribers > 0)
                      .map((_entry, i) => (
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
                    formatter={(value: number, _name: string, entry) => {
                      const plan = entry?.payload as { displayName: string; price: number; mrr: number };
                      return [
                        `${value} subscriber${value === 1 ? "" : "s"} · ${formatCurrency(plan.mrr)}/mo`,
                        plan.displayName,
                      ];
                    }}
                  />
                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </GlassCard>
      </div>

      {/* Platform-wide usage totals */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Store className="size-3.5" />
            <span>Clients (all brokers)</span>
          </div>
          <p className="kpi-num mt-2 text-2xl font-light">{formatNumber(usageTotals.clients)}</p>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="size-3.5" />
            <span>Suppliers (all brokers)</span>
          </div>
          <p className="kpi-num mt-2 text-2xl font-light">{formatNumber(usageTotals.suppliers)}</p>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="size-3.5" />
            <span>POs (all brokers)</span>
          </div>
          <p className="kpi-num mt-2 text-2xl font-light">{formatNumber(usageTotals.pos)}</p>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Receipt className="size-3.5" />
            <span>Bills (all brokers)</span>
          </div>
          <p className="kpi-num mt-2 text-2xl font-light">{formatNumber(usageTotals.bills)}</p>
        </GlassCard>
      </div>

      {/* Recent signups table */}
      <GlassCard className="p-5">
        <SectionHeader
          title="Recent Signups"
          description="The 5 most recent brokers to join the platform"
          action={<Button variant="outline" size="sm" asChild>
            <a href="/admin/brokers">View all brokers</a>
          </Button>}
        />
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Broker</TableHead>
                <TableHead className="hidden sm:table-cell">Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentSignups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <EmptyState title="No brokers yet" hint="New signups will appear here." icon={<Users className="size-4" />} />
                  </TableCell>
                </TableRow>
              ) : (
                recentSignups.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="text-sm font-medium">{b.fullName ?? b.email}</p>
                          <p className="text-xs text-muted-foreground">{b.email}</p>
                        </div>
                        {b.isSuperAdmin ? (
                          <Badge variant="outline" className="ml-1 gap-1 border-teal-500/40 text-teal-700 dark:text-teal-300">
                            <Shield className="size-3" /> Super Admin
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {b.plan ? <Badge variant="secondary">{b.plan}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {b.isSuspended ? (
                        <Badge variant="outline" className="gap-1 border-rose-500/40 text-rose-700 dark:text-rose-300">
                          <Ban className="size-3" /> Suspended
                        </Badge>
                      ) : b.status === "trialing" ? (
                        <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300">
                          Trial
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                          Active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {formatDate(b.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </GlassCard>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-72" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-[300px] rounded-2xl lg:col-span-2" />
        <Skeleton className="h-[300px] rounded-2xl" />
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading admin dashboard…
      </div>
    </div>
  );
}
