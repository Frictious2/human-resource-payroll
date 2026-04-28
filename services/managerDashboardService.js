const pool = require('../config/db');
const staffStatusService = require('./staffStatusService');
const payrollAuditService = require('./payrollAuditService');

function resolveCompanyId(companyId) {
    return Number(companyId) || 1;
}

function buildCompanyCondition(alias, companyId) {
    return `(${alias}.CompanyID = ${companyId} OR ${alias}.CompanyID IS NULL)`;
}

async function getSingleValue(sql, params, key = 'count') {
    const [rows] = await pool.query(sql, params);
    return Number((rows[0] && rows[0][key]) || 0);
}

async function getRetirementAge(companyId) {
    const [rows] = await pool.query(
        `
            SELECT RetireAge
            FROM tblparams1
            WHERE (CompanyID = ? OR CompanyID IS NULL)
            LIMIT 1
        `,
        [companyId]
    );

    return Number((rows[0] && rows[0].RetireAge) || 60);
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

async function getApprovalQueue(companyId) {
    const modules = [
        {
            key: 'newStaff',
            label: 'New Staff / Edits',
            route: '/manager/approve/new-staff',
            table: 'tblstaff',
            alias: 't',
            dateField: 'KeyedIn'
        },
        {
            key: 'leave',
            label: 'Leave Applications',
            route: '/manager/approve/leave-application',
            table: 'tblleave',
            alias: 't',
            dateField: 'StartDate'
        },
        {
            key: 'loan',
            label: 'Loans',
            route: '/manager/approve/loan',
            table: 'tblloan',
            alias: 't',
            dateField: 'EntryDate'
        },
        {
            key: 'training',
            label: 'Training',
            route: '/manager/approve/training',
            table: 'tblcourse',
            alias: 't',
            dateField: 'StartDate'
        },
        {
            key: 'transfer',
            label: 'Transfers',
            route: '/manager/approve/transfer',
            table: 'tbltransfer',
            alias: 't',
            dateField: 'TDate'
        },
        {
            key: 'salaryReview',
            label: 'Salary Reviews',
            route: '/manager/approve/salary-review',
            table: 'tblsalreview',
            alias: 't',
            dateField: 'Datekeyed'
        },
        {
            key: 'eos',
            label: 'End of Service',
            route: '/manager/approve/end-of-service',
            table: 'tbleos',
            alias: 't',
            dateField: 'DateKeyed'
        }
    ];

    const rows = await Promise.all(modules.map(async (module) => {
        const condition = buildCompanyCondition(module.alias, companyId);
        const count = await getSingleValue(
            `
                SELECT COUNT(*) AS count
                FROM ${module.table} ${module.alias}
                WHERE ${condition}
                  AND COALESCE(${module.alias}.Approved, 0) = 0
            `,
            []
        );

        const overdue = await getSingleValue(
            `
                SELECT COUNT(*) AS count
                FROM ${module.table} ${module.alias}
                WHERE ${condition}
                  AND COALESCE(${module.alias}.Approved, 0) = 0
                  AND ${module.alias}.${module.dateField} IS NOT NULL
                  AND DATE(${module.alias}.${module.dateField}) < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            `,
            []
        );

        return {
            ...module,
            count,
            overdue
        };
    }));

    return {
        modules: rows,
        totalPending: rows.reduce((sum, row) => sum + row.count, 0),
        overdueTotal: rows.reduce((sum, row) => sum + row.overdue, 0)
    };
}

async function getPeopleSnapshot(companyId, retirementAge) {
    const activeStaffCount = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblstaff s
            WHERE ${buildCompanyCondition('s', companyId)}
              AND ${staffStatusService.getActiveStaffFilter('s')}
        `,
        []
    );

    const retiredCount = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblstaff s
            WHERE ${buildCompanyCondition('s', companyId)}
              AND CAST(COALESCE(s.EmpStatus, '') AS CHAR) IN ('05', '5')
        `,
        []
    );

    const formerCount = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblstaff s
            WHERE ${buildCompanyCondition('s', companyId)}
              AND CAST(COALESCE(s.EmpStatus, '') AS CHAR) IN ('02', '2')
        `,
        []
    );

    const redundantCount = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblstaff s
            WHERE ${buildCompanyCondition('s', companyId)}
              AND COALESCE(s.Redundant, 0) <> 0
        `,
        []
    );

    const onLeaveNow = await getSingleValue(
        `
            SELECT COUNT(DISTINCT l.PFNO) AS count
            FROM tblleave l
            INNER JOIN tblstaff s
                ON s.PFNo = l.PFNO
            WHERE ${buildCompanyCondition('l', companyId)}
              AND ${buildCompanyCondition('s', companyId)}
              AND ${staffStatusService.getActiveStaffFilter('s')}
              AND COALESCE(l.Approved, 0) IN (-1, 1)
              AND COALESCE(l.Recalled, 0) = 0
              AND COALESCE(l.Resumed, 0) = 0
              AND DATE(l.StartDate) <= CURDATE()
              AND DATE(l.ResumptionDate) >= CURDATE()
        `,
        []
    );

    const activeQueries = await getSingleValue(
        `
            SELECT COUNT(DISTINCT q.PFNO) AS count
            FROM tblquery q
            INNER JOIN tblstaff s
                ON s.PFNo = q.PFNO
            WHERE ${buildCompanyCondition('q', companyId)}
              AND ${buildCompanyCondition('s', companyId)}
              AND ${staffStatusService.getActiveStaffFilter('s')}
              AND COALESCE(q.Approved, 0) IN (-1, 1)
              AND COALESCE(q.Expired, 0) = 0
              AND (q.SDate IS NULL OR DATE(q.SDate) <= CURDATE())
              AND (q.EDate IS NULL OR DATE(q.EDate) >= CURDATE())
        `,
        []
    );

    const pendingExits = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblformer f
            WHERE ${buildCompanyCondition('f', companyId)}
              AND COALESCE(f.Approved, 0) = 0
        `,
        []
    );

    const trainingParticipants = await getSingleValue(
        `
            SELECT COUNT(DISTINCT c.PFNo) AS count
            FROM tblcourse c
            INNER JOIN tblstaff s
                ON s.PFNo = c.PFNo
            WHERE ${buildCompanyCondition('c', companyId)}
              AND ${buildCompanyCondition('s', companyId)}
              AND ${staffStatusService.getActiveStaffFilter('s')}
              AND COALESCE(c.approved, 0) IN (-1, 1)
              AND c.StartDate IS NOT NULL
              AND DATE(c.StartDate) >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        `,
        []
    );

    const attendanceExceptions = await getSingleValue(
        `
            SELECT COUNT(*) AS count
            FROM tblattendance a
            INNER JOIN tblstaff s
                ON s.PFNo = a.PFNo
            WHERE ${buildCompanyCondition('a', companyId)}
              AND ${buildCompanyCondition('s', companyId)}
              AND ${staffStatusService.getActiveStaffFilter('s')}
              AND COALESCE(a.Approved, 0) = 0
              AND a.DateKeyedIn IS NOT NULL
              AND DATE(a.DateKeyedIn) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        `,
        []
    );

    const [upcomingRetirements] = await pool.query(
        `
            SELECT
                s.PFNo,
                s.SName,
                s.CDept AS Dept,
                d.Dept AS DeptName,
                s.DOB,
                TIMESTAMPDIFF(YEAR, s.DOB, CURDATE()) AS CurrentAge,
                DATE(TIMESTAMPADD(YEAR, ?, s.DOB)) AS RetirementDate,
                TIMESTAMPDIFF(MONTH, CURDATE(), DATE(TIMESTAMPADD(YEAR, ?, s.DOB))) AS MonthsToRetirement
            FROM tblstaff s
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            WHERE ${buildCompanyCondition('s', companyId)}
              AND ${staffStatusService.getActiveStaffFilter('s')}
              AND s.DOB IS NOT NULL
              AND DATE(TIMESTAMPADD(YEAR, ?, s.DOB)) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 12 MONTH)
            ORDER BY DATE(TIMESTAMPADD(YEAR, ?, s.DOB)) ASC, s.SName ASC
            LIMIT 12
        `,
        [retirementAge, retirementAge, retirementAge, retirementAge]
    );

    const [staffOnLeaveRows] = await pool.query(
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
            WHERE ${buildCompanyCondition('l', companyId)}
              AND ${buildCompanyCondition('s', companyId)}
              AND ${staffStatusService.getActiveStaffFilter('s')}
              AND COALESCE(l.Approved, 0) IN (-1, 1)
              AND COALESCE(l.Recalled, 0) = 0
              AND COALESCE(l.Resumed, 0) = 0
              AND DATE(l.StartDate) <= CURDATE()
              AND DATE(l.ResumptionDate) >= CURDATE()
            ORDER BY DATE(l.ResumptionDate) ASC, s.SName ASC
            LIMIT 10
        `,
        []
    );

    return {
        cards: {
            activeStaffCount,
            retiredCount,
            formerCount,
            redundantCount,
            onLeaveNow,
            activeQueries,
            pendingExits,
            trainingParticipants,
            attendanceExceptions,
            upcomingRetirementsCount: upcomingRetirements.length,
            retirementAge
        },
        upcomingRetirements,
        staffOnLeaveRows
    };
}

