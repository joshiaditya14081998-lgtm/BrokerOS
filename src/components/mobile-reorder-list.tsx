"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp, ChevronDown, Eye, EyeOff, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// MobileReorderList
//
// Touch-friendly reorder panel — used by the dashboard's customize mode on
// touch devices (phones, tablets) instead of @dnd-kit drag-and-drop. The
// broker taps up / down chevrons to swap a card with its neighbour; tapping
// the eye icon on the right brings a hidden card back.
//
// Why this exists: dnd-kit's PointerSensor works on touch but long-press
// gestures are awkward on a phone — the broker is often on-site with one
// hand. A simple up/down list is faster and more reliable.
//
// Each row is a `glass rounded-xl p-3` card with `hover-lift`. Up/down
// buttons are emerald, `size-8` (32px icon-only target inside a 44px
// touch-safe hit area via padding). The active card (the one most recently
// moved) gets an emerald ring + slight scale for 300ms so the broker sees
// which card just moved.
//
// Haptic feedback: `navigator.vibrate?.(10)` on every up/down tap (wrapped
// in try-catch — Safari/Firefox don't support it and throw on access in
// some versions).
//
// Hidden cards: rendered in a separate "Hidden" section at the bottom with
// a Show (eye) button — this replaces the desktop recovery panel.
// ─────────────────────────────────────────────────────────────────────────────

export type MobileReorderItem = {
  id: string;
  label: string;
  icon?: React.ReactNode;
};

export type MobileReorderHiddenItem = MobileReorderItem;

export function MobileReorderList({
  items,
  hiddenItems,
  onReorder,
  onShow,
  onHide,
}: {
  /** Visible cards, in display order. */
  items: MobileReorderItem[];
  /** Hidden cards (recoverable). */
  hiddenItems?: MobileReorderHiddenItem[];
  /** Called with the new full order (of visible ids) after a swap. */
  onReorder: (newOrder: string[]) => void;
  /** Called when the user taps "Show" on a hidden card. */
  onShow?: (id: string) => void;
  /** Called when the user taps "Hide" on a visible card. */
  onHide?: (id: string) => void;
}) {
  // The id of the card most recently moved (up/down click). Drives the
  // emerald-ring highlight that fades out after 300ms.
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const fadeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending fade timer on unmount.
  React.useEffect(() => {
    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, []);

  /** Mark a card as "just moved" so we can flash the emerald ring. */
  const flashActive = React.useCallback((id: string) => {
    setActiveId(id);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => setActiveId(null), 300);
  }, []);

  /** Subtle haptic tick. Wrapped in try-catch since not all browsers
   *  support `navigator.vibrate` (Safari/Firefox) and some versions throw
   *  on access. */
  const haptic = React.useCallback((ms: number = 10) => {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(ms);
      }
    } catch {
      /* no-op — unsupported */
    }
  }, []);

  /** Swap item at `index` with its neighbour in `direction`. Calls
   *  `onReorder` with the new order, flashes the moved card, and triggers
   *  a haptic tick. No-op at list boundaries. */
  const move = React.useCallback(
    (index: number, direction: -1 | 1) => {
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= items.length) return;
      const ids = items.map((i) => i.id);
      const tmp = ids[index];
      ids[index] = ids[newIndex];
      ids[newIndex] = tmp;
      // The id of the card the broker clicked — that's the one that moved.
      const movedId = items[index].id;
      flashActive(movedId);
      haptic(10);
      onReorder(ids);
    },
    [items, onReorder, flashActive, haptic],
  );

  const handleShow = React.useCallback(
    (id: string) => {
      haptic(10);
      onShow?.(id);
    },
    [onShow, haptic],
  );

  const handleHide = React.useCallback(
    (id: string) => {
      haptic(10);
      onHide?.(id);
    },
    [onHide, haptic],
  );

  const hasHidden = (hiddenItems?.length ?? 0) > 0;
  const isEmpty = items.length === 0;

  return (
    <div className="space-y-5">
      {/* Visible cards — reorderable via up/down chevrons */}
      <div className="space-y-2.5">
        <AnimatePresence initial={false}>
          {items.map((item, index) => {
            const isFirst = index === 0;
            const isLast = index === items.length - 1;
            const isActive = activeId === item.id;
            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ layout: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }, default: { duration: 0.18 } }}
              >
                <div
                  className={cn(
                    "glass hover-lift flex items-center gap-2 rounded-xl p-3 transition-shadow",
                    isActive
                      ? "ring-2 ring-emerald-500/70 scale-[1.015] shadow-md"
                      : "ring-1 ring-transparent",
                  )}
                >
                  {/* Disabled drag handle — visual cue only on touch devices */}
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 cursor-not-allowed place-items-center rounded-md text-muted-foreground/50"
                  >
                    <GripVertical className="size-4" />
                  </span>

                  {/* Card label + icon */}
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {item.icon ? (
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                        {item.icon}
                      </span>
                    ) : null}
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.label}
                    </span>
                  </div>

                  {/* Hide button (eye-off) — only if callback is provided.
                      Smaller than up/down since it's a less-frequent action,
                      but still ≥44px hit area for touch accessibility. */}
                  {onHide ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleHide(item.id)}
                      aria-label={`Hide ${item.label} from dashboard`}
                      className="size-8 min-h-11 min-w-11 shrink-0 p-0 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
                    >
                      <EyeOff className="size-4" />
                    </Button>
                  ) : null}

                  {/* Up chevron — emerald, 44px touch target (size-8 visual +
                      min-h/w-11 hit area to satisfy WCAG mobile minimum). */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => move(index, -1)}
                    disabled={isFirst}
                    aria-label={`Move ${item.label} up`}
                    className="size-8 min-h-11 min-w-11 shrink-0 border-emerald-500/30 bg-emerald-500/5 p-0 text-emerald-700 hover:bg-emerald-500/15 hover:text-emerald-800 disabled:opacity-30 dark:text-emerald-300 dark:hover:text-emerald-200"
                  >
                    <ChevronUp className="size-4" />
                  </Button>

                  {/* Down chevron */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => move(index, 1)}
                    disabled={isLast}
                    aria-label={`Move ${item.label} down`}
                    className="size-8 min-h-11 min-w-11 shrink-0 border-emerald-500/30 bg-emerald-500/5 p-0 text-emerald-700 hover:bg-emerald-500/15 hover:text-emerald-800 disabled:opacity-30 dark:text-emerald-300 dark:hover:text-emerald-200"
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {isEmpty && hasHidden && (
          <div className="glass rounded-xl p-6 text-center text-sm text-muted-foreground">
            No visible cards. Re-add one from the Hidden section below.
          </div>
        )}
      </div>

      {/* Hidden cards recovery — replaces the desktop recovery panel on touch */}
      {hasHidden ? (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 px-1">
            <Eye className="size-3.5 text-muted-foreground" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Hidden cards
            </h4>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {(hiddenItems?.length ?? 0)} hidden
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {hiddenItems!.map((item) => (
              <Button
                key={item.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleShow(item.id)}
                aria-label={`Show ${item.label} card`}
                className="gap-1.5 border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-emerald-700 hover:bg-emerald-500/15 hover:text-emerald-800 dark:text-emerald-300"
              >
                <Eye className="size-3.5" />
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default MobileReorderList;
