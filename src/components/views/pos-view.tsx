"use client";

import * as React from "react";
import { Search, FileText, Download, Filter, X, Printer } from "lucide-react";
import { useApi } from "@/lib/api";
import { formatCurrency, formatDate, titleCase } from "@/lib/format";
import { GlassCard, SectionHeader, StatusChip, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useUI } from "@/lib/ui-store";
import { usePagination } from "@/hooks/use-pagination";
import { useUrlState } from "@/hooks/use-url-state";
import { PaginationBar } from "@/components/pagination-bar";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { TagBadge } from "@/components/tag-badge";
import { TagFilterBar, filterByTags } from "@/components/tag-filter-bar";
import { SavedViewsBar } from "@/components/saved-views-bar";
import { ShareLinkButton } from "@/components/share-link-button";
import { isFilterActive } from "@/lib/saved-views";

type TagLike = { id: string; name: string; color: string };

type PoRow = {
  id: string;
  poNumber: string;
  totalValue: number;
  commissionRate: number;
  gstRate: number;
  status: string;
  expectedDispatchDate: string | null;
  revisedDispatchDate: string | null;
  createdAt: string;
  client: { name: string };
  supplier: { name: string };
  booking: { id: string; bookingDate: string };
  dispatches: { id: string; dispatchDate: string; dispatchedQty: number; status: string }[];
  bill: { id: string; billNumber: string; status: string; finalAmount: number; paidAmount: number } | null;
  orderedQty: number;
  dispatchedQty: number;
  fulfillment: number;
  tags?: TagLike[];
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "partially_delivered", label: "Partially delivered" },
  { value: "fully_delivered", label: "Fully delivered" },
  { value: "closed", label: "Closed" },
];