async function getPayrollOversight(companyId) {
    const [unpostedPeriods] = await pool.query(
        `
            SELECT
                p.PYear,
                p.PMonth,
                p.PType,
                COUNT(*) AS RowCount,
                MAX(DATE(p.PDate)) AS PayrollDate
            FROM tblpayroll p
            WHERE ${buildCompanyCondition('p', companyId)}
              AND COALESCE(p.Approved, 0) IN (-1, 1)
              AND COALESCE(p.posted_to_gl, 0) = 0
            GROUP BY p.PYear, p.PMonth, p.PType
            ORDER BY p.PYear DESC, p.PMonth DESC, p.PType ASC
            LIMIT 8
        `,
        []
    );

    const [yearlyPending] = await pool.query(
        `
            SELECT
                y.PFNo,
                y.SName,
                y.Dept,
                d.Dept AS DeptName,
                y.PMonth,
                y.PYear,
                y.PType,
                y.TotalIncome,
                y.Taxable,
                y.Tax,
                y.NetIncome
            FROM tblyearlypayments y
            LEFT JOIN tbldept d
                ON d.Code = y.Dept
            WHERE ${buildCompanyCondition('y', companyId)}
              AND COALESCE(y.Approved, 0) = 0
            ORDER BY COALESCE(y.TotalIncome, 0) DESC, y.PYear DESC, y.PMonth DESC
            LIMIT 8
        `,
        []
    );

    const [pendingBatches] = await pool.query(
        `
            SELECT
                id,
                activity_code,
                posting_month,
                posting_year,
                status,
                total_lines,
                total_amount,
                created_at
            FROM payroll_gl_posting_batches
            WHERE company_id = ?
              AND UPPER(COALESCE(status, '')) <> 'POSTED'
            ORDER BY created_at DESC
            LIMIT 8
        `,
        [companyId]
    );

    const payrollAudit = await payrollAuditService.getPayrollRowsForNonActiveStaffAfterStatusChange({
        companyId
    });

    return {
        cards: {
            unpostedPayrollPeriods: unpostedPeriods.length,
            pendingYearlyPayments: yearlyPending.length,
            pendingPostingBatches: pendingBatches.length,
            payrollExceptions: payrollAudit.totals.suspiciousGroups
        },
        unpostedPeriods,
        yearlyPending,
        pendingBatches,
        payrollAudit
    };
}

