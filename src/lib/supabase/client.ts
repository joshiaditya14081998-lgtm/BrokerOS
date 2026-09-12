import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 * Uses the publishable (anon) key — safe for client-side use.
 * Auth state is persisted in cookies via @supabase/ssr.
 *
 * Falls back to empty strings during build (SSG) so the page can prerender
 * without env vars — the actual client is created at runtime.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "placeholder-key",
  );
}
