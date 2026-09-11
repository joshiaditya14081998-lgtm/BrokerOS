import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";

/**
 * Get the current authenticated broker from the Supabase session.
 * Returns the Broker profile (with role) or null if not authenticated.
 *
 * Usage in API routes:
 * ```
 * const broker = await getCurrentBroker();
 * if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 * // Now use broker.id to scope all queries
 * const clients = await db.client.findMany({ where: { brokerId: broker.id } });
 * ```
 */
export async function getCurrentBroker() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  // Find or create the Broker profile (linked to Supabase Auth user)
  let broker = await db.broker.findUnique({
    where: { id: user.id },
  });

  if (!broker) {
    // Auto-create broker profile on first API call after signup
    broker = await db.broker.create({
      data: {
        id: user.id,
        email: user.email ?? "",
        fullName: (user.user_metadata?.full_name as string) ?? user.email ?? "",
        role: "admin", // first user is admin
      },
    });
  }

  return broker;
}

/**
 * Require authentication — throws 401 if not authenticated.
 * Use in API routes that MUST have a logged-in broker.
 */
export async function requireBroker() {
  const broker = await getCurrentBroker();
  if (!broker) {
    throw new Error("UNAUTHORIZED");
  }
  return broker;
}

/**
 * Get the current authenticated SUPER ADMIN broker.
 * Returns the Broker profile only if the logged-in Supabase user maps to a
 * Broker row with `isSuperAdmin === true`. Returns null otherwise (not
 * authenticated, no Broker profile, or not a super admin).
 *
 * Usage in admin API routes:
 * ```
 * const admin = await getCurrentSuperAdmin();
 * if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
 * ```
 */
export async function getCurrentSuperAdmin() {
  const broker = await getCurrentBroker();
  if (!broker) return null;
  if (!broker.isSuperAdmin) return null;
  // A suspended super admin can still log in but cannot use admin routes
  // (defensive — protects against the admin accidentally suspending
  // themselves via direct DB access). In practice the admin UI forbids
  // self-suspension.
  if (broker.isSuspended) return null;
  return broker;
}

/**
 * Require super-admin authentication — throws "UNAUTHORIZED" if not
 * authenticated and "FORBIDDEN" if authenticated but not a super admin.
 * Use in admin API routes that MUST only be callable by the SaaS owner.
 */
export async function requireSuperAdmin() {
  const admin = await getCurrentSuperAdmin();
  if (!admin) {
    throw new Error("FORBIDDEN");
  }
  return admin;
}
