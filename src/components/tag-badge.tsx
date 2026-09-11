"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TAG_COLOR_CLASS } from "@/lib/tags";

// A small pill showing the tag's name with the tag's colour. Optionally
// renders an X button for removal (used by the TagPicker + filter bars).
//
// Designed to be cheap: a pure presentational component with no API calls so
// it can be embedded inside list rows, table cells, and filter bars without
// worrying about refetches.

export type TagLike = {
  id: string;
  name: string;
  color: string;
};

export function TagBadge({
  tag,
  onRemove,
  onClick,
  active,
  className,
  size = "default",
}: {
  tag: TagLike;
  onRemove?: () => void;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  size?: "default" | "sm";
}) {
  const colorClass = TAG_COLOR_CLASS[tag.color] ?? TAG_COLOR_CLASS.emerald;
  const padding = size === "sm" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]";
  const Wrapper: React.ElementType = onClick ? "button" : "span";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-pressed={onClick ? (active ? "true" : "false") : undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium transition-colors",
        colorClass,
        padding,
        onClick && "cursor-pointer hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
        active && "ring-2 ring-emerald-500/40",
        className,
      )}
    >
      {tag.name}
      {onRemove ? (
        <span
          role="button"
          tabIndex={0}
          aria-label={`Remove tag ${tag.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }
          }}
          className="ml-0.5 inline-flex size-3.5 cursor-pointer items-center justify-center rounded-full opacity-70 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/15"
        >
          <X className="size-2.5" />
        </span>
      ) : null}
    </Wrapper>
  );
}
