"use client";

import { create } from "zustand";

export type ViewKey =
  | "dashboard"
  | "analytics"
  | "digest"
  | "clients"
  | "suppliers"
  | "visits"
  | "pos"
  | "dispatches"
  | "bills"
  | "payments"
  | "brokerage"
  | "party-ledger"
  | "disputes"
  | "notifications"
  | "audit"
  | "data-health"
  | "tags"
  | "saved-views"
  | "report-builder"
  | "api-docs"
  | "settings"
  | "portal"
  // Sprint 4 — offline draft-save. The Draft Queue view (S4A) renders under
  // this key; the header offline/sync badges + the Settings Network Status
  // card navigate here when the broker clicks them.
  | "drafts"
  // S4A — Draft Queue view key. The sidebar nav item, command palette, and
  // the page router all use this key. (A separate `"drafts"` key is kept
  // for any parallel Sprint 4 wiring that may reference it.)
  | "draft-queue"
  // SA2 — Billing & Plan view. Stripe-backed subscription management
  // (checkout, portal, usage limits, plan comparison). Sidebar nav item +
  // command palette + the page router all use this key.
  | "billing"
  // ACC1 — Broker Expense Tracking. Operating-cost ledger (travel, phone,
  // staff salary, office rent, marketing, misc). Sidebar nav item +
  // command palette + the page router all use this key.
  | "expenses";

// A drill-down preset is a (view, preset) tuple that list views read on mount
// to pre-filter themselves. The dashboard's KPI cards / chart elements use
// `drillTo()` to push a preset; each list view's mount effect checks for a
// matching preset, applies it to its local filter state, then calls
// `clearDrill()` so subsequent manual navigation doesn't carry stale state.
export type DrillFilter = { view: ViewKey; preset: string };

// A "saved-view apply" trigger — set by the Saved Views management page when
// the user clicks Apply on a saved view. The target list view's SavedViewsBar
// watches this via `useUI` and calls its `onApply` callback with the parsed
// filter, then clears the trigger so it doesn't re-fire on subsequent
// navigation. `nonce` lets the same view re-apply if the user clicks Apply
// twice on the same saved view (otherwise the unchanged reference would be
// skipped by the consumer's useEffect dependency check).
export type SavedViewApply = {
  view: string;
  filter: Record<string, unknown>;
  nonce: number;
};

type UIState = {
  view: ViewKey;
  // Optional context id (e.g. selected client id for detail drawer)
  detailId: string | null;
  detailType: string | null;
  // Global command palette (Cmd+K / Ctrl+K)
  cmdOpen: boolean;
  // Drill-down preset — set by `drillTo`, cleared by `setView`/`clearDrill`.
  drillFilter: DrillFilter | null;
  // Keyboard shortcuts help overlay (toggled by "?" key)
  showShortcuts: boolean;
  // New-entity trigger: set by the "n <key>" keyboard shortcut so the target
  // view's "New X" dialog auto-opens. Cleared by `setView` so a stale trigger
  // doesn't linger across manual navigation. `nonce` lets views re-run their
  // open-effect even when the trigger view string is unchanged.
  newEntityTrigger: { view: string; nonce: number } | null;
  // Saved-view apply trigger — set by `applySavedView`, cleared by the
  // consuming view's SavedViewsBar via `clearSavedViewApply`. NOT cleared by
  // `setView` because the apply must survive the navigation that
  // `applySavedView` triggers (the management page calls applySavedView +
  // setView in sequence; the target view mounts and consumes the trigger).
  savedViewApply: SavedViewApply | null;
  setView: (v: ViewKey) => void;
  openDetail: (type: string, id: string) => void;
  closeDetail: () => void;
  setCmdOpen: (open: boolean) => void;
  drillTo: (view: ViewKey, preset: string) => void;
  clearDrill: () => void;
  setShowShortcuts: (open: boolean) => void;
  triggerNewEntity: (view: string) => void;
  applySavedView: (view: string, filter: Record<string, unknown>) => void;
  clearSavedViewApply: () => void;
};

export const useUI = create<UIState>((set) => ({
  view: "dashboard",
  detailId: null,
  detailType: null,
  cmdOpen: false,
  drillFilter: null,
  showShortcuts: false,
  newEntityTrigger: null,
  savedViewApply: null,
  // Manual navigation never carries a drill filter — only `drillTo` does.
  // We also clear `newEntityTrigger` so a stale "open new-X dialog" intent
  // from a prior shortcut doesn't leak into the freshly-navigated view.
  setView: (v) => set({ view: v, detailId: null, detailType: null, drillFilter: null, newEntityTrigger: null }),
  openDetail: (type, id) => set({ detailType: type, detailId: id }),
  closeDetail: () => set({ detailId: null, detailType: null }),
  setCmdOpen: (open) => set({ cmdOpen: open }),
  // Drill-down: switch view AND push a preset for the target view to consume.
  drillTo: (view, preset) => set({ view, detailId: null, detailType: null, drillFilter: { view, preset } }),
  // Called by list views after they've applied the preset, so the store
  // doesn't leak stale filters into later navigations.
  clearDrill: () => set({ drillFilter: null }),
  setShowShortcuts: (open) => set({ showShortcuts: open }),
  // Switch to the target view AND fire a one-shot trigger so the view's
  // "New X" dialog auto-opens. Note: "pos" creation happens inside the
  // Visits view (Visits → Record Booking → auto PO), so we navigate to
  // `visits` but keep the trigger view string as "pos" for visits-view to
  // match on. We bypass `setView` here so the trigger isn't immediately
  // cleared.
  triggerNewEntity: (view) =>
    set({
      view: view === "pos" ? "visits" : (view as ViewKey),
      detailId: null,
      detailType: null,
      drillFilter: null,
      newEntityTrigger: { view, nonce: Date.now() },
    }),
  // Push a saved-view apply trigger. The management page calls this then
  // `setView(view)`; the target view's SavedViewsBar consumes the trigger in
  // a useEffect and calls its `onApply` with the parsed filter.
  applySavedView: (view, filter) =>
    set({ savedViewApply: { view, filter, nonce: Date.now() } }),
  // Called by the SavedViewsBar after it has applied the filter so the
  // trigger doesn't re-fire on subsequent renders / navigations.
  clearSavedViewApply: () => set({ savedViewApply: null }),
}));
