"use client";

import * as React from "react";
import {
  Search, Ban, Trash2, Eye, Loader2, Users, Shield, ShieldCheck, UserCog,
  Send, RotateCcw,
} from "lucide-react";
import { useApi, api } from "@/lib/api";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { AdminGate } from "@/lib/admin-client";

// ── Types ────────────────────────────────────────────────────────────────
type BrokerRow = {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  isSuperAdmin: boolean;
  isSuspended: boolean;
  createdAt: string;
  updatedAt: string;
  subscription: {
    status: string;
    plan: { name: string; displayName: string; priceMonthly: number } | null;
    trialEnd: string | null;
    currentPeriodEnd: string | null;
  } | null;
  counts: { clients: number; suppliers: number; pos: number; bills: number };
};

type BrokerListResponse = {
  brokers: BrokerRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type BrokerDetailResponse = {
  broker: {
    id: string;
    email: string;
    fullName: string | null;
    role: string;
    isSuperAdmin: boolean;
    isSuspended: boolean;
    createdAt: string;
    updatedAt: string;
    subscription: {
      id: string;
      status: string;
      trialStart: string | null;
      trialEnd: string | null;
      currentPeriodStart: string | null;
      currentPeriodEnd: string | null;
      canceledAt: string | null;
      plan: {
        id: string;
        name: string;
        displayName: string;
        priceMonthly: number;
        priceYearly: number;
      } | null;
    } | null;
  };
  counts: {
    clients: number; suppliers: number; pos: number; dispatches: number;
    bills: number; payments: number; brokerages: number; payouts: number;
    disputes: number; photos: number; notifications: number; auditLogs: number;
  };
  financials: {
    totalBilled: number;
    totalPaid: number;
    outstanding: number;
    brokerageEarned: number;
    payoutsPaid: number;
  };
  recentActivity: {
    id: string;
    entityType: string;
    action: string;
    reason: string | null;
    userName: string | null;
    createdAt: string;
  }[];
};

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "trial", label: "Trial" },
  { value: "suspended", label: "Suspended" },
  { value: "super_admin", label: "Super Admin" },
] as const;

const PAGE_SIZE = 20;

export default function AdminBrokersPage() {
  return (
    <AdminGate>
      <AdminBrokersContent />
    </AdminGate>
  );
}

