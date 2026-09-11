import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentBroker } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Universal Party Ledger API
//
// GET /api/party-ledger?type=<client|supplier>&id=<partyId>
//
// Returns a unified timeline of every financial / operational event for the
// chosen party (client OR supplier), regardless of the underlying entity type.
// The timeline is built server-side from bills, payments, POs, dispatches,
// and disputes, then sorted descending by date and posted with a running
// balance (debit − credit) computed forward from the oldest entry.
//
// Stats:
//   client   → totalBusiness, totalReceived, totalPayable, balance
//   supplier → totalSupplied, totalBrokerage, outstandingBrokerage, paidBrokerage
//
// All queries are scoped to the authenticated broker's tenant.
// ─────────────────────────────────────────────────────────────────────────────

type LedgerEntryType = "bill" | "payment" | "po" | "dispatch" | "dispute";

type LedgerEntry = {
  date: string;
  type: LedgerEntryType;
  ref: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  // Optional colour/meta hints the UI may use.
  meta?: Record<string, string | number | boolean | null>;
};

type PartyInfo = {
  id: string;
  name: string;
  type: "client" | "supplier";
  contactInfo: {
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    gstNo: string | null;
  };
};

type ClientStats = {
  totalBusiness: number;
  totalReceived: number;
  totalPayable: number;
  balance: number;
};

type SupplierStats = {
  totalSupplied: number;
  totalBrokerage: number;
  outstandingBrokerage: number;
  paidBrokerage: number;
};

