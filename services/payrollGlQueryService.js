const pool = require('../config/db');

const DEFAULT_ACTIVITY_CODES = ['01', '02', '05', '08', '09', '13', '15'];

function formatSqlDate(date) {
    return date.toISOString().slice(0, 10);
}

async function withTransaction(work) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function ensureInfrastructure(connection) {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS payroll_gl_posting_batches (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
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
            remarks VARCHAR(255) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_payroll_gl_batch (company_id, activity_code, posting_month, posting_year)
        )
    `);

    await connection.query(`
        CREATE TABLE IF NOT EXISTS payroll_gl_posting_lines (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            batch_id BIGINT UNSIGNED NOT NULL,
            company_id INT NOT NULL,
            activity_code VARCHAR(2) NOT NULL,
            employee_id VARCHAR(20) NULL,
            gl_account_code VARCHAR(50) NOT NULL,
            gl_account_name VARCHAR(255) NOT NULL,
            debit_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
            credit_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
            narration VARCHAR(255) NULL,
            source_table VARCHAR(100) NULL,
            source_record_id VARCHAR(100) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_pgpl_batch_id (batch_id),
            KEY idx_pgpl_company_activity (company_id, activity_code)
        )
    `);

    await connection.query(`
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
        )
    `);

    await connection.query(`
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
        )
    `);

    const [postedFlagRows] = await connection.query(`
        SELECT COUNT(*) AS count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'tblpayroll'
          AND column_name = 'posted_to_gl'
    `);

    if (postedFlagRows[0].count === 0) {
        await connection.query(`
            ALTER TABLE tblpayroll
            ADD COLUMN posted_to_gl TINYINT(1) NOT NULL DEFAULT 0,
            ADD COLUMN gl_posted_batch_id BIGINT UNSIGNED NULL,
            ADD COLUMN gl_posted_at DATETIME NULL
        `);
    }

}

async function getSupportedActivities(companyId) {
    const [rows] = await pool.query(
        `SELECT Code, PayType
         FROM tblpaytype
         WHERE CompanyID = ? AND Code IN (?)
         ORDER BY FIELD(Code, '01', '02', '05', '08', '09', '13', '15')`,
        [companyId, DEFAULT_ACTIVITY_CODES]
    );

    return rows;
}

async function findExistingBatch(connection, { companyId, activityCode, postingMonth, postingYear }) {
    const [rows] = await connection.query(
        `SELECT id, status
         FROM payroll_gl_posting_batches
         WHERE company_id = ?
           AND activity_code = ?
           AND posting_month = ?
           AND posting_year = ?
         LIMIT 1`,
        [companyId, activityCode, postingMonth, postingYear]
    );

    return rows[0] || null;
}

async function getGlMappings(connection, { companyId, activityCode }) {
    const [rows] = await connection.query(
        `SELECT pay_component_code, gl_account_code, gl_account_name, entry_type
         FROM gl_account_mappings
         WHERE company_id = ?
           AND activity_code = ?
           AND is_active = 1`,
        [companyId, activityCode]
    );

    return rows;
}

async function getApprovedMonthlyPayrollRows(connection, { companyId, activityCode, postingMonth, postingYear }) {
    const [rows] = await connection.query(
        `SELECT
            CAST(p.PFNo AS UNSIGNED) AS employee_id,
            p.PFNo,
            p.CompanyID AS company_id,
            p.PMonth AS payroll_month,
            p.PYear AS payroll_year,
            p.Approved AS approved,
            p.Level,
            p.Dept,
            COALESCE(p.Salary, 0) AS basic_salary,
            COALESCE(p.Allw03, 0) AS allw03,
            COALESCE(p.Allw04, 0) AS allw04,
            COALESCE(p.Allw05, 0) AS allw05,
            COALESCE(p.Allw06, 0) AS allw06,
            COALESCE(p.Allw07, 0) AS allw07,
            COALESCE(p.Allw10, 0) AS allw10,
            COALESCE(p.Allw11, 0) AS allw11,
            COALESCE(p.Allw12, 0) AS allw12,
            COALESCE(p.Allw14, 0) AS allw14,
            COALESCE(p.Allw16, 0) AS allw16,
            COALESCE(p.Allw17, 0) AS allw17,
            COALESCE(p.Allw19, 0) AS allw19,
            COALESCE(p.Allw20, 0) AS allw20,
            COALESCE(p.Allw03, 0) + COALESCE(p.Allw04, 0) + COALESCE(p.Allw05, 0) + COALESCE(p.Allw06, 0) +
            COALESCE(p.Allw07, 0) +
            COALESCE(p.Allw10, 0) + COALESCE(p.Allw11, 0) + COALESCE(p.Allw12, 0) + COALESCE(p.Allw14, 0) +
            COALESCE(p.Allw16, 0) + COALESCE(p.Allw17, 0) + COALESCE(p.Allw19, 0) AS allowances_total,
            COALESCE(p.TotalIncome, 0) AS gross_pay,
            COALESCE(p.Tax, 0) + COALESCE(p.NassitEmp, 0) + COALESCE(p.GratEmp, 0) +
            COALESCE(p.Ded1, 0) + COALESCE(p.Ded2, 0) + COALESCE(p.Ded3, 0) +
            COALESCE(p.Ded4, 0) + COALESCE(p.Ded5, 0) + COALESCE(p.UnionDues, 0) AS deductions_total,
            COALESCE(p.NetIncome, 0) AS net_pay,
            COALESCE(p.Tax, 0) AS paye,
            COALESCE(p.NassitEmp, 0) AS nassit_employee,
            COALESCE(p.GratEmp, 0) AS gratuity_employee,
            COALESCE(p.UnionDues, 0) AS union_dues,
            COALESCE(p.Ded1, 0) AS ded1,
            COALESCE(p.Ded2, 0) AS ded2,
            COALESCE(p.Ded3, 0) AS ded3,
            COALESCE(p.Ded4, 0) AS ded4,
            COALESCE(p.Ded5, 0) AS ded5,
            COALESCE(p.Ded1, 0) + COALESCE(p.Ded3, 0) + COALESCE(p.Ded4, 0) + COALESCE(p.Ded5, 0) AS loan_deduction,
            COALESCE(p.posted_to_gl, 0) AS posted_to_gl,
            'tblpayroll' AS source_table
        FROM tblpayroll p
        WHERE p.CompanyID = ?
          AND p.PType = ?
          AND p.PMonth = ?
          AND p.PYear = ?
          AND p.Approved IN (-1, 1)
          AND COALESCE(p.posted_to_gl, 0) = 0`,
        [companyId, activityCode, postingMonth, postingYear]
    );

    return rows;
}

async function insertPostingBatch(connection, payload) {
    const [result] = await connection.query(
        `INSERT INTO payroll_gl_posting_batches
        (company_id, activity_code, posting_date, posting_month, posting_year, status, total_lines, total_amount, posted_by, posted_at, remarks, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), NOW())`,
        [
            payload.companyId,
            payload.activityCode,
            formatSqlDate(payload.postingDate),
            payload.postingMonth,
            payload.postingYear,
            payload.status,
            payload.totalLines,
            payload.totalAmount,
            payload.postedBy,
            payload.remarks
        ]
    );

    return result.insertId;
}

async function insertPostingLines(connection, lines) {
    if (lines.length === 0) {
        return;
    }

    const values = lines.map((line) => [
        line.batchId,
        line.companyId,
        line.activityCode,
        line.employeeId || null,
        line.glAccountCode,
        line.glAccountName,
        line.entryType === 'debit' ? line.amount : 0,
        line.entryType === 'credit' ? line.amount : 0,
        line.narration || null,
        line.sourceTable || null,
        line.sourceRecordId || null
    ]);

    await connection.query(
        `INSERT INTO payroll_gl_posting_lines
        (batch_id, company_id, activity_code, employee_id, gl_account_code, gl_account_name, debit_amount, credit_amount, narration, source_table, source_record_id, created_at)
        VALUES ?`,
        [values.map((row) => [...row, new Date()])]
    );
}

async function markPayrollRowsPosted(connection, { batchId, companyId, activityCode, postingMonth, postingYear }) {
    await connection.query(
        `UPDATE tblpayroll
         SET posted_to_gl = 1,
             gl_posted_batch_id = ?,
             gl_posted_at = NOW()
         WHERE CompanyID = ?
           AND PType = ?
           AND PMonth = ?
           AND PYear = ?
           AND Approved IN (-1, 1)`,
        [batchId, companyId, activityCode, postingMonth, postingYear]
    );
}

async function insertAuditLog(connection, payload) {
    await connection.query(
        `INSERT INTO audit_logs
        (company_id, user_id, action, activity_code, posting_month, posting_year, result, reference_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
            payload.companyId,
            payload.userId,
            payload.action,
            payload.activityCode,
            payload.postingMonth,
            payload.postingYear,
            payload.result,
            payload.referenceId || null,
            payload.details || null
        ]
    );
}

