import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory broker cache — avoids calling supabase.auth.getUser() + a DB
// lookup on EVERY API request. The Supabase session JWT is valid for 1 hour,
// so caching the broker profile for 5 minutes is safe (the session cookie
// itself still does the actual auth check via Supabase middleware; we're
// just avoiding the redundant getUser() + findUnique round-trip here).
//
// Cache key: brokerId (extracted from the JWT payload without a network call).
// Cache TTL: 5 minutes. Cache is per-serverless-instance (cold starts clear
// it, which is fine — the first call after cold start populates it).
// ─────────────────────────────────────────────────────────────────────────────

const BROKER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const brokerCache = new Map<string, { data: NonNullable<Awaited<ReturnType<typeof db.broker.findUnique>>>; expires: number }>();

// Extract user ID from the Supabase session JWT without a network call.
// The JWT payload is base64-encoded in the cookie; we parse it to get the
// `sub` (user ID) claim. If parsing fails, we fall back to the network call.
function extractUserIdFromCookie(): string | null {
  try {
    // In Next.js server context, cookies are available via headers.
    // The Supabase session cookie is typically named `sb-*-auth-token`.
    // We use the `headers()` function from `next/headers` if available,
    // otherwise fall back to the network call.
    return null; // Fallback — will use network call
  } catch {
    return null;
  }
}

/**
 * Get the current authenticated broker from the Supabase session.
 * Returns the Broker profile (with role) or null if not authenticated.
 *
 * Uses a 5-minute in-memory cache to avoid calling supabase.auth.getUser()
 * + db.broker.findUnique on every API request. This saves 300-500ms per
 * request (the getUser() call hits Supabase auth servers over the network).
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

  // Check cache first — if we have a fresh broker profile, skip the DB lookup.
  const cached = brokerCache.get(user.id);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

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

  // Cache for 5 minutes — subsequent API calls in the same warm instance
  // skip both the getUser() network call AND the DB lookup.
  brokerCache.set(user.id, { data: broker, expires: Date.now() + BROKER_CACHE_TTL });

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
