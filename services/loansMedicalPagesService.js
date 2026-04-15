const pool = require('../config/db');
const staffStatusService = require('./staffStatusService');

function normalizeText(value) {
    const text = String(value || '').trim();
    return text || '';
}

function normalizeOptionalText(value) {
    const text = normalizeText(value);
    return text || null;
}

function normalizeDate(value) {
    const text = normalizeText(value);
    if (!text) {
        return null;
    }

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString().slice(0, 10);
}

async function getCompanyInfo() {
    const [rows] = await pool.query('SELECT CompanyID, Com_Name, Address, LogoPath FROM tblcominfo LIMIT 1');
    return rows[0] || { CompanyID: 1, Com_Name: 'Human Resource Payroll', Address: '', LogoPath: null };
}

async function getDepartments() {
    const [rows] = await pool.query('SELECT Code, Dept FROM tbldept ORDER BY Dept');
    return rows;
}

async function getLoanCodes() {
    const [rows] = await pool.query('SELECT TCode, TransName FROM tblloancode ORDER BY TransName');
    return rows;
}

async function getMedicalCodes() {
    const [rows] = await pool.query('SELECT TCode, TransName FROM tblmcode ORDER BY TransName');
    return rows;
}

async function getActiveStaffList() {
    const [rows] = await pool.query(
        staffStatusService.getActiveStaffQuery({
            fields: 'PFNo, SName, CDept, CompanyID',
            orderBy: 'PFNo'
        })
    );

    return rows;
}

function applySharedStaffFilters(conditions, params, filters, tableAlias, staffAlias = 's') {
    if (filters.pfNo) {
        conditions.push(`${tableAlias}.PFNo = ?`);
        params.push(filters.pfNo);
    }

    if (filters.staffName) {
        conditions.push(`${staffAlias}.SName LIKE ?`);
        params.push(`%${filters.staffName}%`);
    }

    if (filters.department) {
        conditions.push(`${staffAlias}.CDept = ?`);
        params.push(filters.department);
    }

    if (filters.dateFrom) {
        conditions.push(`DATE(${tableAlias}.EntryDate) >= ?`);
        params.push(filters.dateFrom);
    }

    if (filters.dateTo) {
        conditions.push(`DATE(${tableAlias}.EntryDate) <= ?`);
        params.push(filters.dateTo);
    }
}

async function getLoanBalanceEnquiryData({ companyId, filters = {} }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        staffName: normalizeOptionalText(filters.staffName),
        department: normalizeOptionalText(filters.department),
        loanType: normalizeOptionalText(filters.loanType),
        loanStatus: normalizeOptionalText(filters.loanStatus),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo)
    };

    const conditions = [
        '(l.CompanyID = ? OR l.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s'),
        "COALESCE(l.LTrans, '') NOT IN ('03', '04')"
    ];
    const params = [resolvedCompanyId];

    applySharedStaffFilters(conditions, params, normalizedFilters, 'l');

    if (normalizedFilters.loanType) {
        conditions.push('l.LTrans = ?');
        params.push(normalizedFilters.loanType);
    }

    if (normalizedFilters.loanStatus === 'active') {
        conditions.push('COALESCE(l.Repaid, 0) = 0');
        conditions.push('COALESCE(l.Expired, 0) = 0');
        conditions.push('COALESCE(l.LoanBal, 0) > 0');
    } else if (normalizedFilters.loanStatus === 'completed') {
        conditions.push('(COALESCE(l.Repaid, 0) <> 0 OR COALESCE(l.Expired, 0) <> 0 OR COALESCE(l.LoanBal, 0) <= 0)');
    }

    const [company, departments, loanCodes, staffList, rowsResult] = await Promise.all([
        getCompanyInfo(),
        getDepartments(),
        getLoanCodes(),
        getActiveStaffList(),
        pool.query(
            `
                SELECT
                    l.TransNo,
                    l.EntryDate,
                    l.PFNo,
                    s.SName,
                    d.Dept AS DeptName,
                    lc.TransName AS LoanTypeName,
                    l.Amount,
                    l.LoanBal,
                    l.MonthlyRepayment,
                    l.Interest,
                    l.MonthlyInt,
                    l.StartDate,
                    l.ExpDate,
                    l.Repaid,
                    l.Expired,
                    l.RepaidAmount,
                    l.Approved
                FROM tblloan l
                LEFT JOIN tblstaff s
                    ON s.PFNo = l.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                LEFT JOIN tblloancode lc
                    ON lc.TCode = l.LTrans
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY l.EntryDate DESC, l.PFNo ASC
                LIMIT 300
            `,
            params
        )
    ]);

    return {
        company,
        departments,
        loanCodes,
        staffList,
        rows: rowsResult[0],
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            staffName: normalizedFilters.staffName || '',
            department: normalizedFilters.department || '',
            loanType: normalizedFilters.loanType || '',
            loanStatus: normalizedFilters.loanStatus || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || ''
        }
    };
}

