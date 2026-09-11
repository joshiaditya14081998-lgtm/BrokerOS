"use client";

import { create } from "zustand";

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard layout store — per-broker card visibility + order, persisted to
// localStorage so the broker's preferred arrangement survives reloads.
//
// Cards are top-level dashboard sections. The dashboard-view renders them in
// the order specified by `cardOrder`, skipping any id listed in `hiddenCards`.
//
// Persistence model: on mount, `hydrate()` reads localStorage and merges any
// NEW cards (added in a future update) at the end of the stored order so the
// broker still sees them without losing their saved arrangement. Writes are
// manual (we don't use Zustand's persist middleware) so we have full control
// over the merge + sanitize logic.
// ─────────────────────────────────────────────────────────────────────────────

export type DashboardCardId =
  | "kpiOverview"
  | "secondaryKpis"
  | "actionCenter"
  | "earningsChart"
  | "poStatusChart"
  | "volumeByClient"
  | "dueReminders"
  | "brokeragePosition"
  | "quickTips";

/** Canonical default order — also the source of truth for "all known cards". */
export const DEFAULT_CARD_ORDER: DashboardCardId[] = [
  "kpiOverview",
  "secondaryKpis",
  "actionCenter",
  "earningsChart",
  "poStatusChart",
  "volumeByClient",
  "dueReminders",
  "brokeragePosition",
  "quickTips",
];

/** All known card ids. Used to filter out stale ids from older localStorage. */
export const ALL_DASHBOARD_CARDS: DashboardCardId[] = [...DEFAULT_CARD_ORDER];

/** Human-friendly labels — used by the customize toolbar + recovery panel. */
export const DASHBOARD_CARD_LABELS: Record<DashboardCardId, string> = {
  kpiOverview: "KPI Overview",
  secondaryKpis: "Quick Stats",
  actionCenter: "Action Center",
  earningsChart: "Brokerage Earnings Trend",
  poStatusChart: "PO Status",
  volumeByClient: "Business Volume by Client",
  dueReminders: "Due Reminders",
  brokeragePosition: "Brokerage Position",
  quickTips: "Quick Tips",
};

const STORAGE_KEY = "broker-os:dashboard-layout";

type StoredShape = {
  cardOrder: DashboardCardId[];
  hiddenCards: DashboardCardId[];
};

type DashboardLayoutState = {
  cardOrder: DashboardCardId[];
  hiddenCards: DashboardCardId[];
  /** Customize mode = drag handles + hide buttons visible. Off by default. */
  customizeMode: boolean;
  /** True once `hydrate()` has run on mount; lets the UI avoid flashing the
   *  default order before localStorage is read on first paint. */
  hydrated: boolean;
  setCardOrder: (order: DashboardCardId[]) => void;
  toggleCard: (id: DashboardCardId) => void;
  resetLayout: () => void;
  setCustomizeMode: (on: boolean) => void;
  hydrate: () => void;
};

/** Read + sanitize + merge-forward the stored layout. Returns null if there's
 *  nothing stored or the payload is corrupt. */
function readStored(): StoredShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const known = new Set<DashboardCardId>(ALL_DASHBOARD_CARDS);

    // Sanitize cardOrder: keep only known ids, drop dupes, then merge in any
    // newly-added cards (in DEFAULT order) at the end.
    const rawOrder = (parsed as { cardOrder?: unknown }).cardOrder;
    const order: DashboardCardId[] = Array.isArray(rawOrder)
      ? (rawOrder as unknown[]).filter(
          (id): id is DashboardCardId =>
            typeof id === "string" && known.has(id as DashboardCardId),
        )
      : [];
    // De-dupe in place.
    const seen = new Set<DashboardCardId>(order);
    for (const def of DEFAULT_CARD_ORDER) {
      if (!seen.has(def)) {
        order.push(def);
        seen.add(def);
      }
    }

    // Sanitize hiddenCards: keep only known ids not in cardOrder (defensive).
    const rawHidden = (parsed as { hiddenCards?: unknown }).hiddenCards;
    const hidden: DashboardCardId[] = Array.isArray(rawHidden)
      ? (rawHidden as unknown[]).filter(
          (id): id is DashboardCardId =>
            typeof id === "string" && known.has(id as DashboardCardId),
        )
      : [];

    return { cardOrder: order, hiddenCards: hidden };
  } catch {
    return null;
  }
}

function writeStored(state: StoredShape) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage unavailable or quota exceeded — state still works for this
     * session, just won't survive a reload. */
  }
}

export const useDashboardLayout = create<DashboardLayoutState>((set, get) => ({
  cardOrder: DEFAULT_CARD_ORDER,
  hiddenCards: [],
  customizeMode: false,
  hydrated: false,

  setCardOrder: (order) => {
    set({ cardOrder: order });
    writeStored({ cardOrder: order, hiddenCards: get().hiddenCards });
  },

  toggleCard: (id) => {
    const hidden = get().hiddenCards;
    const next = hidden.includes(id)
      ? hidden.filter((c) => c !== id)
      : [...hidden, id];
    set({ hiddenCards: next });
    writeStored({ cardOrder: get().cardOrder, hiddenCards: next });
  },

  resetLayout: () => {
    set({ cardOrder: DEFAULT_CARD_ORDER, hiddenCards: [] });
    writeStored({ cardOrder: DEFAULT_CARD_ORDER, hiddenCards: [] });
  },

  setCustomizeMode: (on) => set({ customizeMode: on }),

  hydrate: () => {
    const stored = readStored();
    if (stored) {
      set({ cardOrder: stored.cardOrder, hiddenCards: stored.hiddenCards, hydrated: true });
    } else {
      set({ hydrated: true });
    }
  },
}));

/** Helper for the "Customized" badge — true if the layout differs from the
 *  default order OR any cards are hidden. */
export function isLayoutCustomized(state: {
  cardOrder: DashboardCardId[];
  hiddenCards: DashboardCardId[];
}): boolean {
  if (state.hiddenCards.length > 0) return true;
  if (state.cardOrder.length !== DEFAULT_CARD_ORDER.length) return true;
  for (let i = 0; i < state.cardOrder.length; i++) {
    if (state.cardOrder[i] !== DEFAULT_CARD_ORDER[i]) return true;
  }
  return false;
}
