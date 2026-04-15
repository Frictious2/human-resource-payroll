const APPROVED_STATUSES = [-1, 1];
const staffStatusService = require('./staffStatusService');

function createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

async function resolveSurchargeDateColumns(connection) {
    const [rows] = await connection.query(
        `
            SELECT COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'tblsurcharge'
              AND COLUMN_NAME IN ('SDate', 'EDate', 'StarDate', 'ExpDate')
        `
    );

    const columnNames = new Set(rows.map((row) => row.COLUMN_NAME));
    if (columnNames.has('SDate') && columnNames.has('EDate')) {
        return { startColumn: 'SDate', endColumn: 'EDate' };
    }

    if (columnNames.has('StarDate') && columnNames.has('ExpDate')) {
        return { startColumn: 'StarDate', endColumn: 'ExpDate' };
    }

    throw createError('Approved salary-related query adjustments could not be applied.', 409);
}

async function checkDuplicatePayroll(connection, { companyId, activityCode, payrollMonth, payrollYear }) {
    const [rows] = await connection.query(
        `
            SELECT COUNT(*) AS count
            FROM tblpayroll
            WHERE CompanyID = ?
              AND PType = ?
              AND PMonth = ?
              AND PYear = ?
        `,
        [companyId, activityCode, payrollMonth, payrollYear]
    );

    const count = Number(rows[0] && rows[0].count || 0);
    if (count > 0) {
        throw createError('This activity has already been processed for the selected month and year.', 409);
    }

    return count;
}

async function checkDuplicatePayrollRun(connection, { companyId, pMonth, pYear, pType }) {
    return checkDuplicatePayroll(connection, {
        companyId,
        activityCode: pType,
        payrollMonth: pMonth,
        payrollYear: pYear
    });
}

async function getSalarySourceSnapshot(connection, { companyId, payrollDate }) {
    const [rows] = await connection.query(
        `
            SELECT
                COUNT(*) AS total_rows,
                SUM(CASE WHEN sal.PFNo IS NULL OR TRIM(sal.PFNo) = '' OR s.PFNo IS NULL OR TRIM(s.PFNo) = '' THEN 1 ELSE 0 END) AS missing_pfno_rows,
                SUM(CASE WHEN sal.Salary IS NULL THEN 1 ELSE 0 END) AS missing_salary_rows,
                SUM(CASE WHEN sal.TotalIncome IS NULL THEN 1 ELSE 0 END) AS missing_total_income_rows,
                SUM(CASE WHEN s.CDept IS NULL OR TRIM(s.CDept) = '' THEN 1 ELSE 0 END) AS missing_dept_rows,
                SUM(CASE WHEN s.CGrade IS NULL OR TRIM(s.CGrade) = '' THEN 1 ELSE 0 END) AS missing_grade_rows,
                SUM(CASE WHEN e.PFNo IS NULL THEN 1 ELSE 0 END) AS missing_entitle_rows
            FROM tblsalary sal
            INNER JOIN (
                SELECT PFNo, MAX(PDate) AS latest_pdate
                FROM tblsalary
                GROUP BY PFNo
            ) latest
                ON latest.PFNo = sal.PFNo
                AND latest.latest_pdate = sal.PDate
            INNER JOIN tblstaff s
                ON s.PFNo = sal.PFNo
            ${staffStatusService.getPayrollStatusJoins({ staffAlias: 's' })}
            LEFT JOIN tblentitle e
                ON e.PFNo = s.PFNo
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND (s.DOE IS NULL OR DATE(s.DOE) <= ?)
              AND ${staffStatusService.getPayrollEligibilityClause({ staffAlias: 's', payrollDateExpression: "STR_TO_DATE(?, '%Y-%m-%d')" })}
        `,
        [companyId, companyId, payrollDate, payrollDate, payrollDate, payrollDate]
    );

    return rows[0] || {
        total_rows: 0,
        missing_pfno_rows: 0,
        missing_salary_rows: 0,
        missing_total_income_rows: 0,
        missing_dept_rows: 0,
        missing_grade_rows: 0,
        missing_entitle_rows: 0
    };
}

