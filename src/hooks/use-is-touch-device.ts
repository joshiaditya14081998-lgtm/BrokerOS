"use client";

import * as React from "react";

/**
 * Detects whether the current device has a coarse (touch) pointer.
 *
 * SSR-safe — returns `false` during server render and updates after hydration.
 * Used to gate touch-only gestures (lightbox swipe, notification swipe-to-
 * dismiss, pull-to-refresh) so they don't interfere with mouse / desktop
 * usage.
 */
export function useIsTouchDevice() {
  const [isTouch, setIsTouch] = React.useState(false);
  React.useEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)");
    const update = () => {
      const touch =
        "ontouchstart" in window ||
        (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
        mql.matches;
      setIsTouch(!!touch);
    };
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isTouch;
}