async function getDepartmentSummaries(companyId) {
    const [rows] = await pool.query(
        `
            SELECT
                s.CDept AS Dept,
                d.Dept AS DeptName,
                COUNT(DISTINCT s.PFNo) AS ActiveStaff,
                COUNT(DISTINCT l.PFNO) AS OnLeaveNow,
                COUNT(DISTINCT c.PFNo) AS TrainedLast12Months
            FROM tblstaff s
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            LEFT JOIN tblleave l
                ON l.PFNO = s.PFNo
               AND COALESCE(l.Approved, 0) IN (-1, 1)
               AND COALESCE(l.Recalled, 0) = 0
               AND COALESCE(l.Resumed, 0) = 0
               AND DATE(l.StartDate) <= CURDATE()
               AND DATE(l.ResumptionDate) >= CURDATE()
            LEFT JOIN tblcourse c
                ON c.PFNo = s.PFNo
               AND COALESCE(c.approved, 0) IN (-1, 1)
               AND c.StartDate IS NOT NULL
               AND DATE(c.StartDate) >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            WHERE ${buildCompanyCondition('s', companyId)}
              AND ${staffStatusService.getActiveStaffFilter('s')}
            GROUP BY s.CDept, d.Dept
            ORDER BY COUNT(DISTINCT s.PFNo) DESC, d.Dept ASC
            LIMIT 12
        `,
        []
    );

    return rows;
}

