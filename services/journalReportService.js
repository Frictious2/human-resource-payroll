const pool = require('../config/db');
const payrollGlPostingService = require('./payrollGlPostingService');

function roundCurrency(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

const JOURNAL_DEBIT_MAPPING = {
    '01': 'BasicSalary',
    '02': 'Headquarters',
    '03': 'Responsibility',
    '04': 'MaidAllowance',
    '05': 'StaffWelfare',
    '06': 'Transport',
    '07': 'COLA',
    '08': 'Risk',
    '09': 'Acting',
    '10': 'Professional',
    '11': 'Academic'
};

const JOURNAL_CREDIT_MAPPING = {
    '12': 'IncomeTax',
    '13': 'NassitEmp',
    '14': 'ProvidentEmp',
    '15': 'Rent',
    '16': 'SSA',
    '17': 'JSA',
    '18': 'SalAdvance',
    '19': 'IntOnAdv',
    '20': 'SalaryWages'
};

const JOURNAL_COMPONENT_TO_FIELD = {
    SALARY: 'BasicSalary',
    HEADQUARTERS: 'Headquarters',
    RESPONSIBILITY: 'Responsibility',
    MAID: 'MaidAllowance',
    STAFF_WELFARE: 'StaffWelfare',
    TRANSPORT: 'Transport',
    COLA: 'COLA',
    RISK: 'Risk',
    ACTING: 'Acting',
    PROFESSIONAL: 'Professional',
    ACADEMIC: 'Academic',
    INCOME_TAX: 'IncomeTax',
    NASSIT_EMP: 'NassitEmp',
    PROVIDENT_EMP: 'ProvidentEmp',
    RENT_DEDUCTION: 'Rent',
    DED2_SSA: 'SSA',
    DED2_JSA: 'JSA',
    SALARY_ADVANCE: 'SalAdvance',
    INTEREST_ON_ADVANCE: 'IntOnAdv',
    SALARY_WAGES: 'SalaryWages'
};

function normalizeDateInput(value) {
    const text = String(value || '').trim();
    if (!text) {
        return null;
    }

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed.toISOString().slice(0, 10);
}

function buildJournalRows(glAccounts, aggregatedJournal) {
    const data = aggregatedJournal || {};
    const rows = glAccounts.map((account) => {
        const debitField = JOURNAL_DEBIT_MAPPING[account.GLNo];
        const creditField = JOURNAL_CREDIT_MAPPING[account.GLNo];

        return {
            head: account.AccountsHead,
            code: account.Code,
            debit: roundCurrency(debitField ? data[debitField] : 0),
            credit: roundCurrency(creditField ? data[creditField] : 0)
        };
    });

    return {
        rows,
        totalDebit: roundCurrency(rows.reduce((sum, row) => sum + row.debit, 0)),
        totalCredit: roundCurrency(rows.reduce((sum, row) => sum + row.credit, 0))
    };
}

async function rebuildBalancedJournalFromPayroll(companyId, month, year) {
    const [payrollRows] = await pool.query(
        `SELECT
            CAST(p.PFNo AS UNSIGNED) AS employee_id,
            p.PFNo,
            p.Level,
            p.Dept,
            COALESCE(p.Salary, 0) AS basic_salary,
            COALESCE(p.Allw03, 0) AS allw03,
            COALESCE(p.Allw04, 0) AS allw04,
            COALESCE(p.Allw05, 0) AS allw05,
            COALESCE(p.Allw06, 0) AS allw06,
            COALESCE(p.Allw07, 0) AS allw07,
            COALESCE(p.Allw10, 0) AS allw10,
            COALESCE(p.Allw11, 0) AS allw11,
            COALESCE(p.Allw12, 0) AS allw12,
            COALESCE(p.Allw14, 0) AS allw14,
            COALESCE(p.Allw16, 0) AS allw16,
            COALESCE(p.Allw17, 0) AS allw17,
            COALESCE(p.Allw19, 0) AS allw19,
            COALESCE(p.Allw20, 0) AS allw20,
            COALESCE(p.TotalIncome, 0) AS gross_pay,
            COALESCE(p.NetIncome, 0) AS net_pay,
            COALESCE(p.Tax, 0) AS paye,
            COALESCE(p.NassitEmp, 0) AS nassit_employee,
            COALESCE(p.GratEmp, 0) AS gratuity_employee,
            COALESCE(p.UnionDues, 0) AS union_dues,
            COALESCE(p.Ded1, 0) AS ded1,
            COALESCE(p.Ded2, 0) AS ded2,
            COALESCE(p.Ded3, 0) AS ded3,
            COALESCE(p.Ded4, 0) AS ded4,
            COALESCE(p.Ded5, 0) AS ded5,
            'tblpayroll' AS source_table
         FROM tblpayroll p
         WHERE p.CompanyID = ?
           AND p.PType = '01'
           AND p.PMonth = ?
           AND p.PYear = ?
           AND p.Approved IN (-1, 1)`,
        [companyId, month, year]
    );

    if (!payrollRows.length) {
        return null;
    }

    const componentTotals = payrollRows
        .flatMap((row) => payrollGlPostingService.buildPostingComponents(row))
        .reduce((acc, component) => {
            const field = JOURNAL_COMPONENT_TO_FIELD[component.payComponentCode];
            if (field) {
                acc[field] = roundCurrency((acc[field] || 0) + Number(component.amount || 0));
            }
            return acc;
        }, {});

    componentTotals.GLMonth = String(month);
    componentTotals.GLYear = String(year);

    return componentTotals;
}

async function getJournalDates(connection = pool) {
    const [dates] = await connection.query(
        `
            SELECT DISTINCT DATE(GLDate) AS GLDateVal
            FROM tblgltrans
            WHERE GLDate IS NOT NULL
            ORDER BY GLDateVal DESC
        `
    );

    return dates;
}

async function getJournalPreviewData({
    connection = pool,
    companyId,
    glDate
}) {
    const normalizedDate = normalizeDateInput(glDate);
    if (!normalizedDate) {
        throw new Error('A valid journal date is required.');
    }

    const resolvedCompanyId = Number(companyId) || 1;
    const [
        [companyRows],
        [glAccounts],
        [journalEntries],
        [totalCountRows],
        [dateCountRows]
    ] = await Promise.all([
        connection.query('SELECT * FROM tblcominfo LIMIT 1'),
        connection.query('SELECT * FROM tblglaccounts ORDER BY GLNo'),
        connection.query(
            `
                SELECT *
                FROM tblgltrans
                WHERE DATE(GLDate) = ?
            `,
            [normalizedDate]
        ),
        connection.query('SELECT COUNT(*) AS totalRows FROM tblgltrans'),
        connection.query(
            `
                SELECT COUNT(*) AS filteredRows
                FROM tblgltrans
                WHERE DATE(GLDate) = ?
            `,
            [normalizedDate]
        )
    ]);

    const fieldsToSum = [
        'BasicSalary', 'Headquarters', 'Responsibility', 'MaidAllowance', 'StaffWelfare',
        'Transport', 'COLA', 'Risk', 'Acting', 'Professional', 'Academic',
        'IncomeTax', 'NassitEmp', 'ProvidentEmp', 'Rent', 'SSA', 'JSA',
        'SalAdvance', 'IntOnAdv', 'SalaryWages'
    ];

    const aggregatedJournal = journalEntries.reduce((acc, entry) => {
        fieldsToSum.forEach((field) => {
            const value = parseFloat(entry[field]);
            if (!Number.isNaN(value)) {
                acc[field] = (acc[field] || 0) + value;
            }
        });
        return acc;
    }, {});

    if (journalEntries.length > 0) {
        aggregatedJournal.GLDate = journalEntries[0].GLDate;
        aggregatedJournal.GLMonth = journalEntries[0].GLMonth;
        aggregatedJournal.GLYear = journalEntries[0].GLYear;
    }

    let effectiveJournal = aggregatedJournal;
    let { rows: journalRows, totalDebit, totalCredit } = buildJournalRows(glAccounts, effectiveJournal);

    if (journalEntries.length > 0 && Math.abs(totalDebit - totalCredit) > 0.009) {
        const rebuiltJournal = await rebuildBalancedJournalFromPayroll(
            resolvedCompanyId,
            Number(aggregatedJournal.GLMonth),
            Number(aggregatedJournal.GLYear)
        );

        if (rebuiltJournal) {
            effectiveJournal = {
                ...aggregatedJournal,
                ...rebuiltJournal
            };

            const rebuilt = buildJournalRows(glAccounts, effectiveJournal);
            journalRows = rebuilt.rows;
            totalDebit = rebuilt.totalDebit;
            totalCredit = rebuilt.totalCredit;
        }
    }

    return {
        companyInfo: companyRows[0] || {},
        glAccounts,
        glDate: normalizedDate,
        journalEntries,
        aggregatedJournal: effectiveJournal,
        journalRows,
        totalDebit,
        totalCredit,
        debugCounts: {
            totalRows: Number((totalCountRows[0] && totalCountRows[0].totalRows) || 0),
            filteredRows: Number((dateCountRows[0] && dateCountRows[0].filteredRows) || 0)
        }
    };
}

module.exports = {
    getJournalDates,
    getJournalPreviewData
};
