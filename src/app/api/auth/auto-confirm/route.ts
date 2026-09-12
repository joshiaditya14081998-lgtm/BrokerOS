import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { withRateLimit } from "@/lib/api-middleware";

// POST /api/auth/auto-confirm — auto-confirm email for a newly signed-up user.
// Uses the Supabase service role key (admin API) to bypass email confirmation.
// This runs server-side only — the secret key is never exposed to the client.
//
// Rate-limited at 10 req/min per IP — this endpoint calls the Supabase admin
// API and is a credential-confirmation surface, so it gets the same strict
// cap as the other auth-mutation endpoints.
export const POST = withRateLimit(
  async (req: NextRequest) => {
    const body = await req.json().catch(() => ({}));
    const userId = body.userId as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseSecretKey) {
      return NextResponse.json({ error: "Supabase admin not configured" }, { status: 503 });
    }

    const admin = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await admin.auth.admin.updateUserById(userId, {
      email_confirm: true,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  },
  10,
  60_000,
);
