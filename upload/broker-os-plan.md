# Garment Broker OS — Comprehensive Product & Architecture Plan
### Prepared for build handoff to z.ai

---

## 1. Executive Summary

This document specifies a complete software system to digitize and manage the end-to-end operations of a garment industry broker: client visits and on-spot bookings, PO generation, supplier dispatch tracking, payment collection, brokerage (commission) calculation and payout, returns/short-shipment adjustments, and full photo-documented audit trails — with performance dashboards for both clients (buyers) and suppliers.

The system should feel **modern, minimal, and glass-morphic** — clean surfaces, soft blur/translucency, generous whitespace, and a calm, professional visual language suited to a financial/operations tool used daily.

---

## 2. Business Context

The broker acts as the bridge between **buyers (clients)** and **garment suppliers/manufacturers**. Core business cycle:

1. Client confirms a visit date → broker follows up if they don't show.
2. Broker escorts client supplier-by-supplier, showing products live.
3. On-spot booking: client selects styles, set quantities, colors, per supplier.
4. Broker generates a **PO on the client's behalf** at time of booking, hands it to the supplier.
5. Supplier commits an expected dispatch date.
6. Goods dispatch → client receives → any shortfall (partial shipment) gets flagged by the client to the broker.
7. Broker follows up with supplier on the balance and a revised date.
8. Client pays supplier over time (payment cycle varies per client — e.g. 4 months, or custom).
9. Billing is adjusted for short-shipments and returns (e.g. defective goods) before brokerage is computed.
10. Broker earns commission (commonly 5%, varies per supplier) from the **supplier** side — but only once the **client's full payment** for that PO/bill is received. Partial payments are recorded but don't trigger brokerage payout.
11. Brokerage payout timing to the broker itself varies by client relationship — immediate on receipt, quarterly (4-month cumulative), or annual (12-month cumulative).

Everything — every piece, every payment, every PO, every dispute — needs to be tracked with **photo evidence** at each stage.

---

## 3. User Roles

| Role | Access |
|---|---|
| **Broker / Admin (primary user)** | Full access — creates visits, bookings, POs, tracks dispatch, payments, brokerage, reports |
| **Sub-brokers / Agents** *(future-ready)* | Scoped access to their own clients/suppliers, own performance tracked separately |
| **Supplier (optional portal, future)** | View their own POs, confirm dispatch dates, upload dispatch photos |
| **Client (optional portal, future)** | View their own bookings, POs, delivery status, ledger |

*(For v1, build broker/admin-only; design the data model so supplier/client portals can be switched on later without re-architecture.)*

---

## 4. Core Modules

1. **Contacts** — Clients & Suppliers master data (profile, contact info, GST/business details, commission %, payment terms/cycle)
2. **Visits** — Scheduling, follow-up status, visit-to-supplier mapping
3. **Bookings & POs** — Line-item booking (style, set qty, color) per supplier per visit; auto-generated PO per client-supplier pair
4. **Dispatch Tracking** — Expected vs actual dispatch, partial shipment handling, revised ETAs
5. **Financial Engine** — Billing adjustment (short-ship + returns), GST handling, payment ledger, brokerage calculation & payout scheduling
6. **Disputes/Returns** — Shortfall and defect logging, resolution status, linked to original booking/PO
7. **Documents/Photos** — Attach photos at booking, dispatch, receiving, and dispute stages
8. **Dashboards & Reports** — Client view, Supplier view, Broker earnings, performance analytics
9. **Notifications** — Follow-up reminders, dispatch due dates, payment due dates, brokerage due dates

---

## 5. Data Model (Core Entities)

### 5.1 `Client`
- id, name, contact info, GST no.
- default payment cycle (days/months)
- brokerage payout cadence for this client: `immediate | 4_month_cumulative | 12_month_cumulative`
- credit exposure (computed), avg. payment delay (computed), return rate (computed)

### 5.2 `Supplier`
- id, name, contact info, GST no.
- default commission % (overridable per booking/PO)
- performance metrics (computed): avg dispatch delay, short-shipment rate, fulfillment %

### 5.3 `Visit`
- id, client_id, planned_date, actual_date, status (`scheduled | followed_up | occurred | no_show`)
- linked bookings (one visit → multiple supplier bookings)

### 5.4 `Booking` (per client-supplier pair within a visit)
- id, visit_id, client_id, supplier_id
- line items: style/kurti name, set qty, color, unit price
- auto-generates a linked `PO`
- photos (products selected, on-spot booking sheet)

