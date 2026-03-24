CREATE TABLE IF NOT EXISTS payroll_gl_posting_batches (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id BIGINT UNSIGNED NOT NULL,
    activity_code VARCHAR(10) NOT NULL,
    posting_date DATE NOT NULL,
    posting_month TINYINT NOT NULL,
    posting_year SMALLINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'posted',
    total_lines INT NOT NULL DEFAULT 0,
    total_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    source_record_count INT NOT NULL DEFAULT 0,
    posted_by BIGINT UNSIGNED NOT NULL,
    posted_at DATETIME NOT NULL,
    remarks TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_payroll_gl_batch (company_id, activity_code, posting_month, posting_year)
);

CREATE TABLE IF NOT EXISTS payroll_gl_posting_lines (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id BIGINT UNSIGNED NOT NULL,
    company_id BIGINT UNSIGNED NOT NULL,
    activity_code VARCHAR(10) NOT NULL,
    employee_id BIGINT UNSIGNED NULL,
    gl_account_code VARCHAR(50) NOT NULL,
    gl_account_name VARCHAR(255) NOT NULL,
    entry_type ENUM('debit', 'credit') NOT NULL,
    amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    narration VARCHAR(255) NULL,
    source_table VARCHAR(100) NULL,
    source_record_id BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_pgpl_batch_id (batch_id),
    KEY idx_pgpl_company_activity (company_id, activity_code)
);

CREATE TABLE IF NOT EXISTS gl_account_mappings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id BIGINT UNSIGNED NOT NULL,
    activity_code VARCHAR(10) NOT NULL,
    pay_component_code VARCHAR(50) NOT NULL,
    gl_account_code VARCHAR(50) NOT NULL,
    gl_account_name VARCHAR(255) NOT NULL,
    entry_type ENUM('debit', 'credit') NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_gl_mapping (company_id, activity_code, pay_component_code, entry_type)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    action VARCHAR(50) NOT NULL,
    activity_code VARCHAR(10) NOT NULL,
    posting_month TINYINT NOT NULL,
    posting_year SMALLINT NOT NULL,
    result VARCHAR(20) NOT NULL,
    reference_id BIGINT UNSIGNED NULL,
    details TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_audit_logs_company_action (company_id, action),
    KEY idx_audit_logs_posting_period (posting_year, posting_month)
);

ALTER TABLE tblpayroll
    ADD COLUMN IF NOT EXISTS posted_to_gl TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS gl_posted_batch_id BIGINT UNSIGNED NULL,
    ADD COLUMN IF NOT EXISTS gl_posted_at DATETIME NULL;
