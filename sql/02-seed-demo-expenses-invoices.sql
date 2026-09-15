-- ═══════════════════════════════════════════════════════════════════════════
-- Broker OS — Seed Demo Expenses (optional)
-- Run AFTER 01-create-expense-invoice-tables.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- Insert 6 sample expenses for the demo broker
-- (Replace the broker ID if yours is different)

INSERT INTO "Expense" ("id", "brokerId", "category", "amount", "date", "description", "vendor", "createdAt", "updatedAt")
VALUES
-- Travel expenses
('exp_001', '00000000-0000-0000-0000-000000000001', 'travel', 2500, '2026-08-05', 'Surat to Mumbai market visit', 'HP Petrol Pump', NOW(), NOW()),
('exp_002', '00000000-0000-0000-0000-000000000001', 'travel', 1800, '2026-08-12', 'Surat to Bhiwandi supplier visit', 'Ola Cab', NOW(), NOW()),

-- Phone
('exp_003', '00000000-0000-0000-0000-000000000001', 'phone', 999, '2026-08-01', 'Monthly phone bill', 'Airtel', NOW(), NOW()),

-- Office rent
('exp_004', '00000000-0000-0000-0000-000000000001', 'office_rent', 15000, '2026-08-01', 'Office rent — August 2026', 'Surat Textile Market Assoc', NOW(), NOW()),

-- Marketing
('exp_005', '00000000-0000-0000-0000-000000000001', 'marketing', 2000, '2026-08-10', 'WhatsApp business promotion', 'Meta Ads', NOW(), NOW()),

-- Misc
('exp_006', '00000000-0000-0000-0000-000000000001', 'miscellaneous', 500, '2026-08-15', 'Stationery + printing', 'Sharma Stationery', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Insert 2 sample invoices for the demo broker
-- ═══════════════════════════════════════════════════════════════════════════

-- First, get a client ID (Sharma Garments)
-- Replace the clientId with your actual client ID from: SELECT id, name FROM "Client" LIMIT 5;

INSERT INTO "Invoice" ("id", "brokerId", "clientId", "invoiceNumber", "issueDate", "dueDate", "itemsJson", "subtotal", "gstRate", "gstAmount", "roundOff", "totalAmount", "status", "placeOfSupply", "createdAt", "updatedAt")
SELECT
    'inv_001',
    '00000000-0000-0000-0000-000000000001',
    c."id",
    'INV-2026-0001',
    '2026-08-15'::timestamp,
    '2026-08-29'::timestamp,
    '[{"description":"Brokerage service for PO-2024-0001","hsnCode":"9985","quantity":1,"rate":2915,"amount":2915}]',
    2915.0,
    5.0,
    145.75,
    -0.75,
    4060.0,
    'pending',
    'Gujarat (24)',
    NOW(),
    NOW()
FROM "Client" c
WHERE c."name" = 'Sharma Garments Hub'
ON CONFLICT ("id") DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE! Verify with:
-- SELECT * FROM "Expense" ORDER BY "date" DESC;
-- SELECT * FROM "Invoice";
-- ═══════════════════════════════════════════════════════════════════════════
