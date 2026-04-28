const pool = require('../config/db');
const staffStatusService = require('./staffStatusService');

function resolveCompanyId(companyId) {
    return Number(companyId) || 1;
}

async function getSingleValue(sql, params, key = 'count') {
    const [rows] = await pool.query(sql, params);
    return Number((rows[0] && rows[0][key]) || 0);
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

async function getTopCards(companyId) {
    const activeStaffCount = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblstaff s
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND ${staffStatusService.getActiveStaffFilter('s')}
        `,
        [companyId]
    );

    const approvalTables = [
        'tblstaff',
        'tbldependant',
        'tblallowance',
        'tblleave',
        'tblapplication',
        'tblpromotions',
        'tbltransfer',
        'tblcourse',
        'tblquery',
        'tblformer',
        'tblappraisal',
        'tblentitle',
        'tblloan',
        'tblbankguarantee',
        'tblacting'
    ];

    const approvalCounts = await Promise.all(
        approvalTables.map((table) => getSingleValue(
            `
                SELECT COUNT(*) AS count
                FROM ${table}
                WHERE (CompanyID = ? OR CompanyID IS NULL)
                  AND COALESCE(Approved, 0) = 0
            `,
            [companyId]
        ))
    );

    const pendingApprovals = approvalCounts.reduce((sum, count) => sum + count, 0);

    const missingSalary = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblstaff s
            LEFT JOIN (
                SELECT x.PFNo, MAX(x.PDate) AS LatestPDate
                FROM tblsalary x
                WHERE COALESCE(x.Approved, 0) IN (-1, 1)
                GROUP BY x.PFNo
            ) sal ON sal.PFNo = s.PFNo
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND ${staffStatusService.getActiveStaffFilter('s')}
              AND sal.PFNo IS NULL
        `,
        [companyId]
    );

    const missingEntitlement = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblstaff s
            LEFT JOIN tblentitle e
                ON e.PFNo = s.PFNo
               AND COALESCE(e.Approved, 0) IN (-1, 1)
               AND (e.CompanyID = ? OR e.CompanyID IS NULL)
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND ${staffStatusService.getActiveStaffFilter('s')}
              AND e.PFNo IS NULL
        `,
        [companyId, companyId]
    );

    const upcomingLeaveStarts = await getSingleValue(
        `
            SELECT COUNT(DISTINCT l.PFNO) AS count
            FROM tblleave l
            INNER JOIN tblstaff s
                ON s.PFNo = l.PFNO
            WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
              AND (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND ${staffStatusService.getActiveStaffFilter('s')}
              AND COALESCE(l.Approved, 0) IN (-1, 1)
              AND l.StartDate IS NOT NULL
              AND DATE(l.StartDate) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 14 DAY)
        `,
        [companyId, companyId]
    );

    return {
        activeStaffCount,
        pendingApprovals,
        payrollSetupGaps: missingSalary + missingEntitlement,
        upcomingLeaveStarts
    };
}

async function getOperationalQueues(companyId) {
    const modules = [
        {
            label: 'New Staff / Edits',
            route: '/data-entry/staff/list',
            table: 'tblstaff',
            dateField: 'KeyedIn'
        },
        {
            label: 'Attendance Waiting Review',
            route: '/data-entry/staff/attendance',
            table: 'tblattendance',
            dateField: 'DateKeyedIn'
        },
        {
            label: 'Transfers Waiting Review',
            route: '/data-entry/enquiry/transfer-promotion',
            table: 'tbltransfer',
            dateField: 'TDate'
        },
        {
            label: 'Loans Waiting Review',
            route: '/data-entry/enquiry/loan-balance',
            table: 'tblloan',
            dateField: 'EntryDate'
        },
        {
            label: 'Yearly Payments Waiting Review',
            route: '/data-entry/payroll/yearly-payments',
            table: 'tblyearlypayments',
            dateField: 'DateKeyed'
        },
        {
            label: 'Salary Reviews Waiting Review',
            route: '/data-entry/payroll/salary-reviews',
            table: 'tblsalreview',
            dateField: 'Datekeyed'
        }
    ];

    const rows = await Promise.all(modules.map(async (module) => {
        const count = await getSingleValue(
            `
                SELECT COUNT(*) AS count
                FROM ${module.table}
                WHERE (CompanyID = ? OR CompanyID IS NULL)
                  AND COALESCE(Approved, 0) = 0
            `,
            [companyId]
        );

        const todayCount = await getSingleValue(
            `
                SELECT COUNT(*) AS count
                FROM ${module.table}
                WHERE (CompanyID = ? OR CompanyID IS NULL)
                  AND ${module.dateField} IS NOT NULL
                  AND DATE(${module.dateField}) = CURDATE()
            `,
            [companyId]
        );

        return {
            ...module,
            count,
            todayCount
        };
    }));

    return rows;
}

async function getPayrollReadiness(companyId) {
    const missingSalaryRows = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblstaff s
            LEFT JOIN (
                SELECT x.PFNo, MAX(x.PDate) AS LatestPDate
                FROM tblsalary x
                WHERE COALESCE(x.Approved, 0) IN (-1, 1)
                GROUP BY x.PFNo
            ) sal ON sal.PFNo = s.PFNo
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND ${staffStatusService.getActiveStaffFilter('s')}
              AND sal.PFNo IS NULL
        `,
        [companyId]
    );

    const missingEntitlementRows = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblstaff s
            LEFT JOIN tblentitle e
                ON e.PFNo = s.PFNo
               AND COALESCE(e.Approved, 0) IN (-1, 1)
               AND (e.CompanyID = ? OR e.CompanyID IS NULL)
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND ${staffStatusService.getActiveStaffFilter('s')}
              AND e.PFNo IS NULL
        `,
        [companyId, companyId]
    );

    const pendingYearlyPayments = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblyearlypayments y
            WHERE (y.CompanyID = ? OR y.CompanyID IS NULL)
              AND COALESCE(y.Approved, 0) = 0
        `,
        [companyId]
    );

    const pendingSalaryReviews = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblsalreview r
            WHERE (r.CompanyID = ? OR r.CompanyID IS NULL)
              AND COALESCE(r.Approved, 0) = 0
        `,
        [companyId]
    );

    const [missingSetupRows] = await pool.query(
        `
            SELECT
                s.PFNo,
                s.SName,
                s.CDept AS Dept,
                d.Dept AS DeptName,
                CASE WHEN sal.PFNo IS NULL THEN 1 ELSE 0 END AS MissingSalary,
                CASE WHEN e.PFNo IS NULL THEN 1 ELSE 0 END AS MissingEntitlement
            FROM tblstaff s
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            LEFT JOIN (
                SELECT x.PFNo, MAX(x.PDate) AS LatestPDate
                FROM tblsalary x
                WHERE COALESCE(x.Approved, 0) IN (-1, 1)
                GROUP BY x.PFNo
            ) sal ON sal.PFNo = s.PFNo
            LEFT JOIN tblentitle e
                ON e.PFNo = s.PFNo
               AND COALESCE(e.Approved, 0) IN (-1, 1)
               AND (e.CompanyID = ? OR e.CompanyID IS NULL)
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND ${staffStatusService.getActiveStaffFilter('s')}
              AND (sal.PFNo IS NULL OR e.PFNo IS NULL)
            ORDER BY s.SName ASC
            LIMIT 10
        `,
        [companyId, companyId]
    );

    return {
        cards: {
            missingSalaryRows,
            missingEntitlementRows,
            pendingYearlyPayments,
            pendingSalaryReviews
        },
        missingSetupRows
    };
}

async function getRecentActivity(companyId) {
    const queries = [
        {
            label: 'New Staff / Edit',
            route: '/data-entry/staff/list',
            sql: `
                SELECT
                    s.PFNo,
                    s.SName,
                    s.KeyedIn AS ActivityDate,
                    s.CDept AS Dept,
                    d.Dept AS DeptName,
                    COALESCE(s.Approved, 0) AS Approved
                FROM tblstaff s
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND s.KeyedIn IS NOT NULL
                ORDER BY s.KeyedIn DESC
                LIMIT 3
            `
        },
        {
            label: 'Leave Record',
            route: '/data-entry/reports/leave',
            sql: `
                SELECT
                    l.PFNO AS PFNo,
                    s.SName,
                    l.StartDate AS ActivityDate,
                    s.CDept AS Dept,
                    d.Dept AS DeptName,
                    COALESCE(l.Approved, 0) AS Approved
                FROM tblleave l
                INNER JOIN tblstaff s
                    ON s.PFNo = l.PFNO
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
                  AND l.StartDate IS NOT NULL
                ORDER BY l.StartDate DESC
                LIMIT 3
            `
        },
        {
            label: 'Loan Entry',
            route: '/data-entry/enquiry/loan-balance',
            sql: `
                SELECT
                    l.PFNo,
                    s.SName,
                    l.EntryDate AS ActivityDate,
                    s.CDept AS Dept,
                    d.Dept AS DeptName,
                    COALESCE(l.Approved, 0) AS Approved
                FROM tblloan l
                LEFT JOIN tblstaff s
                    ON s.PFNo = l.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
                  AND l.EntryDate IS NOT NULL
                ORDER BY l.EntryDate DESC
                LIMIT 3
            `
        }
    ];

    const results = await Promise.all(queries.map(async (query) => {
        const [rows] = await pool.query(query.sql, [companyId]);
        return rows.map((row) => ({
            module: query.label,
            route: query.route,
            ...row
        }));
    }));

    return results
        .flat()
        .sort((a, b) => new Date(b.ActivityDate || 0) - new Date(a.ActivityDate || 0))
        .slice(0, 8);
}

async function getWatchlist(companyId) {
    const [upcomingLeaveRows] = await pool.query(
        `
            SELECT
                l.PFNO,
                s.SName,
                s.CDept AS Dept,
                d.Dept AS DeptName,
                t.LeaveType,
                l.StartDate,
                l.ResumptionDate,
                l.LDays
            FROM tblleave l
            INNER JOIN tblstaff s
                ON s.PFNo = l.PFNO
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            LEFT JOIN tblleavetype t
                ON t.Code = l.LType
            WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
              AND (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND ${staffStatusService.getActiveStaffFilter('s')}
              AND COALESCE(l.Approved, 0) IN (-1, 1)
              AND l.StartDate IS NOT NULL
              AND DATE(l.StartDate) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 14 DAY)
            ORDER BY DATE(l.StartDate) ASC, s.SName ASC
            LIMIT 10
        `,
        [companyId, companyId]
    );

    const [yearlyPeriods] = await pool.query(
        `
            SELECT
                y.PYear,
                y.PMonth,
                y.PType,
                COUNT(*) AS RowCount,
                SUM(COALESCE(y.NetIncome, 0)) AS NetTotal
            FROM tblyearlypayments y
            WHERE (y.CompanyID = ? OR y.CompanyID IS NULL)
              AND COALESCE(y.Approved, 0) = 0
            GROUP BY y.PYear, y.PMonth, y.PType
            ORDER BY y.PYear DESC, y.PMonth DESC, y.PType ASC
            LIMIT 8
        `,
        [companyId]
    );

    return {
        upcomingLeaveRows,
        yearlyPeriods
    };
}

async function getDataEntryDashboardData({ companyId }) {
    const resolvedCompanyId = resolveCompanyId(companyId);

    const [company, topCards, operationalQueues, payrollReadiness, recentActivity, watchlist] = await Promise.all([
        getCompanyInfo(resolvedCompanyId),
        getTopCards(resolvedCompanyId),
        getOperationalQueues(resolvedCompanyId),
        getPayrollReadiness(resolvedCompanyId),
        getRecentActivity(resolvedCompanyId),
        getWatchlist(resolvedCompanyId)
    ]);

    return {
        company,
        topCards,
        operationalQueues,
        payrollReadiness,
        recentActivity,
        watchlist
    };
}

module.exports = {
    getDataEntryDashboardData
};
