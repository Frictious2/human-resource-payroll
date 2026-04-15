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

function normalizePositiveInteger(value) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return 0;
    }

    return Math.round(number * 100) / 100;
}

function formatDateOnly(value) {
    if (!value) {
        return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toISOString().slice(0, 10);
}

function createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function buildSalaryReviewSourceCategory(rule) {
    return [
        'SALARY_REVIEW',
        formatDateOnly(rule.RevDate),
        normalizeText(rule.RevCode),
        normalizeText(rule.SGrade),
        normalizeText(rule.EGrade),
        Number(rule.Percentage) || 0
    ].join('|');
}

async function getNextAuditTrailId(connection) {
    const [rows] = await connection.query(
        'SELECT COALESCE(MAX(AuditTrailID), 0) + 1 AS nextId FROM tblaudittrail'
    );

    return Number(rows[0]?.nextId || 1);
}

async function logSalaryReviewCommitAudit(connection, {
    companyId,
    committedBy,
    rule,
    createdCount
}) {
    const nextId = await getNextAuditTrailId(connection);
    const recordId = buildSalaryReviewSourceCategory(rule);
    const summary = `${createdCount} increment record(s) created for ${recordId}`;

    await connection.query(
        `
            INSERT INTO tblaudittrail
            (AuditTrailID, ChangeDate, UserName, FormName, Action, RecordID, FieldName, OldValue, NewValue, Loggedout, CompanyID)
            VALUES (?, NOW(), ?, 'manager/activity/run-salary-review', 'COMMIT', ?, 'tblincrement', '', ?, 0, ?)
        `,
        [nextId, committedBy || 'Manager', recordId, summary, Number(companyId) || 1]
    );
}

async function getCompanyInfo() {
    const [rows] = await pool.query('SELECT CompanyID, Com_Name, Address, LogoPath FROM tblcominfo LIMIT 1');
    return rows[0] || { CompanyID: 1, Com_Name: 'Human Resource Payroll', Address: '', LogoPath: null };
}

async function getPayTypes() {
    const [rows] = await pool.query(
        `
            SELECT Code, PayType
            FROM tblpaytype
            WHERE Code <> '99'
            ORDER BY Code
        `
    );

    return rows;
}

async function getReviewTypes() {
    const [rows] = await pool.query(
        `
            SELECT RevCode, RevName
            FROM tblrevtype
            ORDER BY RevCode
        `
    );

    return rows;
}

async function getGrades() {
    const [rows] = await pool.query(
        `
            SELECT GradeCode, Grade
            FROM tblgrade
            ORDER BY GradeCode
        `
    );

    return rows;
}

async function getActiveStaffList() {
    const [rows] = await pool.query(
        staffStatusService.getActiveStaffQuery({
            fields: 'PFNo, SName, CDept, CGrade, JobTitle, AccountNo, CompanyID',
            orderBy: 'PFNo'
        })
    );

    return rows;
}

async function getLatestSalarySnapshot(pfNo, companyId) {
    const [rows] = await pool.query(
        `
            SELECT
                s.PFNo,
                s.SName,
                s.CDept,
                s.CGrade,
                s.JobTitle,
                COALESCE(st.AccountNo, s.AccountNo) AS AccountNo
            FROM tblsalary s
            INNER JOIN (
                SELECT PFNo, MAX(PDate) AS latest_pdate
                FROM tblsalary
                GROUP BY PFNo
            ) latest
                ON latest.PFNo = s.PFNo
               AND latest.latest_pdate = s.PDate
            INNER JOIN tblstaff st
                ON st.PFNo = s.PFNo
            WHERE s.PFNo = ?
              AND (COALESCE(st.CompanyID, s.CompanyID, ?) = ? OR st.CompanyID IS NULL OR s.CompanyID IS NULL)
            LIMIT 1
        `,
        [pfNo, companyId, companyId]
    );

    return rows[0] || null;
}

function buildYearlyPaymentFilters(filters = {}) {
    const conditions = ['y.CompanyID = ?'];
    const params = [Number(filters.companyId) || 1];

    if (filters.pfNo) {
        conditions.push('y.PFNo = ?');
        params.push(filters.pfNo);
    }

    if (filters.payType) {
        conditions.push('y.PType = ?');
        params.push(filters.payType);
    }

    if (filters.month) {
        conditions.push('y.PMonth = ?');
        params.push(filters.month);
    }

    if (filters.year) {
        conditions.push('y.PYear = ?');
        params.push(filters.year);
    }

    if (filters.status === 'pending') {
        conditions.push('COALESCE(y.Approved, 0) = 0');
    } else if (filters.status === 'approved') {
        conditions.push('COALESCE(y.Approved, 0) IN (-1, 1)');
    } else if (filters.status === 'rejected') {
        conditions.push('COALESCE(y.Approved, 0) = 2');
    }

    return {
        whereClause: conditions.join('\n              AND '),
        params
    };
}

async function getYearlyPaymentsPageData({ companyId, filters = {} }) {
    const normalizedFilters = {
        companyId: Number(companyId) || 1,
        pfNo: normalizeOptionalText(filters.pfNo),
        payType: normalizeOptionalText(filters.payType),
        month: normalizePositiveInteger(filters.month),
        year: normalizePositiveInteger(filters.year),
        status: normalizeOptionalText(filters.status)
    };

    const { whereClause, params } = buildYearlyPaymentFilters(normalizedFilters);

    const [company, payTypes, staffList, rows] = await Promise.all([
        getCompanyInfo(),
        getPayTypes(),
        getActiveStaffList(),
        pool.query(
            `
                SELECT
                    y.*,
                    COALESCE(p.PayType, y.PType) AS PayTypeName,
                    COALESCE(d.Dept, y.Dept) AS DeptName,
                    COALESCE(g.Grade, y.Grade) AS GradeName
                FROM tblyearlypayments y
                LEFT JOIN tblpaytype p
                    ON p.Code = y.PType
                LEFT JOIN tbldept d
                    ON d.Code = y.Dept
                LEFT JOIN tblgrade g
                    ON g.GradeCode = y.Grade
                WHERE ${whereClause}
                ORDER BY y.PYear DESC, y.PMonth DESC, y.PDate DESC, y.PFNo ASC
            `,
            params
        )
    ]);

    return {
        company,
        payTypes,
        staffList,
        filters: {
            pfNo: normalizedFilters.pfNo || '',
            payType: normalizedFilters.payType || '',
            month: normalizedFilters.month || '',
            year: normalizedFilters.year || '',
            status: normalizedFilters.status || ''
        },
        rows: rows[0]
    };
}

async function saveYearlyPayment({
    companyId,
    operatorName,
    pDate,
    pfNo,
    payType,
    fixed,
    monthly,
    totalIncome,
    taxable,
    tax,
    netIncome,
    served,
    selected
}) {
    const resolvedCompanyId = Number(companyId) || 1;
    const entryDate = normalizeText(pDate);
    const staffId = normalizeText(pfNo);
    const paymentType = normalizeText(payType);

    if (!entryDate || !staffId || !paymentType) {
        throw createError('Entry date, staff PFNo, and payment type are required.', 400);
    }

    const salarySnapshot = await getLatestSalarySnapshot(staffId, resolvedCompanyId);
    if (!salarySnapshot) {
        throw createError('Selected staff was not found in the current payroll setup.', 404);
    }

    const entryMonth = new Date(entryDate).getMonth() + 1;
    const entryYear = new Date(entryDate).getFullYear();
    if (!entryMonth || !entryYear) {
        throw createError('A valid entry date is required.', 400);
    }

    const payload = {
        PDate: entryDate,
        PFNo: salarySnapshot.PFNo,
        SName: salarySnapshot.SName,
        Dept: salarySnapshot.CDept,
        Grade: salarySnapshot.CGrade,
        JobTitle: salarySnapshot.JobTitle,
        AccountNo: salarySnapshot.AccountNo,
        Fixed: fixed ? 1 : 0,
        Monthly: normalizeMoney(monthly),
        TotalIncome: normalizeMoney(totalIncome),
        Taxable: normalizeMoney(taxable || totalIncome),
        Tax: normalizeMoney(tax),
        NetIncome: normalizeMoney(netIncome || (normalizeMoney(totalIncome) - normalizeMoney(tax))),
        PMonth: entryMonth,
        PYear: entryYear,
        PType: paymentType,
        Served: normalizePositiveInteger(served) || 0,
        Selected: selected ? 1 : 0,
        Operator: operatorName || 'Data Entry Officer',
        CompanyID: resolvedCompanyId
    };

    const [existingRows] = await pool.query(
        `
            SELECT PFNo
            FROM tblyearlypayments
            WHERE CompanyID = ?
              AND PFNo = ?
              AND PType = ?
              AND PMonth = ?
              AND PYear = ?
              AND COALESCE(Approved, 0) = 0
            LIMIT 1
        `,
        [resolvedCompanyId, payload.PFNo, payload.PType, payload.PMonth, payload.PYear]
    );

    if (existingRows.length > 0) {
        await pool.query(
            `
                UPDATE tblyearlypayments
                SET PDate = ?,
                    SName = ?,
                    Dept = ?,
                    Grade = ?,
                    JobTitle = ?,
                    AccountNo = ?,
                    Fixed = ?,
                    Monthly = ?,
                    TotalIncome = ?,
                    Taxable = ?,
                    Tax = ?,
                    NetIncome = ?,
                    Served = ?,
                    Selected = ?,
                    Operator = ?,
                    DateKeyed = NOW(),
                    TimeKeyed = NOW()
                WHERE CompanyID = ?
                  AND PFNo = ?
                  AND PType = ?
                  AND PMonth = ?
                  AND PYear = ?
                  AND COALESCE(Approved, 0) = 0
            `,
            [
                payload.PDate,
                payload.SName,
                payload.Dept,
                payload.Grade,
                payload.JobTitle,
                payload.AccountNo,
                payload.Fixed,
                payload.Monthly,
                payload.TotalIncome,
                payload.Taxable,
                payload.Tax,
                payload.NetIncome,
                payload.Served,
                payload.Selected,
                payload.Operator,
                payload.CompanyID,
                payload.PFNo,
                payload.PType,
                payload.PMonth,
                payload.PYear
            ]
        );
    } else {
        await pool.query(
            `
                INSERT INTO tblyearlypayments (
                    PDate, PFNo, SName, Dept, Grade, JobTitle, AccountNo, Fixed, Monthly,
                    TotalIncome, Taxable, Tax, NetIncome, PMonth, PYear, PType, Served,
                    Selected, Paid, Operator, DateKeyed, TimeKeyed, Approved, CompanyID
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(), NOW(), 0, ?)
            `,
            [
                payload.PDate,
                payload.PFNo,
                payload.SName,
                payload.Dept,
                payload.Grade,
                payload.JobTitle,
                payload.AccountNo,
                payload.Fixed,
                payload.Monthly,
                payload.TotalIncome,
                payload.Taxable,
                payload.Tax,
                payload.NetIncome,
                payload.PMonth,
                payload.PYear,
                payload.PType,
                payload.Served,
                payload.Selected,
                payload.Operator,
                payload.CompanyID
            ]
        );
    }
}

function buildSalaryReviewFilters(filters = {}) {
    const conditions = ['(sr.CompanyID = ? OR sr.CompanyID IS NULL)'];
    const params = [Number(filters.companyId) || 1];

    if (filters.revCode) {
        conditions.push('sr.RevCode = ?');
        params.push(filters.revCode);
    }

    if (filters.startGrade) {
        conditions.push('sr.SGrade = ?');
        params.push(filters.startGrade);
    }

    if (filters.endGrade) {
        conditions.push('sr.EGrade = ?');
        params.push(filters.endGrade);
    }

    if (filters.status === 'pending') {
        conditions.push('COALESCE(sr.Approved, 0) = 0');
    } else if (filters.status === 'approved') {
        conditions.push('COALESCE(sr.Approved, 0) IN (-1, 1)');
    } else if (filters.status === 'rejected') {
        conditions.push('COALESCE(sr.Approved, 0) = 2');
    }

    if (filters.reviewDate) {
        conditions.push('DATE(sr.RevDate) = ?');
        params.push(filters.reviewDate);
    }

    return {
        whereClause: conditions.join('\n              AND '),
        params
    };
}

async function getSalaryReviewsPageData({ companyId, filters = {} }) {
    const normalizedFilters = {
        companyId: Number(companyId) || 1,
        revCode: normalizeOptionalText(filters.revCode),
        startGrade: normalizeOptionalText(filters.startGrade),
        endGrade: normalizeOptionalText(filters.endGrade),
        status: normalizeOptionalText(filters.status),
        reviewDate: normalizeOptionalText(filters.reviewDate)
    };

    const { whereClause, params } = buildSalaryReviewFilters(normalizedFilters);

    const [reviewTypes, grades, rows] = await Promise.all([
        getReviewTypes(),
        getGrades(),
        pool.query(
            `
                SELECT
                    sr.*,
                    rt.RevName,
                    sg.Grade AS StartGradeName,
                    eg.Grade AS EndGradeName
                FROM tblsalreview sr
                LEFT JOIN tblrevtype rt
                    ON rt.RevCode = sr.RevCode
                LEFT JOIN tblgrade sg
                    ON sg.GradeCode = sr.SGrade
                LEFT JOIN tblgrade eg
                    ON eg.GradeCode = sr.EGrade
                WHERE ${whereClause}
                ORDER BY sr.RevDate DESC, sr.RevCode ASC, sr.SGrade ASC, sr.EGrade ASC
            `,
            params
        )
    ]);

    return {
        reviewTypes,
        grades,
        filters: {
            revCode: normalizedFilters.revCode || '',
            startGrade: normalizedFilters.startGrade || '',
            endGrade: normalizedFilters.endGrade || '',
            status: normalizedFilters.status || '',
            reviewDate: normalizedFilters.reviewDate || ''
        },
        rows: rows[0]
    };
}

async function saveSalaryReview({
    companyId,
    operatorName,
    reviewDate,
    revCode,
    startGrade,
    endGrade,
    percentage
}) {
    const resolvedCompanyId = Number(companyId) || 1;
    const revDateValue = normalizeText(reviewDate);
    const revCodeValue = normalizeText(revCode);
    const startGradeValue = normalizeText(startGrade);
    const endGradeValue = normalizeText(endGrade);
    const percentageValue = Number(percentage);

    if (!revDateValue || !revCodeValue || !startGradeValue || !endGradeValue || !Number.isFinite(percentageValue)) {
        throw createError('Review date, review type, grade range, and percentage are required.', 400);
    }

    const [existingRows] = await pool.query(
        `
            SELECT RevCode
            FROM tblsalreview
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND DATE(RevDate) = ?
              AND RevCode = ?
              AND SGrade = ?
              AND EGrade = ?
              AND COALESCE(Approved, 0) = 0
            LIMIT 1
        `,
        [resolvedCompanyId, revDateValue, revCodeValue, startGradeValue, endGradeValue]
    );

    if (existingRows.length > 0) {
        await pool.query(
            `
                UPDATE tblsalreview
                SET Percentage = ?,
                    Operator = ?,
                    Datekeyed = NOW()
                WHERE (CompanyID = ? OR CompanyID IS NULL)
                  AND DATE(RevDate) = ?
                  AND RevCode = ?
                  AND SGrade = ?
                  AND EGrade = ?
                  AND COALESCE(Approved, 0) = 0
            `,
            [percentageValue, operatorName || 'Data Entry Officer', resolvedCompanyId, revDateValue, revCodeValue, startGradeValue, endGradeValue]
        );
    } else {
        await pool.query(
            `
                INSERT INTO tblsalreview (
                    RevDate, Percentage, RevCode, SGrade, EGrade, Operator, Datekeyed, Approved, CompanyID
                ) VALUES (?, ?, ?, ?, ?, ?, NOW(), 0, ?)
            `,
            [revDateValue, percentageValue, revCodeValue, startGradeValue, endGradeValue, operatorName || 'Data Entry Officer', resolvedCompanyId]
        );
    }
}

async function getSalaryReviewApprovalData({ companyId, filters = {} }) {
    const pageData = await getSalaryReviewsPageData({
        companyId,
        filters: {
            ...filters,
            status: filters.status || 'pending'
        }
    });

    return pageData;
}

async function decideSalaryReview({
    companyId,
    reviewDate,
    revCode,
    startGrade,
    endGrade,
    action,
    approvedBy
}) {
    const status = action === 'approve' ? -1 : 2;
    const result = await pool.query(
        `
            UPDATE tblsalreview
            SET Approved = ?,
                ApprovedBy = ?,
                DateApproved = NOW()
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND DATE(RevDate) = ?
              AND RevCode = ?
              AND SGrade = ?
              AND EGrade = ?
              AND COALESCE(Approved, 0) = 0
        `,
        [status, approvedBy || 'Manager', Number(companyId) || 1, reviewDate, revCode, startGrade, endGrade]
    );

    return result[0];
}

async function getApprovedSalaryReviewRule(queryable, {
    companyId,
    reviewDate,
    revCode,
    startGrade,
    endGrade
}) {
    const [rows] = await queryable.query(
        `
            SELECT
                sr.*,
                rt.RevName,
                sg.Grade AS StartGradeName,
                eg.Grade AS EndGradeName
            FROM tblsalreview sr
            LEFT JOIN tblrevtype rt
                ON rt.RevCode = sr.RevCode
            LEFT JOIN tblgrade sg
                ON sg.GradeCode = sr.SGrade
            LEFT JOIN tblgrade eg
                ON eg.GradeCode = sr.EGrade
            WHERE (sr.CompanyID = ? OR sr.CompanyID IS NULL)
              AND DATE(sr.RevDate) = ?
              AND sr.RevCode = ?
              AND sr.SGrade = ?
              AND sr.EGrade = ?
              AND COALESCE(sr.Approved, 0) IN (-1, 1)
            LIMIT 1
        `,
        [Number(companyId) || 1, reviewDate, revCode, startGrade, endGrade]
    );

    if (!rows.length) {
        return null;
    }

    return {
        ...rows[0],
        SourceCategory: buildSalaryReviewSourceCategory(rows[0])
    };
}

async function getSalaryReviewPreviewRowsForRule(queryable, { companyId, rule }) {
    const [rows] = await queryable.query(
        `
            SELECT
                st.PFNo,
                st.SName,
                st.CDept,
                d.Dept AS DeptName,
                st.CGrade,
                g.Grade AS GradeName,
                sal.Salary AS CurrentSalary,
                sal.TotAllw AS CurrentAllowances,
                ? AS ReviewDate,
                ? AS ReviewCode,
                ? AS ReviewName,
                ? AS Percentage,
                ROUND(COALESCE(sal.Salary, 0) * (? / 100), 2) AS SalaryIncrease,
                ROUND(COALESCE(sal.TotAllw, 0) * (? / 100), 2) AS AllowanceIncrease,
                ROUND(
                    CASE
                        WHEN ? = '01' THEN COALESCE(sal.Salary, 0) + (COALESCE(sal.Salary, 0) * (? / 100))
                        WHEN ? = '02' THEN COALESCE(sal.Salary, 0)
                        ELSE COALESCE(sal.Salary, 0) + (COALESCE(sal.Salary, 0) * (? / 100))
                    END,
                    2
                ) AS ProposedSalary,
                ROUND(
                    CASE
                        WHEN ? = '02' THEN COALESCE(sal.TotAllw, 0) + (COALESCE(sal.TotAllw, 0) * (? / 100))
                        WHEN ? = '03' THEN COALESCE(sal.TotAllw, 0) + (COALESCE(sal.TotAllw, 0) * (? / 100))
                        ELSE COALESCE(sal.TotAllw, 0)
                    END,
                    2
                ) AS ProposedAllowances
            FROM tblstaff st
            INNER JOIN tblsalary sal
                ON sal.PFNo = st.PFNo
            INNER JOIN (
                SELECT PFNo, MAX(PDate) AS latest_pdate
                FROM tblsalary
                GROUP BY PFNo
            ) latest
                ON latest.PFNo = sal.PFNo
               AND latest.latest_pdate = sal.PDate
            LEFT JOIN tbldept d
                ON d.Code = st.CDept
            LEFT JOIN tblgrade g
                ON g.GradeCode = st.CGrade
            WHERE (st.CompanyID = ? OR st.CompanyID IS NULL)
              AND ${staffStatusService.getActiveStaffFilter('st')}
              AND st.CGrade >= ?
              AND st.CGrade <= ?
            ORDER BY st.CDept, st.CGrade, st.SName
        `,
        [
            formatDateOnly(rule.RevDate),
            rule.RevCode,
            rule.RevName || rule.RevCode,
            rule.Percentage,
            rule.Percentage,
            rule.Percentage,
            rule.RevCode,
            rule.Percentage,
            rule.RevCode,
            rule.Percentage,
            rule.RevCode,
            rule.Percentage,
            rule.RevCode,
            rule.Percentage,
            Number(companyId) || 1,
            rule.SGrade,
            rule.EGrade
        ]
    );

    return rows.map((row) => ({
        ...row,
        SourceCategory: rule.SourceCategory || buildSalaryReviewSourceCategory(rule),
        CurrentTotal: normalizeMoney(row.CurrentSalary) + normalizeMoney(row.CurrentAllowances),
        ProposedTotal: normalizeMoney(row.ProposedSalary) + normalizeMoney(row.ProposedAllowances)
    }));
}

async function commitSalaryReviewRun({
    companyId,
    reviewDate,
    revCode,
    startGrade,
    endGrade,
    committedBy
}) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalizedReviewDate = normalizeText(reviewDate);
    const normalizedRevCode = normalizeText(revCode);
    const normalizedStartGrade = normalizeText(startGrade);
    const normalizedEndGrade = normalizeText(endGrade);

    if (!normalizedReviewDate || !normalizedRevCode || !normalizedStartGrade || !normalizedEndGrade) {
        throw createError('Review date, review type, and grade range are required to commit a salary review.', 400);
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const rule = await getApprovedSalaryReviewRule(connection, {
            companyId: resolvedCompanyId,
            reviewDate: normalizedReviewDate,
            revCode: normalizedRevCode,
            startGrade: normalizedStartGrade,
            endGrade: normalizedEndGrade
        });

        if (!rule) {
            throw createError('Only approved salary reviews can be committed.', 409);
        }

        const previewRows = await getSalaryReviewPreviewRowsForRule(connection, {
            companyId: resolvedCompanyId,
            rule
        });

        if (!previewRows.length) {
            throw createError('No eligible staff were found for the selected salary review.', 404);
        }

        const staffPlaceholders = previewRows.map(() => '?').join(', ');
        const [duplicateRows] = await connection.query(
            `
                SELECT PFNo
                FROM tblincrement
                WHERE (CompanyID = ? OR CompanyID IS NULL)
                  AND Type = '04'
                  AND DATE(IncDate) = ?
                  AND Category = ?
                  AND PFNo IN (${staffPlaceholders})
                  AND COALESCE(Approved, 0) <> 2
            `,
            [
                resolvedCompanyId,
                normalizedReviewDate,
                rule.SourceCategory,
                ...previewRows.map((row) => row.PFNo)
            ]
        );

        if (duplicateRows.length > 0) {
            const duplicateStaff = duplicateRows.slice(0, 5).map((row) => row.PFNo).join(', ');
            throw createError(
                `Increment records for this salary review already exist.${duplicateStaff ? ` Staff: ${duplicateStaff}.` : ''}`,
                409
            );
        }

        const effectiveDate = new Date(`${normalizedReviewDate}T00:00:00`);
        const payrollMonth = effectiveDate.getMonth() + 1;
        const payrollYear = effectiveDate.getFullYear();
        const incrementPercentage = Number(rule.Percentage) || 0;
        const entryUser = committedBy || 'Manager';

        for (const row of previewRows) {
            await connection.query(
                `
                    INSERT INTO tblincrement (
                        IncDate, PFNo, Grade, Category, Type, IncNo, FPay, PPay, WPay, Days,
                        gRANTED, PYear, PMonth, EPassed, KeyedinBy, DateKeyed, TimeKeyed,
                        Approved, DateApproved, TimeApproved, ApprovedBy, CompanyID
                    ) VALUES (?, ?, ?, ?, '04', ?, ?, ?, ?, 0, 0, ?, ?, 0, ?, NOW(), NOW(), 1, NOW(), NOW(), ?, ?)
                `,
                [
                    normalizedReviewDate,
                    row.PFNo,
                    row.CGrade,
                    rule.SourceCategory,
                    incrementPercentage,
                    1,
                    0,
                    0,
                    payrollYear,
                    payrollMonth,
                    entryUser,
                    entryUser,
                    resolvedCompanyId
                ]
            );
        }

        await logSalaryReviewCommitAudit(connection, {
            companyId: resolvedCompanyId,
            committedBy: entryUser,
            rule,
            createdCount: previewRows.length
        });

        await connection.commit();

        return {
            createdCount: previewRows.length,
            rule: {
                reviewDate: normalizedReviewDate,
                revCode: rule.RevCode,
                reviewName: rule.RevName || rule.RevCode,
                startGrade: rule.SGrade,
                endGrade: rule.EGrade,
                percentage: incrementPercentage,
                sourceCategory: rule.SourceCategory
            }
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function getRunSalaryReviewData({ companyId, filters = {} }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const selectedReviewDate = normalizeOptionalText(filters.reviewDate);
    const selectedRevCode = normalizeOptionalText(filters.revCode);

    const [reviewTypes, rulesRows] = await Promise.all([
        getReviewTypes(),
        pool.query(
            `
                SELECT
                    sr.*,
                    rt.RevName,
                    sg.Grade AS StartGradeName,
                    eg.Grade AS EndGradeName
                FROM tblsalreview sr
                LEFT JOIN tblrevtype rt
                    ON rt.RevCode = sr.RevCode
                LEFT JOIN tblgrade sg
                    ON sg.GradeCode = sr.SGrade
                LEFT JOIN tblgrade eg
                    ON eg.GradeCode = sr.EGrade
                WHERE (sr.CompanyID = ? OR sr.CompanyID IS NULL)
                  AND COALESCE(sr.Approved, 0) IN (-1, 1)
                  ${selectedReviewDate ? 'AND DATE(sr.RevDate) = ?' : ''}
                  ${selectedRevCode ? 'AND sr.RevCode = ?' : ''}
                ORDER BY sr.RevDate DESC, sr.RevCode ASC, sr.SGrade ASC
            `,
            [
                resolvedCompanyId,
                ...(selectedReviewDate ? [selectedReviewDate] : []),
                ...(selectedRevCode ? [selectedRevCode] : [])
            ]
        )
    ]);

    const rules = rulesRows[0].map((rule) => ({
        ...rule,
        ReviewDateOnly: formatDateOnly(rule.RevDate),
        SourceCategory: buildSalaryReviewSourceCategory(rule),
        EligibleCount: 0
    }));

    let previewRows = [];
    if (rules.length > 0) {
        const previewGroups = await Promise.all(
            rules.map((rule) => getSalaryReviewPreviewRowsForRule(pool, {
                companyId: resolvedCompanyId,
                rule
            }))
        );

        previewRows = previewGroups.flat();
        rules.forEach((rule) => {
            rule.EligibleCount = previewRows.filter(
                (row) =>
                    row.SourceCategory === rule.SourceCategory
            ).length;
        });
    }

    return {
        reviewTypes,
        rules,
        previewRows,
        filters: {
            reviewDate: selectedReviewDate || '',
            revCode: selectedRevCode || ''
        }
    };
}

async function getEndOfServiceApprovalData({ companyId, filters = {} }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const statusFilter = normalizeOptionalText(filters.status) || 'pending';
    const pfNo = normalizeOptionalText(filters.pfNo);

    const conditions = ['(e.CompanyID = ? OR e.CompanyID IS NULL)'];
    const params = [resolvedCompanyId];

    if (pfNo) {
        conditions.push('e.PFNo = ?');
        params.push(pfNo);
    }

    if (statusFilter === 'pending') {
        conditions.push('COALESCE(e.Approved, 0) = 0');
    } else if (statusFilter === 'approved') {
        conditions.push('COALESCE(e.Approved, 0) IN (-1, 1)');
    } else if (statusFilter === 'rejected') {
        conditions.push('COALESCE(e.Approved, 0) = 2');
    }

    const [rows] = await pool.query(
        `
            SELECT
                e.*,
                COALESCE(d.Dept, e.Dept) AS DeptName,
                COALESCE(g.Grade, e.Grade) AS GradeName
            FROM tbleos e
            LEFT JOIN tbldept d
                ON d.Code = e.Dept
            LEFT JOIN tblgrade g
                ON g.GradeCode = e.Grade
            WHERE ${conditions.join('\n              AND ')}
            ORDER BY COALESCE(e.DateKeyed, e.DateLeft, e.RetirementDate) DESC, e.PFNo ASC
        `,
        params
    );

    return {
        filters: {
            status: statusFilter,
            pfNo: pfNo || ''
        },
        rows
    };
}

async function decideEndOfService({
    companyId,
    pfNo,
    dateKeyed,
    action,
    approvedBy
}) {
    const status = action === 'approve' ? -1 : 2;
    const normalizedDateKeyed = normalizeOptionalText(dateKeyed);
    const [result] = await pool.query(
        `
            UPDATE tbleos
            SET Approved = ?,
                ApprovedBy = ?,
                DateApproved = NOW(),
                TimeApproved = NOW()
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND PFNo = ?
              AND COALESCE(DateKeyed, '1900-01-01') = COALESCE(?, COALESCE(DateKeyed, '1900-01-01'))
              AND COALESCE(Approved, 0) = 0
        `,
        [status, approvedBy || 'Manager', Number(companyId) || 1, pfNo, normalizedDateKeyed]
    );

    return result;
}

async function getYearlyPaymentsReportData({ companyId, filters = {} }) {
    return getYearlyPaymentsPageData({ companyId, filters });
}

function buildMasterPaySheetFilters(filters = {}) {
    const conditions = ['p.CompanyID = ?'];
    const params = [Number(filters.companyId) || 1];

    if (filters.month) {
        conditions.push('p.PMonth = ?');
        params.push(filters.month);
    }

    if (filters.year) {
        conditions.push('p.PYear = ?');
        params.push(filters.year);
    }

    if (filters.payType) {
        conditions.push('p.PType = ?');
        params.push(filters.payType);
    }

    if (filters.department) {
        conditions.push('p.Dept = ?');
        params.push(filters.department);
    }

    return {
        whereClause: conditions.join('\n              AND '),
        params
    };
}

async function getDepartments() {
    const [rows] = await pool.query(
        `
            SELECT Code, Dept
            FROM tbldept
            ORDER BY Dept
        `
    );

    return rows;
}

async function getMasterPaySheetData({ companyId, filters = {} }) {
    const normalizedFilters = {
        companyId: Number(companyId) || 1,
        month: normalizePositiveInteger(filters.month),
        year: normalizePositiveInteger(filters.year),
        payType: normalizeOptionalText(filters.payType),
        department: normalizeOptionalText(filters.department)
    };

    const { whereClause, params } = buildMasterPaySheetFilters(normalizedFilters);
    const [company, payTypes, departments, rowsResult, totalsResult] = await Promise.all([
        getCompanyInfo(),
        getPayTypes(),
        getDepartments(),
        pool.query(
            `
                SELECT
                    p.*,
                    COALESCE(s.SName, p.PFNo) AS SName,
                    COALESCE(d.Dept, p.Dept) AS DeptName,
                    COALESCE(g.Grade, p.Grade) AS GradeName,
                    COALESCE(j.JobTitle, p.JobTitle) AS JobTitleName,
                    COALESCE(pt.PayType, p.PType) AS PayTypeName
                FROM tblpayroll p
                LEFT JOIN tblstaff s
                    ON s.PFNo = p.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = p.Dept
                LEFT JOIN tblgrade g
                    ON g.GradeCode = p.Grade
                LEFT JOIN tbljobtitle j
                    ON j.Code = p.JobTitle
                LEFT JOIN tblpaytype pt
                    ON pt.Code = p.PType
                WHERE ${whereClause}
                ORDER BY p.Dept, p.Grade, s.SName, p.PFNo
            `,
            params
        ),
        pool.query(
            `
                SELECT
                    COUNT(*) AS totalRows,
                    SUM(COALESCE(p.TotalIncome, 0)) AS totalIncome,
                    SUM(COALESCE(p.Tax, 0)) AS totalTax,
                    SUM(
                        COALESCE(p.NassitEmp, 0) + COALESCE(p.UnionDues, 0) + COALESCE(p.GratEmp, 0) +
                        COALESCE(p.Ded1, 0) + COALESCE(p.Ded2, 0) + COALESCE(p.Ded3, 0) +
                        COALESCE(p.Ded4, 0) + COALESCE(p.Ded5, 0) + COALESCE(p.Ded6, 0) +
                        COALESCE(p.Ded7, 0)
                    ) AS totalDeductions,
                    SUM(COALESCE(p.NetIncome, 0)) AS totalNet
                FROM tblpayroll p
                WHERE ${whereClause}
            `,
            params
        )
    ]);

    return {
        company,
        payTypes,
        departments,
        filters: {
            month: normalizedFilters.month || '',
            year: normalizedFilters.year || '',
            payType: normalizedFilters.payType || '',
            department: normalizedFilters.department || ''
        },
        rows: rowsResult[0],
        totals: totalsResult[0][0] || {
            totalRows: 0,
            totalIncome: 0,
            totalTax: 0,
            totalDeductions: 0,
            totalNet: 0
        }
    };
}

module.exports = {
    commitSalaryReviewRun,
    getEndOfServiceApprovalData,
    getMasterPaySheetData,
    getRunSalaryReviewData,
    getSalaryReviewApprovalData,
    getSalaryReviewsPageData,
    getYearlyPaymentsPageData,
    getYearlyPaymentsReportData,
    saveSalaryReview,
    saveYearlyPayment,
    decideEndOfService,
    decideSalaryReview
};
