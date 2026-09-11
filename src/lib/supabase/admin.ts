import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase admin client — uses the service role key (`SUPABASE_SECRET_KEY`).
 *
 * ⚠️ SERVER-ONLY. NEVER import this from a Client Component or expose the
 * resulting client to the browser. The service role bypasses Row-Level
 * Security and is intended for trusted server-side operations only
 * (creating users on behalf of a broker, looking up users by email, etc.).
 *
 * Returns `null` when the required env vars are missing — callers should
 * check for null and respond with a 503 "Supabase not configured" so the
 * broker UI can surface a helpful "portal invites require Supabase setup"
 * message rather than crash.
 *
 * Env vars:
 *   - NEXT_PUBLIC_SUPABASE_URL  — the Supabase project URL (same as the
 *     publishable-key client uses).
 *   - SUPABASE_SECRET_KEY       — the service role key (keep secret!).
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) return null;
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
