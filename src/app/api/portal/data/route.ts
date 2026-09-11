import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { buildSupplierPortal, buildClientPortal } from "@/app/api/portal/route";

// GET /api/portal/data?partyType=client|supplier&partyId=X
//
// Returns the same payload shape as the broker's `/api/portal?persona=...&id=...`
// route, but scoped to the *party's own* data only — the logged-in portal user
// (a client or supplier) sees ONLY the rows belonging to their linked party.
//
// Auth + verification flow:
//   1. Require a Supabase session (the user must be logged in via /portal/login).
//   2. Read the requested partyType + partyId from the query string.
//   3. Look up the party row by id.
//   4. Verify the party's `userId` matches the Supabase user's id — this is the
//      party-scoping check (prevents a client from impersonating another client
//      by guessing an id; prevents a supplier from reading a client's data).
//   5. Reuse the same `buildSupplierPortal` / `buildClientPortal` builders used by
//      the broker portal route, passing the party's brokerId (the broker who
//      owns this party record). All downstream queries are scoped by that
//      brokerId + the party id — same data the broker sees for this party.
//
// Returns:
//   - 200 with the portal payload (same shape as /api/portal).
//   - 400 if partyType/partyId are missing or invalid.
//   - 401 if no Supabase session.
//   - 403 if the party exists but isn't linked to the logged-in user.
//   - 404 if the party doesn't exist.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const partyType = searchParams.get("partyType");
  const partyId = searchParams.get("partyId");

  if (!partyType || !partyId) {
    return NextResponse.json(
      { error: "partyType and partyId are required" },
      { status: 400 },
    );
  }
  if (partyType !== "supplier" && partyType !== "client") {
    return NextResponse.json(
      { error: "partyType must be 'supplier' or 'client'" },
      { status: 400 },
    );
  }

  try {
    if (partyType === "supplier") {
      const supplier = await db.supplier.findUnique({
        where: { id: partyId },
        select: { id: true, userId: true, brokerId: true },
      });
      if (!supplier) {
        return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
      }
      // Party-scoping check: the party row must be linked to THIS Supabase user.
      if (supplier.userId !== user.id) {
        return NextResponse.json(
          { error: "This portal account is not linked to this supplier" },
          { status: 403 },
        );
      }
      const payload = await buildSupplierPortal(supplier.id, supplier.brokerId);
      if ("error" in payload) {
        return NextResponse.json({ error: payload.error }, { status: 404 });
      }
      return NextResponse.json(payload);
    }

    // partyType === "client"
    const client = await db.client.findUnique({
      where: { id: partyId },
      select: { id: true, userId: true, brokerId: true },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (client.userId !== user.id) {
      return NextResponse.json(
        { error: "This portal account is not linked to this client" },
        { status: 403 },
      );
    }
    const payload = await buildClientPortal(client.id, client.brokerId);
    if ("error" in payload) {
      return NextResponse.json({ error: payload.error }, { status: 404 });
    }
    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
