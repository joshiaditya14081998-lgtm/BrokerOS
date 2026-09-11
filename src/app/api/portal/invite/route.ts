import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/portal/invite
// Body: { partyType: "client" | "supplier", partyId: string, email: string }
//
// Broker-side operation: enables portal access for a client or supplier.
//   1. Requires broker auth (uses the broker's Supabase session).
//   2. Verifies the party row belongs to this broker (`party.brokerId === broker.id`).
//   3. Uses the Supabase Auth admin API to either:
//        a. find an existing auth user by email, OR
//        b. create a new auth user with a randomly-generated password (the
//           broker then tells the user to use "forgot password" to set their
//           own — or the broker can do that flow separately).
//   4. Links the Supabase user id to the party row (sets `userId` on Client
//      or Supplier), so the user can log in via `/portal/login` and the
//      /api/portal/me + /api/portal/data routes will resolve them.
//   5. Returns `{ success: true, userId, created }` — `created: true` if a
//      new Supabase auth user was created, `false` if an existing user was
//      linked.
//
// Errors:
//   - 400: invalid body (missing/invalid partyType, partyId, email).
//   - 401: not authenticated.
//   - 404: party not found / not owned by this broker.
//   - 409: another party is already linked to this Supabase user id.
//   - 500: Supabase admin API failure (e.g. rate-limit, network, etc.).
//   - 503: Supabase env vars not configured (NEXT_PUBLIC_SUPABASE_URL +
//     SUPABASE_SECRET_KEY required for admin operations).
//
// Also supports `DELETE /api/portal/invite` to disable portal access:
//   Body: { partyType, partyId } — clears the `userId` field on the party
//   row (does NOT delete the Supabase auth user; the broker can do that in
//   the Supabase dashboard if needed). Returns `{ success: true }`.
export async function POST(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { partyType?: string; partyId?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { partyType, partyId, email } = body;
  if (!partyType || !partyId || !email) {
    return NextResponse.json(
      { error: "partyType, partyId, and email are required" },
      { status: 400 },
    );
  }
  if (partyType !== "client" && partyType !== "supplier") {
    return NextResponse.json(
      { error: "partyType must be 'client' or 'supplier'" },
      { status: 400 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  // Verify the party belongs to this broker.
  if (partyType === "client") {
    const client = await db.client.findUnique({
      where: { id: partyId },
      select: { id: true, userId: true, brokerId: true },
    });
    if (!client || client.brokerId !== broker.id) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
  } else {
    const supplier = await db.supplier.findUnique({
      where: { id: partyId },
      select: { id: true, userId: true, brokerId: true },
    });
    if (!supplier || supplier.brokerId !== broker.id) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }
  }

  // Create the Supabase admin client. If env vars aren't configured, return 503.
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      {
        error:
          "Supabase admin API not configured — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to enable portal invites.",
      },
      { status: 503 },
    );
  }

  // Try to find an existing auth user with this email. Supabase doesn't expose
  // a direct "getUserByEmail" in all SDK versions, so we fall back to
  // listUsers + filter (paginated, but emails are usually on the first page
  // for a small tenant). If that returns nothing, we create a new user.
  let userId: string | null = null;
  let created = false;

  try {
    const existing = await findUserByEmail(admin, email);
    if (existing) {
      userId = existing;
    } else {
      // Generate a random temporary password (the user should reset it via
      // Supabase's "forgot password" flow — we don't email it; the broker
      // tells the user to reset). 24 chars of base64 entropy is plenty.
      const tempPassword = generateTempPassword();
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true, // skip the email-confirmation step (broker confirms in person)
      });
      if (error) {
        // If createUser fails because the user already exists (race with
        // the lookup above), retry the lookup once more.
        if (error.message.toLowerCase().includes("already")) {
          const retry = await findUserByEmail(admin, email);
          if (retry) userId = retry;
          else return NextResponse.json({ error: error.message }, { status: 500 });
        } else {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      } else {
        userId = data.user.id;
        created = true;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown Supabase admin error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!userId) {
    return NextResponse.json(
      { error: "Could not create or find Supabase user" },
      { status: 500 },
    );
  }

  // Defence-in-depth: make sure no OTHER party is already linked to this
  // Supabase user id (a client and supplier shouldn't share a login).
  const conflictingClient = await db.client.findFirst({
    where: { userId, id: { not: partyType === "client" ? partyId : undefined } },
    select: { id: true, name: true },
  });
  const conflictingSupplier = await db.supplier.findFirst({
    where: { userId, id: { not: partyType === "supplier" ? partyId : undefined } },
    select: { id: true, name: true },
  });
  if (conflictingClient || conflictingSupplier) {
    return NextResponse.json(
      {
        error:
          "That Supabase user is already linked to another party. Use a different email.",
      },
      { status: 409 },
    );
  }

  // Link the Supabase user id to the party row.
  if (partyType === "client") {
    await db.client.update({
      where: { id: partyId },
      data: { userId, email }, // also stamp the email field on the party row for the UI
    });
  } else {
    await db.supplier.update({
      where: { id: partyId },
      data: { userId, email },
    });
  }

  // Audit log entry (broker-attributed).
  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: partyType === "client" ? "Client" : "Supplier",
      entityId: partyId,
      action: "portal_invite",
      after: JSON.stringify({ userId, email, created }),
      userName: broker.fullName,
    },
  });

  return NextResponse.json({ success: true, userId, created });
}

