"use client";

import * as React from "react";
import { useUI, type ViewKey } from "@/lib/ui-store";

/**
 * Global keyboard shortcuts system.
 *
 * Two kinds of shortcuts are supported:
 *
 * 1. Single-key shortcuts (fire immediately):
 *    - "?"  → toggle the shortcuts help overlay
 *    - "/"  → open the command palette (search)
 *    - Esc  → close any open overlay (help, command palette)
 *
 * 2. Sequential two-key shortcuts (a prefix key followed by another key
 *    within {@link PREFIX_TIMEOUT_MS} milliseconds):
 *    - "g <key>" → navigate to a view (see {@link G_PREFIX_MAP})
 *    - "n <key>" → trigger a "New <entity>" dialog (see {@link N_PREFIX_MAP})
 *
 * Shortcuts are ignored while the user is typing in an input, textarea,
 * select, or contentEditable element, and while a modifier key (Cmd/Ctrl/Alt)
 * is held down (so browser & Cmd+K shortcuts keep working).
 */

const PREFIX_TIMEOUT_MS = 1000;

/** "g <key>" → view to navigate to. */
const G_PREFIX_MAP: Record<string, ViewKey> = {
  d: "dashboard",
  a: "analytics",
  c: "clients",
  s: "suppliers",
  v: "visits",
  p: "pos",
  t: "dispatches", // t for tracking
  b: "bills",
  y: "payments", // y for paYments (p is taken)
  k: "brokerage", // k for kommission
  u: "disputes", // u for dispUtes
  n: "notifications",
  o: "portal", // o for pOrtal
  e: "settings", // e for sEttings
};

/** "n <key>" → entity whose "New X" dialog should open. */
const N_PREFIX_MAP: Record<string, string> = {
  c: "clients",
  p: "pos", // POs are created from Visits → Record Booking
  d: "dispatches",
  b: "bills",
  y: "payments",
};

function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  return false;
}

export type PrefixMode = "g" | "n";

/**
 * Registers a global `keydown` listener that implements the shortcuts
 * described above. Returns the current prefix mode (null when idle) so the
 * caller can render the {@link ShortcutPrefixIndicator} component.
 */
export function useKeyboardShortcuts(): { prefixMode: PrefixMode | null } {
  const setView = useUI((s) => s.setView);
  const setCmdOpen = useUI((s) => s.setCmdOpen);
  const showShortcuts = useUI((s) => s.showShortcuts);
  const setShowShortcuts = useUI((s) => s.setShowShortcuts);
  const triggerNewEntity = useUI((s) => s.triggerNewEntity);

  const [prefixMode, setPrefixMode] = React.useState<PrefixMode | null>(null);
  const prefixTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPrefix = React.useCallback(() => {
    setPrefixMode(null);
    if (prefixTimer.current) {
      clearTimeout(prefixTimer.current);
      prefixTimer.current = null;
    }
  }, []);

  const enterPrefix = React.useCallback((mode: PrefixMode) => {
    setPrefixMode(mode);
    if (prefixTimer.current) clearTimeout(prefixTimer.current);
    prefixTimer.current = setTimeout(() => {
      setPrefixMode(null);
      prefixTimer.current = null;
    }, PREFIX_TIMEOUT_MS);
  }, []);

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Escape always works — even inside inputs — so users can dismiss
      // overlays from anywhere.
      if (e.key === "Escape") {
        if (showShortcuts) setShowShortcuts(false);
        setCmdOpen(false);
        clearPrefix();
        return;
      }

      // Don't fire shortcuts while typing in form fields.
      if (isEditableTarget(e)) {
        clearPrefix();
        return;
      }

      // Let modifier combos (Cmd/Ctrl/Alt) fall through to the browser and
      // the existing Cmd+K command-palette handler.
      if (e.metaKey || e.ctrlKey || e.altKey) {
        clearPrefix();
        return;
      }

      const key = e.key.toLowerCase();

      // Waiting for the second key of a "g …" or "n …" sequence.
      if (prefixMode) {
        e.preventDefault();
        const map = prefixMode === "g" ? G_PREFIX_MAP : N_PREFIX_MAP;
        if (Object.prototype.hasOwnProperty.call(map, key)) {
          const value = map[key];
          if (prefixMode === "g") {
            setView(value as ViewKey);
          } else {
            triggerNewEntity(value);
          }
        }
        clearPrefix();
        return;
      }

      // Enter g-prefix / n-prefix mode.
      if (key === "g") {
        e.preventDefault();
        enterPrefix("g");
        return;
      }
      if (key === "n") {
        e.preventDefault();
        enterPrefix("n");
        return;
      }

      // Toggle the help overlay ("?" — typically Shift+/).
      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts(!showShortcuts);
        return;
      }

      // "/" opens the command palette (search).
      if (e.key === "/") {
        e.preventDefault();
        setCmdOpen(true);
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    prefixMode,
    showShortcuts,
    setView,
    setCmdOpen,
    setShowShortcuts,
    triggerNewEntity,
    clearPrefix,
    enterPrefix,
  ]);

  // Clean up the prefix timer on unmount.
  React.useEffect(() => {
    return () => {
      if (prefixTimer.current) clearTimeout(prefixTimer.current);
    };
  }, []);

  return { prefixMode };
}