export function PosView() {
  const { data, loading, refresh } = useApi<{ purchaseOrders: PoRow[] }>("/api/purchase-orders");
  const { openDetail, drillFilter, clearDrill } = useUI();
  // URL-persisted filter state (Task 19-b). Search query, status, and tag
  // filter all sync to the URL so a refresh or shared link preserves them.
  // `tagsParam` is a comma-separated string of tag IDs; converted to/from a
  // Set for the existing filterByTags helper.
  const [q, setQ] = useUrlState<string>("q", "");
  const [status, setStatus] = useUrlState<string>("status", "all");
  const [tagsParam, setTagsParam] = useUrlState<string>("tags", "");
  const tagFilter = React.useMemo<Set<string>>(
    () => new Set(tagsParam ? tagsParam.split(",").filter(Boolean) : []),
    [tagsParam],
  );
  const setTagFilter = React.useCallback(
    (next: Set<string>) => setTagsParam(Array.from(next).join(",")),
    [setTagsParam],
  );

  // Consume drill-down preset from the dashboard PO-Status pie chart — the
  // preset is the PO status string (open | partially_delivered |
  // fully_delivered | closed). We set the existing status Select to it so the
  // table filters immediately; the Select + Filtered badge both surface the
  // active filter. Because `setStatus` is now backed by useUrlState, the
  // drill-down also syncs to the URL — so the URL reflects the drill state.
  // The URL on mount takes precedence for the initial state (useUrlState
  // reads it in a useEffect); this drill effect only fires when a new
  // drillFilter arrives from the dashboard after the view has mounted.
  const consumedDrill = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!drillFilter) return;
    const key = `${drillFilter.view}:${drillFilter.preset}`;
    if (consumedDrill.current === key) return;
    if (drillFilter.view === "pos") {
      const preset = drillFilter.preset;
      if (STATUS_OPTIONS.some((o) => o.value === preset)) {
        setStatus(preset);
        consumedDrill.current = key;
        clearDrill();
      }
    }
  }, [drillFilter, clearDrill, setStatus]);

  const toggleTag = (id: string) => {
    // Closure-based toggle (useUrlState's setter takes a value, not an
    // updater). `tagFilter` re-evaluates on every render so this stays current.
    const next = new Set(tagFilter);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTagFilter(next);
  };

  const rows = filterByTags(
    (data?.purchaseOrders ?? []).filter((p) => {
      const matchesQ =
        p.poNumber.toLowerCase().includes(q.toLowerCase()) ||
        p.client.name.toLowerCase().includes(q.toLowerCase()) ||
        p.supplier.name.toLowerCase().includes(q.toLowerCase());
      const matchesStatus = status === "all" || p.status === status;
      return matchesQ && matchesStatus;
    }),
    tagFilter,
  );

  // Apply pagination to the filtered POs — default page size 10.
  const {
    paginated, currentPage, totalPages, size, setPage, setSize, range,
  } = usePagination<PoRow>(rows, 10);

  // Reset to page 1 whenever the search query, status filter, or tag filter
  // changes so the user is never stuck on a page that no longer exists.
  React.useEffect(() => {
    setPage(1);
  }, [q, status, tagFilter, setPage]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Purchase Orders"
        description="PO tracking & fulfillment"
        action={
          <div className="flex items-center gap-2">
            <ShareLinkButton />
            <Button size="sm" variant="outline" onClick={() => window.open("/api/export?type=pos", "_blank")}>
              <Download className="mr-1.5 size-4" />Export CSV
            </Button>
          </div>
        }
      />

      <SavedViewsBar
        view="pos"
        currentFilter={{ q, status, selectedTagIds: Array.from(tagFilter) }}
        isFilterActive={isFilterActive({ q, status, selectedTagIds: Array.from(tagFilter) })}
        onApply={(f) => {
          setQ(typeof f.q === "string" ? f.q : "");
          if (typeof f.status === "string") setStatus(f.status);
          const ids = Array.isArray(f.selectedTagIds)
            ? f.selectedTagIds.filter((x): x is string => typeof x === "string")
            : [];
          setTagFilter(new Set(ids));
        }}
      />

      <GlassCard className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search PO no, client, supplier…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border-0 bg-transparent pl-9 shadow-none focus-visible:ring-1"
          />
        </div>
        <div className="sm:w-56">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="border-0 bg-transparent shadow-none focus-visible:ring-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </GlassCard>

      <GlassCard className="p-3">
        <TagFilterBar
          selected={tagFilter}
          onToggle={toggleTag}
          onClear={() => setTagFilter(new Set())}
          entityTypeCount="purchaseOrders"
        />
      </GlassCard>

      {status !== "all" && (
        <div className="-mt-1">
          <Badge
            variant="outline"
            className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          >
            <Filter className="mr-1 size-3" />
            Filtered: {titleCase(STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status)}
            <button
              type="button"
              onClick={() => setStatus("all")}
              aria-label="Clear status filter"
              className="ml-1 inline-flex size-3.5 items-center justify-center rounded-full hover:bg-emerald-500/20"
            >
              <X className="size-3" />
            </button>
          </Badge>
        </div>
      )}

      <PullToRefresh onRefresh={refresh}>
        {loading ? (
          <Skeleton className="h-72 rounded-2xl" />
        ) : rows.length === 0 ? (
          <GlassCard className="p-8">
            <EmptyState
              title="No purchase orders"
              hint="Record a booking from an occurred visit to auto-generate a PO."
              icon={<FileText className="size-5" />}
            />
          </GlassCard>
        ) : (
          <>
            <GlassCard className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/40 hover:bg-transparent">
                      <TableHead className="pl-4">PO Number</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="min-w-[140px]">Fulfillment</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Bill</TableHead>
                      <TableHead>Tags</TableHead>
                      <TableHead className="pr-4">Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.map((p) => (
                      <TableRow
                        key={p.id}
                        onClick={() => openDetail("PurchaseOrder", p.id)}
                        className="cursor-pointer"
                      >
                        <TableCell className="pl-4 font-medium">{p.poNumber}</TableCell>
                        <TableCell className="max-w-[160px] truncate text-muted-foreground">{p.client.name}</TableCell>
                        <TableCell className="max-w-[160px] truncate text-muted-foreground">{p.supplier.name}</TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(p.totalValue, { compact: true })}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={p.fulfillment} className="h-1.5 w-20" />
                            <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                              {p.dispatchedQty}/{p.orderedQty}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell><StatusChip status={p.status} /></TableCell>
                        <TableCell>
                          {p.bill ? <StatusChip status={p.bill.status} /> : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          {p.tags && p.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {p.tags.map((t) => <TagBadge key={t.id} tag={t} size="sm" />)}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="pr-4 text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
                        <TableCell className="pr-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(`/api/reports?type=purchase-order&poId=${p.id}`, "_blank");
                            }}
                          >
                            <Printer className="mr-1 size-3" />PO PDF
                          </Button>
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
