-- ═══════════════════════════════════════════════════════════════════════════
-- Broker OS — SQL Migrations for Supabase
-- Run these in Supabase SQL Editor (Dashboard → SQL → New Query)
-- ═══════════════════════════════════════════════════════════════════════════

-- This file creates the Expense + Invoice tables.
-- Safe to run multiple times (uses IF NOT EXISTS / CREATE TABLE IF NOT EXISTS).

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1: Expense Table
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Expense" (
    "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "brokerId"    TEXT NOT NULL REFERENCES "Broker"("id") ON DELETE CASCADE,
    "category"    TEXT NOT NULL,
    "amount"      DOUBLE PRECISION NOT NULL,
    "date"        TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "vendor"      TEXT,
    "receiptUrl"  TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "Expense_brokerId_date_idx" ON "Expense"("brokerId", "date");
CREATE INDEX IF NOT EXISTS "Expense_brokerId_category_idx" ON "Expense"("brokerId", "category");

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 4: Invoice Table
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Invoice" (
    "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "brokerId"      TEXT NOT NULL REFERENCES "Broker"("id") ON DELETE CASCADE,
    "clientId"      TEXT NOT NULL REFERENCES "Client"("id") ON DELETE CASCADE,
    "invoiceNumber" TEXT UNIQUE NOT NULL,
    "issueDate"     TIMESTAMP(3) NOT NULL,
    "dueDate"       TIMESTAMP(3),
    "itemsJson"     TEXT NOT NULL,
    "subtotal"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstRate"       DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "gstAmount"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "roundOff"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status"        TEXT NOT NULL DEFAULT 'pending',
    "notes"         TEXT,
    "placeOfSupply" TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS "Invoice_brokerId_issueDate_idx" ON "Invoice"("brokerId", "issueDate");
CREATE INDEX IF NOT EXISTS "Invoice_clientId_idx" ON "Invoice"("clientId");

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE! Verify with:
-- SELECT count(*) FROM "Expense";  → should be 0
-- SELECT count(*) FROM "Invoice";  → should be 0
-- ═══════════════════════════════════════════════════════════════════════════
