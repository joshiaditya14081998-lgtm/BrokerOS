import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";

// GET /api/portal/me
// Returns the portal profile of the currently-authenticated Supabase user:
//   - If linked to a Client row (`client.userId === user.id`): returns
//     `{ partyType: "client", party: { id, name, email, contactPerson } }`.
//   - If linked to a Supplier row (`supplier.userId === user.id`): returns
//     `{ partyType: "supplier", party: { id, name, email, contactPerson } }`.
//   - Otherwise: `{ partyType: null, party: null }` — the user has a Supabase
//     Auth account but isn't tied to any party yet (the broker hasn't enabled
//     portal access for them).
//
// Auth: requires a Supabase session. Unlike the broker routes, this does NOT
// auto-create a Broker profile — it intentionally reads the session directly
// because portal users (clients + suppliers) should never have a Broker row.
//
// NOTE: a single auth user could in theory be linked to BOTH a client and a
// supplier row (across different brokers). We resolve client-first; the
// portal page treats the first match as the user's identity for this session.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = await db.client.findFirst({
    where: { userId: user.id },
    select: {
      id: true, name: true, email: true, contactPerson: true,
    },
  });
  if (client) {
    return NextResponse.json({ partyType: "client", party: client });
  }

  const supplier = await db.supplier.findFirst({
    where: { userId: user.id },
    select: {
      id: true, name: true, email: true, contactPerson: true,
    },
  });
  if (supplier) {
    return NextResponse.json({ partyType: "supplier", party: supplier });
  }

  return NextResponse.json({ partyType: null, party: null });
}
