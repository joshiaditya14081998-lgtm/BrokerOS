"use client";

import * as React from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
} from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";

export type LightboxPhoto = {
  id: string;
  url: string;
  caption: string | null;
  createdAt: string;
};

type LightboxProps = {
  photos: LightboxPhoto[];
  /** Index of the currently displayed photo. null = closed (component not rendered). */
  index: number;
  onClose: () => void;
  onNavigate: (newIndex: number) => void;
};

const SWIPE_HINT_KEY = "gbos:swipe-hint:lightbox";

/**
 * Full-screen image lightbox with keyboard nav, fade-in animation,
 * prev/next arrows, counter, caption, click-outside-to-close, and
 * touch swipe navigation (mobile).
 *
 * Rendered only when `index !== null` (parent controls mount).
 */
export function Lightbox({ photos, index, onClose, onNavigate }: LightboxProps) {
  const count = photos.length;
  const current = photos[index];

  const goPrev = React.useCallback(() => {
    if (count <= 1) return;
    onNavigate((index - 1 + count) % count);
  }, [count, index, onNavigate]);

  const goNext = React.useCallback(() => {
    if (count <= 1) return;
    onNavigate((index + 1) % count);
  }, [count, index, onNavigate]);

  // Keyboard navigation: Escape closes, arrows navigate.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, goPrev, goNext]);

  // Touch device detection — controls whether the mobile swipe hint is shown
  // and whether the drag gesture is enabled. Drag is touch-only so it doesn't
  // interfere with desktop / mouse usage (arrows + keyboard handle desktop).
  const isTouch = useIsTouchDevice();

  // One-time swipe hint tooltip via localStorage.
  const [hintVisible, setHintVisible] = React.useState(false);
  React.useEffect(() => {
    if (!isTouch || count <= 1) return;
    try {
      if (!localStorage.getItem(SWIPE_HINT_KEY)) {
        setHintVisible(true);
        const t = setTimeout(() => {
          setHintVisible(false);
          localStorage.setItem(SWIPE_HINT_KEY, "1");
        }, 3500);
        return () => clearTimeout(t);
      }
    } catch {
      // localStorage may be unavailable (private mode); ignore.
    }
  }, [isTouch, count]);

  // Drag motion values for the tilt cue during swipe.
  const dragX = useMotionValue(0);
  // Tilt a few degrees in the direction of the drag — subtle visual cue that
  // the swipe is "grabbing" the image.
  const rotate = useTransform(dragX, [-200, 0, 200], [4, 0, -4]);

  // Reset the drag offset when the active photo changes so the new image
  // doesn't briefly render at the previous drag position.
  React.useEffect(() => {
    dragX.set(0);
  }, [index, dragX]);

  if (!current) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="lightbox-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Image preview"
      >
        {/* Counter — top-left */}
        <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur-sm sm:left-6 sm:top-6">
          {index + 1} of {count}
        </div>

        {/* Close — top-right */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:right-6 sm:top-6"
          aria-label="Close preview"
        >
          <X className="size-5" />
        </button>

        {/* Previous arrow */}
        {count > 1 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            className="absolute left-3 top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:left-6 sm:size-12"
            aria-label="Previous photo"
          >
            <ChevronLeft className="size-6" />
          </button>
        ) : null}

        {/* Image + caption container — stops backdrop click from closing */}
        <motion.div
          key={`lightbox-img-${current.id}`}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <motion.img
            src={current.url}
            alt={current.caption ?? "photo"}
            className="max-h-[82vh] max-w-[90vw] touch-none rounded-lg object-contain shadow-2xl"
            style={{ rotate, x: dragX }}
            // Touch swipe to navigate. dragConstraints={0,0} + dragElastic
            // keeps the image roughly in place while still letting the user
            // feel the drag; dragSnapToOrigin springs it back if the swipe
            // didn't cross the threshold. Drag is touch-only — desktop users
            // navigate via arrows / keyboard.
            drag={isTouch ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            dragSnapToOrigin
            onDragEnd={(_e, info) => {
              if (info.offset.x < -50) goNext();
              else if (info.offset.x > 50) goPrev();
            }}
          />
          {current.caption ? (
            <p className="mt-3 max-w-[90vw] text-center text-sm text-white/90">
              {current.caption}
            </p>
          ) : null}
        </motion.div>

        {/* Next arrow */}
        {count > 1 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            className="absolute right-3 top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:right-6 sm:size-12"
            aria-label="Next photo"
          >
            <ChevronRight className="size-6" />
          </button>
        ) : null}

        {/* Persistent mobile swipe hint pill (touch devices only) */}
        {isTouch && count > 1 ? (
          <motion.div
            className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.25 }}
          >
            <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur-sm">
              <span aria-hidden>←</span>
              <span>Swipe</span>
              <span aria-hidden>→</span>
            </div>
          </motion.div>
        ) : null}

        {/* One-time swipe hint tooltip (first visit only) */}
        <AnimatePresence>
          {hintVisible ? (
            <motion.div
              className="pointer-events-none absolute bottom-16 left-1/2 z-20 -translate-x-1/2"
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              role="status"
            >
              <div className="glass-strong rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-xs font-medium text-emerald-200 shadow-xl">
                Swipe to navigate photos
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
