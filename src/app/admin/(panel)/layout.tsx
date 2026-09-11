import * as React from "react";
import { AdminSidebar } from "@/components/admin-sidebar";

/**
 * Admin layout — wraps every `/admin/*` route (except `/admin/login`, which
 * is a standalone route). Renders the admin sidebar + the page content.
 *
 * Auth is checked by each admin page's first fetch (`/api/admin/dashboard`
 * returns 403 for non-super-admins); the middleware enforces that every
 * `/admin/*` route has a Supabase session. This layout only renders the
 * chrome (sidebar); the access gate is enforced by the API + page
 * components, which redirect to `/admin/login` if the dashboard API
 * returns 403.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
