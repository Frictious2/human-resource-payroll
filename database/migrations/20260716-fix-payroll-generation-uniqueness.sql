-- Phase 15B corrective migration
-- Purpose:
-- 1. Remove legacy period-only unique keys that block payroll generations.
-- 2. Verify generation-aware unique keys exist.
-- 3. Fail safely if duplicate data already exists under the intended generation-aware keys.
--
-- Deployment notes:
-- - Back up the target database before running in production.
-- - Run the duplicate-data preflight queries below first and stop if any rows are returned.
-- - This corrective migration must be applied after 20260715-payroll-reopen-workflow.sql.

-- Preflight diagnostics (run and review before production migration):
-- SELECT CompanyID, PMonth, PYear, PType, GenerationNo, COUNT(*) AS row_count
-- FROM payroll_workflow_batches
-- GROUP BY CompanyID, PMonth, PYear, PType, GenerationNo
-- HAVING COUNT(*) > 1;
--
-- SELECT company_id, activity_code, posting_month, posting_year, generation_no, COUNT(*) AS row_count
-- FROM payroll_gl_posting_batches
-- GROUP BY company_id, activity_code, posting_month, posting_year, generation_no
-- HAVING COUNT(*) > 1;

SET @workflow_generation_duplicates := (
    SELECT COUNT(*)
    FROM (
        SELECT 1
        FROM payroll_workflow_batches
        GROUP BY CompanyID, PMonth, PYear, PType, GenerationNo
        HAVING COUNT(*) > 1
    ) workflow_dups
);

SET @gl_generation_duplicates := (
    SELECT COUNT(*)
    FROM (
        SELECT 1
        FROM payroll_gl_posting_batches
        GROUP BY company_id, activity_code, posting_month, posting_year, generation_no
        HAVING COUNT(*) > 1
    ) gl_dups
);

SET @should_abort := IF(@workflow_generation_duplicates > 0 OR @gl_generation_duplicates > 0, 1, 0);
SET @sql := IF(
    @should_abort = 1,
    'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Duplicate generation-aware payroll rows detected. Resolve duplicates before applying 20260716-fix-payroll-generation-uniqueness.sql.''',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_workflow_old_unique := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'payroll_workflow_batches'
      AND INDEX_NAME = 'uq_payroll_workflow_batch'
);
SET @sql := IF(
    @has_workflow_old_unique > 0,
    'ALTER TABLE payroll_workflow_batches DROP INDEX uq_payroll_workflow_batch',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_workflow_generation_unique := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'payroll_workflow_batches'
      AND INDEX_NAME = 'uq_company_period_ptype_generation'
);
SET @sql := IF(
    @has_workflow_generation_unique = 0,
    'ALTER TABLE payroll_workflow_batches ADD UNIQUE KEY uq_company_period_ptype_generation (CompanyID, PMonth, PYear, PType, GenerationNo)',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_gl_old_unique := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'payroll_gl_posting_batches'
      AND INDEX_NAME = 'uq_payroll_gl_posting_batches_company_activity_period'
);
SET @sql := IF(
    @has_gl_old_unique > 0,
    'ALTER TABLE payroll_gl_posting_batches DROP INDEX uq_payroll_gl_posting_batches_company_activity_period',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_gl_generation_unique := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'payroll_gl_posting_batches'
      AND INDEX_NAME = 'uq_company_activity_period_generation'
);
SET @sql := IF(
    @has_gl_generation_unique = 0,
    'ALTER TABLE payroll_gl_posting_batches ADD UNIQUE KEY uq_company_activity_period_generation (company_id, activity_code, posting_month, posting_year, generation_no)',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
