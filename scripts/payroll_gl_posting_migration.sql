CREATE TABLE IF NOT EXISTS payroll_gl_posting_batches (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    activity_code VARCHAR(2) NOT NULL,
    posting_date DATE NOT NULL,
    posting_month SMALLINT NOT NULL,
    posting_year SMALLINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'posted',
    total_lines INT NOT NULL DEFAULT 0,
    total_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    posted_by VARCHAR(100) NOT NULL,
    posted_at DATETIME NOT NULL,
    remarks VARCHAR(255) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_payroll_gl_posting_batches_company_activity_period (company_id, activity_code, posting_month, posting_year)
);

CREATE TABLE IF NOT EXISTS payroll_gl_posting_lines (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id BIGINT NOT NULL,
    company_id INT NOT NULL,
    activity_code VARCHAR(2) NOT NULL,
    employee_id VARCHAR(20) DEFAULT NULL,
    gl_account_code VARCHAR(50) NOT NULL,
    gl_account_name VARCHAR(255) NOT NULL,
    debit_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    credit_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    narration VARCHAR(255) DEFAULT NULL,
    source_table VARCHAR(100) DEFAULT NULL,
    source_record_id VARCHAR(100) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_payroll_gl_posting_lines_batch (batch_id),
    CONSTRAINT fk_payroll_gl_posting_lines_batch FOREIGN KEY (batch_id) REFERENCES payroll_gl_posting_batches(id)
);

CREATE TABLE IF NOT EXISTS gl_account_mappings (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    activity_code VARCHAR(2) NOT NULL,
    pay_component_code VARCHAR(50) NOT NULL,
    gl_account_code VARCHAR(50) NOT NULL,
    gl_account_name VARCHAR(255) NOT NULL,
    entry_type ENUM('debit', 'credit') NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_gl_account_mappings_company_activity_component (company_id, activity_code, pay_component_code)
);

ALTER TABLE tblpayroll
    ADD COLUMN IF NOT EXISTS GlPostedBatchId BIGINT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS GlPostedAt DATETIME DEFAULT NULL;

INSERT IGNORE INTO gl_account_mappings
    (company_id, activity_code, pay_component_code, gl_account_code, gl_account_name, entry_type)
VALUES
    (1, '01', 'SALARY', '01', 'Basic Salary', 'debit'),
    (1, '01', 'TRANSPORT', '06', 'Transport Allowance', 'debit'),
    (1, '01', 'STAFF_WELFARE', '05', 'Staff Welfare', 'debit'),
    (1, '01', 'COLA', '07', 'Cost of Living Allowance', 'debit'),
    (1, '01', 'RESPONSIBILITY', '03', 'Responsibility Allowance', 'debit'),
    (1, '01', 'MAID', '04', 'Maid Allowance', 'debit'),
    (1, '01', 'ACTING', '09', 'Acting Allowance', 'debit'),
    (1, '01', 'PROFESSIONAL', '10', 'Professional Allowance', 'debit'),
    (1, '01', 'RISK', '08', 'Risk Allowance', 'debit'),
    (1, '01', 'ACADEMIC', '11', 'Academic Allowance', 'debit'),
    (1, '01', 'INCOME_TAX', '12', 'Income Tax', 'credit'),
    (1, '01', 'NASSIT_EMP', '13', 'NASSIT Employee', 'credit'),
    (1, '01', 'PROVIDENT_EMP', '14', 'Provident Employee', 'credit'),
    (1, '01', 'SALARY_ADVANCE', '18', 'Salary Advance', 'credit'),
    (1, '01', 'DED2_SSA', '16', 'SSA', 'credit'),
    (1, '01', 'DED2_JSA', '17', 'JSA', 'credit'),
    (1, '01', 'INTEREST_ON_ADVANCE', '19', 'Interest on Advance', 'credit'),
    (1, '01', 'RENT_DEDUCTION', '15', 'Rent Deduction', 'credit'),
    (1, '01', 'SALARY_CONTROL', '20', 'Salary and Wages Control', 'credit');
