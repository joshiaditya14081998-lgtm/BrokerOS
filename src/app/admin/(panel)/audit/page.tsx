"use client";

import * as React from "react";
import {
  ScrollText, Filter, Shield, Loader2,
} from "lucide-react";
import { useApi } from "@/lib/api";
import { GlassCard, SectionHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { AdminGate } from "@/lib/admin-client";

type AuditLog = {
  id: string;
  adminId: string;
  adminName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: string | null;
  after: string | null;
  reason: string | null;
  ipAddress: string | null;
  createdAt: string;
};

type AuditResponse = {
  logs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  admins: { id: string; fullName: string | null; email: string }[];
  byAction: Record<string, number>;
};

const PAGE_SIZE = 25;

export default function AdminAuditPage() {
  return (
    <AdminGate>
      <AdminAuditContent />
    </AdminGate>
  );
}

function AdminAuditContent() {
  const [action, setAction] = React.useState<string>("all");
  const [adminId, setAdminId] = React.useState<string>("all");
  const [targetType, setTargetType] = React.useState<string>("all");
  const [page, setPage] = React.useState(1);

  const query = React.useMemo(() => {
    const p = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (action !== "all") p.set("action", action);
    if (adminId !== "all") p.set("adminId", adminId);
    if (targetType !== "all") p.set("targetType", targetType);
    return `?${p.toString()}`;
  }, [page, action, adminId, targetType]);

  const { data, error, loading } = useApi<AuditResponse>(`/api/admin/audit${query}`);

  // Distinct action labels (derived from byAction + a sensible default list).
  const actionOptions = React.useMemo(() => {
    const set = new Set<string>([
      "suspend_broker", "activate_broker", "delete_broker", "change_role",
      "change_super_admin_flag", "update_broker",
      "create_plan", "update_plan", "deactivate_plan",
      "send_announcement",
    ]);
    if (data) Object.keys(data.byAction).forEach((k) => set.add(k));
    return Array.from(set).sort();
  }, [data]);

  const targetTypeOptions = ["Broker", "Subscription", "Plan", "Notification"];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Admin Audit Log"
        description="Every action taken by a super admin — suspend/activate brokers, plan edits, announcements. Immutable."
      />

      {/* Filters */}
      <GlassCard className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filters</span>
          </div>
          <div className="flex-1">
            <Label htmlFor="filter-action" className="text-[10px] uppercase tracking-wider text-muted-foreground">Action</Label>
            <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
              <SelectTrigger id="filter-action" className="mt-0.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {actionOptions.map((a) => (
                  <SelectItem key={a} value={a}>{a.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label htmlFor="filter-admin" className="text-[10px] uppercase tracking-wider text-muted-foreground">Admin</Label>
            <Select value={adminId} onValueChange={(v) => { setAdminId(v); setPage(1); }}>
              <SelectTrigger id="filter-admin" className="mt-0.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All admins</SelectItem>
                {data?.admins.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.fullName ?? a.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label htmlFor="filter-target" className="text-[10px] uppercase tracking-wider text-muted-foreground">Target</Label>
            <Select value={targetType} onValueChange={(v) => { setTargetType(v); setPage(1); }}>
              <SelectTrigger id="filter-target" className="mt-0.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All targets</SelectItem>
                {targetTypeOptions.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
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
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6">
            <EmptyState title="Failed to load audit log" hint={error} icon={<ScrollText />} />
          </div>
        ) : !data || data.logs.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No audit entries match the filters"
              hint="Try changing the action, admin, or target filter."
              icon={<ScrollText />}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Time</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden md:table-cell">Target</TableHead>
                  <TableHead className="hidden lg:table-cell">Reason</TableHead>
                  <TableHead className="text-right">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.logs.map((l) => (
                  <AuditRow key={l.id} log={l} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {data && data.totalPages > 1 ? (
          <div className="border-t border-border px-4 py-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Page {data.page} of {data.totalPages} · {data.total} entries
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

function AuditRow({ log }: { log: AuditLog }) {
  const [open, setOpen] = React.useState(false);

  // Render `after` payload (or before for delete actions) in the dialog.
  // Both are JSON strings — parse defensively.
  let after: unknown = null;
  let before: unknown = null;
  try { after = log.after ? JSON.parse(log.after) : null; } catch { /* malformed — leave as null */ }
  try { before = log.before ? JSON.parse(log.before) : null; } catch { /* malformed */ }

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(true)}>
        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
          {formatDateTime(log.createdAt)}
        </TableCell>
        <TableCell>
          <p className="text-sm font-medium">{log.adminName}</p>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className="text-[11px]">
            {log.action.replace(/_/g, " ")}
          </Badge>
        </TableCell>
        <TableCell className="hidden md:table-cell text-sm">
          {log.targetType ? (
            <span>
              <span className="text-muted-foreground">{log.targetType}</span>
              {log.targetId ? <span className="ml-1 font-mono text-[10px] text-muted-foreground">{log.targetId.slice(-8)}</span> : null}
            </span>
          ) : "—"}
        </TableCell>
        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
          {log.reason ?? "—"}
        </TableCell>
        <TableCell className="text-right">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          >
            <Shield className="mr-1 size-3.5" /> View
          </Button>
        </TableCell>
      </TableRow>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="glass-strong max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScrollText className="size-5 text-teal-600" />
              <span className="capitalize">{log.action.replace(/_/g, " ")}</span>
            </DialogTitle>
            <DialogDescription>
              {formatDateTime(log.createdAt)} · admin: {log.adminName}
              {log.targetType ? ` · target: ${log.targetType}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {log.reason ? (
              <div className="glass rounded-lg p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Reason</p>
                <p className="mt-1 text-sm">{log.reason}</p>
              </div>
            ) : null}

            {before !== null ? (
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Before</p>
                <pre className="overflow-x-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
                  {JSON.stringify(before, null, 2)}
                </pre>
              </div>
            ) : null}

            {after !== null ? (
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">After</p>
                <pre className="overflow-x-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
                  {JSON.stringify(after, null, 2)}
                </pre>
              </div>
            ) : null}

            {before === null && after === null ? (
              <p className="text-sm text-muted-foreground">No before/after payload recorded.</p>
            ) : null}

            {log.ipAddress ? (
              <p className="text-[10px] text-muted-foreground">IP: {log.ipAddress}</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
