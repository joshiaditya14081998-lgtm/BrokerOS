"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Shield, LayoutDashboard, Users, CreditCard, Settings, ScrollText,
  ArrowLeft, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * AdminSidebar — separate nav for the Super Admin Panel.
 *
 * Visually distinct from the broker app sidebar (deep teal accent vs the
 * broker app's emerald) so an admin who is also a broker can always tell
 * which surface they're on at a glance. Uses the same `glass-panel` surface
 * for visual consistency.
 *
 * Routes:
 *   - /admin              → Dashboard (platform stats)
 *   - /admin/brokers      → Broker management (suspend/activate/delete)
 *   - /admin/subscriptions → Subscription management
 *   - /admin/settings     → Plans + announcement composer
 *   - /admin/audit        → Admin audit log
 */
const NAV: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/brokers", label: "Brokers", icon: Users },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/audit", label: "Audit Log", icon: ScrollText },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "glass-panel flex h-full w-64 flex-col",
        // Slight teal tint to distinguish from the broker sidebar.
        "[--sidebar:oklch(0.97_0.04_195_/_78%)]",
        "dark:[--sidebar:oklch(0.18_0.02_195_/_78%)]",
      )}
    >
      {/* Branding — Shield icon in deep teal */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid size-9 place-items-center rounded-xl bg-teal-600 text-white shadow-sm">
          <Shield className="size-5" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight text-foreground">Admin Panel</p>
          <p className="text-[11px] text-muted-foreground">Super Admin · Broker OS</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="mb-4">
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Platform
          </p>
          <div className="space-y-0.5">
            {NAV.map((item) => {
              const active =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                    active
                      ? "bg-teal-500/15 text-teal-700 shadow-sm dark:text-teal-300"
                      : "text-muted-foreground hover:bg-teal-500/10 hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0 transition-transform",
                      active ? "text-teal-600 dark:text-teal-400" : "group-hover:scale-110",
                    )}
                  />
                  <span className="flex-1 truncate text-left">{item.label}</span>
                  {active ? <ShieldCheck className="size-3.5 text-teal-500" /> : null}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <div className="border-t border-sidebar-border px-3 py-3">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
        >
          <Link href="/">
            <ArrowLeft className="size-4" />
            <span>Back to App</span>
          </Link>
        </Button>
        <p className="mt-2 px-3 text-[10px] text-muted-foreground/70">
          Super admin session · <Shield className="inline size-2.5" /> privileged
        </p>
      </div>
    </aside>
  );
}
