const pool = require('../config/db');
const staffStatusService = require('./staffStatusService');
const payrollPagesService = require('./payrollPagesService');

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

function normalizeYear(value) {
    const year = Number.parseInt(value, 10);
    return Number.isFinite(year) && year > 1900 ? year : null;
}

async function getCompanyInfo() {
    const [rows] = await pool.query('SELECT CompanyID, Com_Name, Address, LogoPath FROM tblcominfo LIMIT 1');
    return rows[0] || { CompanyID: 1, Com_Name: 'Human Resource Payroll', Address: '', LogoPath: null };
}

async function getDepartments() {
    const [rows] = await pool.query('SELECT Code, Dept FROM tbldept ORDER BY Dept');
    return rows;
}

async function getStatusRows() {
    const [rows] = await pool.query('SELECT Code, Status FROM tblstatus ORDER BY Status');
    return rows;
}

async function getVehicleInsurers() {
    const [rows] = await pool.query('SELECT InsCode, InsName FROM tblinsurer ORDER BY InsName');
    return rows;
}

async function getGuaranteeBanks() {
    const [rows] = await pool.query('SELECT Code, Bank FROM tblbanks ORDER BY Bank');
    return rows;
}

function buildBioDataFilters(companyId, filters = {}) {
    const normalizedFilters = {
        companyId: Number(companyId) || 1,
        pfNo: normalizeOptionalText(filters.pfNo),
        staffName: normalizeOptionalText(filters.staffName),
        department: normalizeOptionalText(filters.department),
        statusCode: normalizeOptionalText(filters.statusCode),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo)
    };

    const conditions = [
        '(s.CompanyID = ? OR s.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];
    const params = [normalizedFilters.companyId];

    if (normalizedFilters.pfNo) {
        conditions.push('s.PFNo = ?');
        params.push(normalizedFilters.pfNo);
    }

    if (normalizedFilters.staffName) {
        conditions.push('s.SName LIKE ?');
        params.push(`%${normalizedFilters.staffName}%`);
    }

    if (normalizedFilters.department) {
        conditions.push('s.CDept = ?');
        params.push(normalizedFilters.department);
    }

    if (normalizedFilters.statusCode) {
        conditions.push('s.EmpStatus = ?');
        params.push(normalizedFilters.statusCode);
    }

    if (normalizedFilters.dateFrom) {
        conditions.push('DATE(s.DOE) >= ?');
        params.push(normalizedFilters.dateFrom);
    }

    if (normalizedFilters.dateTo) {
        conditions.push('DATE(s.DOE) <= ?');
        params.push(normalizedFilters.dateTo);
    }

    return { normalizedFilters, conditions, params };
}

async function getBioDataReportData({ companyId, filters = {} }) {
    const { normalizedFilters, conditions, params } = buildBioDataFilters(companyId, filters);

    const [company, departments, statuses, rows] = await Promise.all([
        getCompanyInfo(),
        getDepartments(),
        getStatusRows(),
        pool.query(
            `
                SELECT
                    s.PFNo,
                    s.SName,
                    s.DOB,
                    s.DOE,
                    s.DateConfirmed,
                    s.Phone,
                    s.Email,
                    s.Address,
                    s.City,
                    s.AccountNo,
                    s.NASSITNo,
                    s.EmpType,
                    s.Level,
                    s.Notch,
                    d.Dept AS DeptName,
                    g.Grade AS GradeName,
                    j.JobTitle AS JobTitleName,
                    st.Status AS StatusName
                FROM tblstaff s
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                LEFT JOIN tblgrade g
                    ON g.GradeCode = s.CGrade
                LEFT JOIN tbljobtitle j
                    ON j.Code = s.JobTitle
                LEFT JOIN tblstatus st
                    ON st.Code = s.EmpStatus
                   AND (st.CompanyID = s.CompanyID OR st.CompanyID IS NULL)
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY s.SName ASC, s.PFNo ASC
            `,
            params
        )
    ]);

    return {
        company,
        departments,
        statuses,
        rows: rows[0],
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            staffName: normalizedFilters.staffName || '',
            department: normalizedFilters.department || '',
            statusCode: normalizedFilters.statusCode || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || ''
        }
    };
}

