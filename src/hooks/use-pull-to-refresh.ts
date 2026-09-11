"use client";

import * as React from "react";

export type UsePullToRefreshOptions = {
  onRefresh: () => Promise<void>;
  /** Pull distance (px) required to trigger a refresh. Default 80. */
  threshold?: number;
};

export type UsePullToRefreshResult = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** True while the user is actively dragging (touch is down). */
  pulling: boolean;
  /** Current pull-down distance in px (already dampened). */
  pullDistance: number;
  /** True while the onRefresh promise is in flight. */
  refreshing: boolean;
};

/**
 * Pull-to-refresh behavior for a container, designed for touch devices.
 *
 * The hook attaches native touch listeners to `containerRef.current` so it can
 * call `preventDefault()` on touchmove (which requires `passive: false`).
 * framer-motion's `drag` is intentionally avoided here — we don't want to
 * interfere with vertical scrolling, only to hijack over-scroll at the top of
 * the page.
 *
 * Activation rules:
 *  - Touch devices only (coarse pointer). No-op on desktop / mouse.
 *  - Only engages when the page is scrolled to the very top (scrollTop === 0).
 *  - The pull distance is dampened (deltaY * 0.5) and capped at threshold * 1.5
 *    so the indicator never runs away off-screen.
 *  - On release: if pullDistance >= threshold, runs `onRefresh` (awaited) and
 *    holds the indicator at the threshold height while refreshing; otherwise
 *    snaps back to 0.
 *
 * The parent component is responsible for rendering a pull indicator and
 * translating children by `pullDistance` (see `<PullToRefresh>`).
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 80,
}: UsePullToRefreshOptions): UsePullToRefreshResult {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [pulling, setPulling] = React.useState(false);
  const [pullDistance, setPullDistance] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);

  // Refs mirror state for use inside stable touch listeners (so they don't
  // need to re-bind on every drag update).
  const pullDistanceRef = React.useRef(0);
  const startYRef = React.useRef<number | null>(null);
  const refreshingRef = React.useRef(false);
  const onRefreshRef = React.useRef(onRefresh);
  React.useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  // Touch-device detection. SSR-safe (returns false on the server).
  const isTouchDevice = React.useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      "ontouchstart" in window ||
      (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
      window.matchMedia("(pointer: coarse)").matches
    );
  }, []);

  React.useEffect(() => {
    if (!isTouchDevice) return;
    const el = containerRef.current;
    if (!el) return;

    const currentScrollTop = () =>
      window.scrollY ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      // Only engage when the page is at the top — otherwise the user is
      // scrolling content normally and we must not hijack the gesture.
      if (currentScrollTop() > 0) return;
      // Ignore multi-touch (pinch / zoom).
      if (e.touches.length !== 1) return;
      startYRef.current = e.touches[0].clientY;
      setPulling(true);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || refreshingRef.current) return;
      const deltaY = e.touches[0].clientY - startYRef.current;
      // Only intercept downward pulls.
      if (deltaY <= 0) return;
      // If the user has scrolled away from the top mid-pull, abort cleanly.
      if (currentScrollTop() > 0) {
        startYRef.current = null;
        setPulling(false);
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }
      // Prevent the browser's native pull-to-refresh / rubber-band scroll so
      // our indicator is the only visual feedback.
      e.preventDefault();
      const dampened = Math.min(deltaY * 0.5, threshold * 1.5);
      pullDistanceRef.current = dampened;
      setPullDistance(dampened);
    };

    const onTouchEnd = async () => {
      if (startYRef.current === null) return;
      startYRef.current = null;
      setPulling(false);
      const crossed = pullDistanceRef.current >= threshold;
      if (crossed) {
        refreshingRef.current = true;
        setRefreshing(true);
        // Snap the pull to the resting "refreshing" height so the indicator
        // has a stable home while the promise is in flight.
        pullDistanceRef.current = threshold;
        setPullDistance(threshold);
        try {
          await onRefreshRef.current();
        } finally {
          refreshingRef.current = false;
          setRefreshing(false);
          pullDistanceRef.current = 0;
          setPullDistance(0);
        }
      } else {
        // Snap back to 0 — framer-motion animates the visual return in the
        // wrapper component.
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    // touchmove must be passive:false to allow preventDefault().
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [isTouchDevice, threshold]);

  return { containerRef, pulling, pullDistance, refreshing };
}
