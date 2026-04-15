const staffStatusService = require('./staffStatusService');

function roundAmount(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function parseSalaryReviewCategory(category) {
    const text = String(category || '').trim();
    if (!text.startsWith('SALARY_REVIEW|')) {
        return null;
    }

    const parts = text.split('|');
    if (parts.length < 6) {
        return null;
    }

    return {
        reviewDate: parts[1],
        revCode: parts[2],
        startGrade: parts[3],
        endGrade: parts[4],
        percentage: Number(parts[5]) || 0
    };
}

function getAllowanceFieldNames() {
    return [
        'Allw02', 'Allw03', 'Allw04', 'Allw05', 'Allw06', 'Allw07', 'Allw08', 'Allw09', 'Allw10',
        'Allw11', 'Allw12', 'Allw13', 'Allw14', 'Allw15', 'Allw16', 'Allw17', 'Allw18', 'Allw19', 'Allw20'
    ];
}

async function hasDateEpColumn(connection) {
    const [rows] = await connection.query(
        `
            SELECT COUNT(*) AS count
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'tblincrement'
              AND COLUMN_NAME = 'DateEP'
        `
    );

    return Number(rows[0]?.count || 0) > 0;
}

async function getApplicableIncrements(connection, { companyId, payrollDate }) {
    const [rows] = await connection.query(
        `
            SELECT
                i.IncDate,
                i.PFNo,
                i.Grade,
                i.Category,
                i.Type,
                i.IncNo,
                i.Notch,
                i.NewNotch,
                i.NotchIncr,
                i.Days,
                i.EPassed,
                i.Approved,
                i.CompanyID
            FROM tblincrement i
            INNER JOIN tblstaff s
                ON s.PFNo = i.PFNo
            ${staffStatusService.getPayrollStatusJoins({ staffAlias: 's' })}
            WHERE (i.CompanyID = ? OR i.CompanyID IS NULL)
              AND COALESCE(i.Approved, 0) IN (-1, 1)
              AND COALESCE(i.Type, '') = '04'
              AND DATE(i.IncDate) <= ?
              AND ${staffStatusService.getPayrollEligibilityClause({
                  staffAlias: 's',
                  payrollDateExpression: '?'
              })}
            ORDER BY i.PFNo ASC, i.IncDate ASC
        `,
        [Number(companyId) || 1, Number(companyId) || 1, payrollDate, payrollDate, payrollDate, payrollDate]
    );

    return rows;
}

function buildIncrementContext(rows) {
    const context = new Map();

    for (const row of rows) {
        const existing = context.get(row.PFNo) || [];
        existing.push(row);
        context.set(row.PFNo, existing);
    }

    return context;
}

function computeAdjustedCompensation(baseRow, incrementRows = []) {
    const allowanceFields = getAllowanceFieldNames();
    let salary = roundAmount(baseRow.Salary);
    const allowances = {};

    for (const fieldName of allowanceFields) {
        allowances[fieldName] = roundAmount(baseRow[fieldName]);
    }

    for (const incrementRow of incrementRows) {
        const reviewMeta = parseSalaryReviewCategory(incrementRow.Category);
        const incNo = Number(incrementRow.IncNo) || 0;
        const notchIncrease = Number(incrementRow.NotchIncr) || 0;

        if (reviewMeta) {
            if (reviewMeta.revCode === '01' || reviewMeta.revCode === '03') {
                salary = roundAmount(salary + (salary * (reviewMeta.percentage / 100)));
            }

            if (reviewMeta.revCode === '02' || reviewMeta.revCode === '03') {
                for (const fieldName of allowanceFields) {
                    allowances[fieldName] = roundAmount(allowances[fieldName] + (allowances[fieldName] * (reviewMeta.percentage / 100)));
                }
            }

            continue;
        }

        if (notchIncrease !== 0) {
            salary = roundAmount(salary + notchIncrease);
            continue;
        }

        if (incNo > 0 && incNo <= 100) {
            salary = roundAmount(salary + (salary * (incNo / 100)));
            continue;
        }

        salary = roundAmount(salary + incNo);
    }

    const totAllw = roundAmount(
        allowanceFields.reduce((sum, fieldName) => sum + roundAmount(allowances[fieldName]), 0)
    );
    const totalIncome = roundAmount(salary + totAllw);
    const taxableRatio = Number(baseRow.TotalIncome) > 0 ? roundAmount(baseRow.Taxable) / roundAmount(baseRow.TotalIncome) : 1;
    const taxable = roundAmount(totalIncome * taxableRatio);
    const taxRatio = Number(baseRow.Taxable) > 0 ? roundAmount(baseRow.Tax) / roundAmount(baseRow.Taxable) : 0;
    const tax = roundAmount(taxable * taxRatio);
    const salaryBase = Number(baseRow.Salary) || 0;
    const nassitEmp = salaryBase > 0 ? roundAmount(salary * (roundAmount(baseRow.NassitEmp) / salaryBase)) : roundAmount(baseRow.NassitEmp);
    const nassitInst = salaryBase > 0 ? roundAmount(salary * (roundAmount(baseRow.NassitInst) / salaryBase)) : roundAmount(baseRow.NassitInst);
    const gratEmp = salaryBase > 0 ? roundAmount(salary * (roundAmount(baseRow.GratEmp) / salaryBase)) : roundAmount(baseRow.GratEmp);
    const gratInst = salaryBase > 0 ? roundAmount(salary * (roundAmount(baseRow.GratInst) / salaryBase)) : roundAmount(baseRow.GratInst);
    const unionDues = roundAmount(baseRow.UnionDues);
    const ded1 = roundAmount(baseRow.Ded1);
    const ded3 = roundAmount(baseRow.Ded3);
    const ded4 = roundAmount(baseRow.Ded4);
    const ded5 = roundAmount(baseRow.Ded5);
    const totalDeduction = roundAmount(tax + nassitEmp + gratEmp + unionDues + ded1 + ded3 + ded4 + ded5);
    const netIncome = roundAmount(totalIncome - totalDeduction);

    return {
        Salary: salary,
        Annual: roundAmount(salary * 12),
        ...allowances,
        TotAllw: totAllw,
        TotalIncome: totalIncome,
        Taxable: taxable,
        Tax: tax,
        NassitEmp: nassitEmp,
        NassitInst: nassitInst,
        GratEmp: gratEmp,
        GratInst: gratInst,
        TotalDeduction: totalDeduction,
        NetIncome: netIncome
    };
}

async function markAppliedIncrements(connection, rows) {
    if (!rows.length) {
        return 0;
    }

    const dateEpAvailable = await hasDateEpColumn(connection);
    let updatedCount = 0;

    for (const row of rows) {
        const sql = dateEpAvailable
            ? `
                UPDATE tblincrement
                SET EPassed = 1,
                    DateEP = NOW()
                WHERE PFNo = ?
                  AND IncDate = ?
                  AND COALESCE(Type, '') = '04'
                  AND COALESCE(EPassed, 0) = 0
              `
            : `
                UPDATE tblincrement
                SET EPassed = 1
                WHERE PFNo = ?
                  AND IncDate = ?
                  AND COALESCE(Type, '') = '04'
                  AND COALESCE(EPassed, 0) = 0
              `;

        const [result] = await connection.query(sql, [row.PFNo, row.IncDate]);
        updatedCount += Number(result?.affectedRows || 0);
    }

    return updatedCount;
}

module.exports = {
    buildIncrementContext,
    computeAdjustedCompensation,
    getApplicableIncrements,
    markAppliedIncrements
};