### 5.5 `PurchaseOrder (PO)`
- id, booking_id, client_id, supplier_id
- line items (style, qty, color, rate), total value
- status: `open | partially_delivered | fully_delivered | closed`
- expected dispatch date (from supplier), revised dates log

### 5.6 `Dispatch`
- id, po_id, dispatch_date, items & quantities dispatched, photos
- can be multiple dispatch entries against one PO (partial shipments)
- computed: `delivered_qty / ordered_qty` per PO

### 5.7 `Return / Dispute`
- id, po_id or dispatch_id, type (`short_shipment | defective_return | other`)
- quantity/value affected, photos, resolution status, linked adjustment to billing

### 5.8 `Bill`
- id, po_id, client_id, supplier_id
- base amount = PO value − short-shipment value − returns value
- GST amount (calculated on base, tracked separately)
- final amount = base + GST
- status: `pending | partially_paid | fully_paid`

### 5.9 `Payment` (client → supplier, tracked by broker)
- id, bill_id, amount, date, mode, photos/proof (if applicable)
- running balance against bill

### 5.10 `Brokerage`
- id, bill_id, supplier_id, commission_% (from supplier), base_amount (bill base, excl. GST)
- brokerage_amount = base_amount × commission_%
- eligibility: triggers only when `Bill.status = fully_paid`
- payout entry: linked to client's payout cadence (immediate / 4-month batch / 12-month batch)
- payout status: `accrued | scheduled | paid`

### 5.11 `Notification/Reminder`
- type (`visit_followup | dispatch_due | payment_due | brokerage_due`), due_date, linked entity, status

---

## 6. Key Workflows (Detailed)

### 6.1 Booking & PO Flow
`Visit created → client confirms/no-show → broker visits suppliers → on-spot line items entered per supplier → PO auto-generated per client-supplier pair → PO sent to supplier → supplier sets expected dispatch date`

### 6.2 Dispatch & Shortfall Flow
`Supplier dispatches (full or partial) → dispatch entry logged with photos → PO status updates (partial/full) → if shortfall: client flags broker → broker follows up with supplier → new expected date logged → repeat until PO closed`

### 6.3 Billing Adjustment Flow
`PO value → minus short-shipment value (undelivered qty) → minus returns/defects value → = Bill base amount → + GST → = final bill`
*Example: PO ₹1000 → supplier delivered ₹900 → client returned ₹100 defective → base = ₹800 → bill = ₹800 + GST*

### 6.4 Payment & Brokerage Flow
`Client pays supplier (via broker tracking) → partial payments logged against Bill → Bill fully paid → Brokerage becomes eligible → brokerage = base_amount × commission% (GST excluded) → payout to broker follows client's payout cadence (immediate/4-month/12-month cumulative)`

### 6.5 Dispute Flow
`Shortfall/defect reported → logged with photos → linked to PO/Dispatch → resolution tracked → billing auto-adjusted on resolution`

---

## 7. Financial Engine — Business Rules Summary

- Brokerage is **always calculated on base billed amount, excluding GST**.
- Brokerage is **only payable once the bill is fully paid by the client** — no partial/pro-rata brokerage on partial payments.
- Brokerage **payout to the broker** (separate from *eligibility*) follows the **client's** configured cadence — immediate, 4-month cumulative, or 12-month cumulative — based on cumulative payments received from that client in the period.
- Commission % is **set per supplier** (default 5%, overridable).
- All billing adjustments (short-ship, returns) must be reflected **before** GST and brokerage are computed.

---

## 8. Dashboards & Reports

### 8.1 Client Detail View (select a client →)
- Visit history (dates, suppliers visited)
- All bookings/POs, per supplier, with status
- Delivery status per PO (ordered vs delivered qty)
- Outstanding balance, payment history
- Return/defect history

### 8.2 Supplier Detail View (select a supplier →)
- Buyers served, what/how much supplied
- PO fulfillment rate (ordered vs delivered, on-time vs delayed)
- Short-shipment rate
- Outstanding brokerage owed to broker
- Payment/dispatch reliability score

### 8.3 Broker Financial Dashboard
- Brokerage accrued vs paid vs pending
- Monthly/quarterly earnings trend
- Client-wise and supplier-wise business volume
- Upcoming brokerage payouts by cadence

### 8.4 Party Ledger (universal — client or supplier)
- Full transaction history, single-page view

