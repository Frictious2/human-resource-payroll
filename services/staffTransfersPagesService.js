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

function normalizeInteger(value) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? number : null;
}

function normalizeDecimal(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

async function getCompanyInfo() {
    const [rows] = await pool.query('SELECT CompanyID, Com_Name, Address, LogoPath FROM tblcominfo LIMIT 1');
    return rows[0] || { CompanyID: 1, Com_Name: 'Human Resource Payroll', Address: '', LogoPath: null };
}

async function getDepartments() {
    const [rows] = await pool.query('SELECT Code, Dept FROM tbldept ORDER BY Dept');
    return rows;
}

async function getActiveStaffList() {
    const [rows] = await pool.query(
        staffStatusService.getActiveStaffQuery({
            fields: 'PFNo, SName, CDept, CGrade, JobTitle, CompanyID',
            orderBy: 'PFNo'
        })
    );

    return rows;
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

    return rows.map((row) => row.Work_Status).filter(Boolean);
}

async function getAttendancePageData({ companyId, filters = {} }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        workStatus: normalizeOptionalText(filters.workStatus),
        workDay: normalizeDate(filters.workDay),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo)
    };

    const conditions = ['(a.CompanyID = ? OR a.CompanyID IS NULL)'];
    const params = [resolvedCompanyId];

    if (normalizedFilters.pfNo) {
        conditions.push('a.PFNo = ?');
        params.push(normalizedFilters.pfNo);
    }

    if (normalizedFilters.workStatus) {
        conditions.push('a.Work_Status = ?');
        params.push(normalizedFilters.workStatus);
    }

    if (normalizedFilters.workDay) {
        conditions.push('DATE(a.Work_Day) = ?');
        params.push(normalizedFilters.workDay);
    }

    if (normalizedFilters.dateFrom) {
        conditions.push('DATE(a.Work_Day) >= ?');
        params.push(normalizedFilters.dateFrom);
    }

    if (normalizedFilters.dateTo) {
        conditions.push('DATE(a.Work_Day) <= ?');
        params.push(normalizedFilters.dateTo);
    }

    const [company, staffList, statusOptions, rowsResult] = await Promise.all([
        getCompanyInfo(),
        getActiveStaffList(),
        getAttendanceStatusOptions(),
        pool.query(
            `
                SELECT
                    a.*,
                    COALESCE(s.SName, a.SNAme) AS StaffName,
                    COALESCE(d.Dept, a.Dept) AS DeptName
                FROM tblattendance a
                LEFT JOIN tblstaff s
                    ON s.PFNo = a.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY a.Work_Day DESC, a.PFNo ASC
                LIMIT 250
            `,
            params
        )
    ]);

    return {
        company,
        staffList,
        statusOptions,
        rows: rowsResult[0],
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            workStatus: normalizedFilters.workStatus || '',
            workDay: normalizedFilters.workDay || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || ''
        }
    };
}

async function saveAttendanceRecord({
    companyId,
    keyedInBy,
    pfNo,
    workDay,
    workStatus,
    timeIn,
    timeOut
}) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedPfNo = normalizeText(pfNo);
    const normalizedWorkDay = normalizeDate(workDay);
    const normalizedWorkStatus = normalizeText(workStatus);

    if (!normalizedPfNo || !normalizedWorkDay || !normalizedWorkStatus) {
        throw createError('PFNo, work day, and work status are required.');
    }

    const [staffRows] = await pool.query(
        `SELECT PFNo, SName, CDept
         FROM tblstaff
         WHERE PFNo = ?
           AND ${staffStatusService.getActiveStaffFilter('tblstaff')}`,
        [normalizedPfNo]
    );

    if (!staffRows.length) {
        throw createError('Selected staff was not found in the active staff list.', 404);
    }

    const staff = staffRows[0];
    const timeInValue = normalizeOptionalText(timeIn) ? `${normalizedWorkDay} ${normalizeText(timeIn)}:00` : null;
    const timeOutValue = normalizeOptionalText(timeOut) ? `${normalizedWorkDay} ${normalizeText(timeOut)}:00` : null;
    const checkoutFlag = timeOutValue ? 1 : 0;

    const [existingRows] = await pool.query(
        `
            SELECT PFNo
            FROM tblattendance
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND PFNo = ?
              AND DATE(Work_Day) = ?
            LIMIT 1
        `,
        [resolvedCompanyId, normalizedPfNo, normalizedWorkDay]
    );

    if (existingRows.length > 0) {
        await pool.query(
            `
                UPDATE tblattendance
                SET SNAme = ?,
                    Dept = ?,
                    Work_Status = ?,
                    Time_in = ?,
                    Check_Out = ?,
                    Time_out = ?,
                    KeyedinBy = ?,
                    DateKeyedIn = NOW(),
                    TimeKeyedin = NOW(),
                    Approved = 0
                WHERE (CompanyID = ? OR CompanyID IS NULL)
                  AND PFNo = ?
                  AND DATE(Work_Day) = ?
            `,
            [staff.SName, staff.CDept, normalizedWorkStatus, timeInValue, checkoutFlag, timeOutValue, keyedInBy || 'Data Entry Officer', resolvedCompanyId, normalizedPfNo, normalizedWorkDay]
        );
    } else {
        await pool.query(
            `
                INSERT INTO tblattendance (
                    PFNo, SNAme, Dept, Work_Day, Work_Status, Time_in, Check_Out, Time_out,
                    KeyedinBy, TimeKeyedin, DateKeyedIn, Approved, CompanyID
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), 0, ?)
            `,
            [normalizedPfNo, staff.SName, staff.CDept, normalizedWorkDay, normalizedWorkStatus, timeInValue, checkoutFlag, timeOutValue, keyedInBy || 'Data Entry Officer', resolvedCompanyId]
        );
    }
}

