"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { ArrowDown, Loader2 } from "lucide-react";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { cn } from "@/lib/utils";

const DEFAULT_THRESHOLD = 80;

/**
 * Glass pill pull-to-refresh wrapper.
 *
 * Renders:
 *  - A glass pill indicator at the top (emerald accent) that fades in as the
 *    user pulls. Label flips between "Pull to refresh" → "Release to refresh"
 *    → "Refreshing…" with a rotating Loader2 spinner while the promise is
 *    in flight.
 *  - The children, translated down by `pullDistance` for visual feedback.
 *
 * Touch-only: the underlying hook is a no-op on mouse / desktop, so this
 * component is safe to wrap any list with — desktop users won't see anything.
 */
export function PullToRefresh({
  onRefresh,
  children,
  className,
  threshold = DEFAULT_THRESHOLD,
}: {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  className?: string;
  threshold?: number;
}) {
  const { containerRef, pulling, pullDistance, refreshing } = usePullToRefresh({
    onRefresh,
    threshold,
  });

  const progress = Math.min(1, pullDistance / threshold);
  const atThreshold = pullDistance >= threshold;

  const label = refreshing
    ? "Refreshing…"
    : atThreshold
      ? "Release to refresh"
      : "Pull to refresh";

  // The indicator is visible whenever the user is interacting or refreshing.
  const indicatorVisible = pulling || refreshing || pullDistance > 0;

  // Children translate down by the live pull distance while pulling, or rest
  // at half-threshold while refreshing (leaving room for the spinner).
  const childY = refreshing ? threshold * 0.5 : pullDistance;

  // While pulling, follow the finger instantly (no lag). On release or
  // refresh, smoothly animate to the target.
  const transition = pulling
    ? { duration: 0 }
    : { duration: 0.3, ease: "easeOut" as const };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Pull indicator — glass pill pinned to the top of the container */}
      <motion.div
        className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2"
        animate={{ opacity: indicatorVisible ? 1 : 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        style={{ y: 10 }}
        aria-hidden={!indicatorVisible}
      >
        <div className="glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-emerald-600 shadow-lg shadow-emerald-500/10 dark:text-emerald-400">
          {refreshing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <motion.span
              animate={{ rotate: atThreshold ? 180 : 0 }}
              transition={{ duration: 0.15 }}
              className="inline-flex"
              style={{ rotate: progress * 180 }}
            >
              <ArrowDown className="size-3.5" />
            </motion.span>
          )}
          <span>{label}</span>
        </div>
      </motion.div>

      {/* Children — translated down by the pull distance */}
      <motion.div animate={{ y: childY }} transition={transition}>
        {children}
      </motion.div>
    </div>
  );
}