// DELETE /api/portal/invite — disables portal access for a party.
// Body: { partyType, partyId }. Clears the `userId` field on the party row
// (does NOT delete the Supabase auth user — the broker can do that in the
// Supabase dashboard if needed). Returns `{ success: true }`.
export async function DELETE(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { partyType?: string; partyId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { partyType, partyId } = body;
  if (!partyType || !partyId) {
    return NextResponse.json(
      { error: "partyType and partyId are required" },
      { status: 400 },
    );
  }
  if (partyType !== "client" && partyType !== "supplier") {
    return NextResponse.json(
      { error: "partyType must be 'client' or 'supplier'" },
      { status: 400 },
    );
  }

  if (partyType === "client") {
    const client = await db.client.findUnique({
      where: { id: partyId },
      select: { id: true, userId: true, brokerId: true, email: true },
    });
    if (!client || client.brokerId !== broker.id) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    await db.client.update({
      where: { id: partyId },
      data: { userId: null },
    });
  } else {
    const supplier = await db.supplier.findUnique({
      where: { id: partyId },
      select: { id: true, userId: true, brokerId: true, email: true },
    });
    if (!supplier || supplier.brokerId !== broker.id) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }
    await db.supplier.update({
      where: { id: partyId },
      data: { userId: null },
    });
  }

  await db.auditLog.create({
    data: {
      brokerId: broker.id,
      entityType: partyType === "client" ? "Client" : "Supplier",
      entityId: partyId,
      action: "portal_disable",
      userName: broker.fullName,
    },
  });

  return NextResponse.json({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up an existing Supabase auth user by email. Returns the user id or
 * null if not found. Supabase's admin API doesn't expose a direct
 * "getUserByEmail" in all SDK versions, so we paginate `listUsers` and
 * filter by email client-side. This is fine for small tenants (a few
 * hundred users); for very large tenants this should be replaced with the
 * native `getUserByEmail` once available.
 */
async function findUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  let page = 1;
  // Cap at 10 pages of 1000 users = 10k users scan. If the tenant has more,
  // we'll fall through to createUser and rely on its "already registered"
  // error to short-circuit.
  for (let i = 0; i < 10; i++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) return null;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 1000) return null; // no more pages
    page += 1;
  }
  return null;
}

/**
 * Generate a random 24-char base64 temporary password for newly-created
 * Supabase auth users. The user is expected to reset it via the "forgot
 * password" flow — the broker tells them in person. Uses the Web Crypto
 * API (available in Node 19+ and all browsers).
 */
function generateTempPassword(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  // Convert to base64url, strip padding → ~24 chars of URL-safe entropy.
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  // Supabase requires ≥6 chars; we have ~24. Add a guaranteed digit + symbol
  // to satisfy common password policies.
  return `Pa${b64}9!`;
}
