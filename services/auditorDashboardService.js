const pool = require('../config/db');
const payrollAuditService = require('./payrollAuditService');

const AUDITOR_SCOPE_CLAUSE = `
    (
        UserName IS NULL OR UserName NOT IN (SELECT username FROM developer)
    )
    AND (
        FormName IS NULL
        OR (
            FormName NOT LIKE 'developer/%'
            AND FormName NOT LIKE '/developer/%'
        )
    )
`;

function normalizeModule(formName) {
    const value = String(formName || '').trim();
    if (!value) {
        return 'Unspecified';
    }

    if (value.startsWith('/')) {
        const parts = value.split('/').filter(Boolean);
        return parts.slice(0, 2).join(' / ') || value;
    }

    const parts = value.split('/').filter(Boolean);
    return parts.slice(0, 2).join(' / ') || value;
}

async function getSingleValue(sql, params, key = 'count') {
    const [rows] = await pool.query(sql, params);
    return Number((rows[0] && rows[0][key]) || 0);
}

async function getMetrics(companyId) {
    const [
        totalCount,
        todayCount,
        activeUsers,
        highRiskEvents30Days,
        pendingFinancialApprovals,
        unpostedPayrollPeriods,
        pendingPostingBatches,
        payrollAudit
    ] = await Promise.all([
        getSingleValue(`SELECT COUNT(*) AS totalCount FROM tblaudittrail WHERE ${AUDITOR_SCOPE_CLAUSE}`, [], 'totalCount'),
        getSingleValue(`SELECT COUNT(*) AS todayCount FROM tblaudittrail WHERE ${AUDITOR_SCOPE_CLAUSE} AND DATE(ChangeDate) = CURDATE()`, [], 'todayCount'),
        getSingleValue(`SELECT COUNT(DISTINCT UserName) AS activeUsers FROM tblaudittrail WHERE ${AUDITOR_SCOPE_CLAUSE} AND DATE(ChangeDate) = CURDATE() AND UserName IS NOT NULL`, [], 'activeUsers'),
        getSingleValue(
            `
                SELECT COUNT(*) AS count
                FROM tblaudittrail
                WHERE ${AUDITOR_SCOPE_CLAUSE}
                  AND ChangeDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                  AND (
                      FormName LIKE 'data_entry/payroll/%'
                      OR FormName LIKE 'manager/approve/%'
                      OR FormName LIKE 'data_entry/welfare/%'
                      OR FormName LIKE 'reports/%'
                      OR Action IN ('DELETE', 'Reject', 'REJECT')
                  )
            `,
            []
        ),
        getSingleValue(
            `
                SELECT
                    (
                        SELECT COUNT(*) FROM tblloan WHERE (CompanyID = ? OR CompanyID IS NULL) AND COALESCE(Approved, 0) = 0
                    ) +
                    (
                        SELECT COUNT(*) FROM tblbankguarantee WHERE (CompanyID = ? OR CompanyID IS NULL) AND COALESCE(Approved, 0) = 0
                    ) +
                    (
                        SELECT COUNT(*) FROM tblyearlypayments WHERE (CompanyID = ? OR CompanyID IS NULL) AND COALESCE(Approved, 0) = 0
                    ) +
                    (
                        SELECT COUNT(*) FROM tbleos WHERE (CompanyID = ? OR CompanyID IS NULL) AND COALESCE(Approved, 0) = 0
                    ) +
                    (
                        SELECT COUNT(*) FROM tblincrement WHERE (CompanyID = ? OR CompanyID IS NULL) AND COALESCE(Approved, 0) = 0
                    ) +
                    (
                        SELECT COUNT(*) FROM tblacting WHERE (CompanyID = ? OR CompanyID IS NULL) AND COALESCE(Approved, 0) = 0
                    ) AS count
            `,
            [companyId, companyId, companyId, companyId, companyId, companyId]
        ),
        getSingleValue(
            `
                SELECT COUNT(*) AS count
                FROM (
                    SELECT p.PYear, p.PMonth, p.PType
                    FROM tblpayroll p
                    WHERE (p.CompanyID = ? OR p.CompanyID IS NULL)
                      AND COALESCE(p.Approved, 0) IN (-1, 1)
                      AND COALESCE(p.posted_to_gl, 0) = 0
                    GROUP BY p.PYear, p.PMonth, p.PType
                ) x
            `,
            [companyId]
        ),
        getSingleValue(
            `
                SELECT COUNT(*) AS count
                FROM payroll_gl_posting_batches
                WHERE company_id = ?
                  AND UPPER(COALESCE(status, '')) <> 'POSTED'
            `,
            [companyId]
        ),
        payrollAuditService.getPayrollRowsForNonActiveStaffAfterStatusChange({ companyId })
    ]);

    return {
        totalCount,
        todayCount,
        activeUsers,
        highRiskEvents30Days,
        pendingFinancialApprovals,
        unpostedPayrollPeriods,
        pendingPostingBatches,
        payrollExceptions: payrollAudit.totals.suspiciousGroups
    };
}

