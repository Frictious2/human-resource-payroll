const pool = require('../config/db');
const VISIBLE_ADMIN_USER_LEVELS = ['Admin', 'Manager', 'Data Entry', 'Auditor', 'Entity Head'];

function resolveCompanyId(companyId) {
    return Number(companyId) || 1;
}

function getVisibleUserLevelClause(columnName = 'Level') {
    const placeholders = VISIBLE_ADMIN_USER_LEVELS.map(() => '?').join(', ');
    return {
        clause: `${columnName} IN (${placeholders})`,
        params: [...VISIBLE_ADMIN_USER_LEVELS]
    };
}

async function getSingleValue(sql, params, key = 'count') {
    const [rows] = await pool.query(sql, params);
    return Number((rows[0] && rows[0][key]) || 0);
}

async function getCountForTable(table, companyId, alias = 't') {
    return getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM ${table} ${alias}
            WHERE (${alias}.CompanyID = ? OR ${alias}.CompanyID IS NULL)
        `,
        [companyId]
    );
}

async function getCompanyInfo(companyId) {
    const [rows] = await pool.query(
        `
            SELECT *
            FROM tblcominfo
            WHERE (CompanyID = ? OR CompanyID IS NULL)
            LIMIT 1
        `,
        [companyId]
    );

    return rows[0] || {};
}

async function getDepartmentChart(companyId) {
    const [departmentRows] = await pool.query(
        `
            SELECT
                d.Code,
                d.Dept,
                COUNT(s.PFNo) AS staffCount
            FROM tbldept d
            LEFT JOIN tblstaff s
              ON s.CDept = d.Code
             AND COALESCE(s.Redundant, 0) = 0
             AND (
                s.EmpStatus IS NULL
                OR CAST(COALESCE(s.EmpStatus, '') AS CHAR) IN ('1', '01', '3', '03', '4', '04')
             )
             AND (s.CompanyID = ? OR s.CompanyID IS NULL)
            WHERE (d.CompanyID = ? OR d.CompanyID IS NULL)
            GROUP BY d.Code, d.Dept
            ORDER BY d.Dept ASC
        `,
        [companyId, companyId]
    );

    return {
        labels: departmentRows.map((row) => row.Dept || row.Code || 'Unknown Department'),
        values: departmentRows.map((row) => Number(row.staffCount) || 0),
        rows: departmentRows
    };
}

async function getUserAccess(companyId) {
    const visibleLevels = getVisibleUserLevelClause('Level');
    const [roleRows, recentUsers, pendingPasswordRows] = await Promise.all([
        pool.query(
            `
                SELECT Level, COUNT(*) AS total
                FROM tblpassword
                WHERE CompanyID = ?
                  AND ${visibleLevels.clause}
                GROUP BY Level
                ORDER BY total DESC, Level ASC
            `,
            [companyId, ...visibleLevels.params]
        ),
        pool.query(
            `
                SELECT PFNo, Username, FullName, Email, Level, DateCreated
                FROM tblpassword
                WHERE CompanyID = ?
                  AND ${visibleLevels.clause}
                ORDER BY DateCreated DESC, PFNo DESC
                LIMIT 8
            `,
            [companyId, ...visibleLevels.params]
        ),
        pool.query(
            `
                SELECT PFNo, Username, FullName, Email, Level, DateCreated
                FROM tblpassword
                WHERE CompanyID = ?
                  AND ${visibleLevels.clause}
                  AND (Pword IS NULL OR Pword = '')
                ORDER BY DateCreated DESC, PFNo DESC
                LIMIT 8
            `,
            [companyId, ...visibleLevels.params]
        )
    ]);

    const roleCounts = roleRows[0];
    const totalUsers = roleCounts.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const pendingPasswordSetup = pendingPasswordRows[0].length;

    return {
        totalUsers,
        pendingPasswordSetup,
        roleCounts,
        recentUsers: recentUsers[0],
        pendingPasswordRows: pendingPasswordRows[0]
    };
}

async function getConfigurationHealth(companyId) {
    const checks = await Promise.all([
        getCountForTable('tblcominfo', companyId),
        getCountForTable('tbldept', companyId),
        getCountForTable('tblgrade', companyId),
        getCountForTable('tbljobtitle', companyId),
        getCountForTable('tblpayrollitems', companyId),
        getCountForTable('tblglaccounts', companyId),
        getCountForTable('tblbanks', companyId),
        getCountForTable('tblparams1', companyId),
        getCountForTable('tbleoscalc', companyId),
        getSingleValue(
            `
                SELECT COUNT(*) AS count
                FROM tbltax
                WHERE CompanyID = ? OR CompanyID IS NULL
            `,
            [companyId]
        ),
        getSingleValue(
            `
                SELECT COUNT(*) AS count
                FROM tblweek
                WHERE COALESCE(WorkDay, 0) <> 0
            `,
            []
        ),
        getSingleValue(
            `
                SELECT COUNT(*) AS count
                FROM tblpublic_holidays
                WHERE (CompanyID = ? OR CompanyID IS NULL)
                  AND Pub_Year = YEAR(CURDATE())
            `,
            [companyId]
        )
    ]);

    const items = [
        { label: 'Company Information', route: '/admin/company-info', count: checks[0], warning: 'Company info is missing.' },
        { label: 'Departments', route: '/admin/parameters/departments', count: checks[1], warning: 'No departments configured.' },
        { label: 'Grades', route: '/admin/parameters/grades', count: checks[2], warning: 'No grades configured.' },
        { label: 'Job Titles', route: '/admin/parameters/job-titles', count: checks[3], warning: 'No job titles configured.' },
        { label: 'Payroll Items', route: '/admin/parameters/payroll-items', count: checks[4], warning: 'No payroll items configured.' },
        { label: 'GL Accounts', route: '/admin/parameters/gl-accounts', count: checks[5], warning: 'No GL accounts configured.' },
        { label: 'Banks', route: '/admin/parameters/banks', count: checks[6], warning: 'No banks configured.' },
        { label: 'Global Parameters', route: '/admin/parameters/global-params', count: checks[7], warning: 'Global parameters are missing.' },
        { label: 'EOS Calculation Setup', route: '/admin/parameters/end-of-service-benefit', count: checks[8], warning: 'EOS benefit setup is missing.' },
        { label: 'Tax Table', route: '/admin/parameters/tax-table', count: checks[9], warning: 'Tax table is missing.' },
        { label: 'Work Days', route: '/admin/parameters/work-days', count: checks[10], warning: 'Work day setup is missing.' },
        { label: 'Public Holidays This Year', route: '/admin/parameters/public-holidays', count: checks[11], warning: 'No public holidays configured for this year.' }
    ];

    const completeCount = items.filter((item) => Number(item.count || 0) > 0).length;
    const completenessPercent = Math.round((completeCount / items.length) * 100);
    const warnings = items.filter((item) => Number(item.count || 0) === 0);

    return {
        completenessPercent,
        warningsCount: warnings.length,
        items,
        warnings
    };
}

async function getRecentAdminChanges() {
    const [rows] = await pool.query(
        `
            SELECT AuditTrailID, ChangeDate, UserName, FormName, Action, RecordID, FieldName, OldValue, NewValue
            FROM tblaudittrail
            WHERE FormName LIKE 'admin/%'
               OR FormName LIKE '/admin/%'
            ORDER BY ChangeDate DESC, AuditTrailID DESC
            LIMIT 15
        `
    );

    return rows;
}

async function getSystemAlerts(companyId, configHealth, userAccess) {
    const visibleLevels = getVisibleUserLevelClause('Level');
    const payrollItemsWithoutFreq = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblpayrollitems
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND (Freq IS NULL OR Freq = '')
        `,
        [companyId]
    );

    const usersWithoutEmail = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblpassword
            WHERE CompanyID = ?
              AND ${visibleLevels.clause}
              AND (Email IS NULL OR Email = '')
        `,
        [companyId, ...visibleLevels.params]
    );

    const alerts = [];

    if (configHealth.warningsCount > 0) {
        alerts.push({
            tone: 'warning',
            title: 'Configuration gaps',
            message: `${configHealth.warningsCount} required setup area(s) still need attention.`,
            route: '/admin/parameters/global-params'
        });
    }

    if (userAccess.pendingPasswordSetup > 0) {
        alerts.push({
            tone: 'info',
            title: 'Users pending password setup',
            message: `${userAccess.pendingPasswordSetup} managed portal user(s) have not completed password setup.`,
            route: '/admin/admins'
        });
    }

    if (payrollItemsWithoutFreq > 0) {
        alerts.push({
            tone: 'warning',
            title: 'Payroll items missing frequency',
            message: `${payrollItemsWithoutFreq} payroll item(s) do not have a frequency value.`,
            route: '/admin/parameters/payroll-items'
        });
    }

    if (usersWithoutEmail > 0) {
        alerts.push({
            tone: 'secondary',
            title: 'Portal users missing email',
            message: `${usersWithoutEmail} managed user account(s) have no email address, which affects password onboarding.`,
            route: '/admin/admins'
        });
    }

    return alerts;
}

async function getAdminDashboardData({ companyId }) {
    const resolvedCompanyId = resolveCompanyId(companyId);

    const [company, departmentChart, userAccess, configHealth, recentAdminChanges] = await Promise.all([
        getCompanyInfo(resolvedCompanyId),
        getDepartmentChart(resolvedCompanyId),
        getUserAccess(resolvedCompanyId),
        getConfigurationHealth(resolvedCompanyId),
        getRecentAdminChanges()
    ]);

    const alerts = await getSystemAlerts(resolvedCompanyId, configHealth, userAccess);

    return {
        company,
        departmentChart,
        metrics: {
            activeDepartments: departmentChart.rows.filter((row) => Number(row.staffCount || 0) > 0).length,
            totalConfiguredDepartments: departmentChart.rows.length,
            totalUsers: userAccess.totalUsers,
            pendingPasswordSetup: userAccess.pendingPasswordSetup,
            configurationCompleteness: configHealth.completenessPercent,
            configurationWarnings: configHealth.warningsCount
        },
        userAccess,
        configHealth,
        recentAdminChanges,
        alerts
    };
}

module.exports = {
    getAdminDashboardData
};
