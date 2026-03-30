const pool = require('../config/db');
const { ACTIVITY_DEFINITIONS, parsePayrollDate, validateProcessRequest } = require('../validations/processEmolumentsValidation');

const ALLOWED_ROLES = new Set(['data-entry', 'admin', 'manager', 'developer']);
const APPROVED_STATUSES = [-1, 1];

function roundAmount(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function derivePayrollPeriod(payrollDate) {
    const parsedDate = parsePayrollDate(payrollDate);
    return {
        parsedDate,
        payrollMonth: parsedDate.getMonth() + 1,
        payrollYear: parsedDate.getFullYear()
    };
}

function formatSqlDate(date) {
    return date.toISOString().slice(0, 10);
}

function isLegacyYesSql(columnName) {
    return `COALESCE(${columnName}, 0) <> 0`;
}

function makeHistoryKey({ activityCode, payrollMonth, payrollYear }) {
    return `${payrollYear}-${String(payrollMonth).padStart(2, '0')}-${activityCode}`;
}

function parseHistoryKey(batchId) {
    const match = String(batchId || '').match(/^(\d{4})-(\d{2})-([A-Za-z0-9]+)$/);
    if (!match) {
        const error = new Error('Processing batch not found.');
        error.statusCode = 404;
        throw error;
    }

    return {
        payrollYear: Number(match[1]),
        payrollMonth: Number(match[2]),
        activityCode: match[3]
    };
}

async function getNextAuditTrailId(connection) {
    const [rows] = await connection.query(
        'SELECT COALESCE(MAX(AuditTrailID), 0) + 1 AS nextId FROM tblaudittrail'
    );

    return rows[0] && rows[0].nextId ? rows[0].nextId : 1;
}

async function logProcessAudit(connection, {
    companyId,
    userName,
    action,
    recordId,
    message
}) {
    const nextId = await getNextAuditTrailId(connection);
    await connection.query(
        `INSERT INTO tblaudittrail
        (AuditTrailID, ChangeDate, UserName, FormName, Action, RecordID, FieldName, OldValue, NewValue, Loggedout, CompanyID)
        VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            nextId,
            userName || 'System',
            'payroll/process-emoluments',
            action,
            String(recordId || '').slice(0, 6) || null,
            null,
            null,
            message || null,
            0,
            companyId
        ]
    );
}

async function getCompanyPaymentSetup(connection, companyId) {
    const [rows] = await connection.query(
        `SELECT CompanyID, AccNo, PayingBank
         FROM tblcominfo
         WHERE CompanyID = ?
         LIMIT 1`,
        [companyId]
    );

    if (rows.length > 0) {
        return rows[0];
    }

    const [fallbackRows] = await connection.query(
        'SELECT CompanyID, AccNo, PayingBank FROM tblcominfo LIMIT 1'
    );

    return fallbackRows[0] || { CompanyID: companyId, AccNo: '', PayingBank: '' };
}

async function ensureSalarySourceApproved(connection, { companyId, payrollDate }) {
    const [pendingSalaryRows] = await connection.query(
        `
            SELECT COUNT(*) AS count
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
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND (s.DOE IS NULL OR DATE(s.DOE) <= ?)
              AND COALESCE(s.Redundant, 0) = 0
              AND COALESCE(s.EmpStatus, '01') <> '04'
              AND COALESCE(sal.Approved, 0) = 0
        `,
        [companyId, payrollDate]
    );

    const [pendingEntitleRows] = await connection.query(
        `
            SELECT COUNT(*) AS count
            FROM tblentitle e
            INNER JOIN tblstaff s
                ON s.PFNo = e.PFNo
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND (s.DOE IS NULL OR DATE(s.DOE) <= ?)
              AND COALESCE(s.Redundant, 0) = 0
              AND COALESCE(s.EmpStatus, '01') <> '04'
              AND COALESCE(e.Approved, 0) = 0
        `,
        [companyId, payrollDate]
    );

    if (Number(pendingSalaryRows[0].count || 0) > 0 || Number(pendingEntitleRows[0].count || 0) > 0) {
        const error = new Error('Salary processing is blocked because some salary or entitlement records are still pending manager approval.');
        error.statusCode = 409;
        throw error;
    }
}

async function getDuplicatePayrollCount(connection, { companyId, activityCode, payrollMonth, payrollYear }) {
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

    return Number(rows[0].count || 0);
}

async function insertFullPaySalaryRows(connection, {
    payrollDate,
    payrollMonth,
    payrollYear,
    companyId,
    payingBBAN,
    payingBank,
    operatorName
}) {
    // tblSalary is the monthly payroll-ready source. For full-pay rows we copy the
    // approved source values into tblPayroll without rebuilding salary logic.
    const [result] = await connection.query(
        `
            INSERT INTO tblpayroll (
                SalDate, PDate, PFNo, Dept, Grade, JobTitle, PayThrough, Bank, Branch, PayingBBAN, PayingBank, AccountNo, Level,
                EmpType, PayCurrency, ExchRate, Salary, Allw02, Allw03, Allw04, Allw05, Allw06, Allw07, Allw08, Allw09, Allw10,
                Allw11, Allw12, Allw13, Allw14, Allw15, Allw16, Allw17, Allw18, Allw19, Allw20, TotalIncome, Taxable, Tax,
                NassitEmp, NassitInst, UnionDues, GratEmp, GratInst, NetIncome, LoanCounter, LoanRescheduled, Ded1, Ded2, Ded3,
                Ded4, Ded5, Ded6, Ded7, MReaction, PMonth, PYear, PType, Paid, DatePaid, FullPay, HalfPay, PDays, WithoutPay,
                Operator, DateKeyed, TimeKeyed, Approved, ApprovedBy, DateApproved, TimeApproved, CompanyID
            )
            SELECT
                ?, ?, s.PFNo, s.CDept, s.CGrade, s.JobTitle,
                COALESCE(e.PayThrough, sal.PayThrough), COALESCE(e.Bank, sal.Bank), sal.Branch, ?, ?, COALESCE(e.AccountNo, s.AccountNo, sal.AccountNo), s.Level,
                s.EmpType, s.PayCurrency, sal.ExchRate, sal.Salary, sal.Allw02, sal.Allw03, sal.Allw04, sal.Allw05, sal.Allw06, sal.Allw07, sal.Allw08, sal.Allw09, sal.Allw10,
                sal.Allw11, sal.Allw12, sal.Allw13, sal.Allw14, sal.Allw15, sal.Allw16, sal.Allw17, sal.Allw18, sal.Allw19, sal.Allw20, sal.TotalIncome, sal.Taxable, sal.Tax,
                sal.NassitEmp, sal.NassitInst, sal.UnionDues, sal.GratEmp, sal.GratInst, sal.NetIncome, sal.LoanCounter, sal.LoanRescheduled, sal.Ded1, 0, sal.Ded3,
                sal.Ded4, sal.Ded5, 0, 0, sal.MReaction, ?, ?, '01', 0, NULL, sal.FullPay, sal.HalfPay, sal.Days, sal.WithoutPay,
                ?, NOW(), NOW(), sal.Approved, sal.ApprovedBy, sal.DateApproved, sal.TimeApproved, COALESCE(s.CompanyID, sal.CompanyID, ?)
            FROM tblstaff s
            INNER JOIN tblsalary sal
                ON s.PFNo = sal.PFNo
            INNER JOIN (
                SELECT PFNo, MAX(PDate) AS latest_pdate
                FROM tblsalary
                GROUP BY PFNo
            ) latest
                ON latest.PFNo = sal.PFNo
                AND latest.latest_pdate = sal.PDate
            LEFT JOIN tblentitle e
                ON e.PFNo = s.PFNo
                AND COALESCE(e.Approved, -1) IN (-1, 1)
            WHERE sal.TotalIncome > 0
              AND ${isLegacyYesSql('sal.FullPay')}
              AND COALESCE(sal.HalfPay, 0) = 0
              AND COALESCE(sal.WithoutPay, 0) = 0
              AND COALESCE(sal.Approved, 0) IN (-1, 1)
              AND COALESCE(s.Approved, 0) IN (-1, 1)
              AND COALESCE(s.Redundant, 0) = 0
              AND COALESCE(s.EmpStatus, '01') <> '04'
              AND COALESCE(sal.Posted, 0) = 0
              AND (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND ((s.DOE IS NULL OR DATE(s.DOE) <= ?) AND (s.ReasonDate IS NULL OR DATE(s.ReasonDate) > ?))
        `,
        [
            payrollDate,
            payrollDate,
            payingBBAN,
            payingBank,
            payrollMonth,
            payrollYear,
            operatorName,
            companyId,
            companyId,
            payrollDate,
            payrollDate
        ]
    );

    return result.affectedRows || 0;
}

async function insertHalfPaySalaryRows(connection, {
    payrollDate,
    payrollMonth,
    payrollYear,
    companyId,
    payingBBAN,
    payingBank,
    operatorName
}) {
    // Half pay is a narrow legacy exception. The row still comes from tblSalary,
    // but specific stored source values are adjusted during the move to tblPayroll.
    const [result] = await connection.query(
        `
            INSERT INTO tblpayroll (
                SalDate, PDate, PFNo, Dept, Grade, JobTitle, PayThrough, Bank, Branch, PayingBBAN, PayingBank, AccountNo, Level,
                EmpType, PayCurrency, ExchRate, Salary, Allw02, Allw03, Allw04, Allw05, Allw06, Allw07, Allw08, Allw09, Allw10,
                Allw11, Allw12, Allw13, Allw14, Allw15, Allw16, Allw17, Allw18, Allw19, Allw20, TotalIncome, Taxable, Tax,
                NassitEmp, NassitInst, UnionDues, GratEmp, GratInst, NetIncome, LoanCounter, LoanRescheduled, Ded1, Ded2, Ded3,
                Ded4, Ded5, Ded6, Ded7, MReaction, PMonth, PYear, PType, Paid, DatePaid, FullPay, HalfPay, PDays, WithoutPay,
                Operator, DateKeyed, TimeKeyed, Approved, ApprovedBy, DateApproved, TimeApproved, CompanyID
            )
            SELECT
                ?, ?, s.PFNo, s.CDept, s.CGrade, s.JobTitle,
                COALESCE(e.PayThrough, sal.PayThrough), COALESCE(e.Bank, sal.Bank), sal.Branch, ?, ?, COALESCE(e.AccountNo, s.AccountNo, sal.AccountNo), s.Level,
                s.EmpType, s.PayCurrency, sal.ExchRate,
                sal.Salary / 2,
                sal.Allw02,
                sal.Allw03 / 2, sal.Allw04 / 2, sal.Allw05 / 2, sal.Allw06 / 2, sal.Allw07 / 2, sal.Allw08 / 2, sal.Allw09 / 2, sal.Allw10 / 2,
                sal.Allw11 / 2, sal.Allw12 / 2, sal.Allw13, 0, sal.Allw15 / 2, sal.Allw16 / 2, sal.Allw17 / 2, sal.Allw18 / 2, sal.Allw19 / 2, sal.Allw20 / 2,
                (sal.TotalIncome / 2) + (sal.Allw02 / 2) + (sal.Allw13 / 2),
                (sal.Taxable / 2) + (sal.Allw02 / 2) + (sal.Allw13 / 2),
                sal.Tax / 2,
                sal.NassitEmp / 2, sal.NassitInst / 2, sal.UnionDues, sal.GratEmp / 2, sal.GratInst / 2,
                (sal.NetIncome / 2) + (sal.Allw02 / 2) + (sal.Allw13 / 2),
                sal.LoanCounter, sal.LoanRescheduled, sal.Ded1, 0, sal.Ded3, sal.Ded4, sal.Ded5, 0, 0, sal.MReaction, ?, ?, '01', 0, NULL,
                sal.FullPay, sal.HalfPay, sal.Days, sal.WithoutPay, ?, NOW(), NOW(), sal.Approved, sal.ApprovedBy, sal.DateApproved, sal.TimeApproved, COALESCE(s.CompanyID, sal.CompanyID, ?)
            FROM tblstaff s
            INNER JOIN tblsalary sal
                ON s.PFNo = sal.PFNo
            INNER JOIN (
                SELECT PFNo, MAX(PDate) AS latest_pdate
                FROM tblsalary
                GROUP BY PFNo
            ) latest
                ON latest.PFNo = sal.PFNo
                AND latest.latest_pdate = sal.PDate
            LEFT JOIN tblentitle e
                ON e.PFNo = s.PFNo
                AND COALESCE(e.Approved, -1) IN (-1, 1)
            WHERE ${isLegacyYesSql('sal.HalfPay')}
              AND COALESCE(sal.WithoutPay, 0) = 0
              AND COALESCE(sal.Approved, 0) IN (-1, 1)
              AND COALESCE(s.Approved, 0) IN (-1, 1)
              AND COALESCE(s.Redundant, 0) = 0
              AND COALESCE(s.EmpStatus, '01') <> '04'
              AND (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND (s.DOE IS NULL OR DATE(s.DOE) <= ?)
              AND (s.ReasonDate IS NULL OR DATE(s.ReasonDate) > ?)
        `,
        [
            payrollDate,
            payrollDate,
            payingBBAN,
            payingBank,
            payrollMonth,
            payrollYear,
            operatorName,
            companyId,
            companyId,
            payrollDate,
            payrollDate
        ]
    );

    return result.affectedRows || 0;
}

async function runSalarySideEffects(connection, {
    payrollDate,
    payrollMonth,
    payrollYear
}) {
    await connection.query(
        `
            INSERT INTO tblloanrepyt (PFNo, DeductionDate, LoanType, DAmount, DCode, ExpDate, TransRef)
            SELECT
                l.PFNo, ?, l.LTypeCode, IF(p.Ded1 = 0, p.Ded4, p.Ded1), l.LTrans, l.ExpDate, l.TransNo
            FROM tblpayroll p
            INNER JOIN tblloan l
                ON p.PFNo = l.PFNo
            WHERE IF(p.Ded1 = 0, p.Ded4, p.Ded1) > 0
              AND l.Expired = 0
              AND DATE(p.PDate) = ?
              AND p.PType = '01'
              AND p.PMonth = ?
              AND p.PYear = ?
        `,
        [payrollDate, payrollDate, payrollMonth, payrollYear]
    );

    await connection.query(
        `
            INSERT INTO tblloan (PFNo, LTypeCode, LTrans, Amount, EntryDate, TransNo, Approved, Expired, Reschedule, Repaid)
            SELECT lr.PFNo, lr.LoanType, '03', lr.DAmount, ?, lr.TransRef, 1, 1, 0, 0
            FROM tblloanrepyt lr
            WHERE DATE(lr.DeductionDate) = ?
        `,
        [payrollDate, payrollDate]
    );

    await connection.query(
        `
            UPDATE tblsalary s
            INNER JOIN tblloan l
                ON s.PFNo = l.PFNo
            SET s.LoanCounter = l.DurationBal
            WHERE s.LoanCounter > 0
              AND l.LTrans NOT IN ('03', '04')
        `
    );

    await connection.query(
        `
            UPDATE tblloan
            SET LoanBal = LoanBal - MonthlyRepayment,
                DurationBal = DurationBal - 1,
                Expired = IF(LoanBal <= 0, 1, 0)
            WHERE LoanBal > 0
              AND DurationBal > 0
              AND LTrans NOT IN ('03', '04')
              AND LTypeCode NOT IN ('03', '04')
        `
    );

    await connection.query(
        `
            UPDATE tblsalary s
            INNER JOIN tblloan l
                ON s.PFNo = l.PFNo
            SET s.Ded1 = 0,
                s.LoanCounter = l.DurationBal,
                l.Expired = 1,
                s.Ded3 = 0,
                s.Ded4 = 0
            WHERE s.LoanCounter <= 0
              AND l.Expired = 0
              AND l.LoanBal <= 0
              AND l.LTrans NOT IN ('03', '04')
        `
    );

    await connection.query(
        'DELETE FROM tblleaveallowance WHERE DATE(EntryDate) = ? AND TCode = ? AND PMonth = ? AND PYear = ?',
        [payrollDate, '01', payrollMonth, payrollYear]
    );

    await connection.query(
        `
            INSERT IGNORE INTO tblleaveallowance (EntryDate, PFNo, SName, L_Allowance, TCode, PMonth, PYear, Initiated, Paid)
            SELECT ?, s.PFNo, s.SName, yp.TotalIncome, '01', ?, ?, 1, 0
            FROM tblstaff s
            INNER JOIN tblyearlypayments yp
                ON s.PFNo = yp.PFNo
            WHERE COALESCE(s.EmpStatus, '01') <> '04'
              AND yp.PType = '13'
        `,
        [payrollDate, payrollMonth, payrollYear]
    );

    await connection.query(
        `
            INSERT INTO tblpayday (PayDate)
            SELECT DISTINCT SalDate
            FROM tblpayroll
            WHERE DATE(SalDate) = ?
        `,
        [payrollDate]
    );

    await connection.query(
        `
            UPDATE tblsalary s
            INNER JOIN tblloan l
                ON s.PFNo = l.PFNo
            SET s.Ded1 = 0,
                s.NetIncome = s.TotalIncome - (s.Tax + s.NassitEmp + s.GratEmp + s.UnionDues + s.Ded3 + s.Ded4 + s.Ded5)
            WHERE l.Expired = 0
              AND l.LTrans = '01'
              AND l.LoanBal > 0
              AND l.RescheduleDate > ?
              AND l.Approved IN (-1, 1)
              AND l.Reschedule = 1
              AND l.Repaid = 0
        `,
        [payrollDate]
    );

    await connection.query(
        `
            UPDATE tblacting a
            INNER JOIN tblsalary s
                ON a.PFNo = s.PFNo
            SET s.Allw14 = 0,
                s.Paid = 0
            WHERE (a.Closed = 1 AND a.Approved IN (-1, 1) AND a.EDate < CURDATE())
               OR (a.EDate IS NOT NULL AND a.EDate < CURDATE())
        `
    );

    await connection.query(
        `
            INSERT INTO tblgltrans (
                GLDate, BasicSalary, Headquarters, Transport, COLA, Responsibility, MaidAllowance, Acting, Risk, Professional,
                StaffWelfare, Academic, IncomeTax, NassitEmp, ProvidentEmp, SSA, JSA, GLMonth, GLYear, SalAdvance, IntOnAdv,
                SalaryWages, Rent, Approved
            )
            SELECT
                MAX(p.PDate),
                SUM(IF(p.Dept IN ('06', '12'), 0, p.Salary)),
                SUM(IF(p.Dept IN ('06', '12'), p.Salary + p.Allw03 + p.Allw04 + p.Allw05 + p.Allw06 + p.Allw10 + p.Allw11 + p.Allw12 + p.Allw14 + p.Allw16 + p.Allw17 + p.Allw19 + p.Allw20, 0)),
                SUM(IF(p.Dept IN ('06', '12'), 0, p.Allw03 + p.Allw10)),
                SUM(IF(p.Dept IN ('06', '12'), 0, p.Allw06)),
                SUM(IF(p.Dept IN ('06', '12'), 0, p.Allw11)),
                SUM(IF(p.Dept IN ('06', '12'), 0, p.Allw12)),
                SUM(IF(p.Dept IN ('06', '12'), 0, p.Allw14)),
                SUM(IF(p.Dept IN ('06', '12'), 0, p.Allw17)),
                SUM(IF(p.Dept IN ('06', '12'), 0, p.Allw16)),
                SUM(p.Allw04),
                SUM(IF(p.Dept IN ('06', '12'), 0, p.Allw19)),
                SUM(p.Tax),
                SUM(p.NassitEmp),
                SUM(p.GratEmp),
                SUM(IF(p.Level = '01', p.Ded2, 0)),
                SUM(IF(p.Level = '02', p.Ded2, 0)),
                p.PMonth,
                MAX(p.PYear),
                SUM(p.Ded1),
                SUM(p.Ded3),
                SUM(p.NetIncome),
                SUM(p.Ded4),
                0
            FROM tblpayroll p
            WHERE DATE(p.PDate) = ?
              AND p.PType = '01'
              AND p.PMonth = ?
              AND p.PYear = ?
            GROUP BY p.PMonth
        `,
        [payrollDate, payrollMonth, payrollYear]
    );
}

function mapHistoryRow(row) {
    return {
        id: makeHistoryKey({
            activityCode: row.activity_code,
            payrollMonth: row.payroll_month,
            payrollYear: row.payroll_year
        }),
        activity_code: row.activity_code,
        activity_name: ACTIVITY_DEFINITIONS[row.activity_code] || row.activity_code,
        payroll_month: row.payroll_month,
        payroll_year: row.payroll_year,
        payroll_date: row.payroll_date,
        processed_at: row.processed_at,
        total_staff: row.total_staff,
        total_gross: row.total_gross,
        total_tax: row.total_tax,
        total_deductions: row.total_deductions,
        total_net: row.total_net,
        processed_by_name: row.processed_by_name,
        status: 'processed'
    };
}

class ProcessEmolumentsService {
    static getActivities() {
        return Object.entries(ACTIVITY_DEFINITIONS).map(([code, name]) => ({ code, name }));
    }

    static ensureAuthorized(userRole) {
        if (!ALLOWED_ROLES.has(userRole)) {
            const error = new Error('You are not authorized to process emoluments.');
            error.statusCode = 403;
            throw error;
        }
    }

    static async processEmoluments({ companyId, activityCode, payrollDate, processedByName, userRole }) {
        const validationError = validateProcessRequest({ companyId, activityCode, payrollDate });
        if (validationError) {
            const error = new Error(validationError);
            error.statusCode = 400;
            throw error;
        }

        this.ensureAuthorized(userRole);

        const { parsedDate, payrollMonth, payrollYear } = derivePayrollPeriod(payrollDate);
        const sqlDate = formatSqlDate(parsedDate);
        const activityName = ACTIVITY_DEFINITIONS[activityCode];

        if (activityCode !== '01') {
            const error = new Error(`${activityName} processing is not fully implemented yet.`);
            error.statusCode = 501;
            throw error;
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const duplicateCount = await getDuplicatePayrollCount(connection, {
                companyId,
                activityCode,
                payrollMonth,
                payrollYear
            });

            if (duplicateCount > 0) {
                const error = new Error('This activity has already been processed for the selected month and year.');
                error.statusCode = 409;
                throw error;
            }

            await ensureSalarySourceApproved(connection, {
                companyId,
                payrollDate: sqlDate
            });

            const companySetup = await getCompanyPaymentSetup(connection, companyId);
            // Activity 01 is a posting step from tblSalary into tblPayroll. We read
            // the approved source values from tblSalary and only apply limited
            // legacy exceptions such as half-pay adjustments during the insert.
            const fullPayCount = await insertFullPaySalaryRows(connection, {
                payrollDate: sqlDate,
                payrollMonth,
                payrollYear,
                companyId,
                payingBBAN: companySetup.AccNo || '',
                payingBank: companySetup.PayingBank || '',
                operatorName: processedByName || 'System'
            });
            const halfPayCount = await insertHalfPaySalaryRows(connection, {
                payrollDate: sqlDate,
                payrollMonth,
                payrollYear,
                companyId,
                payingBBAN: companySetup.AccNo || '',
                payingBank: companySetup.PayingBank || '',
                operatorName: processedByName || 'System'
            });

            const totalInserted = fullPayCount + halfPayCount;
            if (totalInserted === 0) {
                const error = new Error('No approved and eligible salary records were found for the selected month and year.');
                error.statusCode = 404;
                throw error;
            }

            await runSalarySideEffects(connection, {
                payrollDate: sqlDate,
                payrollMonth,
                payrollYear
            });

            const [[summary]] = await connection.query(
                `
                    SELECT
                        COUNT(*) AS totalStaff,
                        COALESCE(SUM(TotalIncome), 0) AS totalGross,
                        COALESCE(SUM(Tax), 0) AS totalTax,
                        COALESCE(SUM(COALESCE(NassitEmp, 0) + COALESCE(UnionDues, 0) + COALESCE(GratEmp, 0) + COALESCE(Ded1, 0) + COALESCE(Ded2, 0) + COALESCE(Ded3, 0) + COALESCE(Ded4, 0) + COALESCE(Ded5, 0) + COALESCE(Ded6, 0) + COALESCE(Ded7, 0)), 0) AS totalDeductions,
                        COALESCE(SUM(NetIncome), 0) AS totalNet
                    FROM tblpayroll
                    WHERE CompanyID = ?
                      AND PType = '01'
                      AND PMonth = ?
                      AND PYear = ?
                `,
                [companyId, payrollMonth, payrollYear]
            );

            const recordId = makeHistoryKey({ activityCode, payrollMonth, payrollYear });
            await logProcessAudit(connection, {
                companyId,
                userName: processedByName || 'System',
                action: 'New',
                recordId,
                message: `Processed ${summary.totalStaff} salary payroll record(s) for ${String(payrollMonth).padStart(2, '0')}/${payrollYear}.`
            });

            await connection.commit();

            return {
                batchId: recordId,
                activityCode,
                activityName,
                payrollMonth,
                payrollYear,
                totalStaff: Number(summary.totalStaff || 0),
                totalGross: roundAmount(summary.totalGross),
                totalTax: roundAmount(summary.totalTax),
                totalDeductions: roundAmount(summary.totalDeductions),
                totalNet: roundAmount(summary.totalNet)
            };
        } catch (error) {
            await connection.rollback();

            try {
                await logProcessAudit(connection, {
                    companyId,
                    userName: processedByName || 'System',
                    action: 'Edit',
                    recordId: makeHistoryKey({ activityCode, payrollMonth, payrollYear }),
                    message: error.message
                });
            } catch (auditError) {
                // Ignore audit failures so the original processing error is preserved.
            }

            throw error;
        } finally {
            connection.release();
        }
    }

    static async getHistory({ companyId, filters = {} }) {
        const conditions = ['p.CompanyID = ?', 'p.PMonth > 0', 'p.PYear > 0'];
        const params = [companyId];

        if (filters.activityCode) {
            conditions.push('p.PType = ?');
            params.push(filters.activityCode);
        }

        if (filters.month) {
            conditions.push('p.PMonth = ?');
            params.push(filters.month);
        }

        if (filters.year) {
            conditions.push('p.PYear = ?');
            params.push(filters.year);
        }

        if (filters.status && filters.status !== 'processed') {
            return [];
        }

        const [rows] = await pool.query(
            `
                SELECT
                    p.PType AS activity_code,
                    p.PMonth AS payroll_month,
                    p.PYear AS payroll_year,
                    MAX(p.SalDate) AS payroll_date,
                    MAX(p.DateKeyed) AS processed_at,
                    COUNT(*) AS total_staff,
                    COALESCE(SUM(p.TotalIncome), 0) AS total_gross,
                    COALESCE(SUM(p.Tax), 0) AS total_tax,
                    COALESCE(SUM(COALESCE(p.NassitEmp, 0) + COALESCE(p.UnionDues, 0) + COALESCE(p.GratEmp, 0) + COALESCE(p.Ded1, 0) + COALESCE(p.Ded2, 0) + COALESCE(p.Ded3, 0) + COALESCE(p.Ded4, 0) + COALESCE(p.Ded5, 0) + COALESCE(p.Ded6, 0) + COALESCE(p.Ded7, 0)), 0) AS total_deductions,
                    COALESCE(SUM(p.NetIncome), 0) AS total_net,
                    MAX(COALESCE(p.Operator, 'System')) AS processed_by_name
                FROM tblpayroll p
                WHERE ${conditions.join(' AND ')}
                GROUP BY p.CompanyID, p.PType, p.PMonth, p.PYear
                ORDER BY p.PYear DESC, p.PMonth DESC, p.PType ASC
            `,
            params
        );

        return rows.map(mapHistoryRow);
    }

    static async getBatchDetails({ companyId, batchId }) {
        const { payrollYear, payrollMonth, activityCode } = parseHistoryKey(batchId);

        const [[summary]] = await pool.query(
            `
                SELECT
                    p.PType AS activity_code,
                    p.PMonth AS payroll_month,
                    p.PYear AS payroll_year,
                    MAX(p.SalDate) AS payroll_date,
                    MAX(p.DateKeyed) AS processed_at,
                    COUNT(*) AS total_staff,
                    COALESCE(SUM(p.TotalIncome), 0) AS total_gross,
                    COALESCE(SUM(p.Tax), 0) AS total_tax,
                    COALESCE(SUM(COALESCE(p.NassitEmp, 0) + COALESCE(p.UnionDues, 0) + COALESCE(p.GratEmp, 0) + COALESCE(p.Ded1, 0) + COALESCE(p.Ded2, 0) + COALESCE(p.Ded3, 0) + COALESCE(p.Ded4, 0) + COALESCE(p.Ded5, 0) + COALESCE(p.Ded6, 0) + COALESCE(p.Ded7, 0)), 0) AS total_deductions,
                    COALESCE(SUM(p.NetIncome), 0) AS total_net,
                    MAX(COALESCE(p.Operator, 'System')) AS processed_by_name
                FROM tblpayroll p
                WHERE p.CompanyID = ?
                  AND p.PType = ?
                  AND p.PMonth = ?
                  AND p.PYear = ?
                GROUP BY p.CompanyID, p.PType, p.PMonth, p.PYear
            `,
            [companyId, activityCode, payrollMonth, payrollYear]
        );

        if (!summary) {
            const error = new Error('Processing batch not found.');
            error.statusCode = 404;
            throw error;
        }

        const [items] = await pool.query(
            `
                SELECT
                    p.PFNo AS pfno,
                    s.SName,
                    p.Dept AS dept_code,
                    d.Dept AS dept_name,
                    p.Grade AS grade_code,
                    g.Grade AS grade_name,
                    jt.JobTitle AS job_title,
                    p.Salary AS basic_salary,
                    COALESCE(p.Allw02, 0) + COALESCE(p.Allw03, 0) + COALESCE(p.Allw04, 0) + COALESCE(p.Allw05, 0) + COALESCE(p.Allw06, 0) +
                    COALESCE(p.Allw07, 0) + COALESCE(p.Allw08, 0) + COALESCE(p.Allw09, 0) + COALESCE(p.Allw10, 0) + COALESCE(p.Allw11, 0) +
                    COALESCE(p.Allw12, 0) + COALESCE(p.Allw13, 0) + COALESCE(p.Allw14, 0) + COALESCE(p.Allw15, 0) + COALESCE(p.Allw16, 0) +
                    COALESCE(p.Allw17, 0) + COALESCE(p.Allw18, 0) + COALESCE(p.Allw19, 0) + COALESCE(p.Allw20, 0) AS allowances_total,
                    p.TotalIncome AS gross_amount,
                    p.Taxable AS taxable_amount,
                    p.Tax AS tax_amount,
                    COALESCE(p.NassitEmp, 0) + COALESCE(p.UnionDues, 0) + COALESCE(p.GratEmp, 0) + COALESCE(p.Ded1, 0) + COALESCE(p.Ded2, 0) + COALESCE(p.Ded3, 0) + COALESCE(p.Ded4, 0) + COALESCE(p.Ded5, 0) + COALESCE(p.Ded6, 0) + COALESCE(p.Ded7, 0) AS deductions_total,
                    p.NetIncome AS net_amount,
                    p.FullPay AS full_pay,
                    p.HalfPay AS half_pay,
                    p.WithoutPay AS without_pay
                FROM tblpayroll p
                LEFT JOIN tblstaff s
                    ON s.PFNo = p.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = p.Dept
                LEFT JOIN tblgrade g
                    ON g.GradeCode = p.Grade
                LEFT JOIN tbljobtitle jt
                    ON jt.Code = p.JobTitle
                WHERE p.CompanyID = ?
                  AND p.PType = ?
                  AND p.PMonth = ?
                  AND p.PYear = ?
                ORDER BY p.PFNo
            `,
            [companyId, activityCode, payrollMonth, payrollYear]
        );

        return {
            batch: mapHistoryRow(summary),
            items,
            totals: {
                totalGross: roundAmount(summary.total_gross),
                totalTax: roundAmount(summary.total_tax),
                totalDeductions: roundAmount(summary.total_deductions),
                totalNet: roundAmount(summary.total_net)
            }
        };
    }

    static async reverseBatch() {
        const error = new Error('Process emoluments reversal is not implemented yet.');
        error.statusCode = 501;
        throw error;
    }
}

module.exports = ProcessEmolumentsService;
