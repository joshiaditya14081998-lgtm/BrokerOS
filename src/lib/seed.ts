// Seed script — populates realistic demo data for the Broker OS
// Run with: bun run src/lib/seed.ts
import { db } from "./db";

async function main() {
  console.log("Seeding Broker OS database...");

  // Clean slate
  await db.adminAuditLog.deleteMany();
  await db.subscription.deleteMany();
  await db.auditLog.deleteMany();
  await db.notification.deleteMany();
  await db.photo.deleteMany();
  await db.brokerage.deleteMany();
  await db.brokeragePayout.deleteMany();
  await db.payment.deleteMany();
  await db.bill.deleteMany();
  await db.dispute.deleteMany();
  await db.dispatchDateLog.deleteMany();
  await db.dispatch.deleteMany();
  await db.purchaseOrder.deleteMany();
  await db.bookingLineItem.deleteMany();
  await db.booking.deleteMany();
  await db.visit.deleteMany();
  await db.client.deleteMany();
  await db.supplier.deleteMany();
  await db.systemSetting.deleteMany();
  await db.entityTag.deleteMany();
  await db.tag.deleteMany();
  await db.reportTemplate.deleteMany();
  await db.broker.deleteMany();
  await db.plan.deleteMany();

  // ── Default SaaS Plans ────────────────────────────────────────────────
  const plans = await Promise.all([
    db.plan.create({
      data: {
        name: "free",
        displayName: "Free",
        priceMonthly: 0,
        priceYearly: 0,
        maxClients: 5,
        maxSuppliers: 5,
        maxPOs: 10,
        maxPhotos: 50,
        portalAccess: false,
        aiDigest: false,
        customReports: false,
        advancedAnalytics: false,
        description: "Starter plan for individual brokers evaluating the platform.",
      },
    }),
    db.plan.create({
      data: {
        name: "basic",
        displayName: "Basic",
        priceMonthly: 999,
        priceYearly: 9990,
        maxClients: 25,
        maxSuppliers: 25,
        maxPOs: 100,
        maxPhotos: 500,
        portalAccess: true,
        aiDigest: false,
        customReports: false,
        advancedAnalytics: false,
        description: "For solo brokers running a small book of business.",
      },
    }),
    db.plan.create({
      data: {
        name: "pro",
        displayName: "Pro",
        priceMonthly: 2999,
        priceYearly: 29990,
        maxClients: 100,
        maxSuppliers: 100,
        maxPOs: 500,
        maxPhotos: 5000,
        portalAccess: true,
        aiDigest: true,
        customReports: true,
        advancedAnalytics: false,
        description: "For growing brokerages that need portals + AI digest.",
      },
    }),
    db.plan.create({
      data: {
        name: "enterprise",
        displayName: "Enterprise",
        priceMonthly: 9999,
        priceYearly: 99990,
        maxClients: -1,
        maxSuppliers: -1,
        maxPOs: -1,
        maxPhotos: -1,
        portalAccess: true,
        aiDigest: true,
        customReports: true,
        advancedAnalytics: true,
        description: "Unlimited everything + advanced forecasting. For multi-broker firms.",
      },
    }),
  ]);
  console.log("  Plans:", plans.map((p) => `${p.name} (₹${p.priceMonthly}/mo)`).join(", "));

  // ── Demo Super Admin Broker ───────────────────────────────────────────
  // This is a placeholder ID — in production, real Supabase Auth user IDs are used.
  // For the demo seed, we use a fixed UUID so the seed is idempotent.
  // The demo broker is also the SaaS super admin (isSuperAdmin=true) so the
  // Super Admin Panel is reachable out of the box.
  const DEMO_BROKER_ID = "00000000-0000-0000-0000-000000000001";
  const broker = await db.broker.create({
    data: {
      id: DEMO_BROKER_ID,
      email: "demo@broker-os.com",
      fullName: "Demo Broker",
      role: "admin",
      isSuperAdmin: true,
    },
  });
  console.log("  Broker (super admin):", broker.email);

  // ── Demo Subscription (Pro, trialing) ─────────────────────────────────
  const proPlan = plans.find((p) => p.name === "pro")!;
  const trialStart = new Date();
  const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14-day trial
  await db.subscription.create({
    data: {
      brokerId: DEMO_BROKER_ID,
      planId: proPlan.id,
      status: "trialing",
      trialStart,
      trialEnd,
      currentPeriodStart: trialStart,
      currentPeriodEnd: trialEnd,
    },
  });
  console.log("  Subscription: Pro (14-day trial)");

  // ── Suppliers ──────────────────────────────────────────────────────
  const suppliers = await Promise.all([
    db.supplier.create({
      data: {
        brokerId: DEMO_BROKER_ID,
        name: "Shree Balaji Textiles",
        contactPerson: "Ramesh Agarwal",
        phone: "+91 98200 11223",
        email: "ramesh@balajitextiles.in",
        address: "186, Ring Road, Surat, Gujarat",
        gstNo: "24AAGCB1234M1Z5",
        defaultCommissionRate: 5,
        defaultGstRate: 5,
        notes: "Specialist in cotton kurtis. Reliable dispatch.",
      },
    }),
    db.supplier.create({
      data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
        name: "Mahalaxmi Apparels",
        contactPerson: "Sunita Joshi",
        phone: "+91 99300 44556",
        email: "sunita@mahalaxmi.in",
        address: "42, Textile Hub, Bhiwandi, Maharashtra",
        gstNo: "27AAFCM8890P1Z2",
        defaultCommissionRate: 6,
        defaultGstRate: 5,
        notes: "Partywear & festive wear. Slightly delayed dispatches.",
      },
    }),
    db.supplier.create({
      data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
        name: "Krishna Knit Fab",
        contactPerson: "Gopal Pillai",
        phone: "+91 90400 77889",
        email: "gopal@krishnaknit.in",
        address: "23, Tirupur Knit Park, Tamil Nadu",
        gstNo: "33AAHCK5567Q1Z8",
        defaultCommissionRate: 4.5,
        defaultGstRate: 5,
        notes: "Knitted tops & tunics. Good value.",
      },
    }),
    db.supplier.create({
      data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
        name: "Ananya Ethnic Wear",
        contactPerson: "Ananya Desai",
        phone: "+91 98190 22331",
        email: "ananya@ananyaethnic.in",
        address: "77, Lajpat Nagar, New Delhi",
        gstNo: "07AASCA9012R1Z3",
        defaultCommissionRate: 7,
        defaultGstRate: 12,
        notes: "Premium ethnic sets. Higher commission, premium GST slab.",
      },
    }),
    db.supplier.create({
      data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
        name: "Vastram Creations",
        contactPerson: "Imran Sheikh",
        phone: "+91 97200 55661",
        email: "imran@vastram.in",
        address: "12, Sasoon Road, Pune, Maharashtra",
        gstNo: "27AAFCV3344S1Z9",
        defaultCommissionRate: 5,
        defaultGstRate: 5,
        notes: "Daily-wear kurtis. Volume supplier.",
      },
    }),
  ]);

  // ── Clients ────────────────────────────────────────────────────────
  const clients = await Promise.all([
    db.client.create({
      data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
        name: "Sharma Garments Hub",
        contactPerson: "Vikram Sharma",
        phone: "+91 98811 22003",
        email: "vikram@sharmagarments.in",
        address: "Sadar Bazar, Nagpur, Maharashtra",
        gstNo: "27AAHCS4412Q1Z7",
        defaultPaymentCycleDays: 120,
        payoutCadence: "immediate",
        gstRate: 5,
        notes: "Loyal buyer. 4-month payment cycle. Brokerage paid immediately.",
      },
    }),
    db.client.create({
      data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
        name: "Meenakshi Saree Emporium",
        contactPerson: "Meenakshi Iyer",
        phone: "+91 94400 11234",
        email: "meenakshi@emporium.in",
        address: "T Nagar, Chennai, Tamil Nadu",
        gstNo: "33AAFCM9988P1Z1",
        defaultPaymentCycleDays: 120,
        payoutCadence: "4_month_cumulative",
        gstRate: 5,
        notes: "Bulk buyer. Quarterly brokerage payouts.",
      },
    }),
    db.client.create({
      data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
        name: "Trendz Boutique",
        contactPerson: "Priya Kapoor",
        phone: "+91 98201 44551",
        email: "priya@trendz.in",
        address: "Linking Road, Bandra, Mumbai",
        gstNo: "27AAHCT6677Q1Z4",
        defaultPaymentCycleDays: 180,
        payoutCadence: "12_month_cumulative",
        gstRate: 12,
        notes: "Premium boutique. Annual brokerage. Higher GST slab.",
      },
    }),
    db.client.create({
      data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
        name: "Royal Wardrobe",
        contactPerson: "Arjun Mehta",
        phone: "+91 99100 77882",
        email: "arjun@royalwardrobe.in",
        address: "Sector 17, Chandigarh",
        gstNo: "04AAHCA3322Q1Z9",
        defaultPaymentCycleDays: 90,
        payoutCadence: "immediate",
        gstRate: 5,
        notes: "Fast-paying client.",
      },
    }),
    db.client.create({
      data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
        name: "Sai Family Store",
        contactPerson: "Sai Reddy",
        phone: "+91 90000 11223",
        email: "sai@saifamily.in",
        address: "Abids, Hyderabad, Telangana",
        gstNo: "36AAHCS5544P1Z2",
        defaultPaymentCycleDays: 150,
        payoutCadence: "4_month_cumulative",
        gstRate: 5,
        notes: "Growing retailer.",
      },
    }),
  ]);

  // ── Visits + Bookings + POs + Dispatch + Bill + Payment + Brokerage ─
  // Create a realistic chain for the first few clients.
  const now = new Date();

  // Visit 1 — Sharma Garments → occurred last month, fully paid
  const visit1 = await db.visit.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      clientId: clients[0].id,
      plannedDate: new Date(now.getTime() - 30 * 86400000),
      actualDate: new Date(now.getTime() - 29 * 86400000),
      status: "occurred",
      notes: "Client visited Balaji & Krishna. Placed bulk orders.",
    },
  });

  // Booking 1 → PO → fully delivered + paid + brokerage eligible & paid
  const booking1 = await db.booking.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      visitId: visit1.id,
      clientId: clients[0].id,
      supplierId: suppliers[0].id,
      commissionRate: 5,
      bookingDate: new Date(now.getTime() - 29 * 86400000),
      notes: "Cotton kurti sets — festive catalogue.",
      lineItems: {
        create: [
          { styleName: "Anarkali Cotton Kurti", color: "Indigo", setQty: 50, unitPrice: 480 },
          { styleName: "Straight Kurti Set", color: "Mustard", setQty: 40, unitPrice: 520 },
          { styleName: "A-line Kurti", color: "Olive", setQty: 30, unitPrice: 450 },
        ],
      },
    },
  });

  const li1 = await db.bookingLineItem.findMany({ where: { bookingId: booking1.id } });
  const po1Total = li1.reduce((s, i) => s + i.setQty * i.unitPrice, 0); // 24000 + 20800 + 13500 = 58300
  const po1 = await db.purchaseOrder.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      poNumber: "PO-2024-0001",
      bookingId: booking1.id,
      clientId: clients[0].id,
      supplierId: suppliers[0].id,
      lineItemsJson: JSON.stringify(
        li1.map((i) => ({
          styleName: i.styleName,
          color: i.color,
          setQty: i.setQty,
          unitPrice: i.unitPrice,
          lineTotal: i.setQty * i.unitPrice,
        }))
      ),
      totalValue: po1Total,
      commissionRate: 5,
      gstRate: 5,
      status: "fully_delivered",
      expectedDispatchDate: new Date(now.getTime() - 20 * 86400000),
    },
  });

  const dispatch1 = await db.dispatch.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      poId: po1.id,
      supplierId: suppliers[0].id,
      dispatchDate: new Date(now.getTime() - 18 * 86400000),
      itemsJson: JSON.stringify(
        li1.map((i) => ({ styleName: i.styleName, color: i.color, qty: i.setQty }))
      ),
      dispatchedQty: li1.reduce((s, i) => s + i.setQty, 0),
      status: "delivered",
      notes: "Full shipment received in good condition.",
    },
  });

  const bill1Base = po1Total; // no short-ship/returns
  const bill1Gst = Math.round(bill1Base * 0.05);
  const bill1 = await db.bill.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      billNumber: "BILL-2024-0001",
      poId: po1.id,
      clientId: clients[0].id,
      supplierId: suppliers[0].id,
      baseAmount: bill1Base,
      gstRate: 5,
      gstAmount: bill1Gst,
      finalAmount: bill1Base + bill1Gst,
      paidAmount: bill1Base + bill1Gst,
      status: "fully_paid",
      createdAt: new Date(now.getTime() - 15 * 86400000), // 15 days ago — before payments
    },
  });

  const pay1 = await db.payment.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      billId: bill1.id,
      clientId: clients[0].id,
      amount: Math.round((bill1Base + bill1Gst) * 0.6),
      date: new Date(now.getTime() - 10 * 86400000),
      mode: "bank_transfer",
      reference: "UTR123456789",
      notes: "Part payment 60%",
    },
  });
  const pay2 = await db.payment.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      billId: bill1.id,
      clientId: clients[0].id,
      amount: bill1Base + bill1Gst - Math.round((bill1Base + bill1Gst) * 0.6),
      date: new Date(now.getTime() - 2 * 86400000),
      mode: "cheque",
      reference: "CHQ-556677",
      notes: "Balance payment. Bill fully paid → brokerage eligible.",
    },
  });

  const brokerage1 = await db.brokerage.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      billId: bill1.id,
      supplierId: suppliers[0].id,
      clientId: clients[0].id,
      commissionRate: 5,
      baseAmount: bill1Base,
      brokerageAmount: Math.round(bill1Base * 0.05),
      eligible: true,
      eligibleAt: pay2.date,
      payoutStatus: "paid",
    },
  });

  const payout1 = await db.brokeragePayout.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      clientId: clients[0].id,
      cadence: "immediate",
      periodStart: pay2.date,
      periodEnd: pay2.date,
      totalAmount: brokerage1.brokerageAmount,
      status: "paid",
      paidAt: pay2.date,
      notes: "Immediate payout — client's cadence is immediate.",
      brokerages: { connect: { id: brokerage1.id } },
    },
  });

  // ── Visit 2 — Meenakshi → occurred, partial delivery, partial payment
  const visit2 = await db.visit.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      clientId: clients[1].id,
      plannedDate: new Date(now.getTime() - 20 * 86400000),
      actualDate: new Date(now.getTime() - 19 * 86400000),
      status: "occurred",
      notes: "Visited Mahalaxmi for festive stock.",
    },
  });

  const booking2 = await db.booking.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      visitId: visit2.id,
      clientId: clients[1].id,
      supplierId: suppliers[1].id,
      commissionRate: 6,
      bookingDate: new Date(now.getTime() - 19 * 86400000),
      notes: "Partywear anarkali sets.",
      lineItems: {
        create: [
          { styleName: "Embroidered Anarkali", color: "Maroon", setQty: 60, unitPrice: 950 },
          { styleName: "Sequinned Gown Set", color: "Black", setQty: 35, unitPrice: 1200 },
        ],
      },
    },
  });

  const li2 = await db.bookingLineItem.findMany({ where: { bookingId: booking2.id } });
  const po2Total = li2.reduce((s, i) => s + i.setQty * i.unitPrice, 0); // 57000 + 42000 = 99000
  const po2 = await db.purchaseOrder.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      poNumber: "PO-2024-0002",
      bookingId: booking2.id,
      clientId: clients[1].id,
      supplierId: suppliers[1].id,
      lineItemsJson: JSON.stringify(
        li2.map((i) => ({
          styleName: i.styleName,
          color: i.color,
          setQty: i.setQty,
          unitPrice: i.unitPrice,
          lineTotal: i.setQty * i.unitPrice,
        }))
      ),
      totalValue: po2Total,
      commissionRate: 6,
      gstRate: 5,
      status: "partially_delivered",
      expectedDispatchDate: new Date(now.getTime() - 8 * 86400000),
      revisedDispatchDate: new Date(now.getTime() + 4 * 86400000),
    },
  });

  // Partial dispatch — shortfall of 10 anarkali sets
  const dispatch2 = await db.dispatch.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      poId: po2.id,
      supplierId: suppliers[1].id,
      dispatchDate: new Date(now.getTime() - 6 * 86400000),
      itemsJson: JSON.stringify([
        { styleName: "Embroidered Anarkali", color: "Maroon", qty: 50 },
        { styleName: "Sequinned Gown Set", color: "Black", qty: 35 },
      ]),
      dispatchedQty: 85,
      status: "short_shipment",
      notes: "10 anarkali sets short. Supplier promised to ship balance.",
    },
  });

  // Dispute for the short shipment
  const dispute1 = await db.dispute.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      poId: po2.id,
      dispatchId: dispatch2.id,
      type: "short_shipment",
      description: "10 sets of Embroidered Anarkali (Maroon) not delivered.",
      quantityAffected: 10,
      valueAffected: 10 * 950,
      status: "open",
    },
  });

  const bill2Base = po2Total - 10 * 950; // 99000 - 9500 = 89500
  const bill2Gst = Math.round(bill2Base * 0.05);
  const bill2 = await db.bill.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      billNumber: "BILL-2024-0002",
      poId: po2.id,
      clientId: clients[1].id,
      supplierId: suppliers[1].id,
      baseAmount: bill2Base,
      gstRate: 5,
      gstAmount: bill2Gst,
      finalAmount: bill2Base + bill2Gst,
      paidAmount: Math.round((bill2Base + bill2Gst) * 0.4),
      status: "partially_paid",
      createdAt: new Date(now.getTime() - 10 * 86400000), // 10 days ago — before payment
    },
  });

  await db.payment.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      billId: bill2.id,
      clientId: clients[1].id,
      amount: Math.round((bill2Base + bill2Gst) * 0.4),
      date: new Date(now.getTime() - 3 * 86400000),
      mode: "upi",
      reference: "UPI-9988776655",
      notes: "Advance 40%. Balance due in payment cycle.",
    },
  });

  // Brokerage accrued but not eligible (bill not fully paid)
  await db.brokerage.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      billId: bill2.id,
      supplierId: suppliers[1].id,
      clientId: clients[1].id,
      commissionRate: 6,
      baseAmount: bill2Base,
      brokerageAmount: Math.round(bill2Base * 0.06),
      eligible: false,
      payoutStatus: "accrued",
    },
  });

  // ── Visit 3 — Trendz → scheduled (upcoming)
  await db.visit.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      clientId: clients[2].id,
      plannedDate: new Date(now.getTime() + 3 * 86400000),
      status: "scheduled",
      notes: "Trendz wants premium ethnic from Ananya.",
    },
  });

  // ── Visit 4 — Royal → followed up (no show, needs followup)
  await db.visit.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      clientId: clients[3].id,
      plannedDate: new Date(now.getTime() - 2 * 86400000),
      status: "followed_up",
      notes: "Client did not show. Followed up by phone.",
    },
  });

  // ── Visit 5 — Sai → occurred, fully delivered, fully paid (Ananya, premium)
  const visit5 = await db.visit.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      clientId: clients[4].id,
      plannedDate: new Date(now.getTime() - 45 * 86400000),
      actualDate: new Date(now.getTime() - 44 * 86400000),
      status: "occurred",
      notes: "Premium ethnic catalogue order.",
    },
  });

  const booking5 = await db.booking.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      visitId: visit5.id,
      clientId: clients[4].id,
      supplierId: suppliers[3].id,
      commissionRate: 7,
      bookingDate: new Date(now.getTime() - 44 * 86400000),
      lineItems: {
        create: [
          { styleName: "Silk Embroidered Set", color: "Royal Blue", setQty: 25, unitPrice: 2200 },
          { styleName: "Banarasi Lehenga Set", color: "Rani Pink", setQty: 15, unitPrice: 3500 },
        ],
      },
    },
  });
  const li5 = await db.bookingLineItem.findMany({ where: { bookingId: booking5.id } });
  const po5Total = li5.reduce((s, i) => s + i.setQty * i.unitPrice, 0); // 55000 + 52500 = 107500
  const po5 = await db.purchaseOrder.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      poNumber: "PO-2024-0003",
      bookingId: booking5.id,
      clientId: clients[4].id,
      supplierId: suppliers[3].id,
      lineItemsJson: JSON.stringify(
        li5.map((i) => ({
          styleName: i.styleName,
          color: i.color,
          setQty: i.setQty,
          unitPrice: i.unitPrice,
          lineTotal: i.setQty * i.unitPrice,
        }))
      ),
      totalValue: po5Total,
      commissionRate: 7,
      gstRate: 12,
      status: "fully_delivered",
      expectedDispatchDate: new Date(now.getTime() - 30 * 86400000),
    },
  });
  await db.dispatch.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      poId: po5.id,
      supplierId: suppliers[3].id,
      dispatchDate: new Date(now.getTime() - 25 * 86400000),
      itemsJson: JSON.stringify(
        li5.map((i) => ({ styleName: i.styleName, color: i.color, qty: i.setQty }))
      ),
      dispatchedQty: li5.reduce((s, i) => s + i.setQty, 0),
      status: "delivered",
    },
  });
  const bill5Base = po5Total;
  const bill5Gst = Math.round(bill5Base * 0.12);
  const bill5 = await db.bill.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      billNumber: "BILL-2024-0003",
      poId: po5.id,
      clientId: clients[4].id,
      supplierId: suppliers[3].id,
      baseAmount: bill5Base,
      gstRate: 12,
      gstAmount: bill5Gst,
      finalAmount: bill5Base + bill5Gst,
      paidAmount: bill5Base + bill5Gst,
      status: "fully_paid",
      createdAt: new Date(now.getTime() - 20 * 86400000), // 20 days ago — before payment
    },
  });
  await db.payment.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      billId: bill5.id,
      clientId: clients[4].id,
      amount: bill5Base + bill5Gst,
      date: new Date(now.getTime() - 15 * 86400000),
      mode: "bank_transfer",
      reference: "UTR-55667788",
      notes: "Full payment on delivery.",
    },
  });
  // Brokerage eligible but NOT yet paid (4-month cumulative cadence for this client)
  await db.brokerage.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      billId: bill5.id,
      supplierId: suppliers[3].id,
      clientId: clients[4].id,
      commissionRate: 7,
      baseAmount: bill5Base,
      brokerageAmount: Math.round(bill5Base * 0.07),
      eligible: true,
      eligibleAt: new Date(now.getTime() - 15 * 86400000),
      payoutStatus: "scheduled",
    },
  });

  // ── Visit 6 — Trendz → occurred with Vastram, fully paid, brokerage paid
  const visit6 = await db.visit.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      clientId: clients[2].id,
      plannedDate: new Date(now.getTime() - 60 * 86400000),
      actualDate: new Date(now.getTime() - 59 * 86400000),
      status: "occurred",
    },
  });
  const booking6 = await db.booking.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      visitId: visit6.id,
      clientId: clients[2].id,
      supplierId: suppliers[4].id,
      commissionRate: 5,
      bookingDate: new Date(now.getTime() - 59 * 86400000),
      lineItems: {
        create: [
          { styleName: "Daily Cotton Kurti", color: "Teal", setQty: 80, unitPrice: 320 },
          { styleName: "Printed Tunic", color: "Coral", setQty: 60, unitPrice: 380 },
        ],
      },
    },
  });
  const li6 = await db.bookingLineItem.findMany({ where: { bookingId: booking6.id } });
  const po6Total = li6.reduce((s, i) => s + i.setQty * i.unitPrice, 0); // 25600 + 22800 = 48400
  const po6 = await db.purchaseOrder.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      poNumber: "PO-2024-0004",
      bookingId: booking6.id,
      clientId: clients[2].id,
      supplierId: suppliers[4].id,
      lineItemsJson: JSON.stringify(
        li6.map((i) => ({ styleName: i.styleName, color: i.color, setQty: i.setQty, unitPrice: i.unitPrice, lineTotal: i.setQty * i.unitPrice }))
      ),
      totalValue: po6Total,
      commissionRate: 5,
      gstRate: 12,
      status: "fully_delivered",
      expectedDispatchDate: new Date(now.getTime() - 45 * 86400000),
    },
  });
  await db.dispatch.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      poId: po6.id,
      supplierId: suppliers[4].id,
      dispatchDate: new Date(now.getTime() - 40 * 86400000),
      itemsJson: JSON.stringify(li6.map((i) => ({ styleName: i.styleName, color: i.color, qty: i.setQty }))),
      dispatchedQty: li6.reduce((s, i) => s + i.setQty, 0),
      status: "delivered",
    },
  });
  const bill6Base = po6Total;
  const bill6Gst = Math.round(bill6Base * 0.12);
  const bill6 = await db.bill.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      billNumber: "BILL-2024-0004",
      poId: po6.id,
      clientId: clients[2].id,
      supplierId: suppliers[4].id,
      baseAmount: bill6Base,
      gstRate: 12,
      gstAmount: bill6Gst,
      finalAmount: bill6Base + bill6Gst,
      paidAmount: bill6Base + bill6Gst,
      status: "fully_paid",
      createdAt: new Date(now.getTime() - 30 * 86400000), // 30 days ago — before payment
    },
  });
  const pay6 = await db.payment.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      billId: bill6.id,
      clientId: clients[2].id,
      amount: bill6Base + bill6Gst,
      date: new Date(now.getTime() - 25 * 86400000),
      mode: "bank_transfer",
      reference: "UTR-12345678",
    },
  });
  const brokerage6 = await db.brokerage.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      billId: bill6.id,
      supplierId: suppliers[4].id,
      clientId: clients[2].id,
      commissionRate: 5,
      baseAmount: bill6Base,
      brokerageAmount: Math.round(bill6Base * 0.05),
      eligible: true,
      eligibleAt: pay6.date,
      payoutStatus: "paid",
    },
  });
  await db.brokeragePayout.create({
    data: {
        brokerId: "00000000-0000-0000-0000-000000000001",
      clientId: clients[2].id,
      cadence: "12_month_cumulative",
      periodStart: new Date(now.getTime() - 365 * 86400000),
      periodEnd: now,
      totalAmount: brokerage6.brokerageAmount,
      status: "paid",
      paidAt: new Date(now.getTime() - 20 * 86400000),
      brokerages: { connect: { id: brokerage6.id } },
    },
  });

  // ── Photos — stage-polymorphic audit trail examples ───────────────
  // Reference pre-generated placeholder images in /public/uploads.
  // (Generate replacements with: `z-ai image -p "..." -o ./public/uploads/<name>.jpg`)
  //
  // Schema note: Photo has separate nullable FK columns per parent table
  // (visitId / bookingId / dispatchId / disputeId / paymentId). We set the
  // matching one AND the polymorphic entityId in sync, so Prisma `include:
  // { photos: true }` reads and `/api/photos?entityType=…&entityId=…` queries
  // both resolve correctly.
  await db.photo.createMany({
    data: [
      {
        brokerId: DEMO_BROKER_ID,
        stage: "booking",
        entityType: "Booking",
        entityId: booking1.id,
        bookingId: booking1.id,
        url: "/uploads/seed-booking-sheet.jpg",
        caption: "Booking sheet — cotton kurti samples & swatches",
      },
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        stage: "dispatch",
        entityType: "Dispatch",
        entityId: dispatch1.id,
        dispatchId: dispatch1.id,
        url: "/uploads/seed-dispatch-loading.jpg",
        caption: "Loading bay — bales ready for dispatch",
      },
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        stage: "dispatch",
        entityType: "Dispatch",
        entityId: dispatch2.id,
        dispatchId: dispatch2.id,
        url: "/uploads/seed-dispatch-challan.jpg",
        caption: "Delivery challan — signed GRN copy",
      },
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        stage: "dispute",
        entityType: "Dispute",
        entityId: dispute1.id,
        disputeId: dispute1.id,
        url: "/uploads/seed-defect-closeup.jpg",
        caption: "Defective anarkali — stitching flaw close-up",
      },
    ],
  });

  // ── Notifications ──────────────────────────────────────────────────
  await db.notification.createMany({
    data: [
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        type: "visit_followup",
        title: "Follow up with Royal Wardrobe",
        message: "Client did not show for visit 2 days ago. Call to reschedule.",
        dueDate: new Date(now.getTime() - 1 * 86400000),
        entityType: "Visit",
        status: "pending",
      },
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        type: "dispatch_due",
        title: "Dispatch due — PO-2024-0002",
        message: "Mahalaxmi Apparels revised dispatch date approaching.",
        dueDate: new Date(now.getTime() + 4 * 86400000),
        entityType: "PurchaseOrder",
        status: "pending",
      },
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        type: "payment_due",
        title: "Payment due — BILL-2024-0002",
        message: "Meenakshi Saree Emporium balance payment approaching cycle end.",
        dueDate: new Date(now.getTime() + 10 * 86400000),
        entityType: "Bill",
        status: "pending",
      },
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        type: "brokerage_due",
        title: "Brokerage payout due — Sai Family Store",
        message: "Eligible brokerage pending 4-month cumulative payout.",
        dueDate: new Date(now.getTime() + 5 * 86400000),
        entityType: "Brokerage",
        status: "pending",
      },
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        type: "visit_followup",
        title: "Upcoming visit — Trendz Boutique",
        message: "Scheduled visit in 3 days for Ananya ethnic catalogue.",
        dueDate: new Date(now.getTime() + 3 * 86400000),
        entityType: "Visit",
        status: "pending",
      },
    ],
  });

  // ── System settings ───────────────────────────────────────────────
  await db.systemSetting.createMany({
    data: [
      { key: "default_gst_rate", value: "5", notes: "Default GST % applied to bills." },
      { key: "default_commission_rate", value: "5", notes: "Default broker commission %." },
      { key: "brokerage_on_gst", value: "false", notes: "Brokerage is computed on base amount, excluding GST." },
    ],
  });

  // ── Audit logs ────────────────────────────────────────────────────
  await db.auditLog.createMany({
    data: [
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        entityType: "Bill",
        entityId: bill1.id,
        action: "create",
        after: JSON.stringify({ status: "fully_paid", finalAmount: bill1.finalAmount }),
        userName: "Broker",
        createdAt: bill1.createdAt,
      },
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        entityType: "Payment",
        entityId: pay2.id,
        action: "create",
        after: JSON.stringify({ amount: pay2.amount, mode: pay2.mode }),
        userName: "Broker",
        createdAt: pay2.date,
        reason: "Final payment — triggered brokerage eligibility.",
      },
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        entityType: "Brokerage",
        entityId: brokerage1.id,
        action: "force_eligible",
        after: JSON.stringify({ eligible: true, eligibleAt: pay2.date }),
        userName: "System",
        createdAt: pay2.date,
        reason: "Auto-eligible: Bill status became fully_paid.",
      },
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        entityType: "BrokeragePayout",
        entityId: payout1.id,
        action: "create",
        after: JSON.stringify({ status: "paid", totalAmount: payout1.totalAmount }),
        userName: "Broker",
        createdAt: payout1.paidAt!,
      },
    ],
  });

  // ── Tags + EntityTag assignments ───────────────────────────────────
  // Default tag palette: VIP, Festive Season, Premium, Bulk Buyer,
  // Problem Account. Each gets a distinct colour so the broker can spot
  // tagged entities at a glance on the Clients/Suppliers/PO views.
  const [vipTag, festiveTag, premiumTag, bulkBuyerTag, problemTag] = await Promise.all([
    db.tag.create({ data: { brokerId: "00000000-0000-0000-0000-000000000001", name: "VIP", color: "emerald" } }),
    db.tag.create({ data: { brokerId: "00000000-0000-0000-0000-000000000001", name: "Festive Season", color: "amber" } }),
    db.tag.create({ data: { brokerId: "00000000-0000-0000-0000-000000000001", name: "Premium", color: "plum" } }),
    db.tag.create({ data: { brokerId: "00000000-0000-0000-0000-000000000001", name: "Bulk Buyer", color: "teal" } }),
    db.tag.create({ data: { brokerId: "00000000-0000-0000-0000-000000000001", name: "Problem Account", color: "rose" } }),
  ]);
  // Sharma Garments Hub → VIP + Bulk Buyer (loyal bulk buyer).
  // Meenakshi Saree Emporium → Bulk Buyer (bulk saree orders).
  // Trendz Boutique → Premium (premium boutique, higher GST slab).
  // Ananya Ethnic Wear (supplier) → Premium (premium ethnic supplier).
  // Shree Balaji Textiles (supplier) → VIP (reliable dispatch).
  // PO1 → Festive Season (festive catalogue booking).
  // PO2 → Problem Account (delayed dispatch + outstanding bill).
  await db.entityTag.createMany({
    data: [
      { tagId: vipTag.id,        entityType: "Client",          entityId: clients[0].id, clientId: clients[0].id },
      { tagId: bulkBuyerTag.id,  entityType: "Client",          entityId: clients[0].id, clientId: clients[0].id },
      { tagId: bulkBuyerTag.id,  entityType: "Client",          entityId: clients[1].id, clientId: clients[1].id },
      { tagId: premiumTag.id,    entityType: "Client",          entityId: clients[2].id, clientId: clients[2].id },
      { tagId: problemTag.id,    entityType: "Client",          entityId: clients[3].id, clientId: clients[3].id },
      { tagId: premiumTag.id,    entityType: "Supplier",        entityId: suppliers[3].id, supplierId: suppliers[3].id },
      { tagId: vipTag.id,        entityType: "Supplier",        entityId: suppliers[0].id, supplierId: suppliers[0].id },
      { tagId: festiveTag.id,    entityType: "PurchaseOrder",   entityId: po1.id, purchaseOrderId: po1.id },
      { tagId: problemTag.id,    entityType: "PurchaseOrder",   entityId: po2.id, purchaseOrderId: po2.id },
    ],
  });

  // ── Default report templates ──────────────────────────────────────
  // Three ready-to-use custom report templates that ship with the system.
  // The broker can clone + tweak these in the Report Builder view, or
  // create brand-new templates from scratch. Each template's `configJson`
  // matches the shape documented in `src/lib/report-columns.ts` and is
  // parsed defensively by `parseConfig` in the report-generation API.
  await db.reportTemplate.createMany({
    data: [
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        name: "Weekly Client Performance",
        description: "Top clients by total business this week — outstanding, brokerage earned, open bills.",
        type: "summary",
        configJson: JSON.stringify({
          entityType: "client",
          columns: ["name", "totalBusiness", "outstanding", "brokerageEarned", "openBills"],
          filters: { dateRange: "week" },
          groupBy: null,
          sortBy: { field: "totalBusiness", direction: "desc" },
          title: "Weekly Client Performance",
          includeCharts: true,
          includeSummary: true,
        }),
      },
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        name: "Monthly Brokerage Summary",
        description: "All brokerage entries this month, grouped by client — commission, base, brokerage, eligibility, payout status.",
        type: "ledger",
        configJson: JSON.stringify({
          entityType: "brokerage",
          columns: ["billNumber", "clientName", "supplierName", "commissionRate", "baseAmount", "brokerageAmount", "eligible", "payoutStatus"],
          filters: { dateRange: "month" },
          groupBy: "clientName",
          sortBy: { field: "brokerageAmount", direction: "desc" },
          title: "Monthly Brokerage Summary",
          includeCharts: true,
          includeSummary: true,
        }),
      },
      {
        brokerId: "00000000-0000-0000-0000-000000000001",
        name: "Supplier Comparison",
        description: "All suppliers side-by-side — total supplied, outstanding vs paid brokerage, fulfillment %, short-shipment rate.",
        type: "comparison",
        configJson: JSON.stringify({
          entityType: "supplier",
          columns: ["name", "totalSupplied", "outstandingBrokerage", "paidBrokerage", "fulfillment", "shortShipmentRate"],
          filters: { dateRange: "all" },
          groupBy: null,
          sortBy: { field: "totalSupplied", direction: "desc" },
          title: "Supplier Comparison",
          includeCharts: true,
          includeSummary: true,
        }),
      },
    ],
  });

  console.log("✅ Seed complete.");
  console.log(`   Suppliers: ${suppliers.length}, Clients: ${clients.length}`);
  const counts = {
    visits: await db.visit.count(),
    bookings: await db.booking.count(),
    pos: await db.purchaseOrder.count(),
    dispatches: await db.dispatch.count(),
    bills: await db.bill.count(),
    payments: await db.payment.count(),
    brokerages: await db.brokerage.count(),
    payouts: await db.brokeragePayout.count(),
    disputes: await db.dispute.count(),
    photos: await db.photo.count(),
    notifications: await db.notification.count(),
    tags: await db.tag.count(),
    entityTags: await db.entityTag.count(),
    reportTemplates: await db.reportTemplate.count(),
  };
  console.log("   ", JSON.stringify(counts, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
