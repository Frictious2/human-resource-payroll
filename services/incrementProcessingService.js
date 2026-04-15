const staffStatusService = require('./staffStatusService');

function roundMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return 0;
    }

    return Math.round(number * 100) / 100;
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

function computeIncrementAdjustment(incrementRow, salaryRow) {
    const reviewMeta = parseSalaryReviewCategory(incrementRow.Category);
    const incNo = Number(incrementRow.IncNo) || 0;
    const notchIncrease = Number(incrementRow.NotchIncr) || 0;
    const currentSalary = Number(salaryRow.Salary) || 0;
    const currentAllowances = Number(salaryRow.TotAllw) || 0;

    let salaryDelta = 0;
    let allowanceMultiplier = 1;

    if (reviewMeta) {
        if (reviewMeta.revCode === '01' || reviewMeta.revCode === '03') {
            salaryDelta = currentSalary * (reviewMeta.percentage / 100);
        }

        if (reviewMeta.revCode === '02' || reviewMeta.revCode === '03') {
            allowanceMultiplier = 1 + (reviewMeta.percentage / 100);
        }
    } else if (notchIncrease !== 0) {
        // Legacy manual increment rows may store a fixed adjustment in NotchIncr.
        salaryDelta = notchIncrease;
    } else if (incNo > 0 && incNo <= 100) {
        // Fallback for existing increment rows that only provide IncNo.
        salaryDelta = currentSalary * (incNo / 100);
    } else {
        salaryDelta = incNo;
    }

    const updatedAllowances = {};
    let newTotalAllowances = 0;

    for (const fieldName of getAllowanceFieldNames()) {
        const nextValue = roundMoney((Number(salaryRow[fieldName]) || 0) * allowanceMultiplier);
        updatedAllowances[fieldName] = nextValue;
        newTotalAllowances += nextValue;
    }

    newTotalAllowances = roundMoney(newTotalAllowances);
    const newSalary = roundMoney(currentSalary + salaryDelta);
    const incomeDelta = roundMoney((newSalary - currentSalary) + (newTotalAllowances - currentAllowances));
    const newAnnual = roundMoney(newSalary * 12);
    const newTotalIncome = roundMoney(newSalary + newTotalAllowances);
    const newTaxable = roundMoney((Number(salaryRow.Taxable) || 0) + incomeDelta);

    const taxRatio = (Number(salaryRow.Taxable) || 0) > 0 ? (Number(salaryRow.Tax) || 0) / Number(salaryRow.Taxable) : 0;
    const nassitEmpRatio = currentSalary > 0 ? (Number(salaryRow.NassitEmp) || 0) / currentSalary : 0;
    const nassitInstRatio = currentSalary > 0 ? (Number(salaryRow.NassitInst) || 0) / currentSalary : 0;
    const gratEmpRatio = currentSalary > 0 ? (Number(salaryRow.GratEmp) || 0) / currentSalary : 0;
    const gratInstRatio = currentSalary > 0 ? (Number(salaryRow.GratInst) || 0) / currentSalary : 0;

    const newTax = roundMoney(newTaxable * taxRatio);
    const newNassitEmp = roundMoney(newSalary * nassitEmpRatio);
    const newNassitInst = roundMoney(newSalary * nassitInstRatio);
    const newGratEmp = roundMoney(newSalary * gratEmpRatio);
    const newGratInst = roundMoney(newSalary * gratInstRatio);
    const unionDues = roundMoney(salaryRow.UnionDues);
    const ded1 = roundMoney(salaryRow.Ded1);
    const ded3 = roundMoney(salaryRow.Ded3);
    const ded4 = roundMoney(salaryRow.Ded4);
    const ded5 = roundMoney(salaryRow.Ded5);
    const totalDeduction = roundMoney(newTax + newNassitEmp + newGratEmp + unionDues + ded1 + ded3 + ded4 + ded5);
    const newNetIncome = roundMoney(newTotalIncome - totalDeduction);

    return {
        reviewMeta,
        salaryDelta: roundMoney(salaryDelta),
        newSalary,
        newAnnual,
        updatedAllowances,
        newTotalAllowances,
        newTotalIncome,
        newTaxable,
        newTax,
        newNassitEmp,
        newNassitInst,
        newGratEmp,
        newGratInst,
        totalDeduction,
        newNetIncome
    };
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

async function fetchEligibleIncrements(connection, { companyId, payrollDate }) {
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
                i.CompanyID,
                sal.PDate AS SalaryPDate,
                sal.Dept,
                sal.PType,
                sal.Salary,
                sal.Annual,
                sal.Allw02,
                sal.Allw03,
                sal.Allw04,
                sal.Allw05,
                sal.Allw06,
                sal.Allw07,
                sal.Allw08,
                sal.Allw09,
                sal.Allw10,
                sal.Allw11,
                sal.Allw12,
                sal.Allw13,
                sal.Allw14,
                sal.Allw15,
                sal.Allw16,
                sal.Allw17,
                sal.Allw18,
                sal.Allw19,
                sal.Allw20,
                sal.TotAllw,
                sal.TotalIncome,
                sal.Taxable,
                sal.Tax,
                sal.NassitEmp,
                sal.NassitInst,
                sal.GratEmp,
                sal.GratInst,
                sal.NetIncome,
                sal.Ded1,
                sal.UnionDues,
                sal.Ded3,
                sal.Ded4,
                sal.Ded5
            FROM tblincrement i
            INNER JOIN tblstaff st
                ON st.PFNo = i.PFNo
            ${staffStatusService.getPayrollStatusJoins({ staffAlias: 'st' })}
            INNER JOIN tblsalary sal
                ON sal.PFNo = i.PFNo
            INNER JOIN (
                SELECT PFNo, MAX(PDate) AS latest_pdate
                FROM tblsalary
                GROUP BY PFNo
            ) latest
                ON latest.PFNo = sal.PFNo
               AND latest.latest_pdate = sal.PDate
            WHERE (i.CompanyID = ? OR i.CompanyID IS NULL)
              AND COALESCE(i.Approved, 0) IN (-1, 1)
              AND COALESCE(i.EPassed, 0) = 0
              AND COALESCE(i.Type, '') = '04'
              AND DATE(i.IncDate) <= ?
              AND ${staffStatusService.getPayrollEligibilityClause({
                  staffAlias: 'st',
                  payrollDateExpression: '?'
              })}
            ORDER BY i.IncDate ASC, i.PFNo ASC
        `,
        [Number(companyId) || 1, Number(companyId) || 1, payrollDate, payrollDate, payrollDate, payrollDate]
    );

    return rows;
}

async function updateSalaryFromIncrement(connection, {
    incrementRow,
    adjustment,
    processedBy
}) {
    const allowanceFields = getAllowanceFieldNames();
    const allowanceAssignments = allowanceFields.map((fieldName) => `${fieldName} = ?`).join(',\n                ');

    await connection.query(
        `
            UPDATE tblsalary
            SET Salary = ?,
                Annual = ?,
                ${allowanceAssignments},
                TotAllw = ?,
                TotalIncome = ?,
                Taxable = ?,
                Tax = ?,
                NassitEmp = ?,
                NassitInst = ?,
                GratEmp = ?,
                GratInst = ?,
                TotalDeduction = ?,
                NetIncome = ?,
                Operator = ?,
                DateKeyed = NOW(),
                TimeKeyed = NOW()
            WHERE PFNo = ?
              AND Dept = ?
              AND PType = ?
              AND PDate = ?
        `,
        [
            adjustment.newSalary,
            adjustment.newAnnual,
            ...allowanceFields.map((fieldName) => adjustment.updatedAllowances[fieldName]),
            adjustment.newTotalAllowances,
            adjustment.newTotalIncome,
            adjustment.newTaxable,
            adjustment.newTax,
            adjustment.newNassitEmp,
            adjustment.newNassitInst,
            adjustment.newGratEmp,
            adjustment.newGratInst,
            adjustment.totalDeduction,
            adjustment.newNetIncome,
            processedBy || 'System',
            incrementRow.PFNo,
            incrementRow.Dept,
            incrementRow.PType,
            incrementRow.SalaryPDate
        ]
    );
}

async function markIncrementProcessed(connection, incrementRow, dateEpAvailable) {
    const sql = dateEpAvailable
        ? `
            UPDATE tblincrement
            SET EPassed = 1,
                DateEP = NOW()
            WHERE PFNo = ?
              AND IncDate = ?
              AND Type = ?
              AND COALESCE(EPassed, 0) = 0
          `
        : `
            UPDATE tblincrement
            SET EPassed = 1
            WHERE PFNo = ?
              AND IncDate = ?
              AND Type = ?
              AND COALESCE(EPassed, 0) = 0
          `;

    await connection.query(sql, [incrementRow.PFNo, incrementRow.IncDate, incrementRow.Type]);
}

async function applyApprovedIncrementsBeforePayroll(connection, {
    companyId,
    payrollDate,
    processedBy
}) {
    const eligibleRows = await fetchEligibleIncrements(connection, {
        companyId,
        payrollDate
    });

    if (!eligibleRows.length) {
        return {
            processedCount: 0,
            increments: []
        };
    }

    const dateEpAvailable = await hasDateEpColumn(connection);
    const processedRows = [];
    const currentSalaryStateByPfNo = new Map();

    for (const incrementRow of eligibleRows) {
        const currentSalaryState = currentSalaryStateByPfNo.get(incrementRow.PFNo) || { ...incrementRow };
        const adjustment = computeIncrementAdjustment(incrementRow, currentSalaryState);

        await updateSalaryFromIncrement(connection, {
            incrementRow: {
                ...incrementRow,
                SalaryPDate: currentSalaryState.SalaryPDate,
                Dept: currentSalaryState.Dept,
                PType: currentSalaryState.PType
            },
            adjustment,
            processedBy
        });

        await markIncrementProcessed(connection, incrementRow, dateEpAvailable);

        currentSalaryStateByPfNo.set(incrementRow.PFNo, {
            ...currentSalaryState,
            Salary: adjustment.newSalary,
            Annual: adjustment.newAnnual,
            ...adjustment.updatedAllowances,
            TotAllw: adjustment.newTotalAllowances,
            TotalIncome: adjustment.newTotalIncome,
            Taxable: adjustment.newTaxable,
            Tax: adjustment.newTax,
            NassitEmp: adjustment.newNassitEmp,
            NassitInst: adjustment.newNassitInst,
            GratEmp: adjustment.newGratEmp,
            GratInst: adjustment.newGratInst,
            TotalDeduction: adjustment.totalDeduction,
            NetIncome: adjustment.newNetIncome
        });

        processedRows.push({
            PFNo: incrementRow.PFNo,
            IncDate: incrementRow.IncDate,
            Type: incrementRow.Type,
            Category: incrementRow.Category,
            salaryDelta: adjustment.salaryDelta,
            newSalary: adjustment.newSalary
        });
    }

    return {
        processedCount: processedRows.length,
        increments: processedRows,
        dateEpAvailable
    };
}

module.exports = {
    applyApprovedIncrementsBeforePayroll,
    fetchEligibleIncrements
};
