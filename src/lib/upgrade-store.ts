"use client";

import { create } from "zustand";

// ─────────────────────────────────────────────────────────────────────────────
// Upgrade modal store — triggered when a 402 Payment Required response is
// received from any API route (clients/suppliers/POs/photos limit reached).
//
// The `api()` helper in src/lib/api.ts detects HTTP 402 responses and calls
// `triggerUpgrade()` instead of throwing an error. This shows a friendly
// upgrade modal with plan options rather than a scary red toast.
// ─────────────────────────────────────────────────────────────────────────────

type UpgradeResource = "clients" | "suppliers" | "pos" | "photos";

type UpgradeState = {
  open: boolean;
  resource: UpgradeResource;
  current: number;
  limit: number;
  planName: string;
  triggerUpgrade: (data: { resource: UpgradeResource; current: number; limit: number; planName: string }) => void;
  close: () => void;
};

export const useUpgradeModal = create<UpgradeState>((set) => ({
  open: false,
  resource: "clients",
  current: 0,
  limit: 0,
  planName: "Free",
  triggerUpgrade: (data) =>
    set({ open: true, ...data }),
  close: () => set({ open: false }),
}));
