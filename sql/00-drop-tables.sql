-- ═══════════════════════════════════════════════════════════════════════════
-- Broker OS — Drop Tables (ROLLBACK / CLEANUP)
-- Run this if you need to re-create the tables from scratch.
-- WARNING: This deletes ALL expense and invoice data!
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS "Expense";
DROP TABLE IF EXISTS "Invoice";

-- After dropping, re-run 01-create-expense-invoice-tables.sql
