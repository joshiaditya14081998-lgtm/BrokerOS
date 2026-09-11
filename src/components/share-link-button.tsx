"use client";

import * as React from "react";
import { Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// ShareLinkButton — copies the current URL (with query params) to the
// clipboard and toasts a confirmation. Designed to surface the URL
// persistence feature (Task 19-b): every list view that syncs filter state
// to the URL renders this button so deep-linking is discoverable.
//
// Behaviour:
// - Uses `navigator.clipboard.writeText` when available (modern browsers).
// - Falls back to a hidden-textarea + `document.execCommand("copy")` for
//   older browsers / insecure contexts where the async clipboard API is
//   gated behind HTTPS.
// - The URL is `window.location.href` — which includes the current query
//   string (e.g. `/?q=sharma&status=open`). The recipient opening the link
//   will see the same filters applied, courtesy of `useUrlState`.
// - Toasts "Link copied — filter state is in the URL" on success.
//
// The button is small (`size="sm"`, `variant="outline"`) and uses the
// `Link` (chain) icon to convey "share a deep link". The text is hidden on
// mobile (only the icon shows) to keep the SectionHeader actions row from
// overflowing on narrow viewports.
// ─────────────────────────────────────────────────────────────────────────────

export type ShareLinkButtonProps = {
  className?: string;
  /** Optional label override (defaults to "Share"). */
  label?: string;
  /** Hide the text label on all viewport sizes (icon-only). */
  iconOnly?: boolean;
};

export function ShareLinkButton({
  className,
  label = "Share",
  iconOnly = false,
}: ShareLinkButtonProps) {
  const onShare = React.useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(url);
      } else {
        // Legacy fallback — create a hidden textarea and execCommand("copy").
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.top = "-9999px";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      toast.success("Link copied — filter state is in the URL");
    } catch {
      // If the clipboard write fails (e.g. permissions denied), still tell
      // the user what the URL is so they can copy it manually.
      toast.error("Couldn't copy automatically — copy the URL from the address bar.", {
        description: url,
      });
    }
  }, []);

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onShare}
      className={className}
      aria-label={`Share link — copy current URL with filter state`}
      title="Copy link with current filters"
    >
      <LinkIcon className="size-4" />
      {!iconOnly ? <span className="hidden sm:inline">{label}</span> : null}
    </Button>
  );
}
