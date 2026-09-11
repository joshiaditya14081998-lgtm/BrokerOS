"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type PaginationRange = { from: number; to: number; total: number };

export function PaginationBar({
  currentPage,
  totalPages,
  range,
  onPageChange,
  pageSize,
  onPageSizeChange,
}: {
  currentPage: number;
  totalPages: number;
  range: PaginationRange;
  onPageChange: (p: number) => void;
  pageSize: number;
  onPageSizeChange?: (s: number) => void;
}) {
  // Hide entirely when total <= pageSize — no pagination needed.
  if (range.total <= pageSize) return null;

  // Build page-number list: show current ±1, plus first/last with ellipses
  // for any gaps. Dedupes consecutive identical entries.
  const startPage = Math.max(1, currentPage - 1);
  const endPage = Math.min(totalPages, currentPage + 1);
  const pages: (number | "ellipsis")[] = [];
  const push = (n: number | "ellipsis") => {
    if (pages[pages.length - 1] !== n) pages.push(n);
  };
  if (startPage > 1) {
    push(1);
    if (startPage > 2) push("ellipsis");
  }
  for (let i = startPage; i <= endPage; i++) push(i);
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) push("ellipsis");
    push(totalPages);
  }

  const atFirst = currentPage <= 1;
  const atLast = currentPage >= totalPages;

  return (
    <div
      role="navigation"
      aria-label="Pagination"
      className="glass mt-3 flex flex-col items-center gap-2 rounded-xl py-2 px-3 sm:flex-row sm:justify-between sm:gap-3"
    >
      {/* Left: range summary — hidden on mobile to save vertical space */}
      <p className="hidden text-xs text-muted-foreground sm:block">
        Showing{" "}
        <span className="font-medium text-foreground">{range.from}</span>
        {"–"}
        <span className="font-medium text-foreground">{range.to}</span>
        {" of "}
        <span className="font-medium text-foreground">{range.total}</span>
      </p>

      {/* Center: page navigation (Prev · 1 2 3 … · Next) */}
      <div className="flex items-center justify-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(1)}
          disabled={atFirst}
          aria-label="First page"
        >
          <ChevronsLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={atFirst}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <span
              key={`ellipsis-${i}`}
              aria-hidden
              className="grid size-8 place-items-center text-xs text-muted-foreground"
            >
              …
            </span>
          ) : (
            <Button
              key={p}
              variant="ghost"
              size="icon"
              className={cn(
                "size-8 text-xs font-medium",
                p === currentPage
                  ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={() => onPageChange(p)}
              aria-label={`Page ${p}`}
              aria-current={p === currentPage ? "page" : undefined}
            >
              {p}
            </Button>
          ),
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={atLast}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(totalPages)}
          disabled={atLast}
          aria-label="Last page"
        >
          <ChevronsRight className="size-4" />
        </Button>
      </div>

      {/* Right: page-size selector — moves below on mobile via flex-col */}
      {onPageSizeChange ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Rows</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => onPageSizeChange(Number(v))}
          >
            <SelectTrigger className="h-8 w-[88px]" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}