function buildTransferPromotionConditions(filters, resolvedCompanyId, useActiveOnly) {
    const transferConditions = ['(t.CompanyID = ? OR t.CompanyID IS NULL)'];
    const promotionConditions = ['(p.CompanyID = ? OR p.CompanyID IS NULL)'];
    const transferParams = [resolvedCompanyId];
    const promotionParams = [resolvedCompanyId];

    if (filters.pfNo) {
        transferConditions.push('t.PFNO = ?');
        promotionConditions.push('p.PFNO = ?');
        transferParams.push(filters.pfNo);
        promotionParams.push(filters.pfNo);
    }

    if (filters.staffName) {
        transferConditions.push('s.SName LIKE ?');
        promotionConditions.push('s.SName LIKE ?');
        const namePattern = `%${filters.staffName}%`;
        transferParams.push(namePattern);
        promotionParams.push(namePattern);
    }

    if (filters.department) {
        transferConditions.push('(t.PrevDept = ? OR t.TDept = ? OR s.CDept = ?)');
        promotionConditions.push('s.CDept = ?');
        transferParams.push(filters.department, filters.department, filters.department);
        promotionParams.push(filters.department);
    }

    if (filters.activity) {
        const activityValue = normalizeInteger(filters.activity);
        if (activityValue !== null) {
            transferConditions.push('t.Activity = ?');
            promotionConditions.push('p.Activity = ?');
            transferParams.push(activityValue);
            promotionParams.push(activityValue);
        }
    }

    if (filters.status) {
        if (filters.status === 'pending') {
            transferConditions.push('COALESCE(t.approved, 0) = 0');
            promotionConditions.push('COALESCE(p.Approved, 0) = 0');
        } else if (filters.status === 'approved') {
            transferConditions.push('COALESCE(t.approved, 0) IN (-1, 1)');
            promotionConditions.push('COALESCE(p.Approved, 0) IN (-1, 1)');
        } else if (filters.status === 'rejected') {
            transferConditions.push('COALESCE(t.approved, 0) = 2');
            promotionConditions.push('COALESCE(p.Approved, 0) = 2');
        }
    }

    if (filters.dateFrom) {
        transferConditions.push('DATE(t.TDate) >= ?');
        promotionConditions.push('DATE(p.PDate) >= ?');
        transferParams.push(filters.dateFrom);
        promotionParams.push(filters.dateFrom);
    }

    if (filters.dateTo) {
        transferConditions.push('DATE(t.TDate) <= ?');
        promotionConditions.push('DATE(p.PDate) <= ?');
        transferParams.push(filters.dateTo);
        promotionParams.push(filters.dateTo);
    }

    if (useActiveOnly) {
        transferConditions.push(staffStatusService.getActiveStaffFilter('s'));
        promotionConditions.push(staffStatusService.getActiveStaffFilter('s'));
    }

    return {
        transferWhere: transferConditions.join('\n                  AND '),
        promotionWhere: promotionConditions.join('\n                  AND '),
        params: [...transferParams, ...promotionParams]
    };
}