async function getMedicalEnquiryData({ companyId, filters = {} }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        staffName: normalizeOptionalText(filters.staffName),
        department: normalizeOptionalText(filters.department),
        medicalCode: normalizeOptionalText(filters.medicalCode),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo)
    };

    const conditions = [
        '(m.CompanyID = ? OR m.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];
    const params = [resolvedCompanyId];

    applySharedStaffFilters(conditions, params, normalizedFilters, 'm');

    if (normalizedFilters.medicalCode) {
        conditions.push('m.MCode = ?');
        params.push(normalizedFilters.medicalCode);
    }

    const [company, departments, medicalCodes, staffList, rowsResult] = await Promise.all([
        getCompanyInfo(),
        getDepartments(),
        getMedicalCodes(),
        getActiveStaffList(),
        pool.query(
            `
                SELECT
                    m.TransNo,
                    m.EntryDate,
                    m.PFNo,
                    s.SName,
                    d.Dept AS DeptName,
                    m.Dependant,
                    m.MCode,
                    mc.TransName AS MedicalDescription,
                    m.Amount,
                    m.PicturePath
                FROM tblmedical m
                LEFT JOIN tblstaff s
                    ON s.PFNo = m.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                LEFT JOIN tblmcode mc
                    ON mc.TCode = m.MCode
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY m.EntryDate DESC, m.PFNo ASC
                LIMIT 300
            `,
            params
        )
    ]);

    return {
        company,
        departments,
        medicalCodes,
        staffList,
        rows: rowsResult[0],
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            staffName: normalizedFilters.staffName || '',
            department: normalizedFilters.department || '',
            medicalCode: normalizedFilters.medicalCode || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || ''
        }
    };
}

async function getLoanReportData({ companyId, filters = {} }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        staffName: normalizeOptionalText(filters.staffName),
        department: normalizeOptionalText(filters.department),
        loanType: normalizeOptionalText(filters.loanType),
        loanStatus: normalizeOptionalText(filters.loanStatus),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo)
    };

    const conditions = [
        '(l.CompanyID = ? OR l.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s'),
        "COALESCE(l.LTrans, '') NOT IN ('03', '04')"
    ];
    const params = [resolvedCompanyId];

    applySharedStaffFilters(conditions, params, normalizedFilters, 'l');

    if (normalizedFilters.loanType) {
        conditions.push('l.LTrans = ?');
        params.push(normalizedFilters.loanType);
    }

    if (normalizedFilters.loanStatus === 'active') {
        conditions.push('COALESCE(l.Repaid, 0) = 0');
        conditions.push('COALESCE(l.Expired, 0) = 0');
        conditions.push('COALESCE(l.LoanBal, 0) > 0');
    } else if (normalizedFilters.loanStatus === 'completed') {
        conditions.push('(COALESCE(l.Repaid, 0) <> 0 OR COALESCE(l.Expired, 0) <> 0 OR COALESCE(l.LoanBal, 0) <= 0)');
    }

    const [company, departments, loanCodes, rowsResult] = await Promise.all([
        getCompanyInfo(),
        getDepartments(),
        getLoanCodes(),
        pool.query(
            `
                SELECT
                    l.TransNo,
                    l.EntryDate,
                    l.PFNo,
                    s.SName,
                    d.Dept AS DeptName,
                    lc.TransName AS LoanTypeName,
                    l.Amount,
                    l.LoanBal,
                    l.RepaidAmount,
                    l.MonthlyRepayment,
                    l.Interest,
                    l.MonthlyInt,
                    l.StartDate,
                    l.ExpDate,
                    l.Duration,
                    l.DurationBal,
                    l.Approved,
                    l.Repaid,
                    l.Expired,
                    COALESCE(repyt.TotalPayrollDeductions, 0) AS TotalPayrollDeductions,
                    COALESCE(repyt.LastDeductionDate, NULL) AS LastDeductionDate,
                    COALESCE(repay.PendingRepayments, 0) AS PendingRepayments,
                    COALESCE(repay.ApprovedRepayments, 0) AS ApprovedRepayments
                FROM tblloan l
                LEFT JOIN tblstaff s
                    ON s.PFNo = l.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                LEFT JOIN tblloancode lc
                    ON lc.TCode = l.LTrans
                LEFT JOIN (
                    SELECT
                        TransRef,
                        SUM(COALESCE(DAmount, 0)) AS TotalPayrollDeductions,
                        MAX(DeductionDate) AS LastDeductionDate
                    FROM tblloanrepyt
                    GROUP BY TransRef
                ) repyt
                    ON repyt.TransRef = l.TransNo
                LEFT JOIN (
                    SELECT
                        LoanTransNo,
                        SUM(CASE WHEN COALESCE(Approved, 0) = 0 THEN Amount ELSE 0 END) AS PendingRepayments,
                        SUM(CASE WHEN COALESCE(Approved, 0) IN (-1, 1) THEN Amount ELSE 0 END) AS ApprovedRepayments
                    FROM tblloanrepayment
                    GROUP BY LoanTransNo
                ) repay
                    ON repay.LoanTransNo = l.TransNo
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY l.EntryDate DESC, l.PFNo ASC
                LIMIT 300
            `,
            params
        )
    ]);

    const rows = rowsResult[0];
    const totals = {
        totalLoans: rows.length,
        totalAmount: rows.reduce((sum, row) => sum + Number(row.Amount || 0), 0),
        totalOutstanding: rows.reduce((sum, row) => sum + Number(row.LoanBal || 0), 0),
        totalMonthlyRepayment: rows.reduce((sum, row) => sum + Number(row.MonthlyRepayment || 0), 0)
    };

    return {
        company,
        departments,
        loanCodes,
        rows,
        totals,
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            staffName: normalizedFilters.staffName || '',
            department: normalizedFilters.department || '',
            loanType: normalizedFilters.loanType || '',
            loanStatus: normalizedFilters.loanStatus || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || ''
        }
    };
}

module.exports = {
    getLoanBalanceEnquiryData,
    getMedicalEnquiryData,
    getLoanReportData
};