function buildVehicleInsuranceFilters(companyId, filters = {}) {
    const normalizedFilters = {
        companyId: Number(companyId) || 1,
        pfNo: normalizeOptionalText(filters.pfNo),
        staffName: normalizeOptionalText(filters.staffName),
        department: normalizeOptionalText(filters.department),
        insurer: normalizeOptionalText(filters.insurer),
        approvalStatus: normalizeOptionalText(filters.approvalStatus),
        expiryFrom: normalizeDate(filters.expiryFrom),
        expiryTo: normalizeDate(filters.expiryTo)
    };

    const conditions = [
        '(i.CompanyID = ? OR i.CompanyID IS NULL)',
        "i.InsType = '02'",
        staffStatusService.getActiveStaffFilter('s')
    ];
    const params = [normalizedFilters.companyId];

    if (normalizedFilters.pfNo) {
        conditions.push('i.PFNo = ?');
        params.push(normalizedFilters.pfNo);
    }

    if (normalizedFilters.staffName) {
        conditions.push('s.SName LIKE ?');
        params.push(`%${normalizedFilters.staffName}%`);
    }

    if (normalizedFilters.department) {
        conditions.push('s.CDept = ?');
        params.push(normalizedFilters.department);
    }

    if (normalizedFilters.insurer) {
        conditions.push('i.Insurer = ?');
        params.push(normalizedFilters.insurer);
    }

    if (normalizedFilters.approvalStatus === 'pending') {
        conditions.push('COALESCE(i.Approved, 0) = 0');
    } else if (normalizedFilters.approvalStatus === 'approved') {
        conditions.push('COALESCE(i.Approved, 0) IN (-1, 1)');
    } else if (normalizedFilters.approvalStatus === 'rejected') {
        conditions.push('COALESCE(i.Approved, 0) = 2');
    }

    if (normalizedFilters.expiryFrom) {
        conditions.push('DATE(i.DateExp) >= ?');
        params.push(normalizedFilters.expiryFrom);
    }

    if (normalizedFilters.expiryTo) {
        conditions.push('DATE(i.DateExp) <= ?');
        params.push(normalizedFilters.expiryTo);
    }

    return { normalizedFilters, conditions, params };
}

async function getVehicleInsuranceReportData({ companyId, filters = {} }) {
    const { normalizedFilters, conditions, params } = buildVehicleInsuranceFilters(companyId, filters);

    const [company, departments, insurers, rows] = await Promise.all([
        getCompanyInfo(),
        getDepartments(),
        getVehicleInsurers(),
        pool.query(
            `
                SELECT
                    i.*,
                    s.SName,
                    d.Dept AS DeptName,
                    ins.InsName AS InsurerName,
                    it.InsType AS InsuranceTypeName
                FROM tblinsurance i
                INNER JOIN tblstaff s
                    ON s.PFNo = i.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                LEFT JOIN tblinsurer ins
                    ON ins.InsCode = i.Insurer
                LEFT JOIN tblinstype it
                    ON it.InsCode = i.InsType
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY i.DateExp ASC, i.PFNo ASC
            `,
            params
        )
    ]);

    return {
        company,
        departments,
        insurers,
        rows: rows[0],
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            staffName: normalizedFilters.staffName || '',
            department: normalizedFilters.department || '',
            insurer: normalizedFilters.insurer || '',
            approvalStatus: normalizedFilters.approvalStatus || '',
            expiryFrom: normalizedFilters.expiryFrom || '',
            expiryTo: normalizedFilters.expiryTo || ''
        }
    };
}

function buildGuaranteeFilters(companyId, filters = {}) {
    const normalizedFilters = {
        companyId: Number(companyId) || 1,
        pfNo: normalizeOptionalText(filters.pfNo),
        staffName: normalizeOptionalText(filters.staffName),
        department: normalizeOptionalText(filters.department),
        bank: normalizeOptionalText(filters.bank),
        approvalStatus: normalizeOptionalText(filters.approvalStatus),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo)
    };

    const conditions = [
        '(g.CompanyID = ? OR g.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];
    const params = [normalizedFilters.companyId];

    if (normalizedFilters.pfNo) {
        conditions.push('g.PFNO = ?');
        params.push(normalizedFilters.pfNo);
    }

    if (normalizedFilters.staffName) {
        conditions.push('s.SName LIKE ?');
        params.push(`%${normalizedFilters.staffName}%`);
    }

    if (normalizedFilters.department) {
        conditions.push('s.CDept = ?');
        params.push(normalizedFilters.department);
    }

    if (normalizedFilters.bank) {
        conditions.push('g.Bank = ?');
        params.push(normalizedFilters.bank);
    }

    if (normalizedFilters.approvalStatus === 'pending') {
        conditions.push('COALESCE(g.Approved, 0) = 0');
    } else if (normalizedFilters.approvalStatus === 'approved') {
        conditions.push('COALESCE(g.Approved, 0) IN (-1, 1)');
    } else if (normalizedFilters.approvalStatus === 'rejected') {
        conditions.push('COALESCE(g.Approved, 0) = 2');
    }

    if (normalizedFilters.dateFrom) {
        conditions.push('DATE(g.LoanDate) >= ?');
        params.push(normalizedFilters.dateFrom);
    }

    if (normalizedFilters.dateTo) {
        conditions.push('DATE(g.LoanDate) <= ?');
        params.push(normalizedFilters.dateTo);
    }

    return { normalizedFilters, conditions, params };
}