async function getTransferPromotionEnquiryData({ companyId, filters = {}, useActiveOnly = true }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        staffName: normalizeOptionalText(filters.staffName),
        department: normalizeOptionalText(filters.department),
        activity: normalizeOptionalText(filters.activity),
        status: normalizeOptionalText(filters.status),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo)
    };

    const { transferWhere, promotionWhere, params } = buildTransferPromotionConditions(normalizedFilters, resolvedCompanyId, useActiveOnly);

    const [company, departments, rowsResult] = await Promise.all([
        getCompanyInfo(),
        getDepartments(),
        pool.query(
            `
                SELECT *
                FROM (
                    SELECT
                        'Transfer' AS RecordType,
                        t.PFNO AS PFNo,
                        COALESCE(s.SName, t.SName) AS SName,
                        t.TDate AS EffectiveDate,
                        dp.Dept AS PreviousValue,
                        dt.Dept AS NewValue,
                        NULL AS NewJobTitle,
                        t.Activity,
                        t.approved AS Approved,
                        t.approvedby AS ApprovedBy,
                        t.dateapproved AS DateApproved,
                        s.CDept AS CurrentDept
                    FROM tbltransfer t
                    LEFT JOIN tblstaff s
                        ON s.PFNo = t.PFNO
                    LEFT JOIN tbldept dp
                        ON dp.Code = t.PrevDept
                    LEFT JOIN tbldept dt
                        ON dt.Code = t.TDept
                    WHERE ${transferWhere}

                    UNION ALL

                    SELECT
                        'Promotion' AS RecordType,
                        p.PFNO AS PFNo,
                        COALESCE(s.SName, p.PFNO) AS SName,
                        p.PDate AS EffectiveDate,
                        pg.Grade AS PreviousValue,
                        cg.Grade AS NewValue,
                        jt.JobTitle AS NewJobTitle,
                        p.Activity,
                        p.Approved AS Approved,
                        p.Approvedby AS ApprovedBy,
                        p.Dateapproved AS DateApproved,
                        s.CDept AS CurrentDept
                    FROM tblpromotions p
                    LEFT JOIN tblstaff s
                        ON s.PFNo = p.PFNO
                    LEFT JOIN tblgrade pg
                        ON pg.GradeCode = p.PrevGrade
                    LEFT JOIN tblgrade cg
                        ON cg.GradeCode = p.CGrade
                    LEFT JOIN tbljobtitle jt
                        ON jt.Code = p.JobTitle
                    WHERE ${promotionWhere}
                ) enquiry_rows
                ORDER BY EffectiveDate DESC, PFNo ASC
                LIMIT 300
            `,
            params
        )
    ]);

    return {
        company,
        departments,
        rows: rowsResult[0],
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            staffName: normalizedFilters.staffName || '',
            department: normalizedFilters.department || '',
            activity: normalizedFilters.activity || '',
            status: normalizedFilters.status || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || ''
        }
    };
}

async function getInsuranceLookups() {
    const [staffList, insuranceTypes, insurers] = await Promise.all([
        getActiveStaffList(),
        pool.query(
            `
                SELECT InsCode, InsType
                FROM tblinstype
                WHERE InsCode = '02'
                ORDER BY InsCode
            `
        ),
        pool.query('SELECT InsCode, InsName FROM tblinsurer ORDER BY InsName')
    ]);

    return {
        staffList,
        insuranceTypes: insuranceTypes[0],
        insurers: insurers[0]
    };
}

async function getVehicleInsurancePageData({ companyId, filters = {} }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        insurer: normalizeOptionalText(filters.insurer),
        insType: normalizeOptionalText(filters.insType),
        status: normalizeOptionalText(filters.status)
    };

    const conditions = ['(i.CompanyID = ? OR i.CompanyID IS NULL)', "i.InsType = '02'"];
    const params = [resolvedCompanyId];

    if (normalizedFilters.pfNo) {
        conditions.push('i.PFNo = ?');
        params.push(normalizedFilters.pfNo);
    }

    if (normalizedFilters.insurer) {
        conditions.push('i.Insurer = ?');
        params.push(normalizedFilters.insurer);
    }

    if (normalizedFilters.insType) {
        conditions.push('i.InsType = ?');
        params.push(normalizedFilters.insType);
    }

    if (normalizedFilters.status === 'pending') {
        conditions.push('COALESCE(i.Approved, 0) = 0');
    } else if (normalizedFilters.status === 'approved') {
        conditions.push('COALESCE(i.Approved, 0) IN (-1, 1)');
    } else if (normalizedFilters.status === 'rejected') {
        conditions.push('COALESCE(i.Approved, 0) = 2');
    }

    const [company, lookups, rowsResult] = await Promise.all([
        getCompanyInfo(),
        getInsuranceLookups(),
        pool.query(
            `
                SELECT
                    i.*,
                    s.SName,
                    it.InsType AS InsuranceTypeName,
                    ir.InsName AS InsurerName
                FROM tblinsurance i
                LEFT JOIN tblstaff s
                    ON s.PFNo = i.PFNo
                LEFT JOIN tblinstype it
                    ON it.InsCode = i.InsType
                LEFT JOIN tblinsurer ir
                    ON ir.InsCode = i.Insurer
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY COALESCE(i.DateKeyedIn, i.LoanGranted) DESC, i.PFNo ASC
                LIMIT 250
            `,
            params
        )
    ]);

    return {
        company,
        staffList: lookups.staffList,
        insuranceTypes: lookups.insuranceTypes,
        insurers: lookups.insurers,
        rows: rowsResult[0],
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            insurer: normalizedFilters.insurer || '',
            insType: normalizedFilters.insType || '',
            status: normalizedFilters.status || ''
        }
    };
}