async function getAlerts(companyId, approvalQueue, peopleSnapshot, payrollOversight) {
    const rejectedTables = [
        { table: 'tblstaff', alias: 't', label: 'Rejected staff records' },
        { table: 'tblleave', alias: 't', label: 'Rejected leave applications' },
        { table: 'tblloan', alias: 't', label: 'Rejected loan applications' },
        { table: 'tblcourse', alias: 't', label: 'Rejected training requests' },
        { table: 'tblsalreview', alias: 't', label: 'Rejected salary reviews' }
    ];

    const rejectedCounts = await Promise.all(rejectedTables.map(async (item) => ({
        ...item,
        count: await getSingleValue(
            `
                SELECT COUNT(*) AS count
                FROM ${item.table} ${item.alias}
                WHERE ${buildCompanyCondition(item.alias, companyId)}
                  AND COALESCE(${item.alias}.Approved, 0) = 2
            `,
            []
        )
    })));

    const alerts = [];

    if (approvalQueue.overdueTotal > 0) {
        alerts.push({
            tone: 'warning',
            title: 'Overdue approvals',
            message: `${approvalQueue.overdueTotal} approval item(s) have been waiting more than 7 days.`,
            route: '/manager/pending-approvals'
        });
    }

    if (payrollOversight.cards.unpostedPayrollPeriods > 0) {
        alerts.push({
            tone: 'info',
            title: 'Payroll ready for posting review',
            message: `${payrollOversight.cards.unpostedPayrollPeriods} payroll period(s) are approved but not yet posted to GL.`,
            route: '/manager/reports/payroll'
        });
    }

    if (payrollOversight.cards.payrollExceptions > 0) {
        alerts.push({
            tone: 'danger',
            title: 'Payroll audit exceptions',
            message: `${payrollOversight.cards.payrollExceptions} payroll group(s) include non-active staff after status change.`,
            route: '/data-entry/reports/payroll/non-active-status-audit'
        });
    }

    if (peopleSnapshot.cards.pendingExits > 0) {
        alerts.push({
            tone: 'secondary',
            title: 'Exit approvals waiting',
            message: `${peopleSnapshot.cards.pendingExits} exit / former record(s) are still pending approval.`,
            route: '/manager/approve/exit'
        });
    }

    rejectedCounts
        .filter((item) => item.count > 0)
        .forEach((item) => {
            alerts.push({
                tone: 'warning',
                title: item.label,
                message: `${item.count} record(s) were rejected and may need correction or resubmission.`,
                route: '/manager/pending-approvals'
            });
        });

    return alerts;
}

async function getManagerDashboardData({ companyId }) {
    const resolvedCompanyId = resolveCompanyId(companyId);
    const [company, retirementAge, approvalQueue] = await Promise.all([
        getCompanyInfo(resolvedCompanyId),
        getRetirementAge(resolvedCompanyId),
        getApprovalQueue(resolvedCompanyId)
    ]);

    const [peopleSnapshot, payrollOversight, departmentSummaries] = await Promise.all([
        getPeopleSnapshot(resolvedCompanyId, retirementAge),
        getPayrollOversight(resolvedCompanyId),
        getDepartmentSummaries(resolvedCompanyId)
    ]);

    const alerts = await getAlerts(resolvedCompanyId, approvalQueue, peopleSnapshot, payrollOversight);

    return {
        company,
        approvalQueue,
        peopleSnapshot,
        payrollOversight,
        departmentSummaries,
        alerts
    };
}

module.exports = {
    getManagerDashboardData
};
