"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUI } from "@/lib/ui-store";

type Shortcut = { keys: string[]; label: string };

const NAVIGATION: Shortcut[] = [
  { keys: ["g", "d"], label: "Dashboard" },
  { keys: ["g", "a"], label: "Analytics" },
  { keys: ["g", "c"], label: "Clients" },
  { keys: ["g", "s"], label: "Suppliers" },
  { keys: ["g", "v"], label: "Visits" },
  { keys: ["g", "p"], label: "Purchase Orders" },
  { keys: ["g", "t"], label: "Dispatch Tracking" },
  { keys: ["g", "b"], label: "Bills" },
  { keys: ["g", "y"], label: "Payments" },
  { keys: ["g", "k"], label: "Brokerage" },
  { keys: ["g", "u"], label: "Disputes" },
  { keys: ["g", "n"], label: "Notifications" },
  { keys: ["g", "l"], label: "Audit Trail" },
  { keys: ["g", "o"], label: "Portals" },
  { keys: ["g", "e"], label: "Settings" },
];

const CREATE: Shortcut[] = [
  { keys: ["n", "c"], label: "New client" },
  { keys: ["n", "p"], label: "New purchase order (via Visits → Record booking)" },
  { keys: ["n", "d"], label: "New dispatch" },
  { keys: ["n", "b"], label: "New bill" },
  { keys: ["n", "y"], label: "New payment" },
];

const GLOBAL: Shortcut[] = [
  { keys: ["⌘K"], label: "Command palette" },
  { keys: ["/"], label: "Search / open command palette" },
  { keys: ["?"], label: "This help overlay" },
  { keys: ["Esc"], label: "Close overlays / cancel prefix" },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="pointer-events-none select-none rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

function ShortcutRow({ keys, label }: Shortcut) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/40">
      <span className="text-sm text-foreground/90">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((k, i) => (
          <React.Fragment key={k}>
            {i > 0 && <span className="text-muted-foreground" aria-hidden>·</span>}
            <Kbd>{k}</Kbd>
          </React.Fragment>
        ))}
      </span>
    </div>
  );
}

function ShortcutGroup({
  title,
  hint,
  items,
}: {
  title: string;
  hint: string;
  items: Shortcut[];
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{hint}</span>
      </div>
      <div className="space-y-0.5">
        {items.map((s) => (
          <ShortcutRow key={s.label} {...s} />
        ))}
      </div>
    </div>
  );
}

export function ShortcutsOverlay() {
  const showShortcuts = useUI((s) => s.showShortcuts);
  const setShowShortcuts = useUI((s) => s.setShowShortcuts);

  return (
    <Dialog open={showShortcuts} onOpenChange={setShowShortcuts}>
      <DialogContent className="glass-strong max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-primary" aria-hidden />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Press the prefix key, then the second key within 1 second. Shortcuts are disabled while typing in form fields.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 md:grid-cols-2">
          <ShortcutGroup
            title="Navigation"
            hint="g-prefix"
            items={NAVIGATION}
          />
          <div className="space-y-4">
            <ShortcutGroup title="Create" hint="n-prefix" items={CREATE} />
            <ShortcutGroup title="Global" hint="single key" items={GLOBAL} />
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/30 px-3 py-2 text-[11px] text-muted-foreground">
          <span>
            Tip: <Kbd>g</Kbd> then a letter jumps to a view · <Kbd>n</Kbd> then a letter opens a creation dialog.
          </span>
          <span className="hidden sm:inline">Press <Kbd>?</Kbd> or <Kbd>Esc</Kbd> to close.</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
