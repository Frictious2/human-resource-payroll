const pool = require('../config/db');
const staffStatusService = require('./staffStatusService');

function normalizeFilterValue(value) {
    const text = String(value || '').trim();
    return text || null;
}

function buildAuditFilters({ companyId, payrollMonth, payrollYear, activityCode, pfNo }) {
    const conditions = ['p.CompanyID = ?'];
    const params = [companyId];

    if (payrollMonth) {
        conditions.push('p.PMonth = ?');
        params.push(Number(payrollMonth));
    }

    if (payrollYear) {
        conditions.push('p.PYear = ?');
        params.push(Number(payrollYear));
    }

    if (activityCode) {
        conditions.push('p.PType = ?');
        params.push(activityCode);
    }

    if (pfNo) {
        conditions.push('p.PFNo = ?');
        params.push(pfNo);
    }

    return {
        whereClause: conditions.join('\n              AND '),
        params
    };
}

function getCurrentStatusExpression() {
    return `
        CASE
            WHEN COALESCE(s.Redundant, 0) <> 0 THEN 'REDUNDANT'
            WHEN COALESCE(status_lookup.Status, '') <> '' THEN status_lookup.Status
            ELSE CAST(COALESCE(s.EmpStatus, '') AS CHAR)
        END
    `;
}

function getEffectiveStatusChangeDateExpression() {
    return `
        CASE
            WHEN COALESCE(s.Redundant, 0) <> 0 THEN DATE(s.DateRedundant)
            ELSE COALESCE(former_status.effective_former_date, DATE(s.ReasonDate))
        END
    `;
}

function getPayrollDateExpression() {
    return "COALESCE(DATE(p.PDate), STR_TO_DATE(CONCAT(p.PYear, '-', LPAD(p.PMonth, 2, '0'), '-01'), '%Y-%m-%d'))";
}

async function getPayrollRowsForNonActiveStaffAfterStatusChange({
    companyId,
    payrollMonth = null,
    payrollYear = null,
    activityCode = null,
    pfNo = null
}) {
    const normalizedFilters = {
        companyId: Number(companyId) || 1,
        payrollMonth: normalizeFilterValue(payrollMonth),
        payrollYear: normalizeFilterValue(payrollYear),
        activityCode: normalizeFilterValue(activityCode),
        pfNo: normalizeFilterValue(pfNo)
    };

    const { whereClause, params } = buildAuditFilters(normalizedFilters);
    const currentStatusExpression = getCurrentStatusExpression();
    const effectiveStatusChangeDateExpression = getEffectiveStatusChangeDateExpression();
    const payrollDateExpression = getPayrollDateExpression();

    const baseParams = [normalizedFilters.companyId, ...params];

    const [detailRows] = await pool.query(
        `
            SELECT
                p.CompanyID,
                p.PFNo,
                COALESCE(s.SName, '') AS SName,
                p.PMonth,
                p.PYear,
                p.PType,
                COALESCE(pt.PayType, p.PType) AS PayTypeName,
                ${currentStatusExpression} AS CurrentStatus,
                ${effectiveStatusChangeDateExpression} AS EffectiveStatusChangeDate,
                COUNT(*) AS PayrollRowCount,
                MIN(${payrollDateExpression}) AS PayrollDate
            FROM tblpayroll p
            INNER JOIN tblstaff s
                ON s.PFNo = p.PFNo
            ${staffStatusService.getPayrollStatusJoins({ staffAlias: 's' })}
            LEFT JOIN tblpaytype pt
                ON pt.Code = p.PType
            WHERE ${whereClause}
              AND ${staffStatusService.getPayrollIneligibilityClause({
                  staffAlias: 's',
                  payrollDateExpression
              })}
            GROUP BY
                p.CompanyID,
                p.PFNo,
                COALESCE(s.SName, ''),
                p.PMonth,
                p.PYear,
                p.PType,
                COALESCE(pt.PayType, p.PType),
                ${currentStatusExpression},
                ${effectiveStatusChangeDateExpression}
            ORDER BY p.PYear DESC, p.PMonth DESC, p.PType ASC, p.PFNo ASC
        `,
        baseParams
    );

    const [summaryRows] = await pool.query(
        `
            SELECT
                p.CompanyID,
                p.PMonth,
                p.PYear,
                p.PType,
                COALESCE(pt.PayType, p.PType) AS PayTypeName,
                COUNT(*) AS SuspiciousPayrollRows,
                COUNT(DISTINCT p.PFNo) AS StaffCount
            FROM tblpayroll p
            INNER JOIN tblstaff s
                ON s.PFNo = p.PFNo
            ${staffStatusService.getPayrollStatusJoins({ staffAlias: 's' })}
            LEFT JOIN tblpaytype pt
                ON pt.Code = p.PType
            WHERE ${whereClause}
              AND ${staffStatusService.getPayrollIneligibilityClause({
                  staffAlias: 's',
                  payrollDateExpression
              })}
            GROUP BY
                p.CompanyID,
                p.PMonth,
                p.PYear,
                p.PType,
                COALESCE(pt.PayType, p.PType)
            ORDER BY p.PYear DESC, p.PMonth DESC, p.PType ASC
        `,
        baseParams
    );

    const totals = {
        suspiciousGroups: detailRows.length,
        suspiciousPayrollRows: detailRows.reduce((sum, row) => sum + Number(row.PayrollRowCount || 0), 0),
        periodsAffected: summaryRows.length
    };

    return {
        label: 'Payroll rows for non-active staff after status change',
        filters: normalizedFilters,
        detailRows,
        summaryRows,
        totals
    };
}

module.exports = {
    getPayrollRowsForNonActiveStaffAfterStatusChange
};
