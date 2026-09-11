import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";

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
