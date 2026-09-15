-- ═══════════════════════════════════════════════════════════════════════════
-- Broker OS — Verify All Tables (check what exists)
-- Run this to see the full database schema
-- ═══════════════════════════════════════════════════════════════════════════

-- List all tables
SELECT 
    t.tablename AS "table_name",
    pg_size_pretty(pg_total_relation_size('"' || t.schemaname || '"."' || t.tablename || '"')) AS "size"
FROM pg_tables t
WHERE t.schemaname = 'public'
ORDER BY t.tablename;

-- Count rows per table
SELECT 'Broker' as "table", count(*) as "rows" FROM "Broker"
UNION ALL SELECT 'Client', count(*) FROM "Client"
UNION ALL SELECT 'Supplier', count(*) FROM "Supplier"
UNION ALL SELECT 'Visit', count(*) FROM "Visit"
UNION ALL SELECT 'Booking', count(*) FROM "Booking"
UNION ALL SELECT 'PurchaseOrder', count(*) FROM "PurchaseOrder"
UNION ALL SELECT 'Dispatch', count(*) FROM "Dispatch"
UNION ALL SELECT 'Bill', count(*) FROM "Bill"
UNION ALL SELECT 'Payment', count(*) FROM "Payment"
UNION ALL SELECT 'Brokerage', count(*) FROM "Brokerage"
UNION ALL SELECT 'BrokeragePayout', count(*) FROM "BrokeragePayout"
UNION ALL SELECT 'Dispute', count(*) FROM "Dispute"
UNION ALL SELECT 'Photo', count(*) FROM "Photo"
UNION ALL SELECT 'Notification', count(*) FROM "Notification"
UNION ALL SELECT 'AuditLog', count(*) FROM "AuditLog"
UNION ALL SELECT 'SystemSetting', count(*) FROM "SystemSetting"
UNION ALL SELECT 'Tag', count(*) FROM "Tag"
UNION ALL SELECT 'EntityTag', count(*) FROM "EntityTag"
UNION ALL SELECT 'SavedView', count(*) FROM "SavedView"
UNION ALL SELECT 'ReportTemplate', count(*) FROM "ReportTemplate"
UNION ALL SELECT 'Plan', count(*) FROM "Plan"
UNION ALL SELECT 'Subscription', count(*) FROM "Subscription"
UNION ALL SELECT 'AdminAuditLog', count(*) FROM "AdminAuditLog"
UNION ALL SELECT 'Expense', count(*) FROM "Expense"
UNION ALL SELECT 'Invoice', count(*) FROM "Invoice"
ORDER BY "table";