async function checkSalarySourceReady(connection, { companyId, payrollDate }) {
    const snapshot = await getSalarySourceSnapshot(connection, { companyId, payrollDate });
    const totalRows = Number(snapshot.total_rows || 0);
    const missingCriticalRows =
        Number(snapshot.missing_pfno_rows || 0) +
        Number(snapshot.missing_salary_rows || 0) +
        Number(snapshot.missing_total_income_rows || 0) +
        Number(snapshot.missing_dept_rows || 0) +
        Number(snapshot.missing_grade_rows || 0) +
        Number(snapshot.missing_entitle_rows || 0);

    if (totalRows === 0) {
        throw createError('No valid salary data found for the selected payroll period.', 404);
    }

    if (missingCriticalRows > 0) {
        throw createError('No valid salary data found for the selected payroll period.', 409);
    }

    return snapshot;
}

async function getApprovedSalaryQueries(connection, { companyId, payrollDate }) {
    const [rows] = await connection.query(
        `
            SELECT
                q.PFNO,
                q.QDate,
                q.QType,
                q.QDetails,
                q.MResponse,
                mr.Reaction AS MResponseName,
                q.SDate,
                q.EDate,
                q.Percent
            FROM tblquery q
            LEFT JOIN tblmreaction mr
                ON mr.Code = q.MResponse
            INNER JOIN tblstaff s
                ON s.PFNo = q.PFNO
            ${staffStatusService.getPayrollStatusJoins({ staffAlias: 's' })}
            WHERE (q.CompanyID = ? OR q.CompanyID IS NULL)
              AND (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND COALESCE(q.Approved, 0) IN (-1, 1)
              AND COALESCE(q.Expired, 0) = 0
              AND ${staffStatusService.getPayrollEligibilityClause({ staffAlias: 's', payrollDateExpression: "STR_TO_DATE(?, '%Y-%m-%d')" })}
              AND (
                    q.MResponse IN ('05', '12', '13')
                    OR UPPER(COALESCE(mr.Reaction, '')) IN ('SURCHARGED', 'SUSP -1/2 PAY (INTERDICTION)', 'SUSP WITHOUT PAY')
                  )
              AND (q.SDate IS NULL OR DATE(q.SDate) <= ?)
              AND (q.EDate IS NULL OR DATE(q.EDate) >= ?)
            ORDER BY q.PFNO, q.QDate DESC
        `,
        [companyId, companyId, companyId, payrollDate, payrollDate, payrollDate, payrollDate, payrollDate, payrollDate]
    );

    return rows;
}

async function getActiveLoanDeductions(connection, { companyId, payrollDate }) {
    const [rows] = await connection.query(
        `
            SELECT
                l.PFNo,
                SUM(COALESCE(l.MonthlyRepayment, 0)) AS loan_deduction,
                SUM(COALESCE(l.MonthlyInt, 0)) AS interest_deduction
            FROM tblloan l
            INNER JOIN tblstaff s
                ON s.PFNo = l.PFNo
            ${staffStatusService.getPayrollStatusJoins({ staffAlias: 's' })}
            WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
              AND (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND ${staffStatusService.getPayrollEligibilityClause({ staffAlias: 's', payrollDateExpression: "STR_TO_DATE(?, '%Y-%m-%d')" })}
              AND COALESCE(l.Approved, 0) IN (-1, 1)
              AND COALESCE(l.Expired, 0) = 0
              AND COALESCE(l.Repaid, 0) = 0
              AND COALESCE(l.LoanBal, 0) > 0
              AND COALESCE(l.LTrans, '') NOT IN ('03', '04')
              AND (l.StartDate IS NULL OR DATE(l.StartDate) <= ?)
              AND (l.ExpDate IS NULL OR DATE(l.ExpDate) >= ?)
              AND (
                    COALESCE(l.Reschedule, 0) = 0
                    OR l.RescheduleDate IS NULL
                    OR DATE(l.RescheduleDate) <= ?
                  )
            GROUP BY l.PFNo
        `,
        [companyId, companyId, companyId, payrollDate, payrollDate, payrollDate, payrollDate, payrollDate, payrollDate]
    );

    return rows;
}

