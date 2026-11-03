const pool = require('../config/db');
const staffStatusService = require('./staffStatusService');

const dedupedGradeLookupSql = `
    (
        SELECT GradeCode, MAX(Grade) AS Grade
        FROM tblgrade
        GROUP BY GradeCode
    )
`;

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

function normalizePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePagination(filters = {}) {
    const pageSize = Math.min(normalizePositiveInteger(filters.pageSize, 25), 100);
    const page = normalizePositiveInteger(filters.page, 1);
    return {
        page,
        pageSize,
        offset: (page - 1) * pageSize
    };
}

function buildPagination(page, pageSize, totalRows) {
    const totalPages = Math.max(1, Math.ceil(Number(totalRows || 0) / pageSize));
    return {
        page,
        pageSize,
        totalRows: Number(totalRows || 0),
        totalPages,
        hasPrevious: page > 1,
        hasNext: page < totalPages,
        previousPage: page > 1 ? page - 1 : 1,
        nextPage: page < totalPages ? page + 1 : totalPages
    };
}

async function getCompanyInfo(companyId) {
    const [rows] = await pool.query(
        `
            SELECT CompanyID, Com_Name, Address, LogoPath
            FROM tblcominfo
            WHERE (CompanyID = ? OR CompanyID IS NULL)
            LIMIT 1
        `,
        [companyId]
    );

    return rows[0] || { CompanyID: companyId, Com_Name: 'Human Resource Payroll', Address: '', LogoPath: null };
}