async function getPostingHistory({ companyId, activityCode, month, year, status, page, pageSize }) {
    const filters = ['company_id = ?'];
    const params = [companyId];

    if (activityCode) {
        filters.push('activity_code = ?');
        params.push(activityCode);
    }
    if (month) {
        filters.push('posting_month = ?');
        params.push(month);
    }
    if (year) {
        filters.push('posting_year = ?');
        params.push(year);
    }
    if (status) {
        filters.push('status = ?');
        params.push(status);
    }

    const whereClause = filters.join(' AND ');
    const offset = (page - 1) * pageSize;

    const [countRows] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM payroll_gl_posting_batches
         WHERE ${whereClause}`,
        params
    );

    const [rows] = await pool.query(
        `SELECT
            id,
            activity_code,
            posting_date,
            posting_month,
            posting_year,
            total_lines,
            total_amount,
            status,
            posted_by,
            posted_at,
            NULL AS source_record_count
         FROM payroll_gl_posting_batches
         WHERE ${whereClause}
         ORDER BY posted_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
    );

    return {
        rows,
        pagination: {
            page,
            pageSize,
            total: countRows[0].total
        }
    };
}

async function getPostingBatchDetail({ companyId, batchId }) {
    const [batchRows] = await pool.query(
        `SELECT
            id,
            company_id,
            activity_code,
            posting_date,
            posting_month,
            posting_year,
            status,
            total_lines,
            total_amount,
            NULL AS source_record_count,
            posted_by,
            posted_at,
            remarks
         FROM payroll_gl_posting_batches
         WHERE company_id = ? AND id = ?
         LIMIT 1`,
        [companyId, batchId]
    );

    const batch = batchRows[0] || null;
    if (!batch) {
        return null;
    }

    const [lines] = await pool.query(
        `SELECT
            id,
            batch_id,
            company_id,
            activity_code,
            employee_id,
            gl_account_code,
            gl_account_name,
            CASE
                WHEN COALESCE(debit_amount, 0) > 0 THEN 'debit'
                ELSE 'credit'
            END AS entry_type,
            CASE
                WHEN COALESCE(debit_amount, 0) > 0 THEN debit_amount
                ELSE credit_amount
            END AS amount,
            narration,
            source_table,
            source_record_id,
            created_at
         FROM payroll_gl_posting_lines
         WHERE batch_id = ?
         ORDER BY gl_account_code, id`,
        [batchId]
    );

    return {
        batch,
        lines
    };
}

module.exports = {
    ensureInfrastructure,
    findExistingBatch,
    formatSqlDate,
    getApprovedMonthlyPayrollRows,
    getGlMappings,
    getPostingBatchDetail,
    getPostingHistory,
    getSupportedActivities,
    insertAuditLog,
    insertPostingBatch,
    insertPostingLines,
    markPayrollRowsPosted,
    withTransaction
};
