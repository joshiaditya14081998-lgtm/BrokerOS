"use client";

import * as React from "react";
import type { PrefixMode } from "@/hooks/use-keyboard-shortcuts";

/**
 * Floating pill shown at the bottom-center while a prefix key (g or n) is
 * active. Includes a 1-second progress bar that depletes in sync with the
 * prefix timeout. Mounts fresh each time the mode changes (via `key`) so the
 * CSS animation restarts reliably.
 */
export function ShortcutPrefixIndicator({ mode }: { mode: PrefixMode | null }) {
  if (!mode) return null;
  const label = mode === "g" ? "g —" : "n —";
  const hint = mode === "g" ? "navigation" : "new entity";
  return (
    <div
      key={mode}
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 overflow-hidden rounded-full glass-strong px-4 py-2 text-sm font-medium shadow-lg"
    >
      <span className="inline-flex items-center gap-2">
        <kbd className="pointer-events-none select-none rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
          {mode}
        </kbd>
        <span className="text-foreground">{label}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{hint}</span>
      </span>
      <span
        aria-hidden
        className="block h-1 w-10 overflow-hidden rounded-full bg-muted/70"
      >
        <span
          className="block h-full origin-left rounded-full bg-primary"
          style={{ animation: "shortcutPrefixProgress 1s linear forwards" }}
        />
      </span>
    </div>
  );
}
