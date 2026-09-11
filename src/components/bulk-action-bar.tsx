"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * BulkActionBar — a reusable sticky bar for bulk operations.
 *
 * Renders a glass-strong bar fixed at the bottom of the viewport, centered,
 * with the count of selected items on the left, caller-supplied action
 * buttons in the middle/right, and a Clear (X) button. Animates in via a
 * slide-up + fade and only renders when `selectedCount > 0`.
 *
 * The bar wraps gracefully on mobile (flex-wrap) so that several action
 * buttons stack cleanly under the count on narrow viewports.
 */
export function BulkActionBar({
  selectedCount,
  onClear,
  children,
  className,
}: {
  selectedCount: number;
  onClear: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence>
      {selectedCount > 0 ? (
        <motion.div
          key="bulk-action-bar"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          className={cn(
            "glass-strong fixed bottom-4 left-1/2 z-30 -translate-x-1/2",
            "flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-full px-3 py-2 shadow-2xl sm:gap-3 sm:px-4",
            className,
          )}
          role="region"
          aria-label="Bulk actions toolbar"
        >
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <span
              className="grid size-5 place-items-center rounded-full bg-emerald-600 text-[10px] font-bold text-white"
              aria-hidden="true"
            >
              {selectedCount > 99 ? "99+" : selectedCount}
            </span>
            <span className="whitespace-nowrap">
              {selectedCount === 1 ? "1 selected" : `${selectedCount} selected`}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {children}
          </div>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClear}
            aria-label="Clear selection"
            className="size-8 shrink-0 rounded-full text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
          >
            <X className="size-4" />
          </Button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