async function getActionBreakdown() {
    const [rows] = await pool.query(`
        SELECT Action, COUNT(*) AS total
        FROM tblaudittrail
        WHERE ${AUDITOR_SCOPE_CLAUSE}
        GROUP BY Action
        ORDER BY total DESC, Action ASC
        LIMIT 8
    `);

    return rows;
}

async function getRecentActivity() {
    const [rows] = await pool.query(`
        SELECT AuditTrailID, ChangeDate, UserName, FormName, Action, RecordID, FieldName, OldValue, NewValue
        FROM tblaudittrail
        WHERE ${AUDITOR_SCOPE_CLAUSE}
        ORDER BY ChangeDate DESC, AuditTrailID DESC
        LIMIT 20
    `);

    return rows;
}

async function getHighRiskActivity() {
    const [rows] = await pool.query(`
        SELECT AuditTrailID, ChangeDate, UserName, FormName, Action, RecordID, FieldName, OldValue, NewValue
        FROM tblaudittrail
        WHERE ${AUDITOR_SCOPE_CLAUSE}
          AND ChangeDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND (
              FormName LIKE 'data_entry/payroll/%'
              OR FormName LIKE 'manager/approve/%'
              OR FormName LIKE 'data_entry/welfare/%'
              OR Action IN ('DELETE', 'Reject', 'REJECT')
          )
        ORDER BY ChangeDate DESC, AuditTrailID DESC
        LIMIT 12
    `);

    return rows;
}

async function getModuleBreakdown() {
    const [rows] = await pool.query(`
        SELECT FormName, COUNT(*) AS total
        FROM tblaudittrail
        WHERE ${AUDITOR_SCOPE_CLAUSE}
          AND FormName IS NOT NULL
          AND FormName <> ''
        GROUP BY FormName
        ORDER BY total DESC, FormName ASC
        LIMIT 20
    `);

    const totals = new Map();
    rows.forEach((row) => {
        const key = normalizeModule(row.FormName);
        totals.set(key, (totals.get(key) || 0) + Number(row.total || 0));
    });

    return Array.from(totals.entries())
        .map(([module, total]) => ({ module, total }))
        .sort((a, b) => b.total - a.total || a.module.localeCompare(b.module))
        .slice(0, 8);
}

async function getTopUsersToday() {
    const [rows] = await pool.query(`
        SELECT UserName, COUNT(*) AS total
        FROM tblaudittrail
        WHERE ${AUDITOR_SCOPE_CLAUSE}
          AND DATE(ChangeDate) = CURDATE()
          AND UserName IS NOT NULL
          AND UserName <> ''
        GROUP BY UserName
        ORDER BY total DESC, UserName ASC
        LIMIT 8
    `);

    return rows;
}