async function getDashboardData({ companyId, entityScope }) {
    const [company] = await Promise.all([getCompanyInfo(companyId)]);

    const [activeStaffRows, onLeaveRows, attendanceRows, trainingRows, recentTransferRows] = await Promise.all([
        pool.query(
            `
                SELECT COUNT(*) AS count
                FROM tblstaff s
                WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND ${staffStatusService.getActiveStaffFilter('s')}
            `,
            [companyId]
        ),
        pool.query(
            `
                SELECT COUNT(DISTINCT l.PFNO) AS count
                FROM tblleave l
                INNER JOIN tblstaff s
                    ON s.PFNo = l.PFNO
                WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
                  AND (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND ${staffStatusService.getActiveStaffFilter('s')}
                  AND COALESCE(l.Approved, 0) IN (-1, 1)
                  AND COALESCE(l.Recalled, 0) = 0
                  AND COALESCE(l.Resumed, 0) = 0
                  AND DATE(l.StartDate) <= CURDATE()
                  AND DATE(l.ResumptionDate) >= CURDATE()
            `,
            [companyId, companyId]
        ),
        pool.query(
            `
                SELECT COUNT(*) AS count
                FROM tblattendance a
                INNER JOIN tblstaff s
                    ON s.PFNo = a.PFNo
                WHERE (a.CompanyID = ? OR a.CompanyID IS NULL)
                  AND (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND ${staffStatusService.getActiveStaffFilter('s')}
                  AND a.Work_Day IS NOT NULL
                  AND DATE(a.Work_Day) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            `,
            [companyId, companyId]
        ),
        pool.query(
            `
                SELECT COUNT(DISTINCT c.PFNo) AS count
                FROM tblcourse c
                INNER JOIN tblstaff s
                    ON s.PFNo = c.PFNo
                WHERE (c.CompanyID = ? OR c.CompanyID IS NULL)
                  AND (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND ${staffStatusService.getActiveStaffFilter('s')}
                  AND COALESCE(c.approved, 0) IN (-1, 1)
                  AND c.StartDate IS NOT NULL
                  AND DATE(c.StartDate) >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            `,
            [companyId, companyId]
        ),
        pool.query(
            `
                SELECT *
                FROM (
                    SELECT
                        'Transfer' AS RecordType,
                        t.PFNO AS PFNo,
                        s.SName,
                        t.TDate AS EffectiveDate,
                        dp.Dept AS PreviousValue,
                        dt.Dept AS NewValue
                    FROM tbltransfer t
                    INNER JOIN tblstaff s
                        ON s.PFNo = t.PFNO
                    LEFT JOIN tbldept dp
                        ON dp.Code = t.PrevDept
                    LEFT JOIN tbldept dt
                        ON dt.Code = t.TDept
                    WHERE (t.CompanyID = ? OR t.CompanyID IS NULL)
                      AND (s.CompanyID = ? OR s.CompanyID IS NULL)
                      AND ${staffStatusService.getActiveStaffFilter('s')}

                    UNION ALL

                    SELECT
                        'Promotion' AS RecordType,
                        p.PFNO AS PFNo,
                        s.SName,
                        p.PDate AS EffectiveDate,
                        pg.Grade AS PreviousValue,
                        cg.Grade AS NewValue
                    FROM tblpromotions p
                    INNER JOIN tblstaff s
                        ON s.PFNo = p.PFNO
                    LEFT JOIN ${dedupedGradeLookupSql} pg
                        ON pg.GradeCode = p.PrevGrade
                    LEFT JOIN ${dedupedGradeLookupSql} cg
                        ON cg.GradeCode = p.CGrade
                    WHERE (p.CompanyID = ? OR p.CompanyID IS NULL)
                      AND (s.CompanyID = ? OR s.CompanyID IS NULL)
                      AND ${staffStatusService.getActiveStaffFilter('s')}
                ) activity_rows
                ORDER BY EffectiveDate DESC, PFNo ASC
                LIMIT 8
            `,
            [companyId, companyId, companyId, companyId]
        )
    ]);

    const [currentLeaveRows, recentTrainingRows] = await Promise.all([
        pool.query(
            `
                SELECT
                    l.PFNO,
                    s.SName,
                    lt.LeaveType,
                    l.StartDate,
                    l.ResumptionDate
                FROM tblleave l
                INNER JOIN tblstaff s
                    ON s.PFNo = l.PFNO
                LEFT JOIN tblleavetype lt
                    ON lt.Code = l.LType
                WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
                  AND (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND ${staffStatusService.getActiveStaffFilter('s')}
                  AND COALESCE(l.Approved, 0) IN (-1, 1)
                  AND COALESCE(l.Recalled, 0) = 0
                  AND COALESCE(l.Resumed, 0) = 0
                  AND DATE(l.StartDate) <= CURDATE()
                  AND DATE(l.ResumptionDate) >= CURDATE()
                ORDER BY DATE(l.ResumptionDate) ASC, s.SName ASC
                LIMIT 8
            `,
            [companyId, companyId]
        ),
        pool.query(
            `
                SELECT
                    c.PFNo,
                    s.SName,
                    c.Course,
                    c.StartDate,
                    ct.CType AS TypeName
                FROM tblcourse c
                INNER JOIN tblstaff s
                    ON s.PFNo = c.PFNo
                LEFT JOIN tblcoursetype ct
                    ON ct.CourseCode = c.Type
                WHERE (c.CompanyID = ? OR c.CompanyID IS NULL)
                  AND (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND ${staffStatusService.getActiveStaffFilter('s')}
                  AND c.StartDate IS NOT NULL
                ORDER BY c.StartDate DESC, s.SName ASC
                LIMIT 8
            `,
            [companyId, companyId]
        )
    ]);

    return {
        company,
        cards: {
            activeStaff: Number(activeStaffRows[0][0]?.count || 0),
            onLeaveNow: Number(onLeaveRows[0][0]?.count || 0),
            attendanceLast30Days: Number(attendanceRows[0][0]?.count || 0),
            trainingLast12Months: Number(trainingRows[0][0]?.count || 0)
        },
        recentTransferRows: recentTransferRows[0],
        currentLeaveRows: currentLeaveRows[0],
        recentTrainingRows: recentTrainingRows[0]
    };
}

