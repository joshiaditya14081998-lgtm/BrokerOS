// Static catalogue of every Broker OS REST API endpoint.
//
// Used by the in-app "API Documentation" view so mobile-app developers and
// third-party integrators can browse the full surface area of the backend
// without leaving the app. Each entry mirrors a real route file under
// `src/app/api/...` — the catalogue is hand-curated (not auto-scanned) so we
// can attach a human-readable description + curl example to every endpoint.
//
// Keep this file in sync with the actual routes whenever a new route is added
// or an existing one changes shape. The view at
// `src/components/views/api-docs-view.tsx` reads this array verbatim.

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type ApiField = {
  name: string;
  type: string;
  description: string;
  required: boolean;
};

export type ApiEndpoint = {
  method: HttpMethod;
  path: string; // e.g. "/api/clients" or "/api/clients/[id]"
  description: string;
  auth: boolean; // requires authentication (true for every route post-S2C)
  params?: ApiField[];
  body?: ApiField[];
  response: string; // description of response shape
  example?: string; // example curl command
};

// Helper to keep examples short + consistent. Every endpoint requires auth
// (S2C added `getCurrentBroker()` to all 50 routes), so the curl examples
// include a `-b` cookie flag for the Supabase session.
const curl = (method: HttpMethod, path: string, body?: string) => {
  const base = `curl -X ${method} '${path}' -b cookie.txt`;
  if (!body) return base;
  return `${base} -H 'Content-Type: application/json' -d '${body}'`;
};