async function getControlChecks(companyId) {
    const [financialApprovals, unpostedPeriods, pendingBatches] = await Promise.all([
        pool.query(`
            SELECT 'Loans' AS label, '/manager/approve/loan' AS route, COUNT(*) AS total
            FROM tblloan
            WHERE (CompanyID = ? OR CompanyID IS NULL) AND COALESCE(Approved, 0) = 0
            UNION ALL
            SELECT 'Bank Guarantees' AS label, '/manager/approve/guarantee' AS route, COUNT(*) AS total
            FROM tblbankguarantee
            WHERE (CompanyID = ? OR CompanyID IS NULL) AND COALESCE(Approved, 0) = 0
            UNION ALL
            SELECT 'Yearly Payments' AS label, '/manager/approve/yearly' AS route, COUNT(*) AS total
            FROM tblyearlypayments
            WHERE (CompanyID = ? OR CompanyID IS NULL) AND COALESCE(Approved, 0) = 0
            UNION ALL
            SELECT 'End of Service' AS label, '/manager/approve/end-of-service' AS route, COUNT(*) AS total
            FROM tbleos
            WHERE (CompanyID = ? OR CompanyID IS NULL) AND COALESCE(Approved, 0) = 0
            UNION ALL
            SELECT 'Increments' AS label, '/manager/approve/increment' AS route, COUNT(*) AS total
            FROM tblincrement
            WHERE (CompanyID = ? OR CompanyID IS NULL) AND COALESCE(Approved, 0) = 0
            UNION ALL
            SELECT 'Acting Allowance' AS label, '/manager/approve/acting-allowance' AS route, COUNT(*) AS total
            FROM tblacting
            WHERE (CompanyID = ? OR CompanyID IS NULL) AND COALESCE(Approved, 0) = 0
        `, [companyId, companyId, companyId, companyId, companyId, companyId]),
        pool.query(`
            SELECT
                p.PYear,
                p.PMonth,
                p.PType,
                COUNT(*) AS RowCount,
                MAX(DATE(p.PDate)) AS PayrollDate
            FROM tblpayroll p
            WHERE (p.CompanyID = ? OR p.CompanyID IS NULL)
              AND COALESCE(p.Approved, 0) IN (-1, 1)
              AND COALESCE(p.posted_to_gl, 0) = 0
            GROUP BY p.PYear, p.PMonth, p.PType
            ORDER BY p.PYear DESC, p.PMonth DESC, p.PType ASC
            LIMIT 8
        `, [companyId]),
        pool.query(`
            SELECT id, activity_code, posting_month, posting_year, status, total_lines, total_amount, created_at
            FROM payroll_gl_posting_batches
            WHERE company_id = ?
              AND UPPER(COALESCE(status, '')) <> 'POSTED'
            ORDER BY created_at DESC
            LIMIT 8
        `, [companyId])
    ]);

    return {
        financialApprovals: financialApprovals[0].filter((row) => Number(row.total || 0) > 0),
        unpostedPeriods: unpostedPeriods[0],
        pendingBatches: pendingBatches[0]
    };
}

async function getAuditorDashboardData({ companyId }) {
    const resolvedCompanyId = Number(companyId) || 1;

    const [
        metrics,
        actionBreakdown,
        recentActivity,
        highRiskActivity,
        moduleBreakdown,
        topUsersToday,
        controlChecks
    ] = await Promise.all([
        getMetrics(resolvedCompanyId),
        getActionBreakdown(),
        getRecentActivity(),
        getHighRiskActivity(),
        getModuleBreakdown(),
        getTopUsersToday(),
        getControlChecks(resolvedCompanyId)
    ]);

    return {
        metrics,
        actionBreakdown,
        recentActivity,
        highRiskActivity,
        moduleBreakdown,
        topUsersToday,
        controlChecks
    };
}

module.exports = {
    AUDITOR_SCOPE_CLAUSE,
    getAuditorDashboardData
};
