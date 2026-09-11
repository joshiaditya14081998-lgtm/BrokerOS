import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 * Uses the publishable (anon) key — safe for client-side use.
 * Auth state is persisted in cookies via @supabase/ssr.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
