"use client";

import * as React from "react";
import { useUpgradeModal } from "@/lib/upgrade-store";

// Locale key the client persists (matches src/lib/locale-store.ts). The value
// is the Zustand persist shape: { state: { locale: "hi" }, version: 1 }.
const LOCALE_STORAGE_KEY = "broker-os:locale";

/**
 * Read the broker's chosen locale from localStorage. Returns "en" when:
 *   - running on the server (no window),
 *   - localStorage is unavailable (private mode / disabled),
 *   - the stored value is missing or malformed.
 *
 * We parse the raw JSON ourselves rather than importing the locale-store
 * (which would pull the full Zustand bundle into every `api()` call) — this
 * keeps the helper lightweight and SSR-safe.
 */
function readClientLocale(): "en" | "hi" | "gu" {
  if (typeof window === "undefined") return "en";
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (!raw) return "en";
    const parsed = JSON.parse(raw) as {
      state?: { locale?: unknown };
      locale?: unknown;
    };
    const l = parsed?.state?.locale ?? parsed?.locale;
    if (l === "en" || l === "hi" || l === "gu") return l;
    return "en";
  } catch {
    return "en";
  }
}

/**
 * Append `?locale=<en|hi|gu>` to a GET request URL so server routes can
 * translate their responses (notification messages, action-center titles —
 * see src/lib/server-i18n.ts). Skipped when:
 *   - the URL already has a `locale=` param (caller-provided override),
 *   - the path is empty (defensive — shouldn't happen in practice).
 */
function appendLocaleParam(path: string): string {
  if (!path) return path;
  // Already has an explicit locale — don't clobber it.
  if (/[?&]locale=/.test(path)) return path;
  const locale = readClientLocale();
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}locale=${locale}`;
}

// Map API endpoint → upgrade resource type for the modal.
function inferResource(path: string): "clients" | "suppliers" | "pos" | "photos" {
  if (path.includes("/clients")) return "clients";
  if (path.includes("/suppliers")) return "suppliers";
  if (path.includes("/pos") || path.includes("/purchase-orders")) return "pos";
  if (path.includes("/photos")) return "photos";
  return "clients";
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  // Only GET requests (no body, default or explicit GET method) get the locale
  // param appended. POST/PATCH/DELETE typically carry the locale-irrelevant
  // payload (or the server doesn't need it), and we don't want to mutate the
  // URL for mutation calls.
  const method = (init?.method ?? "GET").toUpperCase();
  const isGet = method === "GET" && !init?.body;
  const finalPath = isGet ? appendLocaleParam(path) : path;

  const res = await fetch(finalPath, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    // ── 402 Payment Required → trigger upgrade modal instead of throwing ──
    // When the broker hits a plan limit (clients/suppliers/POs/photos), the
    // API returns 402 with { error, current, limit, planName }. Instead of
    // showing a scary red toast, we open a friendly upgrade modal.
    if (res.status === 402) {
      const body = await res.json().catch(() => ({}));
      useUpgradeModal.getState().triggerUpgrade({
        resource: inferResource(path),
        current: body.current ?? 0,
        limit: body.limit ?? 0,
        planName: body.planName ?? "Free",
      });
      // Throw a silent error — the modal handles the UX. The caller's
      // catch block won't show a toast because the error message is empty.
      throw new Error("");
    }
    const txt = await res.text().catch(() => "");
    throw new Error(`API ${finalPath} → ${res.status}: ${txt}`);
  }
  return res.json() as Promise<T>;
}

export function useApi<T>(path: string | null, opts?: { refreshKey?: string | number }) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Ref mirror of `data` so the `refresh` callback can keep a stable identity
  // (its only dep is `path`) while still telling "subsequent refresh" apart
  // from "initial load". Subsequent refreshes (pull-to-refresh, post-mutation
  // refetch) keep existing data visible instead of flashing the loading
  // skeleton — important for mobile gestures where a skeleton flash feels
  // jarring.
  const dataRef = React.useRef<T | null>(null);
  React.useEffect(() => { dataRef.current = data; }, [data]);

  const refresh = React.useCallback(async () => {
    if (!path) { setLoading(false); return; }
    // Always re-fetch — even on refresh (not just initial load).
    // This ensures the list updates after a create/update/delete operation.
    setError(null);
    try {
      const d = await api<T>(path);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [path]);

  React.useEffect(() => { refresh(); }, [refresh, opts?.refreshKey]);
  return { data, error, loading, refresh, setData };
}