async function getStaffOverviewData({ companyId, entityScope, filters = {} }) {
    const { page, pageSize, offset } = normalizePagination(filters);
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        staffName: normalizeOptionalText(filters.staffName),
        page,
        pageSize
    };

    const params = [companyId];
    const conditions = [
        '(s.CompanyID = ? OR s.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];

    if (normalizedFilters.pfNo) {
        conditions.push('s.PFNo = ?');
        params.push(normalizedFilters.pfNo);
    }

    if (normalizedFilters.staffName) {
        conditions.push('s.SName LIKE ?');
        params.push(`%${normalizedFilters.staffName}%`);
    }

    const countParams = [...params];
    const rowParams = [...params, pageSize, offset];

    const [company, rowsResult, countResult] = await Promise.all([
        getCompanyInfo(companyId),
        pool.query(
            `
                SELECT
                    s.PFNo,
                    s.SName,
                    s.DOE,
                    s.DOB,
                    s.Phone,
                    s.Email,
                    d.Dept AS DeptName,
                    g.Grade,
                    j.JobTitle,
                    st.Status
                FROM tblstaff s
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                LEFT JOIN ${dedupedGradeLookupSql} g
                    ON g.GradeCode = s.CGrade
                LEFT JOIN tbljobtitle j
                    ON j.Code = s.JobTitle
                LEFT JOIN tblstatus st
                    ON st.CODE = s.EmpStatus
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY s.SName ASC, s.PFNo ASC
                LIMIT ? OFFSET ?
            `,
            rowParams
        ),
        pool.query(
            `
                SELECT COUNT(*) AS TotalRows
                FROM tblstaff s
                WHERE ${conditions.join('\n                  AND ')}
            `,
            countParams
        )
    ]);

    const totalRows = countResult[0][0]?.TotalRows || 0;
    return {
        company,
        rows: rowsResult[0],
        pagination: buildPagination(page, pageSize, totalRows),
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            staffName: normalizedFilters.staffName || '',
            page,
            pageSize
        }
    };
}

async function getAttendanceSummaryData({ companyId, entityScope, filters = {} }) {
    const { page, pageSize, offset } = normalizePagination(filters);
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo),
        workStatus: normalizeOptionalText(filters.workStatus),
        page,
        pageSize
    };

    const params = [companyId, companyId];
    const conditions = [
        '(a.CompanyID = ? OR a.CompanyID IS NULL)',
        '(s.CompanyID = ? OR s.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];

    if (normalizedFilters.pfNo) {
        conditions.push('a.PFNo = ?');
        params.push(normalizedFilters.pfNo);
    }
    if (normalizedFilters.dateFrom) {
        conditions.push('DATE(a.Work_Day) >= ?');
        params.push(normalizedFilters.dateFrom);
    }
    if (normalizedFilters.dateTo) {
        conditions.push('DATE(a.Work_Day) <= ?');
        params.push(normalizedFilters.dateTo);
    }
    if (normalizedFilters.workStatus) {
        conditions.push('a.Work_Status = ?');
        params.push(normalizedFilters.workStatus);
    }

    const countParams = [...params];
    const rowParams = [...params, pageSize, offset];

    const [company, rowsResult, workStatusRows, summaryRows, countRows] = await Promise.all([
        getCompanyInfo(companyId),
        pool.query(
            `
                SELECT
                    a.PFNo,
                    s.SName,
                    d.Dept AS DeptName,
                    a.Work_Day,
                    a.Work_Status,
                    a.Time_in,
                    a.Time_out,
                    a.Approved
                FROM tblattendance a
                INNER JOIN tblstaff s
                    ON s.PFNo = a.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY a.Work_Day DESC, s.SName ASC
                LIMIT ? OFFSET ?
            `,
            rowParams
        ),
        pool.query(
            `
                SELECT DISTINCT Work_Status
                FROM tblattendance a
                INNER JOIN tblstaff s
                    ON s.PFNo = a.PFNo
                WHERE (a.CompanyID = ? OR a.CompanyID IS NULL)
                  AND (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND ${staffStatusService.getActiveStaffFilter('s')}
                  AND Work_Status IS NOT NULL
                  AND Work_Status <> ''
                ORDER BY Work_Status
            `,
            [companyId, companyId]
        ),
        pool.query(
            `
                SELECT
                    SUM(CASE WHEN COALESCE(a.Approved, 0) = 0 THEN 1 ELSE 0 END) AS PendingRows,
                    SUM(CASE WHEN COALESCE(a.Approved, 0) IN (-1, 1) THEN 1 ELSE 0 END) AS ApprovedRows,
                    COUNT(*) AS TotalRows
                FROM tblattendance a
                INNER JOIN tblstaff s
                    ON s.PFNo = a.PFNo
                WHERE ${conditions.join('\n                  AND ')}
            `,
            countParams
        ),
        pool.query(
            `
                SELECT COUNT(*) AS TotalRows
                FROM tblattendance a
                INNER JOIN tblstaff s
                    ON s.PFNo = a.PFNo
                WHERE ${conditions.join('\n                  AND ')}
            `,
            countParams
        )
    ]);

    return {
        company,
        rows: rowsResult[0],
        statuses: workStatusRows[0].map((row) => row.Work_Status),
        totals: summaryRows[0][0] || { PendingRows: 0, ApprovedRows: 0, TotalRows: 0 },
        pagination: buildPagination(page, pageSize, countRows[0][0]?.TotalRows || 0),
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || '',
            workStatus: normalizedFilters.workStatus || '',
            page,
            pageSize
        }
    };
}

