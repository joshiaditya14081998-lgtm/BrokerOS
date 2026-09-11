import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";

// POST /api/auth/create-profile — auto-create a Broker row for the newly-signed-up user
export async function POST(req: NextRequest) {
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
}

// GET /api/auth/me — get current broker profile
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ user: null, broker: null });
  }

  const broker = await db.broker.findUnique({ where: { id: user.id } });
  return NextResponse.json({ user: { id: user.id, email: user.email }, broker });
}

// DELETE /api/auth — sign out
export async function DELETE() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
