import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { withRateLimit } from "@/lib/api-middleware";

// POST /api/auth/create-profile — auto-create a Broker row for the newly-signed-up user.
// (Legacy bare-bones variant of `/api/auth` POST — kept for callers that just
// want a broker profile without a plan/subscription. New signup flow goes
// through `/api/auth` POST which also creates the Subscription.)
//
// Rate-limited at 10 req/min per IP — same strict cap as `/api/auth` POST
// since this is an account-creation surface.
export const POST = withRateLimit(
  async (req: NextRequest) => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Check if broker profile already exists
    const existing = await db.broker.findUnique({ where: { id: user.id } });
    if (existing) {
      return NextResponse.json({ broker: existing });
    }

    const body = await req.json().catch(() => ({}));
    const broker = await db.broker.create({
      data: {
        id: user.id,
        email: user.email ?? "",
        fullName: body.fullName ?? user.email ?? "",
        role: "admin",
      },
    });

    return NextResponse.json({ broker });
  },
  10,
  60_000,
);
