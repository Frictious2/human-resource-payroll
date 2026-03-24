INSERT INTO gl_account_mappings
    (company_id, activity_code, pay_component_code, gl_account_code, gl_account_name, entry_type, is_active, created_at, updated_at)
VALUES
    (1, '01', 'BASIC_SALARY', '90102', 'Basic Salary Expense', 'debit', 1, NOW(), NOW()),
    (1, '01', 'ALLOWANCES', '90115', 'Allowance Expense', 'debit', 1, NOW(), NOW()),
    (1, '01', 'PAYE', '50109', 'PAYE Payable', 'credit', 1, NOW(), NOW()),
    (1, '01', 'NASSIT_EMPLOYEE', '90106', 'NASSIT Employee Payable', 'credit', 1, NOW(), NOW()),
    (1, '01', 'LOAN_DEDUCTION', '20104', 'Loan Deductions Payable', 'credit', 1, NOW(), NOW()),
    (1, '01', 'NET_PAY', '90103', 'Net Salaries Payable', 'credit', 1, NOW(), NOW())
ON DUPLICATE KEY UPDATE
    gl_account_code = VALUES(gl_account_code),
    gl_account_name = VALUES(gl_account_name),
    is_active = VALUES(is_active),
    updated_at = NOW();