async function getLeaveSummaryData({ companyId, entityScope, filters = {} }) {
    const { page, pageSize, offset } = normalizePagination(filters);
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        status: normalizeOptionalText(filters.status),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo),
        page,
        pageSize
    };

    const params = [companyId, companyId];
    const conditions = [
        '(l.CompanyID = ? OR l.CompanyID IS NULL)',
        '(s.CompanyID = ? OR s.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];

    if (normalizedFilters.pfNo) {
        conditions.push('l.PFNO = ?');
        params.push(normalizedFilters.pfNo);
    }
    if (normalizedFilters.dateFrom) {
        conditions.push('DATE(l.StartDate) >= ?');
        params.push(normalizedFilters.dateFrom);
    }
    if (normalizedFilters.dateTo) {
        conditions.push('DATE(l.StartDate) <= ?');
        params.push(normalizedFilters.dateTo);
    }
    if (normalizedFilters.status === 'current') {
        conditions.push('COALESCE(l.Approved, 0) IN (-1, 1)');
        conditions.push('COALESCE(l.Recalled, 0) = 0');
        conditions.push('COALESCE(l.Resumed, 0) = 0');
        conditions.push('DATE(l.StartDate) <= CURDATE()');
        conditions.push('DATE(l.ResumptionDate) >= CURDATE()');
    } else if (normalizedFilters.status === 'pending') {
        conditions.push('COALESCE(l.Approved, 0) = 0');
    } else if (normalizedFilters.status === 'resumed') {
        conditions.push('COALESCE(l.Resumed, 0) <> 0');
    }

    const countParams = [...params];
    const rowParams = [...params, pageSize, offset];

    const [company, rowsResult, totalsResult, countResult] = await Promise.all([
        getCompanyInfo(companyId),
        pool.query(
            `
                SELECT
                    l.PFNO,
                    s.SName,
                    d.Dept AS DeptName,
                    lt.LeaveType,
                    l.LYear,
                    l.StartDate,
                    l.ResumptionDate,
                    l.LDays,
                    l.BalDays,
                    l.Allowance,
                    l.Taxable,
                    l.Tax,
                    l.Resumed,
                    l.Approved
                FROM tblleave l
                INNER JOIN tblstaff s
                    ON s.PFNo = l.PFNO
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                LEFT JOIN tblleavetype lt
                    ON lt.Code = l.LType
                WHERE ${conditions.join('\n                  AND ')}
                ORDER BY l.StartDate DESC, s.SName ASC
                LIMIT ? OFFSET ?
            `,
            rowParams
        ),
        pool.query(
            `
                SELECT
                    SUM(
                        CASE
                            WHEN COALESCE(l.Approved, 0) IN (-1, 1)
                             AND COALESCE(l.Recalled, 0) = 0
                             AND COALESCE(l.Resumed, 0) = 0
                             AND DATE(l.StartDate) <= CURDATE()
                             AND DATE(l.ResumptionDate) >= CURDATE()
                            THEN 1 ELSE 0
                        END
                    ) AS CurrentLeave,
                    SUM(CASE WHEN COALESCE(l.Approved, 0) = 0 THEN 1 ELSE 0 END) AS PendingLeave,
                    SUM(CASE WHEN COALESCE(l.Resumed, 0) <> 0 THEN 1 ELSE 0 END) AS ResumedLeave
                FROM tblleave l
                INNER JOIN tblstaff s
                    ON s.PFNo = l.PFNO
                WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
                  AND (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND ${staffStatusService.getActiveStaffFilter('s')}
            `,
            [companyId, companyId]
        ),
        pool.query(
            `
                SELECT COUNT(*) AS TotalRows
                FROM tblleave l
                INNER JOIN tblstaff s
                    ON s.PFNo = l.PFNO
                WHERE ${conditions.join('\n                  AND ')}
            `,
            countParams
        )
    ]);

    return {
        company,
        rows: rowsResult[0],
        totals: totalsResult[0][0] || { CurrentLeave: 0, PendingLeave: 0, ResumedLeave: 0 },
        pagination: buildPagination(page, pageSize, countResult[0][0]?.TotalRows || 0),
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            status: normalizedFilters.status || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || '',
            page,
            pageSize
        }
    };
}

