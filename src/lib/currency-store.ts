"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// Display-currency preference store.
//
// All amounts in the database are stored in INR — this store only controls
// which currency the UI uses for *display* (via the static rates in
// `src/lib/currency.ts`). Persisted to localStorage so the broker's choice
// survives reloads and across browser sessions.
//
// `skipHydration: true` + explicit `rehydrate()` call from the hook avoids
// SSR/Next.js hydration mismatches: server-rendered HTML always shows INR,
// then the client swaps to the saved currency after mount.

type CurrencyState = {
  currency: string; // Currency code — see CURRENCIES in src/lib/currency.ts
  setCurrency: (code: string) => void;
};

export const useCurrency = create<CurrencyState>()(
  persist(
    (set) => ({
      currency: "INR",
      setCurrency: (code) => set({ currency: code }),
    }),
    {
      name: "broker-os:currency",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      skipHydration: true,
      // Only the `currency` field is persisted; setCurrency is a function and
      // is rehydrated from the store definition.
      partialize: (s) => ({ currency: s.currency }),
    },
  ),
);