type ResponsePayload = {
  party: PartyInfo;
  ledger: LedgerEntry[];
  stats: ClientStats | SupplierStats;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function toISO(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString();
}

export async function GET(req: NextRequest) {
  const broker = await getCurrentBroker();
  if (!broker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = (searchParams.get("type") ?? "").toLowerCase();
  const id = (searchParams.get("id") ?? "").trim();

  if (type !== "client" && type !== "supplier") {
    return NextResponse.json(
      { error: "`type` must be either \"client\" or \"supplier\"." },
      { status: 400 },
    );
  }
  if (!id) {
    return NextResponse.json(
      { error: "`id` is required." },
      { status: 400 },
    );
  }

  try {
    if (type === "client") {
      const payload = await buildClientLedger(id, broker.id);
      return NextResponse.json(payload);
    }
    const payload = await buildSupplierLedger(id, broker.id);
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Party ledger failed: ${message}` }, { status: 500 });
  }
}

// ── Client ledger builder ────────────────────────────────────────────────────

async function buildClientLedger(clientId: string, brokerId: string): Promise<ResponsePayload> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      contactPerson: true,
      phone: true,
      email: true,
      address: true,
      gstNo: true,
      brokerId: true,
    },
  });
  if (!client || client.brokerId !== brokerId) {
    // Returning a 404 inside a Promise<ResponsePayload> path is awkward;
    // throw and let the GET handler return a clean error.
    throw new Error("Client not found.");
  }

  // Gather bills, payments, POs, dispatches, disputes in parallel — each
  // linked to this client directly (bills, payments, POs) or via the PO
  // (dispatches, disputes via po.clientId). All scoped to brokerId.
  const [bills, pos, dispatches, disputes] = await Promise.all([
    db.bill.findMany({
      where: { clientId, brokerId },
      include: {
        po: { select: { poNumber: true } },
        payments: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    db.purchaseOrder.findMany({
      where: { clientId, brokerId },
      select: {
        id: true,
        poNumber: true,
        totalValue: true,
        status: true,
        createdAt: true,
        supplier: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.dispatch.findMany({
      where: { po: { clientId, brokerId } },
      select: {
        id: true,
        dispatchDate: true,
        dispatchedQty: true,
        status: true,
        po: { select: { poNumber: true } },
      },
      orderBy: { dispatchDate: "asc" },
    }),
    db.dispute.findMany({
      where: { po: { clientId, brokerId } },
      select: {
        id: true,
        type: true,
        description: true,
        valueAffected: true,
        status: true,
        createdAt: true,
        po: { select: { poNumber: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const entries: LedgerEntry[] = [];

  // Bills: debit = finalAmount (what the client owes for this bill).
  for (const b of bills) {
    entries.push({
      date: toISO(b.createdAt),
      type: "bill",
      ref: b.billNumber,
      description: `Bill ${b.billNumber} raised for ${b.po.poNumber}`,
      debit: b.finalAmount,
      credit: 0,
      balance: 0,
      meta: {
        billStatus: b.status,
        poNumber: b.po.poNumber,
        finalAmount: b.finalAmount,
        paidAmount: b.paidAmount,
      },
    });
    // Payments linked to this bill: credit = amount (what the client paid).
    for (const p of b.payments) {
      entries.push({
        date: toISO(p.date),
        type: "payment",
        ref: p.reference || p.id.slice(-6),
        description: `Payment ${formatCurrencyINR(p.amount)} received via ${titleCase(p.mode)}`,
        debit: 0,
        credit: p.amount,
        balance: 0,
        meta: {
          mode: p.mode,
          billNumber: b.billNumber,
          reference: p.reference,
        },
      });
    }
  }

  // POs: debit = totalValue (order placed — represents an obligation).
  for (const p of pos) {
    entries.push({
      date: toISO(p.createdAt),
      type: "po",
      ref: p.poNumber,
      description: `PO ${p.poNumber} placed with ${p.supplier.name} for ${formatCurrencyINR(p.totalValue)}`,
      debit: p.totalValue,
      credit: 0,
      balance: 0,
      meta: {
        status: p.status,
        supplierName: p.supplier.name,
        totalValue: p.totalValue,
      },
    });
  }

  // Dispatches: info-only (no debit/credit) — represents the physical flow.
  for (const d of dispatches) {
    entries.push({
      date: toISO(d.dispatchDate),
      type: "dispatch",
      ref: d.po.poNumber,
      description: `Dispatch of ${d.dispatchedQty} sets for ${d.po.poNumber}`,
      debit: 0,
      credit: 0,
      balance: 0,
      meta: {
        status: d.status,
        dispatchedQty: d.dispatchedQty,
        poNumber: d.po.poNumber,
      },
    });
  }

  // Disputes: info-only — valueAffected is the affected amount, not a debit/credit.
  for (const d of disputes) {
    entries.push({
      date: toISO(d.createdAt),
      type: "dispute",
      ref: d.po.poNumber,
      description: `${titleCase(d.type)} dispute on ${d.po.poNumber}${d.description ? ` — ${d.description}` : ""}`,
      debit: 0,
      credit: 0,
      balance: 0,
      meta: {
        type: d.type,
        status: d.status,
        valueAffected: d.valueAffected,
        poNumber: d.po.poNumber,
      },
    });
  }

  // Sort ascending by date to compute running balance.
  entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let runningBalance = 0;
  for (const e of entries) {
    runningBalance += e.debit - e.credit;
    e.balance = runningBalance;
  }
  // Reverse to show newest first.
  entries.reverse();

  const totalBusiness = bills.reduce((s, b) => s + b.finalAmount, 0);
  const totalReceived = bills.reduce((s, b) => s + b.payments.reduce((sp, p) => sp + p.amount, 0), 0);
  const totalPayable = totalBusiness - totalReceived;

  const stats: ClientStats = {
    totalBusiness,
    totalReceived,
    totalPayable,
    balance: totalPayable,
  };

  const party: PartyInfo = {
    id: client.id,
    name: client.name,
    type: "client",
    contactInfo: {
      contactPerson: client.contactPerson,
      phone: client.phone,
      email: client.email,
      address: client.address,
      gstNo: client.gstNo,
    },
  };

  return { party, ledger: entries, stats };
}

// ── Supplier ledger builder ──────────────────────────────────────────────────

async function buildSupplierLedger(supplierId: string, brokerId: string): Promise<ResponsePayload> {
  const supplier = await db.supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
      name: true,
      contactPerson: true,
      phone: true,
      email: true,
      address: true,
      gstNo: true,
      brokerId: true,
    },
  });
  if (!supplier || supplier.brokerId !== brokerId) {
    throw new Error("Supplier not found.");
  }

  const [bills, pos, dispatches, disputes, brokerages] = await Promise.all([
    db.bill.findMany({
      where: { supplierId, brokerId },
      include: {
        po: { select: { poNumber: true } },
        client: { select: { name: true } },
        payments: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    db.purchaseOrder.findMany({
      where: { supplierId, brokerId },
      select: {
        id: true,
        poNumber: true,
        totalValue: true,
        status: true,
        createdAt: true,
        client: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.dispatch.findMany({
      where: { supplierId, brokerId },
      select: {
        id: true,
        dispatchDate: true,
        dispatchedQty: true,
        status: true,
        po: { select: { poNumber: true, client: { select: { name: true } } } },
      },
      orderBy: { dispatchDate: "asc" },
    }),
    db.dispute.findMany({
      where: { po: { supplierId, brokerId } },
      select: {
        id: true,
        type: true,
        description: true,
        valueAffected: true,
        status: true,
        createdAt: true,
        po: { select: { poNumber: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.brokerage.findMany({
      where: { supplierId, brokerId },
      select: {
        id: true,
        baseAmount: true,
        brokerageAmount: true,
        commissionRate: true,
        eligible: true,
        payoutStatus: true,
        createdAt: true,
        bill: { select: { billNumber: true } },
        client: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const entries: LedgerEntry[] = [];

  // Bills: from supplier perspective, the supplier is owed the base amount
  // (the brokerage gets subtracted). We model this as:
  //   debit  = baseAmount     (what supplier is owed)
  //   credit = brokerageAmount (brokerage = supplier's commission back to broker)
  // The "balance" then represents the net amount still owed to the supplier.
  for (const b of bills) {
    entries.push({
      date: toISO(b.createdAt),
      type: "bill",
      ref: b.billNumber,
      description: `Bill ${b.billNumber} raised for ${b.po.poNumber} (${b.client.name})`,
      debit: b.baseAmount,
      credit: 0,
      balance: 0,
      meta: {
        billStatus: b.status,
        poNumber: b.po.poNumber,
        clientName: b.client.name,
        baseAmount: b.baseAmount,
        finalAmount: b.finalAmount,
        paidAmount: b.paidAmount,
      },
    });
    // Brokerage on this bill (supplier's commission back to the broker).
    // Find the matching brokerage row (bills have at most one).
    const brokerage = brokerages.find((br) => br.bill.billNumber === b.billNumber);
    if (brokerage) {
      entries.push({
        date: toISO(brokerage.createdAt),
        type: "payment",
        ref: `BRK-${brokerage.bill.billNumber}`,
        description: `Brokerage ${formatCurrencyINR(brokerage.brokerageAmount)} @ ${brokerage.commissionRate.toFixed(1)}% accrued on ${b.billNumber}`,
        debit: 0,
        credit: brokerage.brokerageAmount,
        balance: 0,
        meta: {
          brokerageId: brokerage.id,
          commissionRate: brokerage.commissionRate,
          eligible: brokerage.eligible,
          payoutStatus: brokerage.payoutStatus,
        },
      });
    }
    // Payments from the client (received via the broker) that flow to the
    // supplier — model as credit (supplier gets paid).
    for (const p of b.payments) {
      entries.push({
        date: toISO(p.date),
        type: "payment",
        ref: p.reference || p.id.slice(-6),
        description: `Payment ${formatCurrencyINR(p.amount)} received via ${titleCase(p.mode)} for ${b.billNumber}`,
        debit: 0,
        credit: p.amount,
        balance: 0,
        meta: {
          mode: p.mode,
          billNumber: b.billNumber,
          reference: p.reference,
        },
      });
    }
  }

  // POs: debit = totalValue (orders placed with this supplier).
  for (const p of pos) {
    entries.push({
      date: toISO(p.createdAt),
      type: "po",
      ref: p.poNumber,
      description: `PO ${p.poNumber} placed by ${p.client.name} for ${formatCurrencyINR(p.totalValue)}`,
      debit: p.totalValue,
      credit: 0,
      balance: 0,
      meta: {
        status: p.status,
        clientName: p.client.name,
        totalValue: p.totalValue,
      },
    });
  }

  // Dispatches: info-only — what the supplier shipped.
  for (const d of dispatches) {
    entries.push({
      date: toISO(d.dispatchDate),
      type: "dispatch",
      ref: d.po.poNumber,
      description: `Dispatch of ${d.dispatchedQty} sets for ${d.po.poNumber} (${d.po.client.name})`,
      debit: 0,
      credit: 0,
      balance: 0,
      meta: {
        status: d.status,
        dispatchedQty: d.dispatchedQty,
        poNumber: d.po.poNumber,
        clientName: d.po.client.name,
      },
    });
  }

  // Disputes: info-only — issues with this supplier.
  for (const d of disputes) {
    entries.push({
      date: toISO(d.createdAt),
      type: "dispute",
      ref: d.po.poNumber,
      description: `${titleCase(d.type)} dispute on ${d.po.poNumber}${d.description ? ` — ${d.description}` : ""}`,
      debit: 0,
      credit: 0,
      balance: 0,
      meta: {
        type: d.type,
        status: d.status,
        valueAffected: d.valueAffected,
        poNumber: d.po.poNumber,
      },
    });
  }

  entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let runningBalance = 0;
  for (const e of entries) {
    runningBalance += e.debit - e.credit;
    e.balance = runningBalance;
  }
  entries.reverse();

  const totalSupplied = bills.reduce((s, b) => s + b.baseAmount, 0);
  const totalBrokerage = brokerages.reduce((s, b) => s + b.brokerageAmount, 0);
  const outstandingBrokerage = brokerages
    .filter((b) => b.eligible && b.payoutStatus !== "paid")
    .reduce((s, b) => s + b.brokerageAmount, 0);
  const paidBrokerage = brokerages
    .filter((b) => b.payoutStatus === "paid")
    .reduce((s, b) => s + b.brokerageAmount, 0);

  const stats: SupplierStats = {
    totalSupplied,
    totalBrokerage,
    outstandingBrokerage,
    paidBrokerage,
  };

  const party: PartyInfo = {
    id: supplier.id,
    name: supplier.name,
    type: "supplier",
    contactInfo: {
      contactPerson: supplier.contactPerson,
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.address,
      gstNo: supplier.gstNo,
    },
  };

  return { party, ledger: entries, stats };
}

// ── Small formatting helpers (server-side, no imports from client lib) ───────

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCurrencyINR(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}