async function getTransferPromotionSummaryData({ companyId, entityScope, filters = {} }) {
    const { page, pageSize, offset } = normalizePagination(filters);
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        recordType: normalizeOptionalText(filters.recordType),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo),
        page,
        pageSize
    };

    const transferConditions = [
        '(t.CompanyID = ? OR t.CompanyID IS NULL)',
        '(s.CompanyID = ? OR s.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];
    const promotionConditions = [
        '(p.CompanyID = ? OR p.CompanyID IS NULL)',
        '(s.CompanyID = ? OR s.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];
    const transferParams = [companyId, companyId];
    const promotionParams = [companyId, companyId];

    if (normalizedFilters.pfNo) {
        transferConditions.push('t.PFNO = ?');
        promotionConditions.push('p.PFNO = ?');
        transferParams.push(normalizedFilters.pfNo);
        promotionParams.push(normalizedFilters.pfNo);
    }
    if (normalizedFilters.dateFrom) {
        transferConditions.push('DATE(t.TDate) >= ?');
        promotionConditions.push('DATE(p.PDate) >= ?');
        transferParams.push(normalizedFilters.dateFrom);
        promotionParams.push(normalizedFilters.dateFrom);
    }
    if (normalizedFilters.dateTo) {
        transferConditions.push('DATE(t.TDate) <= ?');
        promotionConditions.push('DATE(p.PDate) <= ?');
        transferParams.push(normalizedFilters.dateTo);
        promotionParams.push(normalizedFilters.dateTo);
    }

    const unionSql = `
        SELECT *
        FROM (
            SELECT
                'Transfer' AS RecordType,
                t.PFNO AS PFNo,
                s.SName,
                d.Dept AS DeptName,
                t.TDate AS EffectiveDate,
                dp.Dept AS PreviousValue,
                dt.Dept AS NewValue,
                t.Activity,
                t.approved AS Approved,
                t.approvedby AS ApprovedBy,
                t.dateapproved AS DateApproved
            FROM tbltransfer t
            INNER JOIN tblstaff s
                ON s.PFNo = t.PFNO
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            LEFT JOIN tbldept dp
                ON dp.Code = t.PrevDept
            LEFT JOIN tbldept dt
                ON dt.Code = t.TDept
            WHERE ${transferConditions.join('\n              AND ')}

            UNION ALL

            SELECT
                'Promotion' AS RecordType,
                p.PFNO AS PFNo,
                s.SName,
                d.Dept AS DeptName,
                p.PDate AS EffectiveDate,
                pg.Grade AS PreviousValue,
                cg.Grade AS NewValue,
                p.Activity,
                p.Approved AS Approved,
                p.Approvedby AS ApprovedBy,
                p.Dateapproved AS DateApproved
            FROM tblpromotions p
            INNER JOIN tblstaff s
                ON s.PFNo = p.PFNO
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            LEFT JOIN ${dedupedGradeLookupSql} pg
                ON pg.GradeCode = p.PrevGrade
            LEFT JOIN ${dedupedGradeLookupSql} cg
                ON cg.GradeCode = p.CGrade
            WHERE ${promotionConditions.join('\n              AND ')}
        ) scope_rows
        ${normalizedFilters.recordType ? 'WHERE RecordType = ?' : ''}
        ORDER BY EffectiveDate DESC, PFNo ASC
        LIMIT ? OFFSET ?
    `;

    const resultParams = normalizedFilters.recordType
        ? [...transferParams, ...promotionParams, normalizedFilters.recordType, pageSize, offset]
        : [...transferParams, ...promotionParams, pageSize, offset];
    const countSql = `
        SELECT COUNT(*) AS TotalRows
        FROM (
            SELECT t.PFNO AS PFNo, 'Transfer' AS RecordType
            FROM tbltransfer t
            INNER JOIN tblstaff s
                ON s.PFNo = t.PFNO
            WHERE ${transferConditions.join('\n              AND ')}

            UNION ALL

            SELECT p.PFNO AS PFNo, 'Promotion' AS RecordType
            FROM tblpromotions p
            INNER JOIN tblstaff s
                ON s.PFNo = p.PFNO
            WHERE ${promotionConditions.join('\n              AND ')}
        ) scope_rows
        ${normalizedFilters.recordType ? 'WHERE RecordType = ?' : ''}
    `;

    const [company, rowsResult, countResult] = await Promise.all([
        getCompanyInfo(companyId),
        pool.query(
            unionSql,
            resultParams
        ),
        pool.query(
            countSql,
            normalizedFilters.recordType
                ? [...transferParams, ...promotionParams, normalizedFilters.recordType]
                : [...transferParams, ...promotionParams]
        )
    ]);

    return {
        company,
        rows: rowsResult[0],
        pagination: buildPagination(page, pageSize, countResult[0][0]?.TotalRows || 0),
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            recordType: normalizedFilters.recordType || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || '',
            page,
            pageSize
        }
    };
}

