"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { defaultLocale, type Locale } from "@/lib/i18n";

// Locale preference store.
//
// The broker's chosen interface language (English / Hindi / Gujarati).
// Persisted to localStorage so the choice survives reloads and across
// browser sessions.
//
// `skipHydration: true` + the explicit `rehydrate()` call inside
// `useTranslation` avoids SSR/Next.js hydration mismatches: server-rendered
// HTML always uses `defaultLocale` ("en"), then the client swaps to the
// saved locale after mount. Translations swap instantly on the next render
// (no page reload) because every translated component reads `locale` from
// Zustand via `useTranslation`, which re-subscribes to the store.

type LocaleState = {
  locale: Locale;
  setLocale: (l: Locale) => void;
};

export const useLocale = create<LocaleState>()(
  persist(
    (set) => ({
      locale: defaultLocale,
      setLocale: (l) => set({ locale: l }),
    }),
    {
      name: "broker-os:locale",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      skipHydration: true,
      // Only persist the `locale` field — `setLocale` is a function and is
      // rehydrated from the store definition.
      partialize: (s) => ({ locale: s.locale }),
    },
  ),
);