async function saveVehicleInsuranceRecord({
    companyId,
    operatorName,
    pfNo,
    insType,
    insurer,
    policyNo,
    loanGranted,
    loanLife,
    insAmount,
    premium,
    premSequence,
    dateExp,
    noOfPayments,
    renewed,
    dateRenewed
}) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedPfNo = normalizeText(pfNo);
    const normalizedInsType = normalizeText(insType);
    const normalizedInsurer = normalizeText(insurer);
    const normalizedPolicyNo = normalizeText(policyNo);
    const normalizedLoanGranted = normalizeDate(loanGranted);
    const normalizedDateExp = normalizeDate(dateExp);
    const normalizedDateRenewed = normalizeDate(dateRenewed);

    if (!normalizedPfNo || !normalizedInsType || !normalizedInsurer || !normalizedPolicyNo) {
        throw createError('PFNo, insurance type, insurer, and policy number are required.');
    }

    const [staffRows] = await pool.query(
        `SELECT PFNo
         FROM tblstaff
         WHERE PFNo = ?
           AND ${staffStatusService.getActiveStaffFilter('tblstaff')}`,
        [normalizedPfNo]
    );

    if (!staffRows.length) {
        throw createError('Selected staff was not found in the active staff list.', 404);
    }

    const [existingRows] = await pool.query(
        `
            SELECT PFNo
            FROM tblinsurance
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND PFNo = ?
              AND InsType = ?
              AND PolNo = ?
            LIMIT 1
        `,
        [resolvedCompanyId, normalizedPfNo, normalizedInsType, normalizedPolicyNo]
    );

    const payload = [
        normalizedInsurer,
        normalizedLoanGranted,
        normalizeInteger(loanLife) || 0,
        0,
        normalizeDecimal(insAmount),
        normalizeText(premSequence) || null,
        normalizeDecimal(premium),
        normalizedDateExp,
        renewed ? 1 : 0,
        normalizeInteger(noOfPayments) || 0,
        normalizedDateRenewed,
        operatorName || 'Data Entry Officer'
    ];

    if (existingRows.length > 0) {
        await pool.query(
            `
                UPDATE tblinsurance
                SET Insurer = ?,
                    LoanGranted = ?,
                    LoanLife = ?,
                    LoanRepaid = ?,
                    InsAmount = ?,
                    PremSequence = ?,
                    Premium = ?,
                    DateExp = ?,
                    Renewed = ?,
                    NoOfPayments = ?,
                    DateRenewed = ?,
                    Operator = ?,
                    DateKeyedIn = NOW(),
                    TimeKeyed = NOW(),
                    Approved = 0
                WHERE (CompanyID = ? OR CompanyID IS NULL)
                  AND PFNo = ?
                  AND InsType = ?
                  AND PolNo = ?
            `,
            [...payload, resolvedCompanyId, normalizedPfNo, normalizedInsType, normalizedPolicyNo]
        );
    } else {
        await pool.query(
            `
                INSERT INTO tblinsurance (
                    PFNo, InsType, Insurer, PolNo, LoanGranted, LoanLife, LoanRepaid,
                    InsAmount, PremSequence, Premium, DateExp, Renewed, NoOfPayments,
                    DateRenewed, Operator, DateKeyedIn, TimeKeyed, Approved, CompanyID
                ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), 0, ?)
            `,
            [
                normalizedPfNo,
                normalizedInsType,
                normalizedInsurer,
                normalizedPolicyNo,
                normalizedLoanGranted,
                normalizeInteger(loanLife) || 0,
                normalizeDecimal(insAmount),
                normalizeText(premSequence) || null,
                normalizeDecimal(premium),
                normalizedDateExp,
                renewed ? 1 : 0,
                normalizeInteger(noOfPayments) || 0,
                normalizedDateRenewed,
                operatorName || 'Data Entry Officer',
                resolvedCompanyId
            ]
        );
    }
}

