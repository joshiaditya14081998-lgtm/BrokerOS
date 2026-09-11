"use client";

import * as React from "react";

// ─────────────────────────────────────────────────────────────────────────────
// useUrlState — sync a piece of state with a URL query param.
//
// Design goals (Task 19-b):
// - SSR-safe: on the server, `window` is undefined — the hook returns the
//   defaultValue and never touches the URL.
// - Hydration-safe: the first client render also uses the defaultValue so it
//   matches the server-rendered HTML. After mount, a `useEffect` reads the
//   URL and updates state if the param is present. This avoids a
//   server/client hydration mismatch (which would otherwise occur because
//   the URL is only available on the client).
// - Silent URL updates: `window.history.replaceState` is used (not
//   `pushState`) so each filter change doesn't pollute the browser history.
//   The user can still use the back button to leave the SPA; they won't get
//   a "back into last filter" entry per keystroke.
// - Default values are not added to the URL. If the user clears a filter
//   (sets it back to the default), the param is removed — keeps shared
//   links clean and prevents stale `?q=` empty params from lingering.
//
// Serialization rules:
// - string  → as-is (empty string is treated as "default" → removed from URL)
// - number  → String(value); parsed back via Number() with NaN fallback
// - boolean → "1" / "0"
// - array   → comma-separated; empty array → "" → removed from URL
//
// The hook accepts any `T` that extends `Primitive | Primitive[]`. The views
// typically use string (e.g. `useUrlState("q", "")`) and convert to/from
// richer types (Set, Date, enum) at the call site.
// ─────────────────────────────────────────────────────────────────────────────

type Primitive = string | number | boolean;

function serialize(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return value.map((v) => String(v)).join(",");
  }
  return null;
}

function deserialize<T>(raw: string, defaultValue: T): T {
  if (typeof defaultValue === "string") {
    return raw as unknown as T;
  }
  if (typeof defaultValue === "number") {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : defaultValue) as unknown as T;
  }
  if (typeof defaultValue === "boolean") {
    // Accept "1" / "0" / "true" / "false" for resilience when a user
    // hand-edits the URL. Anything else falls back to the default.
    if (raw === "1" || raw === "true") return true as unknown as T;
    if (raw === "0" || raw === "false") return false as unknown as T;
    return defaultValue;
  }
  if (Array.isArray(defaultValue)) {
    if (!raw) return [] as unknown as T;
    return raw.split(",").filter(Boolean) as unknown as T;
  }
  return defaultValue;
}

export function useUrlState<T extends Primitive | Primitive[]>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  // Start with the defaultValue — both server-render and first client
  // render use this, so there's no hydration mismatch. After mount, the
  // effect below reads the URL and updates the state if a param is present.
  const [value, setValue] = React.useState<T>(defaultValue);

  // On mount (client only), read the URL and set the initial state. If the
  // URL param is missing, the defaultValue stays — and we don't add it to
  // the URL (keeps shared links clean).
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has(key)) {
      const raw = params.get(key) ?? "";
      const deserialized = deserialize(raw, defaultValue);
      setValue(deserialized);
    }
    // `key` and `defaultValue` are stable literals in every call site —
    // including them in deps is harmless and satisfies the
    // exhaustive-deps lint rule. The effect only fires when either changes
    // (rare: would mean the parent component re-mounted the hook with a
    // different key, which doesn't happen in practice).
  }, [key, defaultValue]);

  // Build the URL: if the new value equals the default (or is empty / false /
  // empty array), REMOVE the param from the URL — keeps shared links clean.
  // Otherwise, set it. We compare the raw value (not the serialized form) so
  // the intent ("this filter is back to default") is explicit and survives any
  // future serialization tweaks. `URLSearchParams` handles the actual URL
  // manipulation so we don't hand-roll `?a=1&b=2` concatenation.
  const setValueUrl = React.useCallback(
    (next: T) => {
      setValue(next);
      if (typeof window === "undefined") return;

      const params = new URLSearchParams(window.location.search);
      if (
        next === defaultValue ||
        next === "" ||
        next === false ||
        (Array.isArray(next) && next.length === 0)
      ) {
        params.delete(key);
      } else {
        const serialized = serialize(next);
        if (serialized === null || serialized === "") {
          params.delete(key);
        } else {
          params.set(key, serialized);
        }
      }

      const qs = params.toString();
      const newUrl = qs
        ? `${window.location.pathname}?${qs}`
        : window.location.pathname;

      // replaceState (not pushState) — silent update, no history pollution,
      // no scroll jump.
      window.history.replaceState(null, "", newUrl);
    },
    [key, defaultValue],
  );

  return [value, setValueUrl];
}