async function getActiveMedicalDeductions(connection, { companyId, payrollDate, payrollMonth, payrollYear }) {
    const [rows] = await connection.query(
        `
            SELECT
                m.PFNo,
                SUM(COALESCE(m.Amount, 0)) AS medical_deduction
            FROM tblmedical m
            INNER JOIN tblstaff s
                ON s.PFNo = m.PFNo
            ${staffStatusService.getPayrollStatusJoins({ staffAlias: 's' })}
            WHERE (m.CompanyID = ? OR m.CompanyID IS NULL)
              AND (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND ${staffStatusService.getPayrollEligibilityClause({ staffAlias: 's', payrollDateExpression: "STR_TO_DATE(?, '%Y-%m-%d')" })}
              AND YEAR(m.EntryDate) = ?
              AND MONTH(m.EntryDate) = ?
              AND DATE(m.EntryDate) <= ?
            GROUP BY m.PFNo
        `,
        [companyId, companyId, companyId, payrollDate, payrollDate, payrollDate, payrollYear, payrollMonth, payrollDate]
    );

    return rows;
}

async function getActiveSurchargeDeductions(connection, { companyId, payrollDate }) {
    const { startColumn, endColumn } = await resolveSurchargeDateColumns(connection);
    const [rows] = await connection.query(
        `
            SELECT
                s.PFNo,
                SUM(COALESCE(s.SAmount, 0)) AS surcharge_deduction
            FROM tblsurcharge s
            INNER JOIN tblstaff st
                ON st.PFNo = s.PFNo
            ${staffStatusService.getPayrollStatusJoins({ staffAlias: 'st' })}
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND (st.CompanyID = ? OR st.CompanyID IS NULL)
              AND ${staffStatusService.getPayrollEligibilityClause({ staffAlias: 'st', payrollDateExpression: "STR_TO_DATE(?, '%Y-%m-%d')" })}
              AND COALESCE(s.Approved, 0) IN (-1, 1)
              AND COALESCE(s.Expired, 0) = 0
              AND (s.${startColumn} IS NULL OR DATE(s.${startColumn}) <= ?)
              AND (s.${endColumn} IS NULL OR DATE(s.${endColumn}) >= ?)
            GROUP BY s.PFNo
        `,
        [companyId, companyId, companyId, payrollDate, payrollDate, payrollDate, payrollDate, payrollDate]
    );

    return rows;
}

async function validateProcessEmoluments(connection, {
    companyId,
    activityCode,
    payrollDate,
    payrollMonth,
    payrollYear
}) {
    await checkDuplicatePayroll(connection, {
        companyId,
        activityCode,
        payrollMonth,
        payrollYear
    });

    if (activityCode === '01') {
        await checkSalarySourceReady(connection, {
            companyId,
            payrollDate
        });

        await Promise.all([
            getApprovedSalaryQueries(connection, { companyId, payrollDate }),
            getActiveLoanDeductions(connection, { companyId, payrollDate }),
            getActiveMedicalDeductions(connection, { companyId, payrollDate, payrollMonth, payrollYear }),
            getActiveSurchargeDeductions(connection, { companyId, payrollDate })
        ]);
    }
}