async function getTrainingSummaryData({ companyId, entityScope, filters = {} }) {
    const { page, pageSize, offset } = normalizePagination(filters);
    const normalizedFilters = {
        pfNo: normalizeOptionalText(filters.pfNo),
        dateFrom: normalizeDate(filters.dateFrom),
        dateTo: normalizeDate(filters.dateTo),
        status: normalizeOptionalText(filters.status),
        page,
        pageSize
    };

    const params = [companyId, companyId];
    const conditions = [
        '(c.CompanyID = ? OR c.CompanyID IS NULL)',
        '(s.CompanyID = ? OR s.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];

    if (normalizedFilters.pfNo) {
        conditions.push('c.PFNo = ?');
        params.push(normalizedFilters.pfNo);
    }
    if (normalizedFilters.dateFrom) {
        conditions.push('DATE(c.StartDate) >= ?');
        params.push(normalizedFilters.dateFrom);
    }
    if (normalizedFilters.dateTo) {
        conditions.push('DATE(c.StartDate) <= ?');
        params.push(normalizedFilters.dateTo);
    }
    if (normalizedFilters.status === 'approved') {
        conditions.push('COALESCE(c.approved, 0) IN (-1, 1)');
    } else if (normalizedFilters.status === 'pending') {
        conditions.push('COALESCE(c.approved, 0) = 0');
    } else if (normalizedFilters.status === 'rejected') {
        conditions.push('COALESCE(c.approved, 0) = 2');
    }

    const countParams = [...params];
    const rowParams = [...params, pageSize, offset];

    const [company, rowsResult, totalsResult, countResult] = await Promise.all([
        getCompanyInfo(companyId),
        pool.query(
            `
                SELECT
                    c.PFNo,
                    s.SName,
                    d.Dept AS DeptName,
                    c.Course,
                    cl.CLevel AS LevelName,
                    ct.CType AS TypeName,
                    sp.Sponsor AS SponsorName,
                    c.OrganisedBy,
                    c.Duration,
                    c.Country,
                    c.StartDate,
                    c.Cost,
                    c.Completed,
                    c.approved
                FROM tblcourse c
                INNER JOIN tblstaff s
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
                ORDER BY c.StartDate DESC, s.SName ASC
                LIMIT ? OFFSET ?
            `,
            rowParams
        ),
        pool.query(
            `
                SELECT
                    COUNT(*) AS TotalRows,
                    SUM(CASE WHEN COALESCE(c.approved, 0) IN (-1, 1) THEN 1 ELSE 0 END) AS ApprovedRows,
                    SUM(CASE WHEN COALESCE(c.Completed, 0) <> 0 THEN 1 ELSE 0 END) AS CompletedRows
                FROM tblcourse c
                INNER JOIN tblstaff s
                    ON s.PFNo = c.PFNo
                WHERE (c.CompanyID = ? OR c.CompanyID IS NULL)
                  AND (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND ${staffStatusService.getActiveStaffFilter('s')}
            `,
            [companyId, companyId]
        ),
        pool.query(
            `
                SELECT COUNT(*) AS TotalRows
                FROM tblcourse c
                INNER JOIN tblstaff s
                    ON s.PFNo = c.PFNo
                WHERE ${conditions.join('\n                  AND ')}
            `,
            countParams
        )
    ]);

    return {
        company,
        rows: rowsResult[0],
        totals: totalsResult[0][0] || { TotalRows: 0, ApprovedRows: 0, CompletedRows: 0 },
        pagination: buildPagination(page, pageSize, countResult[0][0]?.TotalRows || 0),
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            dateFrom: normalizedFilters.dateFrom || '',
            dateTo: normalizedFilters.dateTo || '',
            status: normalizedFilters.status || '',
            page,
            pageSize
        }
    };
}