### 8.5 Notifications Panel
- Follow-ups due, dispatch dates due, payments due, brokerage due

---

## 9. UI/UX Design Direction

**Aesthetic:** Modern, minimal, **glassmorphism**.

- **Surfaces:** translucent frosted-glass cards (`backdrop-blur`, low-opacity white/dark backgrounds, subtle 1px light border) floating over a soft gradient or muted background — not stark white.
- **Palette:** neutral base (soft off-white / deep charcoal for dark mode) with **one confident accent color** (e.g. deep indigo or emerald) used sparingly for CTAs, status highlights, and key numbers. Avoid rainbow color-coding — keep it restrained.
- **Typography:** a clean modern sans-serif (e.g. Inter/Manrope-style), strong hierarchy — large light-weight numerals for KPIs, medium-weight labels.
- **Layout:** generous whitespace, card-based grid, soft rounded corners (12–20px radius), subtle shadows (not heavy drop-shadows — glass depth instead).
- **Motion:** subtle, purposeful micro-interactions only (hover lift, smooth transitions) — no gratuitous animation.
- **Data density:** this is an operations/finance tool — prioritize scannability (tables, status chips, sparklines) over decoration.
- **Status chips:** color-coded but muted (soft green/amber/red tints, not saturated) for statuses like `pending / partial / fulfilled / overdue`.
- **Dark mode:** should be a first-class citizen, not an afterthought — glassmorphism reads especially well on dark backgrounds.

---

## 10. Technical Architecture Guidance (for z.ai)

- **Relational database** strongly recommended (PostgreSQL) — this is a financial system with strict referential integrity needs (PO → Dispatch → Bill → Payment → Brokerage chains).
- **Photo storage:** object storage (S3-compatible) with references stored in DB; every photo tagged to its stage (booking / dispatch / receiving / dispute).
- **Audit trail:** every financial mutation (payment logged, brokerage computed, billing adjusted) should be immutable/append-only logged — critical for dispute resolution.
- **Computed fields** (fulfillment %, delay averages, credit exposure) — compute via scheduled jobs or on-read aggregation; don't hand-maintain.
- **Role-based access control** from day one, even if only broker/admin uses it initially — makes future supplier/client portals straightforward.
- **Notification engine:** decoupled service/cron checking due dates (visit follow-ups, dispatch ETAs, payment due, brokerage due) → push/email/WhatsApp-style alerts.
- **API-first design** so a future mobile app (broker is often in-market, on the move) can consume the same backend.

---

## 11. Non-Functional Requirements

- **Mobile-friendly / responsive** — broker is frequently on-site at supplier markets, likely booking on phone/tablet.
- **Offline-tolerant entry** *(nice-to-have)* — market areas may have poor connectivity; consider local draft-save with sync.
- **Multi-broker/agent scalability** — data model already supports this (Section 3); UI should support it in a later phase.
- **Auditability** — every number in a report must be traceable back to source transactions and photos.

---

## 12. Phased Implementation Roadmap

**Phase 1 — Core Ops:** Contacts, Visits, Bookings, PO generation, Dispatch tracking (incl. partial), photo attachments.

**Phase 2 — Financial Engine:** Billing adjustment logic (short-ship + returns + GST), Payment ledger, Brokerage calculation & eligibility rules.

**Phase 3 — Brokerage Payout & Dashboards:** Payout cadence engine (immediate/4-month/12-month), Client detail view, Supplier detail view, Broker financial dashboard.

**Phase 4 — Disputes, Notifications, Polish:** Dispute/return workflow UI, notification/reminder engine, party ledger view, reporting exports.

**Phase 5 (future) — Portals & Scale:** Supplier self-service portal, client self-service portal, multi-broker/agent support, mobile app.

---

## 13. Open Questions / Assumptions to Validate with Stakeholder

1. Can one PO span multiple visits, or is it always one PO per booking-visit-supplier instance?
2. Is GST rate uniform, or does it vary by product/supplier and need to be configurable?
3. Should disputed/returned quantities be automatically deducted from a supplier's performance score, or logged separately?
4. For the 4-month/12-month cumulative brokerage payout — is the "period" a rolling window from first payment, or a fixed calendar cycle?
5. Does the broker ever advance brokerage before full client payment (as a business decision), and if so, should the system support manual override of the "fully paid" trigger?

---

*This document is intended as the master build reference. Each module in Section 4 can be broken into its own detailed spec/ticket for implementation.*
