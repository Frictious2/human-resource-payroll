const pool = require('../config/db');
const {
    ACTIVITY_DEFINITIONS,
    parsePayrollDate,
    validateProcessEmoluments: validateProcessEmolumentsInput
} = require('../validations/processEmolumentsValidation');
const payrollValidationService = require('./payrollValidationService');
const staffStatusService = require('./staffStatusService');
const incrementPayrollService = require('./incrementPayrollService');

const ALLOWED_ROLES = new Set(['data-entry', 'admin', 'manager', 'developer']);

function roundAmount(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function derivePayrollPeriod(payrollDate) {
    const parsedDate = payrollDate instanceof Date ? payrollDate : parsePayrollDate(payrollDate);
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

const PAYROLL_INSERT_COLUMNS = [
    'SalDate', 'PDate', 'PFNo', 'Dept', 'Grade', 'JobTitle', 'PayThrough', 'Bank', 'Branch', 'PayingBBAN', 'PayingBank', 'AccountNo', 'Level',
    'EmpType', 'PayCurrency', 'ExchRate', 'Salary', 'Allw02', 'Allw03', 'Allw04', 'Allw05', 'Allw06', 'Allw07', 'Allw08', 'Allw09', 'Allw10',
    'Allw11', 'Allw12', 'Allw13', 'Allw14', 'Allw15', 'Allw16', 'Allw17', 'Allw18', 'Allw19', 'Allw20', 'TotalIncome', 'Taxable', 'Tax',
    'NassitEmp', 'NassitInst', 'UnionDues', 'GratEmp', 'GratInst', 'NetIncome', 'LoanCounter', 'LoanRescheduled', 'Ded1', 'Ded2', 'Ded3',
    'Ded4', 'Ded5', 'Ded6', 'Ded7', 'MReaction', 'PMonth', 'PYear', 'PType', 'Paid', 'DatePaid', 'FullPay', 'HalfPay', 'PDays', 'WithoutPay',
    'Operator', 'DateKeyed', 'TimeKeyed', 'Approved', 'ApprovedBy', 'DateApproved', 'TimeApproved', 'CompanyID'
];

function buildInsertPlaceholders(rowCount, columnCount) {
    return Array.from({ length: rowCount }, () => `(${Array.from({ length: columnCount }, () => '?').join(', ')})`).join(',\n');
}

async function insertPayrollRows(connection, rows) {
    if (!rows.length) {
        return 0;
    }

    const placeholders = buildInsertPlaceholders(rows.length, PAYROLL_INSERT_COLUMNS.length);
    const values = rows.flatMap((row) => PAYROLL_INSERT_COLUMNS.map((column) => row[column]));

    await connection.query(
        `INSERT INTO tblpayroll (${PAYROLL_INSERT_COLUMNS.join(', ')}) VALUES ${placeholders}`,
        values
    );

    return rows.length;
}

async function fetchSalarySourceRows(connection, {
    mode,
    payrollDate,
    companyId,
    payingBBAN,
    payingBank
}) {
    const conditions = [
        '(s.CompanyID = ? OR s.CompanyID IS NULL)',
        '(s.DOE IS NULL OR DATE(s.DOE) <= ?)',
        staffStatusService.getPayrollEligibilityClause({ staffAlias: 's', payrollDateExpression: "STR_TO_DATE(?, '%Y-%m-%d')" })
    ];

    if (mode === 'full') {
        conditions.unshift(
            'sal.TotalIncome > 0',
            isLegacyYesSql('sal.FullPay'),
            'COALESCE(sal.HalfPay, 0) = 0',
            'COALESCE(sal.WithoutPay, 0) = 0',
            'COALESCE(sal.Posted, 0) = 0'
        );
    } else if (mode === 'half') {
        conditions.unshift(
            isLegacyYesSql('sal.HalfPay'),
            'COALESCE(sal.WithoutPay, 0) = 0'
        );
    } else if (mode === 'without') {
        conditions.unshift(isLegacyYesSql('sal.WithoutPay'));
    }

    const [rows] = await connection.query(
        `
            SELECT
                ? AS SalDate,
                ? AS PDate,
                s.PFNo,
                s.CDept AS Dept,
                s.CGrade AS Grade,
                s.JobTitle,
                COALESCE(e.PayThrough, sal.PayThrough) AS PayThrough,
                COALESCE(e.Bank, sal.Bank) AS Bank,
                sal.Branch,
                ${mode === 'without' ? 'COALESCE(e.PayingBBAN, sal.PayingBBAN)' : '?'} AS PayingBBAN,
                ${mode === 'without' ? 'COALESCE(e.Bank, sal.PayingBank)' : '?'} AS PayingBank,
                COALESCE(e.AccountNo, s.AccountNo, sal.AccountNo) AS AccountNo,
                s.Level,
                s.EmpType,
                s.PayCurrency,
                sal.ExchRate,
                sal.Salary,
                sal.Allw02, sal.Allw03, sal.Allw04, sal.Allw05, sal.Allw06, sal.Allw07, sal.Allw08, sal.Allw09, sal.Allw10,
                sal.Allw11, sal.Allw12, sal.Allw13, sal.Allw14, sal.Allw15, sal.Allw16, sal.Allw17, sal.Allw18, sal.Allw19, sal.Allw20,
                sal.TotalIncome, sal.Taxable, sal.Tax, sal.NassitEmp, sal.NassitInst, sal.UnionDues, sal.GratEmp, sal.GratInst, sal.NetIncome,
                sal.LoanCounter, sal.LoanRescheduled, sal.Ded1, sal.Ded3, sal.Ded4, sal.Ded5, sal.MReaction, sal.FullPay, sal.HalfPay, sal.Days AS PDays,
                sal.WithoutPay, sal.Approved, sal.ApprovedBy, sal.DateApproved, sal.TimeApproved, COALESCE(s.CompanyID, sal.CompanyID, ?) AS CompanyID
            FROM tblstaff s
            ${staffStatusService.getPayrollStatusJoins({ staffAlias: 's' })}
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
            WHERE ${conditions.join('\n              AND ')}
            ORDER BY s.CDept, s.CGrade, s.PFNo
        `,
        [
            payrollDate,
            payrollDate,
            ...(mode === 'without' ? [] : [payingBBAN, payingBank]),
            companyId,
            companyId,
            companyId,
            payrollDate,
            payrollDate,
            payrollDate,
            payrollDate
        ]
    );

    return rows;
}

function buildPayrollInsertRow({
    baseRow,
    adjusted,
    payrollMonth,
    payrollYear,
    operatorName,
    mode,
    now
}) {
    const row = {
        SalDate: baseRow.SalDate,
        PDate: baseRow.PDate,
        PFNo: baseRow.PFNo,
        Dept: baseRow.Dept,
        Grade: baseRow.Grade,
        JobTitle: baseRow.JobTitle,
        PayThrough: baseRow.PayThrough,
        Bank: baseRow.Bank,
        Branch: baseRow.Branch,
        PayingBBAN: baseRow.PayingBBAN,
        PayingBank: baseRow.PayingBank,
        AccountNo: baseRow.AccountNo,
        Level: baseRow.Level,
        EmpType: baseRow.EmpType,
        PayCurrency: baseRow.PayCurrency,
        ExchRate: baseRow.ExchRate,
        Salary: 0,
        Allw02: 0,
        Allw03: 0,
        Allw04: 0,
        Allw05: 0,
        Allw06: 0,
        Allw07: 0,
        Allw08: 0,
        Allw09: 0,
        Allw10: 0,
        Allw11: 0,
        Allw12: 0,
        Allw13: 0,
        Allw14: 0,
        Allw15: 0,
        Allw16: 0,
        Allw17: 0,
        Allw18: 0,
        Allw19: 0,
        Allw20: 0,
        TotalIncome: 0,
        Taxable: 0,
        Tax: 0,
        NassitEmp: 0,
        NassitInst: 0,
        UnionDues: 0,
        GratEmp: 0,
        GratInst: 0,
        NetIncome: 0,
        LoanCounter: baseRow.LoanCounter,
        LoanRescheduled: baseRow.LoanRescheduled,
        Ded1: 0,
        Ded2: 0,
        Ded3: 0,
        Ded4: 0,
        Ded5: 0,
        Ded6: 0,
        Ded7: 0,
        MReaction: baseRow.MReaction,
        PMonth: payrollMonth,
        PYear: payrollYear,
        PType: '01',
        Paid: 0,
        DatePaid: null,
        FullPay: 0,
        HalfPay: 0,
        PDays: baseRow.PDays,
        WithoutPay: 0,
        Operator: operatorName,
        DateKeyed: now,
        TimeKeyed: now,
        Approved: baseRow.Approved,
        ApprovedBy: baseRow.ApprovedBy,
        DateApproved: baseRow.DateApproved,
        TimeApproved: baseRow.TimeApproved,
        CompanyID: baseRow.CompanyID
    };

    if (mode === 'full') {
        Object.assign(row, {
            Salary: adjusted.Salary,
            Allw02: adjusted.Allw02,
            Allw03: adjusted.Allw03,
            Allw04: adjusted.Allw04,
            Allw05: adjusted.Allw05,
            Allw06: adjusted.Allw06,
            Allw07: adjusted.Allw07,
            Allw08: adjusted.Allw08,
            Allw09: adjusted.Allw09,
            Allw10: adjusted.Allw10,
            Allw11: adjusted.Allw11,
            Allw12: adjusted.Allw12,
            Allw13: adjusted.Allw13,
            Allw14: adjusted.Allw14,
            Allw15: adjusted.Allw15,
            Allw16: adjusted.Allw16,
            Allw17: adjusted.Allw17,
            Allw18: adjusted.Allw18,
            Allw19: adjusted.Allw19,
            Allw20: adjusted.Allw20,
            TotalIncome: adjusted.TotalIncome,
            Taxable: adjusted.Taxable,
            Tax: adjusted.Tax,
            NassitEmp: adjusted.NassitEmp,
            NassitInst: adjusted.NassitInst,
            UnionDues: roundAmount(baseRow.UnionDues),
            GratEmp: adjusted.GratEmp,
            GratInst: adjusted.GratInst,
            NetIncome: adjusted.NetIncome,
            Ded1: roundAmount(baseRow.Ded1),
            Ded3: roundAmount(baseRow.Ded3),
            Ded4: roundAmount(baseRow.Ded4),
            Ded5: roundAmount(baseRow.Ded5),
            FullPay: baseRow.FullPay,
            HalfPay: baseRow.HalfPay,
            WithoutPay: baseRow.WithoutPay
        });
    } else if (mode === 'half') {
        Object.assign(row, {
            Salary: roundAmount(adjusted.Salary / 2),
            Allw02: adjusted.Allw02,
            Allw03: roundAmount(adjusted.Allw03 / 2),
            Allw04: roundAmount(adjusted.Allw04 / 2),
            Allw05: roundAmount(adjusted.Allw05 / 2),
            Allw06: roundAmount(adjusted.Allw06 / 2),
            Allw07: roundAmount(adjusted.Allw07 / 2),
            Allw08: roundAmount(adjusted.Allw08 / 2),
            Allw09: roundAmount(adjusted.Allw09 / 2),
            Allw10: roundAmount(adjusted.Allw10 / 2),
            Allw11: roundAmount(adjusted.Allw11 / 2),
            Allw12: roundAmount(adjusted.Allw12 / 2),
            Allw13: adjusted.Allw13,
            Allw14: 0,
            Allw15: roundAmount(adjusted.Allw15 / 2),
            Allw16: roundAmount(adjusted.Allw16 / 2),
            Allw17: roundAmount(adjusted.Allw17 / 2),
            Allw18: roundAmount(adjusted.Allw18 / 2),
            Allw19: roundAmount(adjusted.Allw19 / 2),
            Allw20: roundAmount(adjusted.Allw20 / 2),
            TotalIncome: roundAmount((adjusted.TotalIncome / 2) + (adjusted.Allw02 / 2) + (adjusted.Allw13 / 2)),
            Taxable: roundAmount((adjusted.Taxable / 2) + (adjusted.Allw02 / 2) + (adjusted.Allw13 / 2)),
            Tax: roundAmount(adjusted.Tax / 2),
            NassitEmp: roundAmount(adjusted.NassitEmp / 2),
            NassitInst: roundAmount(adjusted.NassitInst / 2),
            UnionDues: roundAmount(baseRow.UnionDues),
            GratEmp: roundAmount(adjusted.GratEmp / 2),
            GratInst: roundAmount(adjusted.GratInst / 2),
            NetIncome: roundAmount((adjusted.NetIncome / 2) + (adjusted.Allw02 / 2) + (adjusted.Allw13 / 2)),
            Ded1: roundAmount(baseRow.Ded1),
            Ded3: roundAmount(baseRow.Ded3),
            Ded4: roundAmount(baseRow.Ded4),
            Ded5: roundAmount(baseRow.Ded5),
            FullPay: baseRow.FullPay,
            HalfPay: baseRow.HalfPay,
            WithoutPay: baseRow.WithoutPay
        });
    } else {
        Object.assign(row, {
            LoanCounter: baseRow.LoanCounter,
            LoanRescheduled: baseRow.LoanRescheduled,
            PDays: baseRow.PDays,
            WithoutPay: 1
        });
    }

    return row;
}

async function insertFullPaySalaryRows(connection, {
    payrollDate,
    payrollMonth,
    payrollYear,
    companyId,
    payingBBAN,
    payingBank,
    operatorName,
    incrementContext,
    appliedIncrementRows
}) {
    const sourceRows = await fetchSalarySourceRows(connection, {
        mode: 'full',
        payrollDate,
        companyId,
        payingBBAN,
        payingBank
    });
    const now = new Date();
    const rows = sourceRows.map((baseRow) => {
        const incrementRows = incrementContext.get(baseRow.PFNo) || [];
        incrementRows.filter((row) => Number(row.EPassed || 0) === 0).forEach((row) => appliedIncrementRows.add(`${row.PFNo}|${row.IncDate}`));
        const adjusted = incrementPayrollService.computeAdjustedCompensation(baseRow, incrementRows);
        return buildPayrollInsertRow({ baseRow, adjusted, payrollMonth, payrollYear, operatorName, mode: 'full', now });
    });

    return insertPayrollRows(connection, rows);
}

async function insertHalfPaySalaryRows(connection, {
    payrollDate,
    payrollMonth,
    payrollYear,
    companyId,
    payingBBAN,
    payingBank,
    operatorName,
    incrementContext,
    appliedIncrementRows
}) {
    const sourceRows = await fetchSalarySourceRows(connection, {
        mode: 'half',
        payrollDate,
        companyId,
        payingBBAN,
        payingBank
    });
    const now = new Date();
    const rows = sourceRows.map((baseRow) => {
        const incrementRows = incrementContext.get(baseRow.PFNo) || [];
        incrementRows.filter((row) => Number(row.EPassed || 0) === 0).forEach((row) => appliedIncrementRows.add(`${row.PFNo}|${row.IncDate}`));
        const adjusted = incrementPayrollService.computeAdjustedCompensation(baseRow, incrementRows);
        return buildPayrollInsertRow({ baseRow, adjusted, payrollMonth, payrollYear, operatorName, mode: 'half', now });
    });

    return insertPayrollRows(connection, rows);
}

async function insertWithoutPaySalaryRows(connection, {
    payrollDate,
    payrollMonth,
    payrollYear,
    companyId,
    operatorName,
    incrementContext,
    appliedIncrementRows
}) {
    const sourceRows = await fetchSalarySourceRows(connection, {
        mode: 'without',
        payrollDate,
        companyId,
        payingBBAN: '',
        payingBank: ''
    });
    const now = new Date();
    const rows = sourceRows.map((baseRow) => {
        const incrementRows = incrementContext.get(baseRow.PFNo) || [];
        incrementRows.filter((row) => Number(row.EPassed || 0) === 0).forEach((row) => appliedIncrementRows.add(`${row.PFNo}|${row.IncDate}`));
        const adjusted = incrementPayrollService.computeAdjustedCompensation(baseRow, incrementRows);
        return buildPayrollInsertRow({ baseRow, adjusted, payrollMonth, payrollYear, operatorName, mode: 'without', now });
    });

    return insertPayrollRows(connection, rows);
}

async function applySalaryQueryAdjustments(connection, { companyId, payrollMonth, payrollYear, payrollDate }) {
    const approvedQueries = await payrollValidationService.getApprovedSalaryQueries(connection, {
        companyId,
        payrollDate
    });

    if (approvedQueries.length === 0) {
        return { halfPayCount: 0, withoutPayCount: 0, surchargeCount: 0 };
    }

    // Legacy tblquery payroll effects are driven by MResponse:
    // 12 = half pay, 13 = without pay, 05 = surcharge.
    const [withoutPayResult] = await connection.query(
        `
            UPDATE tblpayroll p
            INNER JOIN tblquery q
                ON q.PFNO = p.PFNo
            SET
                p.Salary = 0,
                p.Allw02 = 0, p.Allw03 = 0, p.Allw04 = 0, p.Allw05 = 0, p.Allw06 = 0, p.Allw07 = 0, p.Allw08 = 0, p.Allw09 = 0, p.Allw10 = 0,
                p.Allw11 = 0, p.Allw12 = 0, p.Allw13 = 0, p.Allw14 = 0, p.Allw15 = 0, p.Allw16 = 0, p.Allw17 = 0, p.Allw18 = 0, p.Allw19 = 0, p.Allw20 = 0,
                p.TotalIncome = 0,
                p.Taxable = 0,
                p.Tax = 0,
                p.NassitEmp = 0,
                p.NassitInst = 0,
                p.GratEmp = 0,
                p.GratInst = 0,
                p.NetIncome = 0,
                p.Ded1 = 0,
                p.Ded2 = 0,
                p.Ded3 = 0,
                p.Ded4 = 0,
                p.Ded5 = 0,
                p.Ded6 = 0,
                p.Ded7 = 0,
                p.FullPay = 0,
                p.HalfPay = 0,
                p.WithoutPay = 1,
                p.MReaction = q.MResponse
            WHERE p.CompanyID = ?
              AND p.PMonth = ?
              AND p.PYear = ?
              AND p.PType = '01'
              AND COALESCE(q.Approved, 0) IN (-1, 1)
              AND COALESCE(q.Expired, 0) = 0
              AND q.MResponse = '13'
              AND (q.SDate IS NULL OR DATE(q.SDate) <= ?)
              AND (q.EDate IS NULL OR DATE(q.EDate) >= ?)
        `,
        [companyId, payrollMonth, payrollYear, payrollDate, payrollDate]
    );

    const [halfPayResult] = await connection.query(
        `
            UPDATE tblpayroll p
            INNER JOIN tblquery q
                ON q.PFNO = p.PFNo
            SET
                p.Salary = p.Salary / 2,
                p.Allw03 = p.Allw03 / 2,
                p.Allw04 = p.Allw04 / 2,
                p.Allw05 = p.Allw05 / 2,
                p.Allw06 = p.Allw06 / 2,
                p.Allw07 = p.Allw07 / 2,
                p.Allw08 = p.Allw08 / 2,
                p.Allw09 = p.Allw09 / 2,
                p.Allw10 = p.Allw10 / 2,
                p.Allw11 = p.Allw11 / 2,
                p.Allw12 = p.Allw12 / 2,
                p.Allw14 = 0,
                p.Allw15 = p.Allw15 / 2,
                p.Allw16 = p.Allw16 / 2,
                p.Allw17 = p.Allw17 / 2,
                p.Allw18 = p.Allw18 / 2,
                p.Allw19 = p.Allw19 / 2,
                p.Allw20 = p.Allw20 / 2,
                p.TotalIncome = (p.TotalIncome / 2) + (p.Allw02 / 2) + (p.Allw13 / 2),
                p.Taxable = (p.Taxable / 2) + (p.Allw02 / 2) + (p.Allw13 / 2),
                p.Tax = p.Tax / 2,
                p.NassitEmp = p.NassitEmp / 2,
                p.NassitInst = p.NassitInst / 2,
                p.GratEmp = p.GratEmp / 2,
                p.GratInst = p.GratInst / 2,
                p.NetIncome = (p.NetIncome / 2) + (p.Allw02 / 2) + (p.Allw13 / 2),
                p.FullPay = 0,
                p.HalfPay = 1,
                p.WithoutPay = 0,
                p.MReaction = q.MResponse
            WHERE p.CompanyID = ?
              AND p.PMonth = ?
              AND p.PYear = ?
              AND p.PType = '01'
              AND COALESCE(p.WithoutPay, 0) = 0
              AND COALESCE(q.Approved, 0) IN (-1, 1)
              AND COALESCE(q.Expired, 0) = 0
              AND q.MResponse = '12'
              AND (q.SDate IS NULL OR DATE(q.SDate) <= ?)
              AND (q.EDate IS NULL OR DATE(q.EDate) >= ?)
        `,
        [companyId, payrollMonth, payrollYear, payrollDate, payrollDate]
    );

    const [surchargeResult] = await connection.query(
        `
            UPDATE tblpayroll p
            INNER JOIN tblquery q
                ON q.PFNO = p.PFNo
            SET p.MReaction = q.MResponse
            WHERE p.CompanyID = ?
              AND p.PMonth = ?
              AND p.PYear = ?
              AND p.PType = '01'
              AND COALESCE(q.Approved, 0) IN (-1, 1)
              AND COALESCE(q.Expired, 0) = 0
              AND q.MResponse = '05'
              AND (q.SDate IS NULL OR DATE(q.SDate) <= ?)
              AND (q.EDate IS NULL OR DATE(q.EDate) >= ?)
        `,
        [companyId, payrollMonth, payrollYear, payrollDate, payrollDate]
    );

    return {
        halfPayCount: halfPayResult.affectedRows || 0,
        withoutPayCount: withoutPayResult.affectedRows || 0,
        surchargeCount: surchargeResult.affectedRows || 0
    };
}

async function applyLoanDeductions(connection, { companyId, payrollMonth, payrollYear, payrollDate }) {
    const loanRows = await payrollValidationService.getActiveLoanDeductions(connection, {
        companyId,
        payrollDate
    });

    if (loanRows.some((row) => Number(row.loan_deduction || 0) < 0 || Number(row.interest_deduction || 0) < 0)) {
        const error = new Error('Loan deduction data is invalid for one or more staff.');
        error.statusCode = 409;
        throw error;
    }

    if (loanRows.length === 0) {
        return 0;
    }

    const [result] = await connection.query(
        `
            UPDATE tblpayroll p
            INNER JOIN (
                SELECT
                    l.PFNo,
                    SUM(COALESCE(l.MonthlyRepayment, 0)) AS loan_deduction,
                    SUM(COALESCE(l.MonthlyInt, 0)) AS interest_deduction
                FROM tblloan l
                INNER JOIN tblstaff s
                    ON s.PFNo = l.PFNo
                WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
                  AND (s.CompanyID = ? OR s.CompanyID IS NULL)
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
            ) loan
                ON loan.PFNo = p.PFNo
            SET
                p.Ded1 = ROUND(COALESCE(loan.loan_deduction, 0), 2),
                p.Ded3 = ROUND(COALESCE(loan.interest_deduction, 0), 2)
            WHERE p.CompanyID = ?
              AND p.PMonth = ?
              AND p.PYear = ?
              AND p.PType = '01'
              AND COALESCE(p.WithoutPay, 0) = 0
        `,
        [companyId, companyId, payrollDate, payrollDate, payrollDate, companyId, payrollMonth, payrollYear]
    );

    return result.affectedRows || 0;
}

async function applyMedicalDeductions(connection, { companyId, payrollMonth, payrollYear, payrollDate }) {
    const medicalRows = await payrollValidationService.getActiveMedicalDeductions(connection, {
        companyId,
        payrollDate,
        payrollMonth,
        payrollYear
    });

    if (medicalRows.some((row) => Number(row.medical_deduction || 0) < 0)) {
        const error = new Error('Medical deduction data is invalid for one or more staff.');
        error.statusCode = 409;
        throw error;
    }

    if (medicalRows.length === 0) {
        return 0;
    }

    const [result] = await connection.query(
        `
            UPDATE tblpayroll p
            INNER JOIN (
                SELECT
                    m.PFNo,
                    SUM(COALESCE(m.Amount, 0)) AS medical_deduction
                FROM tblmedical m
                INNER JOIN tblstaff s
                    ON s.PFNo = m.PFNo
                WHERE (m.CompanyID = ? OR m.CompanyID IS NULL)
                  AND (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND YEAR(m.EntryDate) = ?
                  AND MONTH(m.EntryDate) = ?
                  AND DATE(m.EntryDate) <= ?
                GROUP BY m.PFNo
            ) med
                ON med.PFNo = p.PFNo
            SET p.Ded6 = ROUND(COALESCE(med.medical_deduction, 0), 2)
            WHERE p.CompanyID = ?
              AND p.PMonth = ?
              AND p.PYear = ?
              AND p.PType = '01'
              AND COALESCE(p.WithoutPay, 0) = 0
        `,
        [companyId, companyId, payrollYear, payrollMonth, payrollDate, companyId, payrollMonth, payrollYear]
    );

    return result.affectedRows || 0;
}

async function applySurchargeDeductions(connection, { companyId, payrollMonth, payrollYear, payrollDate }) {
    const surchargeRows = await payrollValidationService.getActiveSurchargeDeductions(connection, {
        companyId,
        payrollDate
    });

    if (surchargeRows.some((row) => Number(row.surcharge_deduction || 0) < 0)) {
        const error = new Error('Approved salary-related query adjustments could not be applied.');
        error.statusCode = 409;
        throw error;
    }

    if (surchargeRows.length === 0) {
        return 0;
    }

    const [result] = await connection.query(
        `
            UPDATE tblpayroll p
            INNER JOIN (
                SELECT
                    s.PFNo,
                    SUM(COALESCE(s.SAmount, 0)) AS surcharge_deduction
                FROM tblsurcharge s
                INNER JOIN tblstaff st
                    ON st.PFNo = s.PFNo
                WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND (st.CompanyID = ? OR st.CompanyID IS NULL)
                  AND COALESCE(s.Approved, 0) IN (-1, 1)
                  AND COALESCE(s.Expired, 0) = 0
                  AND (s.StarDate IS NULL OR DATE(s.StarDate) <= ?)
                  AND (s.ExpDate IS NULL OR DATE(s.ExpDate) >= ?)
                GROUP BY s.PFNo
            ) surcharge
                ON surcharge.PFNo = p.PFNo
            SET p.Ded7 = ROUND(COALESCE(surcharge.surcharge_deduction, 0), 2)
            WHERE p.CompanyID = ?
              AND p.PMonth = ?
              AND p.PYear = ?
              AND p.PType = '01'
              AND COALESCE(p.WithoutPay, 0) = 0
        `,
        [companyId, companyId, payrollDate, payrollDate, companyId, payrollMonth, payrollYear]
    );

    return result.affectedRows || 0;
}

async function refreshPayrollNetIncome(connection, { companyId, payrollMonth, payrollYear }) {
    await connection.query(
        `
            UPDATE tblpayroll
            SET NetIncome = ROUND(
                COALESCE(TotalIncome, 0) -
                (
                    COALESCE(Tax, 0) +
                    COALESCE(NassitEmp, 0) +
                    COALESCE(GratEmp, 0) +
                    COALESCE(UnionDues, 0) +
                    COALESCE(Ded1, 0) +
                    COALESCE(Ded2, 0) +
                    COALESCE(Ded3, 0) +
                    COALESCE(Ded4, 0) +
                    COALESCE(Ded5, 0) +
                    COALESCE(Ded6, 0) +
                    COALESCE(Ded7, 0)
                ),
                2
            )
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND PType = '01'
        `,
        [companyId, payrollMonth, payrollYear]
    );
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
        const validatedPayload = validateProcessEmolumentsInput({ companyId, activityCode, payrollDate });

        this.ensureAuthorized(userRole);

        const {
            companyId: validatedCompanyId,
            activityCode: validatedActivityCode,
            payrollDate: validatedPayrollDate,
            payrollMonth,
            payrollYear,
            activityName
        } = validatedPayload;
        const { parsedDate } = derivePayrollPeriod(validatedPayrollDate);
        const sqlDate = formatSqlDate(parsedDate);

        if (validatedActivityCode !== '01') {
            const error = new Error(`${activityName} processing is not fully implemented yet.`);
            error.statusCode = 501;
            throw error;
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            await payrollValidationService.validateProcessEmoluments(connection, {
                companyId: validatedCompanyId,
                activityCode: validatedActivityCode,
                payrollDate: sqlDate,
                payrollMonth,
                payrollYear
            });

            const companySetup = await getCompanyPaymentSetup(connection, validatedCompanyId);
            const incrementRows = await incrementPayrollService.getApplicableIncrements(connection, {
                companyId: validatedCompanyId,
                payrollDate: sqlDate
            });
            const incrementContext = incrementPayrollService.buildIncrementContext(incrementRows);
            const appliedIncrementRows = new Set();
            // Activity 01 is a posting step from tblSalary into tblPayroll. We read
            // the base source values from tblSalary, then layer approved legacy
            // increment rows in memory before writing the adjusted payroll row.
            const fullPayCount = await insertFullPaySalaryRows(connection, {
                payrollDate: sqlDate,
                payrollMonth,
                payrollYear,
                companyId: validatedCompanyId,
                payingBBAN: companySetup.AccNo || '',
                payingBank: companySetup.PayingBank || '',
                operatorName: processedByName || 'System',
                incrementContext,
                appliedIncrementRows
            });
            const halfPayCount = await insertHalfPaySalaryRows(connection, {
                payrollDate: sqlDate,
                payrollMonth,
                payrollYear,
                companyId: validatedCompanyId,
                payingBBAN: companySetup.AccNo || '',
                payingBank: companySetup.PayingBank || '',
                operatorName: processedByName || 'System',
                incrementContext,
                appliedIncrementRows
            });
            const withoutPayCount = await insertWithoutPaySalaryRows(connection, {
                payrollDate: sqlDate,
                payrollMonth,
                payrollYear,
                companyId: validatedCompanyId,
                operatorName: processedByName || 'System',
                incrementContext,
                appliedIncrementRows
            });

            await applySalaryQueryAdjustments(connection, {
                companyId: validatedCompanyId,
                payrollMonth,
                payrollYear,
                payrollDate: sqlDate
            });

            await applyLoanDeductions(connection, {
                companyId: validatedCompanyId,
                payrollMonth,
                payrollYear,
                payrollDate: sqlDate
            });

            await applyMedicalDeductions(connection, {
                companyId: validatedCompanyId,
                payrollMonth,
                payrollYear,
                payrollDate: sqlDate
            });

            await applySurchargeDeductions(connection, {
                companyId: validatedCompanyId,
                payrollMonth,
                payrollYear,
                payrollDate: sqlDate
            });

            await refreshPayrollNetIncome(connection, {
                companyId: validatedCompanyId,
                payrollMonth,
                payrollYear
            });

            const totalInserted = fullPayCount + halfPayCount + withoutPayCount;
            if (totalInserted === 0) {
                const error = new Error('No valid salary data found for the selected payroll period.');
                error.statusCode = 404;
                throw error;
            }

            const incrementRowsToMark = Array.from(appliedIncrementRows).map((entry) => {
                const [PFNo, IncDate] = entry.split('|');
                return { PFNo, IncDate };
            });
            await incrementPayrollService.markAppliedIncrements(connection, incrementRowsToMark);

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
                [validatedCompanyId, payrollMonth, payrollYear]
            );

            const recordId = makeHistoryKey({ activityCode: validatedActivityCode, payrollMonth, payrollYear });
            await logProcessAudit(connection, {
                companyId: validatedCompanyId,
                userName: processedByName || 'System',
                action: 'New',
                recordId,
                message: `Processed ${summary.totalStaff} salary payroll record(s) for ${String(payrollMonth).padStart(2, '0')}/${payrollYear}.`
            });

            await connection.commit();

            return {
                batchId: recordId,
                activityCode: validatedActivityCode,
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
                    companyId: validatedCompanyId,
                    userName: processedByName || 'System',
                    action: 'Edit',
                    recordId: makeHistoryKey({ activityCode: validatedActivityCode, payrollMonth, payrollYear }),
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