async function getGuaranteesReportData({ companyId, filters = {} }) {
    const { normalizedFilters, conditions, params } = buildGuaranteeFilters(companyId, filters);

    const [company, departments, banks, rows] = await Promise.all([
        getCompanyInfo(),
        getDepartments(),
        getGuaranteeBanks(),
        pool.query(
            `
                SELECT
                    g.*,
                    s.SName,
                    d.Dept AS DeptName,
                    b.Bank AS BankName
                FROM tblbankguarantee g
                INNER JOIN tblstaff s
                    ON s.PFNo = g.PFNO
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                LEFT JOIN tblbanks b
                    ON b.Code = g.Bank
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY g.LoanDate DESC, g.PFNO ASC
            `,
            params
        )
    ]);

    const totals = rows[0].reduce((summary, row) => {
        summary.totalGuarantees += 1;
        summary.totalAmount += Number(row.LoanAmount || 0);
        summary.totalMonthly += Number(row.Monthly || 0);
        return summary;
    }, { totalGuarantees: 0, totalAmount: 0, totalMonthly: 0 });

    return {
        company,
        departments,
        banks,
        rows: rows[0],
        totals,
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            staffName: normalizedFilters.staffName || '',
            department: normalizedFilters.department || '',
            bank: normalizedFilters.bank || '',
            approvalStatus: normalizedFilters.approvalStatus || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || ''
        }
    };
}

function buildActingFilters(companyId, filters = {}) {
    const normalizedFilters = {
        companyId: Number(companyId) || 1,
        pfNo: normalizeOptionalText(filters.pfNo),
        staffName: normalizeOptionalText(filters.staffName),
        department: normalizeOptionalText(filters.department),
        approvalStatus: normalizeOptionalText(filters.approvalStatus),
        closedStatus: normalizeOptionalText(filters.closedStatus),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo)
    };

    const conditions = [
        '(a.CompanyID = ? OR a.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];
    const params = [normalizedFilters.companyId];

    if (normalizedFilters.pfNo) {
        conditions.push('a.PFNO = ?');
        params.push(normalizedFilters.pfNo);
    }

    if (normalizedFilters.staffName) {
        conditions.push('s.SName LIKE ?');
        params.push(`%${normalizedFilters.staffName}%`);
    }

    if (normalizedFilters.department) {
        conditions.push('(s.CDept = ? OR a.A_Dept = ?)');
        params.push(normalizedFilters.department, normalizedFilters.department);
    }

    if (normalizedFilters.approvalStatus === 'pending') {
        conditions.push('COALESCE(a.Approved, 0) = 0');
    } else if (normalizedFilters.approvalStatus === 'approved') {
        conditions.push('COALESCE(a.Approved, 0) IN (-1, 1)');
    } else if (normalizedFilters.approvalStatus === 'rejected') {
        conditions.push('COALESCE(a.Approved, 0) = 2');
    }

    if (normalizedFilters.closedStatus === 'open') {
        conditions.push('COALESCE(a.Closed, 0) = 0');
    } else if (normalizedFilters.closedStatus === 'closed') {
        conditions.push('COALESCE(a.Closed, 0) <> 0');
    }

    if (normalizedFilters.dateFrom) {
        conditions.push('DATE(a.SDate) >= ?');
        params.push(normalizedFilters.dateFrom);
    }

    if (normalizedFilters.dateTo) {
        conditions.push('DATE(a.EDate) <= ?');
        params.push(normalizedFilters.dateTo);
    }

    return { normalizedFilters, conditions, params };
}

async function getActingAllowanceReportData({ companyId, filters = {} }) {
    const { normalizedFilters, conditions, params } = buildActingFilters(companyId, filters);

    const [company, departments, rows] = await Promise.all([
        getCompanyInfo(),
        getDepartments(),
        pool.query(
            `
                SELECT
                    a.*,
                    s.SName,
                    d.Dept AS CurrentDeptName,
                    ad.Dept AS ActingDeptName,
                    cg.Grade AS CurrentGradeName,
                    ag.Grade AS ActingGradeName,
                    cj.JobTitle AS CurrentJobTitleName,
                    aj.JobTitle AS ActingJobTitleName
                FROM tblacting a
                INNER JOIN tblstaff s
                    ON s.PFNo = a.PFNO
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                LEFT JOIN tbldept ad
                    ON ad.Code = a.A_Dept
                LEFT JOIN tblgrade cg
                    ON cg.GradeCode = a.C_Grade
                LEFT JOIN tblgrade ag
                    ON ag.GradeCode = a.A_Grade
                LEFT JOIN tbljobtitle cj
                    ON cj.Code = a.JobTitle
                LEFT JOIN tbljobtitle aj
                    ON aj.Code = a.A_JobTitle
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY a.SDate DESC, a.PFNO ASC
            `,
            params
        )
    ]);

    const totals = rows[0].reduce((summary, row) => {
        summary.totalRecords += 1;
        summary.totalActingSalary += Number(row.A_Salary || 0);
        summary.totalGradeDifference += Number(row.GradeDifference || 0);
        return summary;
    }, { totalRecords: 0, totalActingSalary: 0, totalGradeDifference: 0 });

    return {
        company,
        departments,
        rows: rows[0],
        totals,
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            staffName: normalizedFilters.staffName || '',
            department: normalizedFilters.department || '',
            approvalStatus: normalizedFilters.approvalStatus || '',
            closedStatus: normalizedFilters.closedStatus || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || ''
        }
    };
}