async function getPayrollSnapshot(connection, { companyId, activityCode, payrollMonth, payrollYear }) {
    const [rows] = await connection.query(
        `
            SELECT
                COUNT(*) AS total_rows,
                SUM(CASE WHEN Approved IN (-1, 1) THEN 1 ELSE 0 END) AS approved_rows,
                SUM(CASE WHEN COALESCE(Approved, 0) NOT IN (-1, 1) THEN 1 ELSE 0 END) AS unapproved_rows,
                SUM(CASE WHEN COALESCE(posted_to_gl, 0) <> 0 THEN 1 ELSE 0 END) AS posted_rows,
                SUM(CASE WHEN PFNo IS NULL OR TRIM(PFNo) = '' THEN 1 ELSE 0 END) AS missing_pfno_rows,
                SUM(CASE WHEN Salary IS NULL THEN 1 ELSE 0 END) AS missing_salary_rows,
                SUM(CASE WHEN TotalIncome IS NULL THEN 1 ELSE 0 END) AS missing_total_income_rows
            FROM tblpayroll
            WHERE CompanyID = ?
              AND PType = ?
              AND PMonth = ?
              AND PYear = ?
        `,
        [companyId, activityCode, payrollMonth, payrollYear]
    );

    return rows[0] || {
        total_rows: 0,
        approved_rows: 0,
        unapproved_rows: 0,
        posted_rows: 0,
        missing_pfno_rows: 0,
        missing_salary_rows: 0,
        missing_total_income_rows: 0
    };
}

async function checkPayrollExists(connection, { companyId, activityCode, payrollMonth, payrollYear }) {
    const snapshot = await getPayrollSnapshot(connection, {
        companyId,
        activityCode,
        payrollMonth,
        payrollYear
    });

    if (Number(snapshot.total_rows || 0) === 0) {
        throw createError('Payroll not found for the selected month and activity.', 404);
    }

    return snapshot;
}

async function checkPayrollApproved(connection, { companyId, activityCode, payrollMonth, payrollYear, snapshot }) {
    const currentSnapshot = snapshot || await getPayrollSnapshot(connection, {
        companyId,
        activityCode,
        payrollMonth,
        payrollYear
    });

    const missingCriticalRows =
        Number(currentSnapshot.missing_pfno_rows || 0) +
        Number(currentSnapshot.missing_salary_rows || 0) +
        Number(currentSnapshot.missing_total_income_rows || 0);

    if (missingCriticalRows > 0) {
        throw createError('Payroll data has missing critical fields.', 409);
    }

    if (Number(currentSnapshot.approved_rows || 0) === 0 || Number(currentSnapshot.unapproved_rows || 0) > 0) {
        throw createError('Payroll not approved.', 409);
    }

    return currentSnapshot;
}

async function checkPayrollAlreadyPosted(connection, { companyId, activityCode, payrollMonth, payrollYear, snapshot }) {
    const currentSnapshot = snapshot || await getPayrollSnapshot(connection, {
        companyId,
        activityCode,
        payrollMonth,
        payrollYear
    });

    const [batchRows] = await connection.query(
        `
            SELECT COUNT(*) AS count
            FROM payroll_gl_posting_batches
            WHERE company_id = ?
              AND activity_code = ?
              AND posting_month = ?
              AND posting_year = ?
              AND status <> 'reversed'
        `,
        [companyId, activityCode, payrollMonth, payrollYear]
    );

    const [exportRows] = await connection.query(
        `
            SELECT COUNT(*) AS count
            FROM tblexport
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND TCode = ?
              AND YEAR(EntryDate) = ?
              AND MONTH(EntryDate) = ?
        `,
        [companyId, activityCode, payrollYear, payrollMonth]
    );

    if (Number(currentSnapshot.posted_rows || 0) > 0 ||
        Number(batchRows[0] && batchRows[0].count || 0) > 0 ||
        Number(exportRows[0] && exportRows[0].count || 0) > 0) {
        throw createError('This payroll activity has already been posted to accounts for the selected month and year.', 409);
    }

    return currentSnapshot;
}

async function checkGLAlreadyPosted(connection, args) {
    return checkPayrollAlreadyPosted(connection, args);
}