export const API_ENDPOINTS: ApiEndpoint[] = [
  // ── Dashboard / Analytics / Digest ─────────────────────────────────────────
  {
    method: "GET",
    path: "/api/dashboard",
    description:
      "Broker financial dashboard — KPIs (outstanding receivable, brokerage earned, pending, active POs/disputes) + chart data (earnings trend, PO status, volume by client) + due reminders + brokerage position tiles.",
    auth: true,
    params: [
      { name: "range", type: "string", description: "Date-range preset: '7d' | '30d' | '90d' | 'ytd' | 'all'. Defaults to '30d'.", required: false },
    ],
    response:
      "{ kpis: {...}, charts: { earningsTrend, poStatus, volumeByClient }, reminders: Notification[], brokeragePosition: {...} }",
    example: curl("GET", "/api/dashboard?range=30d"),
  },
  {
    method: "GET",
    path: "/api/analytics",
    description:
      "Cross-entity analytics + 6-month brokerage forecast with confidence interval. Returns reliability scores, short-ship rate, avg payment delay, top clients/suppliers, and forecast bands.",
    auth: true,
    params: [
      { name: "range", type: "string", description: "Date-range preset (default '90d').", required: false },
    ],
    response:
      "{ reliability: { client, supplier }, shortShipRate, avgPaymentDelay, forecast: { months, lower, upper }, topClients, topSuppliers }",
    example: curl("GET", "/api/analytics?range=90d"),
  },
  {
    method: "GET",
    path: "/api/digest",
    description:
      "AI-style daily digest summarising today's visits, overdue POs, open bills, eligible brokerages, open disputes, and pending notification count. Supports plain-text, HTML, and email-sending modes.",
    auth: true,
    params: [
      { name: "format", type: "string", description: "'text' | 'html' | 'email'. Default 'text'.", required: false },
    ],
    response:
      "When format=text → { digest: string }. When format=email → { ok: true, sentTo: string }. When format=html → HTML string.",
    example: curl("GET", "/api/digest?format=text"),
  },

  // ── Clients ─────────────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/clients",
    description:
      "List all clients (buyers) for the current broker. Pass ?detail=true to include outstanding balances, lifetime brokerage, last-visit date, and tag list per client.",
    auth: true,
    params: [
      { name: "detail", type: "boolean", description: "Include per-client computed metrics (outstanding, brokerage, tags).", required: false },
      { name: "q", type: "string", description: "Search by name, contact, phone.", required: false },
    ],
    response:
      "When detail=false → Client[]. When detail=true → (Client & { outstanding, brokerage, lastVisitAt, tags })[].",
    example: curl("GET", "/api/clients?detail=true"),
  },
  {
    method: "POST",
    path: "/api/clients",
    description: "Create a new client (buyer).",
    auth: true,
    body: [
      { name: "name", type: "string", description: "Client/buyer name.", required: true },
      { name: "contactPerson", type: "string", description: "Primary contact person.", required: false },
      { name: "phone", type: "string", description: "Phone (with country code).", required: false },
      { name: "email", type: "string", description: "Email address.", required: false },
      { name: "gstNumber", type: "string", description: "GST number.", required: false },
      { name: "address", type: "string", description: "Billing/shipping address.", required: false },
    ],
    response: "Client (with id, brokerId, createdAt).",
    example: curl("POST", "/api/clients", "{\"name\":\"Acme Garments\",\"phone\":\"+91 9876543210\"}"),
  },
  {
    method: "GET",
    path: "/api/clients/[id]",
    description:
      "Fetch a single client by id, including computed metrics (outstanding, lifetime brokerage, recent visits, open POs).",
    auth: true,
    params: [
      { name: "id", type: "string", description: "Client id (cuid).", required: true },
    ],
    response: "Client & { outstanding, brokerage, recentVisits, openPOs } | 404.",
    example: curl("GET", "/api/clients/cmsn4wpu7002hy2ts1iinaeok"),
  },
  {
    method: "PATCH",
    path: "/api/clients/[id]",
    description: "Update client fields. Any subset of the create body is accepted.",
    auth: true,
    params: [
      { name: "id", type: "string", description: "Client id.", required: true },
    ],
    body: [
      { name: "name", type: "string", description: "Updated name.", required: false },
      { name: "contactPerson", type: "string", description: "Updated contact.", required: false },
      { name: "phone", type: "string", description: "Updated phone.", required: false },
      { name: "email", type: "string", description: "Updated email.", required: false },
      { name: "gstNumber", type: "string", description: "Updated GST.", required: false },
      { name: "address", type: "string", description: "Updated address.", required: false },
    ],
    response: "Updated Client | 404.",
    example: curl("PATCH", "/api/clients/cmsn4wpu7002hy2ts1iinaeok", "{\"phone\":\"+91 9988776655\"}"),
  },
  {
    method: "DELETE",
    path: "/api/clients/[id]",
    description:
      "Delete a client. Blocked if the client has any linked POs / bills / payments (returns 409). Audit-logged.",
    auth: true,
    params: [
      { name: "id", type: "string", description: "Client id.", required: true },
    ],
    response: "{ ok: true } | 404 | 409 { error }.",
    example: curl("DELETE", "/api/clients/cmsn4wpu7002hy2ts1iinaeok"),
  },

  // ── Suppliers ───────────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/suppliers",
    description:
      "List all suppliers (manufacturers) for the current broker, including reliability score and active PO count.",
    auth: true,
    params: [
      { name: "q", type: "string", description: "Search by name, contact, phone.", required: false },
    ],
    response: "(Supplier & { reliability, activePOs })[].",
    example: curl("GET", "/api/suppliers"),
  },
  {
    method: "POST",
    path: "/api/suppliers",
    description: "Create a new supplier (manufacturer).",
    auth: true,
    body: [
      { name: "name", type: "string", description: "Supplier name.", required: true },
      { name: "contactPerson", type: "string", description: "Primary contact.", required: false },
      { name: "phone", type: "string", description: "Phone.", required: false },
      { name: "email", type: "string", description: "Email.", required: false },
      { name: "gstNumber", type: "string", description: "GST number.", required: false },
      { name: "address", type: "string", description: "Address.", required: false },
      { name: "gstApplicable", type: "boolean", description: "Whether GST applies (default: system default).", required: false },
    ],
    response: "Supplier (with id, brokerId, createdAt).",
    example: curl("POST", "/api/suppliers", "{\"name\":\"Sunrise Textiles\",\"gstApplicable\":true}"),
  },
  {
    method: "GET",
    path: "/api/suppliers/[id]",
    description: "Fetch a single supplier by id with reliability, active POs, and recent dispatches.",
    auth: true,
    params: [
      { name: "id", type: "string", description: "Supplier id.", required: true },
    ],
    response: "Supplier & { reliability, activePOs, recentDispatches } | 404.",
    example: curl("GET", "/api/suppliers/cmsn4wpu7002gy2tscxlk437s"),
  },
  {
    method: "PATCH",
    path: "/api/suppliers/[id]",
    description: "Update supplier fields. Any subset of the create body is accepted.",
    auth: true,
    params: [
      { name: "id", type: "string", description: "Supplier id.", required: true },
    ],
    body: [
      { name: "name", type: "string", description: "Updated name.", required: false },
      { name: "contactPerson", type: "string", description: "Updated contact.", required: false },
      { name: "phone", type: "string", description: "Updated phone.", required: false },
      { name: "email", type: "string", description: "Updated email.", required: false },
      { name: "gstApplicable", type: "boolean", description: "Toggle GST applicability.", required: false },
    ],
    response: "Updated Supplier | 404.",
    example: curl("PATCH", "/api/suppliers/cmsn4wpu7002gy2tscxlk437s", "{\"phone\":\"+91 9112233445\"}"),
  },
  {
    method: "DELETE",
    path: "/api/suppliers/[id]",
    description:
      "Delete a supplier. Blocked if linked to any POs / dispatches (409). Audit-logged.",
    auth: true,
    params: [
      { name: "id", type: "string", description: "Supplier id.", required: true },
    ],
    response: "{ ok: true } | 404 | 409 { error }.",
    example: curl("DELETE", "/api/suppliers/cmsn4wpu7002gy2tscxlk437s"),
  },

  // ── Visits ──────────────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/visits",
    description:
      "List visits (broker field trips to supplier factories), optionally filtered by client/supplier/date range. Includes linked PO + dispatch summary per visit.",
    auth: true,
    params: [
      { name: "clientId", type: "string", description: "Filter by client.", required: false },
      { name: "supplierId", type: "string", description: "Filter by supplier.", required: false },
      { name: "from", type: "string (ISO date)", description: "Inclusive start date.", required: false },
      { name: "to", type: "string (ISO date)", description: "Inclusive end date.", required: false },
    ],
    response: "(Visit & { client, supplier, po, dispatch })[].",
    example: curl("GET", "/api/visits?from=2024-01-01&to=2024-03-31"),
  },
  {
    method: "POST",
    path: "/api/visits",
    description: "Record a new visit (a broker's visit to a supplier's factory on behalf of a client).",
    auth: true,
    body: [
      { name: "clientId", type: "string", description: "Client being served.", required: true },
      { name: "supplierId", type: "string", description: "Supplier being visited.", required: true },
      { name: "visitedAt", type: "string (ISO)", description: "Visit date/time.", required: true },
      { name: "notes", type: "string", description: "Free-text notes.", required: false },
      { name: "photoIds", type: "string[]", description: "Ids of uploaded photos.", required: false },
    ],
    response: "Visit (with id, brokerId).",
    example: curl("POST", "/api/visits", "{\"clientId\":\"c1\",\"supplierId\":\"s1\",\"visitedAt\":\"2024-04-12T10:00:00Z\"}"),
  },
  {
    method: "PATCH",
    path: "/api/visits/[id]",
    description: "Update visit notes / dates / photo attachments.",
    auth: true,
    params: [
      { name: "id", type: "string", description: "Visit id.", required: true },
    ],
    body: [
      { name: "notes", type: "string", description: "Updated notes.", required: false },
      { name: "visitedAt", type: "string (ISO)", description: "Updated date.", required: false },
    ],
    response: "Updated Visit | 404.",
    example: curl("PATCH", "/api/visits/v1", "{\"notes\":\"Quality approved.\"}"),
  },
  {
    method: "DELETE",
    path: "/api/visits/[id]",
    description: "Delete a visit. Blocked if a linked PO exists (409).",
    auth: true,
    params: [
      { name: "id", type: "string", description: "Visit id.", required: true },
    ],
    response: "{ ok: true } | 404 | 409.",
    example: curl("DELETE", "/api/visits/v1"),
  },

  // ── Bookings + Purchase Orders ──────────────────────────────────────────────
  {
    method: "POST",
    path: "/api/bookings",
    description:
      "Record a booking (order placed by a client through the broker). Auto-generates a Purchase Order against the supplier — one PO per visit/supplier pair is enforced.",
    auth: true,
    body: [
      { name: "visitId", type: "string", description: "Parent visit.", required: true },
      { name: "items", type: "array", description: "Line items: { description, quantity, unit, rate }[].", required: true },
      { name: "gstApplicable", type: "boolean", description: "Override supplier default.", required: false },
    ],
    response: "{ booking, purchaseOrder } — the auto-created PO is returned alongside.",
    example: curl("POST", "/api/bookings", "{\"visitId\":\"v1\",\"items\":[{\"description\":\"Cotton shirt\",\"quantity\":100,\"unit\":\"pcs\",\"rate\":250}]}"),
  },
  {
    method: "GET",
    path: "/api/purchase-orders",
    description:
      "List all purchase orders for the current broker, with computed fulfillment %, total value, and dispatch summary.",
    auth: true,
    params: [
      { name: "status", type: "string", description: "Filter by status: 'open' | 'partial' | 'closed' | 'cancelled'.", required: false },
      { name: "supplierId", type: "string", description: "Filter by supplier.", required: false },
      { name: "clientId", type: "string", description: "Filter by client.", required: false },
    ],
    response: "(PurchaseOrder & { fulfillmentPct, totalValue, dispatches, client, supplier })[].",
    example: curl("GET", "/api/purchase-orders?status=open"),
  },
  {
    method: "GET",
    path: "/api/purchase-orders/[id]",
    description:
      "Fetch a single PO by id, including line items, dispatches, bills, payments, and computed fields.",
    auth: true,
    params: [
      { name: "id", type: "string", description: "PO id.", required: true },
    ],
    response: "PurchaseOrder & { items, dispatches, bills, payments, fulfillmentPct, totalValue } | 404.",
    example: curl("GET", "/api/purchase-orders/po1"),
  },
  {
    method: "PATCH",
    path: "/api/purchase-orders/[id]",
    description:
      "Update a PO — most commonly to set status='closed' once fulfillment is complete. Audit-logged.",
    auth: true,
    params: [
      { name: "id", type: "string", description: "PO id.", required: true },
    ],
    body: [
      { name: "status", type: "string", description: "'open' | 'partial' | 'closed' | 'cancelled'.", required: false },
      { name: "notes", type: "string", description: "Updated notes.", required: false },
    ],
    response: "Updated PurchaseOrder | 404.",
    example: curl("PATCH", "/api/purchase-orders/po1", "{\"status\":\"closed\"}"),
  },

  // ── Dispatches ──────────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/dispatches",
    description:
      "List dispatches (shipments from supplier to client), with linked PO + delivery status + photos.",
    auth: true,
    params: [
      { name: "poId", type: "string", description: "Filter by parent PO.", required: false },
      { name: "status", type: "string", description: "Filter by status: 'in_transit' | 'delivered' | 'short_shipped'.", required: false },
    ],
    response: "(Dispatch & { po, photos })[].",
    example: curl("GET", "/api/dispatches?status=delivered"),
  },
  {
    method: "POST",
    path: "/api/dispatches",
    description:
      "Record a dispatch (a shipment from supplier to client). Updates the parent PO's fulfillment %.",
    auth: true,
    body: [
      { name: "poId", type: "string", description: "Parent PO.", required: true },
      { name: "dispatchedAt", type: "string (ISO)", description: "Dispatch date.", required: true },
      { name: "quantity", type: "number", description: "Quantity shipped this dispatch.", required: true },
      { name: "challanNumber", type: "string", description: "Supplier's challan / packing-slip number.", required: false },
      { name: "status", type: "string", description: "'in_transit' | 'delivered' | 'short_shipped'. Default 'in_transit'.", required: false },
      { name: "photoIds", type: "string[]", description: "Ids of dispatch photos.", required: false },
    ],
    response: "Dispatch (with id, brokerId).",
    example: curl("POST", "/api/dispatches", "{\"poId\":\"po1\",\"dispatchedAt\":\"2024-04-15T09:00:00Z\",\"quantity\":80}"),
  },

  // ── Bills + Payments + Brokerage ─────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/bills",
    description:
      "List bills (adjusted billing, including GST), with linked PO + payment status + outstanding balance.",
    auth: true,
    params: [
      { name: "status", type: "string", description: "'unpaid' | 'partial' | 'paid' | 'disputed'.", required: false },
      { name: "clientId", type: "string", description: "Filter by client.", required: false },
    ],
    response: "(Bill & { po, client, paidAmount, outstanding })[].",
    example: curl("GET", "/api/bills?status=unpaid"),
  },
  {
    method: "POST",
    path: "/api/bills",
    description:
      "Generate a bill for a PO. Computes adjusted billing including GST (per supplier GST-applicability), and triggers brokerage accrual.",
    auth: true,
    body: [
      { name: "poId", type: "string", description: "PO to bill.", required: true },
      { name: "billNumber", type: "string", description: "Manual bill number (auto-generated if omitted).", required: false },
      { name: "adjustments", type: "array", description: "Line-item adjustments: { description, amount }[].", required: false },
    ],
    response: "Bill & { brokerage } — the auto-accrued brokerage is returned alongside.",
    example: curl("POST", "/api/bills", "{\"poId\":\"po1\"}"),
  },
  {
    method: "GET",
    path: "/api/payments",
    description:
      "List payments received from clients, with linked bill + PO + brokerage-eligibility status.",
    auth: true,
    params: [
      { name: "billId", type: "string", description: "Filter by parent bill.", required: false },
      { name: "clientId", type: "string", description: "Filter by client.", required: false },
    ],
    response: "(Payment & { bill, client, triggeredBrokerage })[].",
    example: curl("GET", "/api/payments?clientId=c1"),
  },
  {
    method: "POST",
    path: "/api/payments",
    description:
      "Record a payment from a client against a bill. When the bill is fully settled, this triggers brokerage eligibility (transitioning brokerage from 'pending' → 'accrued'). Audit-logged.",
    auth: true,
    body: [
      { name: "billId", type: "string", description: "Bill being paid.", required: true },
      { name: "amount", type: "number", description: "Amount received (INR).", required: true },
      { name: "paidAt", type: "string (ISO)", description: "Payment date.", required: true },
      { name: "method", type: "string", description: "'cash' | 'cheque' | 'bank_transfer' | 'upi'.", required: false },
      { name: "reference", type: "string", description: "Cheque/UPI reference.", required: false },
    ],
    response: "{ payment, triggeredBrokerage: Brokerage | null }.",
    example: curl("POST", "/api/payments", "{\"billId\":\"b1\",\"amount\":25000,\"paidAt\":\"2024-04-20T00:00:00Z\",\"method\":\"bank_transfer\"}"),
  },
  {
    method: "GET",
    path: "/api/brokerages",
    description:
      "List brokerage entries with status (pending / accrued / scheduled / paid), linked bill + client, and payout grouping if assigned.",
    auth: true,
    params: [
      { name: "status", type: "string", description: "'pending' | 'accrued' | 'scheduled' | 'paid'.", required: false },
      { name: "clientId", type: "string", description: "Filter by client.", required: false },
    ],
    response: "(Brokerage & { bill, client, payout })[].",
    example: curl("GET", "/api/brokerages?status=accrued"),
  },
  {
    method: "POST",
    path: "/api/brokerages",
    description:
      "Force-eligible an existing brokerage (manual override) OR create a new payout batch grouping accrued brokerages. Behaviour selected by the body shape.",
    auth: true,
    body: [
      { name: "forceEligible", type: "object", description: "{ brokerageId, reason } — manually mark a brokerage as eligible.", required: false },
      { name: "createPayout", type: "object", description: "{ brokerageIds[], cadence: 'immediate' | '4month' | '12month', clientId } — group into a payout batch.", required: false },
    ],
    response:
      "forceEligible → { brokerage }. createPayout → { payout: BrokeragePayout, brokerages: Brokerage[] }.",
    example: curl("POST", "/api/brokerages", "{\"createPayout\":{\"brokerageIds\":[\"br1\",\"br2\"],\"cadence\":\"immediate\"}}"),
  },

  // ── Disputes ────────────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/disputes",
    description:
      "List disputes, with linked PO + bill + parties (client/supplier), and resolution status.",
    auth: true,
    params: [
      { name: "status", type: "string", description: "'open' | 'resolved' | 'rejected'.", required: false },
      { name: "entityType", type: "string", description: "'PO' | 'Bill' | 'Dispatch' | 'Payment'.", required: false },
    ],
    response: "(Dispute & { po, bill, client, supplier })[].",
    example: curl("GET", "/api/disputes?status=open"),
  },
  {
    method: "POST",
    path: "/api/disputes",
    description: "Log a new dispute against a PO / bill / dispatch / payment.",
    auth: true,
    body: [
      { name: "entityType", type: "string", description: "'PO' | 'Bill' | 'Dispatch' | 'Payment'.", required: true },
      { name: "entityId", type: "string", description: "Id of the disputed entity.", required: true },
      { name: "reason", type: "string", description: "Free-text dispute reason.", required: true },
      { name: "amount", type: "number", description: "Disputed amount (optional).", required: false },
    ],
    response: "Dispute (with id, status='open').",
    example: curl("POST", "/api/disputes", "{\"entityType\":\"Bill\",\"entityId\":\"b1\",\"reason\":\"Wrong GST calculation\"}"),
  },
  {
    method: "PATCH",
    path: "/api/disputes/[id]",
    description: "Resolve (status='resolved') or reject (status='rejected') a dispute. Audit-logged.",
    auth: true,
    params: [
      { name: "id", type: "string", description: "Dispute id.", required: true },
    ],
    body: [
      { name: "status", type: "string", description: "'resolved' | 'rejected'.", required: true },
      { name: "resolution", type: "string", description: "Resolution/rejection note.", required: false },
    ],
    response: "Updated Dispute | 404.",
    example: curl("PATCH", "/api/disputes/d1", "{\"status\":\"resolved\",\"resolution\":\"Adjusted bill after re-count.\"}"),
  },
  {
    method: "DELETE",
    path: "/api/disputes/[id]",
    description: "Delete a dispute. Only allowed for disputes with status 'rejected' (returns 409 otherwise).",
    auth: true,
    params: [
      { name: "id", type: "string", description: "Dispute id.", required: true },
    ],
    response: "{ ok: true } | 404 | 409.",
    example: curl("DELETE", "/api/disputes/d1"),
  },

  // ── Notifications ────────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/notifications",
    description:
      "List notifications for the current broker, sorted newest-first. Supports status filter + pagination.",
    auth: true,
    params: [
      { name: "status", type: "string", description: "'pending' | 'done' | 'dismissed'.", required: false },
      { name: "limit", type: "number", description: "Page size (default 50).", required: false },
    ],
    response: "Notification[].",
    example: curl("GET", "/api/notifications?status=pending"),
  },
  {
    method: "PATCH",
    path: "/api/notifications",
    description:
      "Mark a single notification (or a batch) as done or dismissed. Body selects mode.",
    auth: true,
    body: [
      { name: "id", type: "string", description: "Single-notification id (mutually exclusive with ids).", required: false },
      { name: "ids", type: "string[]", description: "Batch of notification ids.", required: false },
      { name: "status", type: "string", description: "'done' | 'dismissed'.", required: true },
    ],
    response: "{ updated: number }.",
    example: curl("PATCH", "/api/notifications", "{\"ids\":[\"n1\",\"n2\"],\"status\":\"done\"}"),
  },
  {
    method: "GET",
    path: "/api/notifications/generate",
    description:
      "Trigger on-demand auto-generation of reminders (overdue POs, due bills, eligible brokerage). Usually runs hourly via the scheduler mini-service.",
    auth: true,
    response: "{ generated: number } — count of new notifications created.",
    example: curl("GET", "/api/notifications/generate"),
  },
  {
    method: "POST",
    path: "/api/notifications/generate",
    description: "Same as the GET form but accepts body params for scoped generation.",
    auth: true,
    body: [
      { name: "dryRun", type: "boolean", description: "If true, return the would-be-generated notifications without writing.", required: false },
    ],
    response: "{ generated: number, notifications?: Notification[] }.",
    example: curl("POST", "/api/notifications/generate", "{\"dryRun\":true}"),
  },
  {
    method: "POST",
    path: "/api/notifications/email",
    description: "Send an email digest of pending notifications to the broker's email address.",
    auth: true,
    body: [
      { name: "to", type: "string", description: "Override recipient email (defaults to broker email).", required: false },
    ],
    response: "{ ok: true, sentTo: string }.",
    example: curl("POST", "/api/notifications/email", "{}"),
  },

  // ── Audit + Data Health + Tags ──────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/audit",
    description:
      "Audit trail for every financial mutation (payment, bill, brokerage, dispute, dispatch, payout). Supports rich filtering by entity type, action, date range, and user.",
    auth: true,
    params: [
      { name: "entityType", type: "string", description: "Filter by entity (Payment, Bill, Brokerage, …).", required: false },
      { name: "action", type: "string", description: "Filter by action: 'create' | 'update' | 'delete' | 'force_eligible' | 'payout'.", required: false },
      { name: "from", type: "string (ISO date)", description: "Start date.", required: false },
      { name: "to", type: "string (ISO date)", description: "End date.", required: false },
      { name: "userId", type: "string", description: "Filter by acting user.", required: false },
    ],
    response: "{ logs: AuditLog[], stats: { total, filtered, shown, byAction, byEntityType, dateRange } }.",
    example: curl("GET", "/api/audit?action=create&from=2024-04-01&to=2024-04-30"),
  },
  {
    method: "GET",
    path: "/api/data-health",
    description:
      "Run all data-health checks (orphan brokerage, missing brokerId, duplicate bills, missing client/supplier links, etc.) and return issues + an overall health score.",
    auth: true,
    response:
      "{ score: number (0-100), issues: { id, severity, title, count, fixable }[] }.",
    example: curl("GET", "/api/data-health"),
  },
  {
    method: "POST",
    path: "/api/data-health/fix",
    description:
      "Fix a specific data-health issue by id. Returns the before/after snapshot for audit.",
    auth: true,
    body: [
      { name: "issueId", type: "string", description: "Issue id from /api/data-health.", required: true },
      { name: "dryRun", type: "boolean", description: "If true, return the planned fix without applying.", required: false },
    ],
    response: "{ fixed: number, after?: {...} }.",
    example: curl("POST", "/api/data-health/fix", "{\"issueId\":\"orphan-brokerage\"}"),
  },
  {
    method: "GET",
    path: "/api/tags",
    description: "List all tags (cross-entity labels) for the current broker, with assignment counts.",
    auth: true,
    response: "(Tag & { assignedCount })[].",
    example: curl("GET", "/api/tags"),
  },
  {
    method: "POST",
    path: "/api/tags",
    description: "Create a new tag. Tag names are globally unique (DB-level constraint).",
    auth: true,
    body: [
      { name: "name", type: "string", description: "Tag name (unique).", required: true },
      { name: "color", type: "string", description: "Hex color, e.g. '#10b981'.", required: false },
    ],
    response: "Tag (with id).",
    example: curl("POST", "/api/tags", "{\"name\":\"VIP\",\"color\":\"#10b981\"}"),
  },

  // ── Search + Saved Views + Settings ─────────────────────────────────────────
  {
    method: "GET",
    path: "/api/search",
    description:
      "Global unified search across all entities (clients, suppliers, POs, bills, payments, disputes, visits, dispatches, notifications, audit logs). Returns ranked, type-tagged results.",
    auth: true,
    params: [
      { name: "q", type: "string", description: "Search query (min 2 chars).", required: true },
      { name: "limit", type: "number", description: "Max results (default 20, max 50).", required: false },
    ],
    response: "{ results: { id, type, title, subtitle, entityType, entityId }[] }.",
    example: curl("GET", "/api/search?q=acme&limit=20"),
  },
  {
    method: "GET",
    path: "/api/saved-views",
    description: "List saved filter views for the current broker (per-view named filters).",
    auth: true,
    response: "SavedView[].",
    example: curl("GET", "/api/saved-views"),
  },
  {
    method: "POST",
    path: "/api/saved-views",
    description: "Save a new filter view for a specific list view.",
    auth: true,
    body: [
      { name: "view", type: "string", description: "Target view key (e.g. 'bills', 'payments').", required: true },
      { name: "name", type: "string", description: "Display name.", required: true },
      { name: "filter", type: "object", description: "Filter state to apply.", required: true },
    ],
    response: "SavedView (with id, brokerId).",
    example: curl("POST", "/api/saved-views", "{\"view\":\"bills\",\"name\":\"Unpaid + Client A\",\"filter\":{\"status\":\"unpaid\",\"clientId\":\"c1\"}}"),
  },
  {
    method: "GET",
    path: "/api/settings",
    description:
      "Read all system settings (currency, brokerage rate, GST default, auto-backup cadence, etc.). Settings are broker-scoped except for system-wide defaults.",
    auth: true,
    response: "Record<string, string | number | boolean>.",
    example: curl("GET", "/api/settings"),
  },
  {
    method: "POST",
    path: "/api/settings",
    description: "Update system settings. Writes are audit-logged with the acting broker's id + name.",
    auth: true,
    body: [
      { name: "key", type: "string", description: "Setting key.", required: true },
      { name: "value", type: "string | number | boolean", description: "New value.", required: true },
    ],
    response: "{ ok: true }.",
    example: curl("POST", "/api/settings", "{\"key\":\"brokerageRate\",\"value\":0.02}"),
  },

  // ── Export + Reports + Backup ───────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/export",
    description:
      "Export any list view to CSV. The `type` param selects the builder (clients, suppliers, pos, bills, payments, brokerage, audit).",
    auth: true,
    params: [
      { name: "type", type: "string", description: "Builder key: 'clients' | 'suppliers' | 'pos' | 'bills' | 'payments' | 'brokerage' | 'audit'.", required: true },
      { name: "from", type: "string (ISO date)", description: "Start date (audit only).", required: false },
      { name: "to", type: "string (ISO date)", description: "End date (audit only).", required: false },
    ],
    response: "text/csv (Content-Disposition: attachment; filename=...).",
    example: curl("GET", "/api/export?type=bills"),
  },
  {
    method: "GET",
    path: "/api/reports",
    description:
      "Generate a PDF report. The `type` param selects one of 6 built-in builders (brokerage statement, client ledger, supplier summary, audit trail, PO, party ledger).",
    auth: true,
    params: [
      { name: "type", type: "string", description: "'brokerage_statement' | 'client_ledger' | 'supplier_summary' | 'audit_trail' | 'po' | 'party_ledger'.", required: true },
      { name: "clientId", type: "string", description: "Required for client_ledger / party_ledger.", required: false },
      { name: "supplierId", type: "string", description: "Required for supplier_summary / party_ledger.", required: false },
      { name: "poId", type: "string", description: "Required for po.", required: false },
      { name: "partyType", type: "string", description: "'Client' | 'Supplier' for party_ledger.", required: false },
      { name: "from", type: "string (ISO date)", description: "Start date (brokerage_statement / audit_trail).", required: false },
      { name: "to", type: "string (ISO date)", description: "End date (brokerage_statement / audit_trail).", required: false },
    ],
    response: "application/pdf (Content-Disposition: attachment; filename=...).",
    example: curl("GET", "/api/reports?type=brokerage_statement&from=2024-01-01&to=2024-03-31"),
  },
  {
    method: "GET",
    path: "/api/backup",
    description:
      "Download a full SQLite database backup (binary stream). The current user must be authenticated.",
    auth: true,
    response: "application/octet-stream (Content-Disposition: attachment; filename=broker-os-backup-YYYY-MM-DD.db).",
    example: curl("GET", "/api/backup"),
  },
  {
    method: "POST",
    path: "/api/backup",
    description:
      "Restore the database from an uploaded backup file. Multipart form-data with a `file` field. Destructive — overwrites all current data.",
    auth: true,
    body: [
      { name: "file", type: "File (multipart)", description: "SQLite backup file uploaded as multipart form-data.", required: true },
    ],
    response: "{ ok: true, restoredAt: string }.",
    example: "curl -X POST '/api/backup' -b cookie.txt -F 'file=@backup.db'",
  },

  // ── Auth + Portal ───────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/auth/me",
    description:
      "Return the current authenticated user + linked broker profile. Returns { user: null, broker: null } if not signed in (no 401 — used by the login gate).",
    auth: false,
    response: "{ user: { id, email } | null, broker: { id, fullName, email } | null }.",
    example: curl("GET", "/api/auth/me"),
  },
  {
    method: "DELETE",
    path: "/api/auth",
    description: "Logout — invalidates the current Supabase session.",
    auth: true,
    response: "{ ok: true }.",
    example: curl("DELETE", "/api/auth"),
  },
  {
    method: "GET",
    path: "/api/portal/me",
    description:
      "Portal-user endpoint: returns the client/supplier party linked to the currently-authenticated portal user (for client/supplier-facing portal views).",
    auth: true,
    response: "{ partyType: 'Client' | 'Supplier', party: {...} } | 404 if no link.",
    example: curl("GET", "/api/portal/me"),
  },
  {
    method: "GET",
    path: "/api/portal/data",
    description:
      "Portal-party-scoped data: returns the POs, bills, dispatches, and payments visible to the linked client/supplier party (read-only — no broker-wide view).",
    auth: true,
    response: "{ pos, bills, dispatches, payments } scoped to the linked party.",
    example: curl("GET", "/api/portal/data"),
  },
  {
    method: "POST",
    path: "/api/portal/invite",
    description:
      "Enable portal access for a client or supplier. Generates a one-time invite link + creates a Supabase user record (if missing).",
    auth: true,
    body: [
      { name: "partyType", type: "string", description: "'Client' | 'Supplier'.", required: true },
      { name: "partyId", type: "string", description: "Id of the client/supplier.", required: true },
      { name: "email", type: "string", description: "Email to send the invite to (defaults to the party's email).", required: false },
    ],
    response: "{ ok: true, inviteUrl: string }.",
    example: curl("POST", "/api/portal/invite", "{\"partyType\":\"Client\",\"partyId\":\"c1\"}"),
  },
];
