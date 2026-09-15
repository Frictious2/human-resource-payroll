SET @has_generation := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'payroll_workflow_batches'
      AND COLUMN_NAME = 'GenerationNo'
);
SET @sql := IF(@has_generation = 0,
    'ALTER TABLE payroll_workflow_batches
        ADD COLUMN GenerationNo INT NOT NULL DEFAULT 1 AFTER PType,
        ADD COLUMN OriginalWorkflowBatchID BIGINT UNSIGNED NULL AFTER GenerationNo,
        ADD COLUMN ReopenRequestID BIGINT UNSIGNED NULL AFTER OriginalWorkflowBatchID',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE payroll_workflow_batches
SET GenerationNo = 1
WHERE GenerationNo IS NULL OR GenerationNo = 0;

SET @has_old_unique := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'payroll_workflow_batches'
      AND INDEX_NAME = 'uq_company_period_ptype'
);
SET @sql := IF(@has_old_unique > 0,
    'ALTER TABLE payroll_workflow_batches DROP INDEX uq_company_period_ptype',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_generation_unique := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'payroll_workflow_batches'
      AND INDEX_NAME = 'uq_company_period_ptype_generation'
);
SET @sql := IF(@has_generation_unique = 0,
    'ALTER TABLE payroll_workflow_batches
        ADD UNIQUE KEY uq_company_period_ptype_generation (CompanyID, PMonth, PYear, PType, GenerationNo),
        ADD KEY idx_payroll_workflow_original_batch (OriginalWorkflowBatchID),
        ADD KEY idx_payroll_workflow_reopen_request (ReopenRequestID)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_gl_generation := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'payroll_gl_posting_batches'
      AND COLUMN_NAME = 'generation_no'
);
SET @sql := IF(@has_gl_generation = 0,
    'ALTER TABLE payroll_gl_posting_batches
        ADD COLUMN generation_no INT NOT NULL DEFAULT 1 AFTER posting_year,
        ADD COLUMN workflow_batch_id BIGINT UNSIGNED NULL AFTER generation_no',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE payroll_gl_posting_batches
SET generation_no = 1
WHERE generation_no IS NULL OR generation_no = 0;

SET @has_gl_old_unique := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'payroll_gl_posting_batches'
      AND INDEX_NAME = 'uq_company_activity_period'
);
SET @sql := IF(@has_gl_old_unique > 0,
    'ALTER TABLE payroll_gl_posting_batches DROP INDEX uq_company_activity_period',
    'SELECT 1');
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
SET @sql := IF(@has_gl_generation_unique = 0,
    'ALTER TABLE payroll_gl_posting_batches
        ADD UNIQUE KEY uq_company_activity_period_generation (company_id, activity_code, posting_month, posting_year, generation_no),
        ADD KEY idx_payroll_gl_workflow_batch (workflow_batch_id)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TRIGGER IF EXISTS trg_payroll_gl_posting_batches_before_insert_generation;
DELIMITER $$
CREATE TRIGGER trg_payroll_gl_posting_batches_before_insert_generation
BEFORE INSERT ON payroll_gl_posting_batches
FOR EACH ROW
BEGIN
    IF NEW.generation_no IS NULL OR NEW.generation_no = 0 THEN
        SELECT GenerationNo, id
          INTO @wf_generation_no, @wf_batch_id
          FROM payroll_workflow_batches
         WHERE CompanyID = NEW.company_id
           AND PMonth = NEW.posting_month
           AND PYear = NEW.posting_year
           AND PType = NEW.activity_code
         ORDER BY GenerationNo DESC, id DESC
         LIMIT 1;

        SET NEW.generation_no = COALESCE(@wf_generation_no, 1);
        SET NEW.workflow_batch_id = COALESCE(NEW.workflow_batch_id, @wf_batch_id);
    END IF;
END$$
DELIMITER ;

CREATE TABLE IF NOT EXISTS payroll_reopen_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    OriginalWorkflowBatchID BIGINT UNSIGNED NOT NULL,
    ReversalRequestID BIGINT UNSIGNED NOT NULL,
    CompanyID INT NOT NULL,
    PMonth TINYINT NOT NULL,
    PYear SMALLINT NOT NULL,
    PType VARCHAR(10) NOT NULL,
    OriginalGenerationNo INT NOT NULL,
    ProposedGenerationNo INT NOT NULL,
    Status VARCHAR(50) NOT NULL,
    Reason TEXT NOT NULL,
    RequestedBy VARCHAR(50) NOT NULL,
    RequestedAt DATETIME NOT NULL,
    ManagerEndorsedBy VARCHAR(50) NULL,
    ManagerEndorsedAt DATETIME NULL,
    ManagerComments TEXT NULL,
    AuditorEndorsedBy VARCHAR(50) NULL,
    AuditorEndorsedAt DATETIME NULL,
    AuditorComments TEXT NULL,
    FinalApprovedBy VARCHAR(50) NULL,
    FinalApprovedAt DATETIME NULL,
    EntityHeadComments TEXT NULL,
    ReopenedBy VARCHAR(50) NULL,
    ReopenedAt DATETIME NULL,
    NewWorkflowBatchID BIGINT UNSIGNED NULL,
    OriginalPayrollChecksum VARCHAR(128) NOT NULL,
    OriginalReversalReference VARCHAR(100) NULL,
    CreatedAt DATETIME NOT NULL,
    UpdatedAt DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_payroll_reopen_generation (OriginalWorkflowBatchID, ProposedGenerationNo),
    KEY idx_payroll_reopen_company_status (CompanyID, Status),
    KEY idx_payroll_reopen_reversal_request (ReversalRequestID),
    KEY idx_payroll_reopen_new_batch (NewWorkflowBatchID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payroll_reopen_actions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ReopenRequestID BIGINT UNSIGNED NOT NULL,
    Action VARCHAR(50) NOT NULL,
    FromStatus VARCHAR(50) NULL,
    ToStatus VARCHAR(50) NOT NULL,
    ActionBy VARCHAR(50) NOT NULL,
    ActionAt DATETIME NOT NULL,
    Comments TEXT NULL,
    Metadata LONGTEXT NULL,
    Result VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    PRIMARY KEY (id),
    KEY idx_payroll_reopen_actions_request (ReopenRequestID, ActionAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payroll_reversed_row_archive (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    OriginalWorkflowBatchID BIGINT UNSIGNED NOT NULL,
    OriginalGenerationNo INT NOT NULL,
    ReversalRequestID BIGINT UNSIGNED NULL,
    ReopenRequestID BIGINT UNSIGNED NULL,
    CompanyID INT NOT NULL,
    PMonth TINYINT NOT NULL,
    PYear SMALLINT NOT NULL,
    PType VARCHAR(10) NOT NULL,
    PFNo VARCHAR(50) NULL,
    ArchivedAt DATETIME NOT NULL,
    ArchivedBy VARCHAR(50) NOT NULL,
    RowChecksum VARCHAR(128) NULL,
    PayrollRowData LONGTEXT NOT NULL,
    PRIMARY KEY (id),
    KEY idx_payroll_reversed_archive_batch (OriginalWorkflowBatchID),
    KEY idx_payroll_reversed_archive_period (CompanyID, PMonth, PYear, PType),
    KEY idx_payroll_reversed_archive_reopen (ReopenRequestID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