async function getTrainingEnquiryData({ companyId, filters = {}, useActiveOnly = true }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        course: normalizeOptionalText(filters.course),
        department: normalizeOptionalText(filters.department),
        level: normalizeOptionalText(filters.level),
        type: normalizeOptionalText(filters.type),
        sponsor: normalizeOptionalText(filters.sponsor),
        status: normalizeOptionalText(filters.status),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo)
    };

    const conditions = ['(c.CompanyID = ? OR c.CompanyID IS NULL)'];
    const params = [resolvedCompanyId];

    if (normalizedFilters.pfNo) {
        conditions.push('c.PFNo = ?');
        params.push(normalizedFilters.pfNo);
    }

    if (normalizedFilters.course) {
        conditions.push('c.Course LIKE ?');
        params.push(`%${normalizedFilters.course}%`);
    }

    if (normalizedFilters.department) {
        conditions.push('s.CDept = ?');
        params.push(normalizedFilters.department);
    }

    if (normalizedFilters.level) {
        conditions.push('c.Level = ?');
        params.push(normalizedFilters.level);
    }

    if (normalizedFilters.type) {
        conditions.push('c.Type = ?');
        params.push(normalizedFilters.type);
    }

    if (normalizedFilters.sponsor) {
        conditions.push('c.SponsoredBy = ?');
        params.push(normalizedFilters.sponsor);
    }

    if (normalizedFilters.status === 'pending') {
        conditions.push('COALESCE(c.approved, 0) = 0');
    } else if (normalizedFilters.status === 'approved') {
        conditions.push('COALESCE(c.approved, 0) IN (-1, 1)');
    } else if (normalizedFilters.status === 'rejected') {
        conditions.push('COALESCE(c.approved, 0) = 2');
    }

    if (normalizedFilters.dateFrom) {
        conditions.push('DATE(c.StartDate) >= ?');
        params.push(normalizedFilters.dateFrom);
    }

    if (normalizedFilters.dateTo) {
        conditions.push('DATE(c.StartDate) <= ?');
        params.push(normalizedFilters.dateTo);
    }

    if (useActiveOnly) {
        conditions.push(staffStatusService.getActiveStaffFilter('s'));
    }

    const [company, departments, levels, types, sponsors, rowsResult] = await Promise.all([
        getCompanyInfo(),
        getDepartments(),
        pool.query('SELECT CLCode, CLevel FROM tblcourselevel ORDER BY CLevel'),
        pool.query('SELECT CourseCode, CType FROM tblcoursetype ORDER BY CType'),
        pool.query('SELECT SCode, Sponsor FROM tblcoursesponsor ORDER BY Sponsor'),
        pool.query(
            `
                SELECT
                    c.*,
                    s.SName,
                    d.Dept AS DeptName,
                    cl.CLevel AS LevelName,
                    ct.CType AS TypeName,
                    sp.Sponsor AS SponsorName
                FROM tblcourse c
                LEFT JOIN tblstaff s
                    ON s.PFNo = c.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                LEFT JOIN tblcourselevel cl
                    ON cl.CLCode = c.Level
                LEFT JOIN tblcoursetype ct
                    ON ct.CourseCode = c.Type
                LEFT JOIN tblcoursesponsor sp
                    ON sp.SCode = c.SponsoredBy
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY c.StartDate DESC, c.PFNo ASC
                LIMIT 300
            `,
            params
        )
    ]);

    return {
        company,
        departments,
        levels: levels[0],
        types: types[0],
        sponsors: sponsors[0],
        rows: rowsResult[0],
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            course: normalizedFilters.course || '',
            department: normalizedFilters.department || '',
            level: normalizedFilters.level || '',
            type: normalizedFilters.type || '',
            sponsor: normalizedFilters.sponsor || '',
            status: normalizedFilters.status || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || ''
        }
    };
}

module.exports = {
    getAttendancePageData,
    getTransferPromotionEnquiryData,
    getTrainingEnquiryData,
    getVehicleInsurancePageData,
    saveAttendanceRecord,
    saveVehicleInsuranceRecord
};
