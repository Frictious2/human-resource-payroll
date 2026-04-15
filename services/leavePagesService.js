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

async function getLeaveTypes() {
    const [rows] = await pool.query('SELECT Code, LeaveType FROM tblleavetype ORDER BY LeaveType');
    return rows;
}

async function getActiveStaffList() {
    const [rows] = await pool.query(
        staffStatusService.getActiveStaffQuery({
            fields: 'PFNo, SName, CDept, CGrade, CompanyID',
            orderBy: 'PFNo'
        })
    );

    return rows;
}

function applyLeaveFilters(conditions, params, filters, aliases = { leave: 'l', staff: 's' }) {
    const leaveAlias = aliases.leave;
    const staffAlias = aliases.staff;

    if (filters.pfNo) {
        conditions.push(`${leaveAlias}.PFNO = ?`);
        params.push(filters.pfNo);
    }

    if (filters.staffName) {
        conditions.push(`${staffAlias}.SName LIKE ?`);
        params.push(`%${filters.staffName}%`);
    }

    if (filters.leaveType) {
        conditions.push(`${leaveAlias}.LType = ?`);
        params.push(filters.leaveType);
    }

    if (filters.leaveYear) {
        conditions.push(`${leaveAlias}.LYear = ?`);
        params.push(filters.leaveYear);
    }

    if (filters.department) {
        conditions.push(`${staffAlias}.CDept = ?`);
        params.push(filters.department);
    }

    if (filters.approvedStatus === 'pending') {
        conditions.push(`COALESCE(${leaveAlias}.Approved, 0) = 0`);
    } else if (filters.approvedStatus === 'approved') {
        conditions.push(`COALESCE(${leaveAlias}.Approved, 0) IN (-1, 1)`);
    } else if (filters.approvedStatus === 'rejected') {
        conditions.push(`COALESCE(${leaveAlias}.Approved, 0) = 2`);
    }

    if (filters.resumedStatus === 'resumed') {
        conditions.push(`COALESCE(${leaveAlias}.Resumed, 0) <> 0`);
    } else if (filters.resumedStatus === 'not_resumed') {
        conditions.push(`COALESCE(${leaveAlias}.Resumed, 0) = 0`);
    }

    if (filters.dateFrom) {
        conditions.push(`DATE(${leaveAlias}.StartDate) >= ?`);
        params.push(filters.dateFrom);
    }

    if (filters.dateTo) {
        conditions.push(`DATE(${leaveAlias}.StartDate) <= ?`);
        params.push(filters.dateTo);
    }
}

async function getLeaveReportData({ companyId, filters = {}, currentOnly = false }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        staffName: normalizeOptionalText(filters.staffName),
        leaveType: normalizeOptionalText(filters.leaveType),
        leaveYear: normalizeOptionalText(filters.leaveYear),
        department: normalizeOptionalText(filters.department),
        approvedStatus: normalizeOptionalText(filters.approvedStatus),
        resumedStatus: normalizeOptionalText(filters.resumedStatus),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo),
        currentOnly: String(filters.currentOnly || (currentOnly ? '1' : '')) === '1' ? '1' : ''
    };

    const conditions = [
        '(l.CompanyID = ? OR l.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];
    const params = [resolvedCompanyId];

    applyLeaveFilters(conditions, params, normalizedFilters);

    if (normalizedFilters.currentOnly === '1') {
        conditions.push('COALESCE(l.Approved, 0) IN (-1, 1)');
        conditions.push('COALESCE(l.Recalled, 0) = 0');
        conditions.push('COALESCE(l.Resumed, 0) = 0');
        conditions.push('DATE(l.StartDate) <= CURDATE()');
        conditions.push('DATE(l.ResumptionDate) >= CURDATE()');
    }

    const [company, departments, leaveTypes, staffList, rowsResult] = await Promise.all([
        getCompanyInfo(),
        getDepartments(),
        getLeaveTypes(),
        getActiveStaffList(),
        pool.query(
            `
                SELECT
                    l.*,
                    s.SName,
                    d.Dept AS DeptName,
                    t.LeaveType
                FROM tblleave l
                LEFT JOIN tblstaff s
                    ON s.PFNo = l.PFNO
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                LEFT JOIN tblleavetype t
                    ON t.Code = l.LType
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY l.StartDate DESC, l.PFNO ASC
                LIMIT 300
            `,
            params
        )
    ]);

    return {
        company,
        departments,
        leaveTypes,
        staffList,
        rows: rowsResult[0],
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            staffName: normalizedFilters.staffName || '',
            leaveType: normalizedFilters.leaveType || '',
            leaveYear: normalizedFilters.leaveYear || '',
            department: normalizedFilters.department || '',
            approvedStatus: normalizedFilters.approvedStatus || '',
            resumedStatus: normalizedFilters.resumedStatus || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || '',
            currentOnly: normalizedFilters.currentOnly || ''
        }
    };
}

module.exports = {
    getLeaveReportData
};