async function getReportsData({ companyId, entityScope }) {
    const [company, dashboard, staff, attendance, leave, transfers, training] = await Promise.all([
        getCompanyInfo(companyId),
        getDashboardData({ companyId, entityScope }),
        getStaffOverviewData({ companyId, entityScope, filters: {} }),
        getAttendanceSummaryData({ companyId, entityScope, filters: {} }),
        getLeaveSummaryData({ companyId, entityScope, filters: {} }),
        getTransferPromotionSummaryData({ companyId, entityScope, filters: {} }),
        getTrainingSummaryData({ companyId, entityScope, filters: {} })
    ]);

    return {
        company,
        cards: dashboard.cards,
        staffCount: staff.rows.length,
        attendanceTotals: attendance.totals,
        leaveTotals: leave.totals,
        trainingTotals: training.totals,
        staffRows: staff.rows.slice(0, 8),
        attendanceRows: attendance.rows.slice(0, 8),
        leaveRows: leave.rows.slice(0, 8),
        transferRows: transfers.rows.slice(0, 8),
        trainingRows: training.rows.slice(0, 8)
    };
}

module.exports = {
    getDashboardData,
    getStaffOverviewData,
    getAttendanceSummaryData,
    getLeaveSummaryData,
    getTransferPromotionSummaryData,
    getTrainingSummaryData,
    getReportsData
};