function buildAttendanceFilters(companyId, filters = {}) {
    const normalizedFilters = {
        companyId: Number(companyId) || 1,
        pfNo: normalizeOptionalText(filters.pfNo),
        staffName: normalizeOptionalText(filters.staffName),
        department: normalizeOptionalText(filters.department),
        workStatus: normalizeOptionalText(filters.workStatus),
        approvalStatus: normalizeOptionalText(filters.approvalStatus),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo)
    };

    const conditions = [
        '(a.CompanyID = ? OR a.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];
    const params = [normalizedFilters.companyId];

    if (normalizedFilters.pfNo) {
        conditions.push('a.PFNo = ?');
        params.push(normalizedFilters.pfNo);
    }

    if (normalizedFilters.staffName) {
        conditions.push('COALESCE(s.SName, a.SNAme) LIKE ?');
        params.push(`%${normalizedFilters.staffName}%`);
    }

    if (normalizedFilters.department) {
        conditions.push('s.CDept = ?');
        params.push(normalizedFilters.department);
    }

    if (normalizedFilters.workStatus) {
        conditions.push('a.Work_Status = ?');
        params.push(normalizedFilters.workStatus);
    }

    if (normalizedFilters.approvalStatus === 'pending') {
        conditions.push('COALESCE(a.Approved, 0) = 0');
    } else if (normalizedFilters.approvalStatus === 'approved') {
        conditions.push('COALESCE(a.Approved, 0) IN (-1, 1)');
    } else if (normalizedFilters.approvalStatus === 'rejected') {
        conditions.push('COALESCE(a.Approved, 0) = 2');
    }

    if (normalizedFilters.dateFrom) {
        conditions.push('DATE(a.Work_Day) >= ?');
        params.push(normalizedFilters.dateFrom);
    }

    if (normalizedFilters.dateTo) {
        conditions.push('DATE(a.Work_Day) <= ?');
        params.push(normalizedFilters.dateTo);
    }

    return { normalizedFilters, conditions, params };
}

async function getAttendanceStatusOptions() {
    const [rows] = await pool.query(
        `
            SELECT DISTINCT Work_Status
            FROM tblattendance
            WHERE Work_Status IS NOT NULL
              AND Work_Status <> ''
            ORDER BY Work_Status
        `
    );

    return rows;
}

async function getAttendanceReportData({ companyId, filters = {} }) {
    const { normalizedFilters, conditions, params } = buildAttendanceFilters(companyId, filters);

    const [company, departments, statuses, rows] = await Promise.all([
        getCompanyInfo(),
        getDepartments(),
        getAttendanceStatusOptions(),
        pool.query(
            `
                SELECT
                    a.*,
                    COALESCE(s.SName, a.SNAme) AS StaffName,
                    d.Dept AS DeptName
                FROM tblattendance a
                INNER JOIN tblstaff s
                    ON s.PFNo = a.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY a.Work_Day DESC, a.PFNo ASC
            `,
            params
        )
    ]);

    const totals = rows[0].reduce((summary, row) => {
        summary.totalRows += 1;
        if (Number(row.Approved || 0) === 0) {
            summary.pending += 1;
        } else if (Number(row.Approved || 0) === 2) {
            summary.rejected += 1;
        } else {
            summary.approved += 1;
        }
        return summary;
    }, { totalRows: 0, pending: 0, approved: 0, rejected: 0 });

    return {
        company,
        departments,
        statuses,
        rows: rows[0],
        totals,
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            staffName: normalizedFilters.staffName || '',
            department: normalizedFilters.department || '',
            workStatus: normalizedFilters.workStatus || '',
            approvalStatus: normalizedFilters.approvalStatus || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || ''
        }
    };
}

async function getYearlyPaymentsReportData({ companyId, filters = {} }) {
    return payrollPagesService.getYearlyPaymentsReportData({ companyId, filters });
}

module.exports = {
    getBioDataReportData,
    getVehicleInsuranceReportData,
    getGuaranteesReportData,
    getActingAllowanceReportData,
    getAttendanceReportData,
    getYearlyPaymentsReportData
};