async function getIneligibleStaffForPayrollPeriod(connection, {
    companyId,
    activityCode,
    payrollMonth,
    payrollYear
}) {
    const [rows] = await connection.query(
        `
            SELECT
                p.PFNo,
                COALESCE(s.SName, '') AS SName,
                p.PDate,
                s.EmpStatus,
                status_lookup.Status AS StatusName,
                s.ReasonDate,
                s.DateRedundant,
                former_status.effective_former_date AS FormerEffectiveDate,
                s.Redundant
            FROM tblpayroll p
            INNER JOIN tblstaff s
                ON s.PFNo = p.PFNo
            ${staffStatusService.getPayrollStatusJoins({ staffAlias: 's' })}
            WHERE p.CompanyID = ?
              AND p.PType = ?
              AND p.PMonth = ?
              AND p.PYear = ?
              AND ${staffStatusService.getPayrollIneligibilityClause({
                  staffAlias: 's',
                  payrollDateExpression: "COALESCE(DATE(p.PDate), STR_TO_DATE(CONCAT(p.PYear, '-', LPAD(p.PMonth, 2, '0'), '-01'), '%Y-%m-%d'))"
              })}
            ORDER BY p.PFNo
        `,
        [companyId, companyId, activityCode, payrollMonth, payrollYear]
    );

    return rows;
}

async function validateNoFormerRetiredRedundantInPayroll(connection, {
    companyId,
    activityCode,
    payrollMonth,
    payrollYear
}) {
    const rows = await getIneligibleStaffForPayrollPeriod(connection, {
        companyId,
        activityCode,
        payrollMonth,
        payrollYear
    });

    if (rows.length > 0) {
        const staffList = rows.slice(0, 5).map((row) => row.PFNo).join(', ');
        throw createError(
            `One or more payroll rows belong to staff who were already Former, Retired, or Redundant for the selected payroll period.${staffList ? ` Staff: ${staffList}.` : ''}`,
            409
        );
    }

    return rows;
}

async function isStaffActiveForPayrollPeriod(connection, { pfNo, payrollDate, companyId = null }) {
    const sql = `
        SELECT s.PFNo
        FROM tblstaff s
        ${staffStatusService.getPayrollStatusJoins({ staffAlias: 's' })}
        WHERE s.PFNo = ?
          ${companyId ? 'AND (s.CompanyID = ? OR s.CompanyID IS NULL)' : ''}
          AND ${staffStatusService.getPayrollEligibilityClause({ staffAlias: 's', payrollDateExpression: "STR_TO_DATE(?, '%Y-%m-%d')" })}
        LIMIT 1
    `;

    const params = companyId
        ? [companyId, pfNo, companyId, payrollDate, payrollDate, payrollDate]
        : [null, pfNo, payrollDate, payrollDate, payrollDate];

    const [rows] = await connection.query(sql, params);
    return rows.length > 0;
}

async function validatePayrollBeforePosting(connection, {
    companyId,
    activityCode,
    postingMonth,
    postingYear
}) {
    const snapshot = await checkPayrollExists(connection, {
        companyId,
        activityCode,
        payrollMonth: postingMonth,
        payrollYear: postingYear
    });

    await checkPayrollApproved(connection, {
        companyId,
        activityCode,
        payrollMonth: postingMonth,
        payrollYear: postingYear,
        snapshot
    });

    await checkPayrollAlreadyPosted(connection, {
        companyId,
        activityCode,
        payrollMonth: postingMonth,
        payrollYear: postingYear,
        snapshot
    });

    await validateNoFormerRetiredRedundantInPayroll(connection, {
        companyId,
        activityCode,
        payrollMonth: postingMonth,
        payrollYear: postingYear
    });

    return snapshot;
}

module.exports = {
    APPROVED_STATUSES,
    checkDuplicatePayroll,
    checkDuplicatePayrollRun,
    checkGLAlreadyPosted,
    checkPayrollAlreadyPosted,
    checkPayrollApproved,
    checkPayrollExists,
    getIneligibleStaffForPayrollPeriod,
    getActiveLoanDeductions,
    getActiveMedicalDeductions,
    getActiveSurchargeDeductions,
    getApprovedSalaryQueries,
    isStaffActiveForPayrollPeriod,
    validateNoFormerRetiredRedundantInPayroll,
    validatePayrollBeforePosting,
    validateProcessEmoluments
};