function AdminBrokersContent() {
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<string>("all");
  const [page, setPage] = React.useState(1);
  const [refreshKey, setRefreshKey] = React.useState(0);

  // Debounce the search input — 350ms is enough for typing without thrashing.
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const query = React.useMemo(() => {
    const p = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      status,
    });
    if (debouncedSearch) p.set("search", debouncedSearch);
    return `?${p.toString()}`;
  }, [page, status, debouncedSearch]);

  const { data, error, loading, refresh } = useApi<BrokerListResponse>(
    `/api/admin/brokers${query}`,
    { refreshKey },
  );

  // ── Row actions ──────────────────────────────────────────────────────
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<BrokerRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [suspendingId, setSuspendingId] = React.useState<string | null>(null);

  async function handleToggleSuspend(broker: BrokerRow) {
    setSuspendingId(broker.id);
    try {
      const next = !broker.isSuspended;
      await api(`/api/admin/brokers/${broker.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isSuspended: next }),
      });
      toast.success(next ? "Broker suspended" : "Broker activated", {
        description: `${broker.fullName ?? broker.email} is now ${next ? "suspended" : "active"}.`,
      });
      refresh();
    } catch (e) {
      toast.error("Failed to update broker", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSuspendingId(null);
    }
  }

  async function handleDelete(broker: BrokerRow) {
    setDeleting(true);
    try {
      await api(`/api/admin/brokers/${broker.id}`, { method: "DELETE" });
      toast.success("Broker deleted", {
        description: `${broker.fullName ?? broker.email} + all their data has been removed.`,
      });
      setDeleteTarget(null);
      refresh();
    } catch (e) {
      toast.error("Failed to delete broker", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Brokers"
        description="Manage all broker accounts on the platform. Suspend, reactivate, or delete brokers + all their data."
      />

      {/* Filters + search */}
      <GlassCard className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="status-filter" className="sr-only">Status</Label>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger id="status-filter" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </GlassCard>

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
            <EmptyState title="Failed to load brokers" hint={error} icon={<Users />} />
          </div>
        ) : !data || data.brokers.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No brokers found"
              hint="Try adjusting the search or filter."
              icon={<Search />}
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
                  <TableHead className="hidden lg:table-cell">Joined</TableHead>
                  <TableHead className="text-right">Clients</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">POs</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.brokers.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="text-sm font-medium leading-tight">
                            {b.fullName ?? "—"}
                          </p>
                          <p className="text-xs text-muted-foreground">{b.email}</p>
                        </div>
                        {b.isSuperAdmin ? (
                          <Badge variant="outline" className="ml-1 gap-1 border-teal-500/40 text-teal-700 dark:text-teal-300">
                            <Shield className="size-3" /> Super Admin
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {b.subscription?.plan ? (
                        <div className="flex flex-col gap-0.5">
                          <Badge variant="secondary" className="w-fit">{b.subscription.plan.displayName}</Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {b.subscription.plan.priceMonthly === 0
                              ? "Free"
                              : `${formatCurrency(b.subscription.plan.priceMonthly)}/mo`}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No plan</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {b.isSuspended ? (
                        <Badge variant="outline" className="gap-1 border-rose-500/40 text-rose-700 dark:text-rose-300">
                          <Ban className="size-3" /> Suspended
                        </Badge>
                      ) : b.subscription?.status === "trialing" ? (
                        <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300">
                          Trial
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                          <ShieldCheck className="size-3" /> Active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {formatDate(b.createdAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {formatNumber(b.counts.clients)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums text-sm">
                      {formatNumber(b.counts.pos)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setDetailId(b.id)}
                          title="View broker details"
                          aria-label="View broker details"
                        >
                          <Eye className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => handleToggleSuspend(b)}
                          disabled={b.isSuperAdmin || suspendingId === b.id}
                          title={b.isSuspended ? "Activate broker" : "Suspend broker"}
                          aria-label={b.isSuspended ? "Activate broker" : "Suspend broker"}
                        >
                          {suspendingId === b.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : b.isSuspended ? (
                            <RotateCcw className="size-4 text-emerald-600" />
                          ) : (
                            <Ban className="size-4 text-amber-600" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 hover:bg-rose-500/10 hover:text-rose-600"
                          onClick={() => setDeleteTarget(b)}
                          disabled={b.isSuperAdmin}
                          title="Delete broker + all their data"
                          aria-label="Delete broker"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Pagination footer */}
        {data ? (
          <div className="border-t border-border px-4 py-3">
            <BrokerPagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              pageSize={data.pageSize}
              onPageChange={setPage}
            />
          </div>
        ) : null}
      </GlassCard>

      {/* Detail dialog */}
      {detailId ? (
        <BrokerDetailDialog brokerId={detailId} onClose={() => setDetailId(null)} />
      ) : null}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete broker and all their data?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                This will permanently delete{" "}
                <span className="font-medium text-foreground">
                  {deleteTarget?.fullName ?? deleteTarget?.email}
                </span>{" "}
                and ALL their data:
              </span>
              <span className="block text-xs">
                {deleteTarget ? `${formatNumber(deleteTarget.counts.clients)} clients, ${formatNumber(deleteTarget.counts.pos)} POs, ${formatNumber(deleteTarget.counts.bills)} bills` : ""}
                {" — all visits, bookings, dispatches, payments, brokerages, payouts, disputes, photos, notifications, audit logs, saved views, report templates, and tags."}
              </span>
              <span className="block text-rose-600 dark:text-rose-400">
                This action cannot be undone.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
              disabled={deleting}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {deleting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Trash2 className="mr-2 size-4" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Pagination (simple, page-numbers only) ──────────────────────────────
function BrokerPagination({
  page, totalPages, total, pageSize, onPageChange,
}: {
  page: number; totalPages: number; total: number; pageSize: number; onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) {
    return (
      <p className="text-xs text-muted-foreground">
        Showing all {formatNumber(total)} broker{total === 1 ? "" : "s"}.
      </p>
    );
  }
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}</span>–<span className="font-medium text-foreground">{to}</span>
        {" of "}<span className="font-medium text-foreground">{formatNumber(total)}</span>
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Prev
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          Page {page} / {totalPages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

// ── Broker detail dialog ─────────────────────────────────────────────────
function BrokerDetailDialog({ brokerId, onClose }: { brokerId: string; onClose: () => void }) {
  const { data, error, loading } = useApi<BrokerDetailResponse>(`/api/admin/brokers/${brokerId}`);
  const [role, setRole] = React.useState<string>("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (data?.broker) setRole(data.broker.role);
  }, [data]);

  async function handleSaveRole() {
    if (!data) return;
    setSaving(true);
    try {
      await api(`/api/admin/brokers/${brokerId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      toast.success("Role updated", { description: `New role: ${role}` });
    } catch (e) {
      toast.error("Failed to update role", { description: e instanceof Error ? e.message : "" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass-strong max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="size-5 text-teal-600" />
            Broker Details
          </DialogTitle>
          <DialogDescription>
            {data?.broker ? (
              <span>
                {data.broker.fullName ?? "—"} · {data.broker.email}
                {data.broker.isSuperAdmin ? (
                  <Badge variant="outline" className="ml-2 gap-1 border-teal-500/40 text-teal-700 dark:text-teal-300">
                    <Shield className="size-3" /> Super Admin
                  </Badge>
                ) : null}
              </span>
            ) : (
              "Loading…"
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        ) : error ? (
          <EmptyState title="Failed to load broker detail" hint={error} icon={<Eye />} />
        ) : data ? (
          <div className="space-y-5">
            {/* Subscription summary */}
            <div className="glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subscription</p>
              {data.broker.subscription ? (
                <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Plan</p>
                    <p className="font-medium">
                      {data.broker.subscription.plan?.displayName ?? "—"}
                      {data.broker.subscription.plan ? ` (${formatCurrency(data.broker.subscription.plan.priceMonthly)}/mo)` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <Badge variant="secondary">{data.broker.subscription.status}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Trial end</p>
                    <p className="font-medium">{formatDate(data.broker.subscription.trialEnd)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Period end</p>
                    <p className="font-medium">{formatDate(data.broker.subscription.currentPeriodEnd)}</p>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No subscription — on Free plan.</p>
              )}
            </div>

            {/* Entity counts */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <CountTile label="Clients" value={data.counts.clients} />
              <CountTile label="Suppliers" value={data.counts.suppliers} />
              <CountTile label="POs" value={data.counts.pos} />
              <CountTile label="Dispatches" value={data.counts.dispatches} />
              <CountTile label="Bills" value={data.counts.bills} />
              <CountTile label="Payments" value={data.counts.payments} />
              <CountTile label="Brokerages" value={data.counts.brokerages} />
              <CountTile label="Disputes" value={data.counts.disputes} />
            </div>

            {/* Financials */}
            <div className="glass rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Financials (₹)</p>
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <Fin label="Total Billed" value={formatCurrency(data.financials.totalBilled, { compact: true })} />
                <Fin label="Total Paid" value={formatCurrency(data.financials.totalPaid, { compact: true })} />
                <Fin label="Outstanding" value={formatCurrency(data.financials.outstanding, { compact: true })} />
                <Fin label="Brokerage Earned" value={formatCurrency(data.financials.brokerageEarned, { compact: true })} />
                <Fin label="Payouts Paid" value={formatCurrency(data.financials.payoutsPaid, { compact: true })} />
              </div>
            </div>

            {/* Role editor */}
            {!data.broker.isSuperAdmin ? (
              <div className="glass rounded-xl p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Role</p>
                <div className="mt-3 flex items-center gap-2">
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="broker">Broker</SelectItem>
                      <SelectItem value="staff">Staff</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={handleSaveRole} disabled={saving || role === data.broker.role}>
                    {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    Save
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Recent activity */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Recent Activity (last 10)
              </p>
              {data.recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity.</p>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-3">
                  {data.recentActivity.map((a) => (
                    <div key={a.id} className="flex items-start gap-2 text-xs">
                      <Badge variant="outline" className="shrink-0 text-[10px]">{a.action}</Badge>
                      <span className="text-muted-foreground">{a.entityType}</span>
                      {a.reason ? <span className="text-foreground">· {a.reason}</span> : null}
                      <span className="ml-auto text-muted-foreground">{formatDate(a.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Impersonate (future feature) */}
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              <Send className="size-3.5" />
              <span>Impersonate this broker (future feature) — would set a cookie to view the app as them.</span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                disabled
                title="Coming soon"
              >
                Impersonate
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass rounded-lg p-3 text-center">
      <p className="kpi-num text-xl font-light tabular-nums">{formatNumber(value)}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function Fin({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="kpi-num font-medium">{value}</p>
    </div>
  );
}
