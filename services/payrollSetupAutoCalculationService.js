const pool = require('../config/db');
const payeTaxService = require('./payeTaxService');

function roundCurrency(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function legacyTrue(value) {
    return value === true || value === 1 || value === -1 || value === '1' || value === '-1';
}

function normalizeFrequency(value) {
    return String(value || '').trim().toUpperCase();
}

function buildSalaryScale({ gradeCode, maxNotch, startLevel, endLevel, scaleNotches, increment, notch }) {
    const parsedMaxNotch = Number(maxNotch) || 0;
    const parsedNotch = Math.max(Number(notch) || 1, 1);
    const effectiveScaleNotches = Number(scaleNotches) || parsedMaxNotch || 1;
    const appliedNotch = parsedMaxNotch > 0 ? Math.min(parsedNotch, parsedMaxNotch) : parsedNotch;
    const startSalary = Number(startLevel) || 0;
    const endSalary = Number(endLevel) || startSalary;
    const configuredIncrement = Number(increment);
    const stepIncrement = Number.isFinite(configuredIncrement) && configuredIncrement > 0
        ? configuredIncrement
        : (effectiveScaleNotches > 1 ? (endSalary - startSalary) / (effectiveScaleNotches - 1) : 0);
    const annualSalary = startSalary + ((appliedNotch - 1) * stepIncrement);
    const monthlySalary = annualSalary / 12;

    return {
        gradeCode,
        maxNotch: parsedMaxNotch,
        scaleNotches: effectiveScaleNotches,
        appliedNotch,
        startSalary: roundCurrency(startSalary),
        endSalary: roundCurrency(endSalary),
        increment: roundCurrency(stepIncrement),
        annualSalary: roundCurrency(annualSalary),
        monthlySalary: roundCurrency(monthlySalary)
    };
}

async function queryWithExecutor(executor, sql, params) {
    return executor.query(sql, params);
}

async function getLatestGradeScale(executor, gradeCode) {
    if (!gradeCode) {
        return null;
    }

    const [rows] = await queryWithExecutor(
        executor,
        `
            SELECT
                g.GradeCode,
                g.NotchIncr,
                a.StartLevel,
                a.EndLevel,
                a.Notches,
                a.Increment
            FROM tblgrade g
            LEFT JOIN tblallowance a
                ON a.Grade = g.GradeCode
                AND a.ScaleDate = (
                    SELECT MAX(a2.ScaleDate)
                    FROM tblallowance a2
                    WHERE a2.Grade = g.GradeCode
                )
            WHERE g.GradeCode = ?
            ORDER BY g.GradeCode
            LIMIT 1
        `,
        [gradeCode]
    );

    return rows[0] || null;
}

async function calculateStaffCompensation({ executor = pool, gradeCode, notch }) {
    const scale = await getLatestGradeScale(executor, gradeCode);
    if (!scale) {
        return buildSalaryScale({
            gradeCode,
            maxNotch: 0,
            startLevel: 0,
            endLevel: 0,
            scaleNotches: 0,
            increment: 0,
            notch
        });
    }

    return buildSalaryScale({
        gradeCode,
        maxNotch: scale.NotchIncr,
        startLevel: scale.StartLevel,
        endLevel: scale.EndLevel,
        scaleNotches: scale.Notches,
        increment: scale.Increment,
        notch
    });
}

async function getPayrollItems(executor, companyId) {
    const [rows] = await queryWithExecutor(
        executor,
        `
            SELECT *
            FROM tblpayrollitems
            WHERE CompanyID = ? OR CompanyID IS NULL
            ORDER BY CASE WHEN CompanyID = ? THEN 0 ELSE 1 END, Code
        `,
        [Number(companyId) || 1, Number(companyId) || 1]
    );

    const items = new Map();
    rows.forEach((row) => {
        const code = String(row.Code || '').padStart(2, '0');
        if (code && !items.has(code)) {
            items.set(code, row);
        }
    });

    return items;
}

function calculateMonthlyItemAmount(item, basicSalary) {
    if (!item || normalizeFrequency(item.Freq) !== 'M') {
        return 0;
    }

    const percent = Number(item.Percent) || 0;
    const fixedAmount = Number(item.TAmount) || 0;

    if (percent > 0) {
        return roundCurrency(basicSalary * (percent / 100));
    }

    if (legacyTrue(item.Fixed) && fixedAmount > 0) {
        return roundCurrency(fixedAmount);
    }

    return 0;
}

function calculateContribution(items, code, basicSalary) {
    const item = items.get(code);
    if (!item || normalizeFrequency(item.Freq) !== 'M') {
        return 0;
    }

    const percent = Number(item.Percent) || 0;
    return percent > 0 ? roundCurrency(basicSalary * (percent / 100)) : 0;
}

async function fetchStaff(executor, companyId, pfNo) {
    const [rows] = await queryWithExecutor(
        executor,
        `
            SELECT
                PFNo,
                SName,
                CDept AS Dept,
                CGrade AS GradeCode,
                JobTitle AS JobTitleCode,
                Notch,
                CompanyID
            FROM tblstaff
            WHERE PFNo = ?
              AND (CompanyID = ? OR CompanyID IS NULL)
            LIMIT 1
        `,
        [pfNo, Number(companyId) || 1]
    );

    return rows[0] || null;
}

async function fetchLatestSalary(executor, companyId, pfNo) {
    const [rows] = await queryWithExecutor(
        executor,
        `
            SELECT *
            FROM tblsalary
            WHERE PFNo = ?
              AND (CompanyID = ? OR CompanyID IS NULL)
            ORDER BY PDate DESC
            LIMIT 1
        `,
        [pfNo, Number(companyId) || 1]
    );

    return rows[0] || null;
}

async function calculatePayrollSetupForStaff({ companyId, pfNo, payrollDate = new Date(), executor = pool }) {
    const staff = await fetchStaff(executor, companyId, pfNo);
    if (!staff) {
        const error = new Error('Staff not found for payroll setup calculation.');
        error.statusCode = 404;
        throw error;
    }

    const items = await getPayrollItems(executor, companyId);
    const compensation = await calculateStaffCompensation({ executor, gradeCode: staff.GradeCode, notch: staff.Notch });
    const latestSalary = await fetchLatestSalary(executor, companyId, pfNo);

    const salary = compensation.monthlySalary;
    const annual = compensation.annualSalary;
    const calculated = {};
    let totalAllowance = 0;
    let taxableAllowance = 0;

    for (let code = 2; code <= 20; code += 1) {
        const itemCode = String(code).padStart(2, '0');
        const item = items.get(itemCode);
        const amount = calculateMonthlyItemAmount(item, salary);
        calculated[`Allw${itemCode}`] = amount;
        totalAllowance += amount;
        if (legacyTrue(item?.Taxable)) {
            taxableAllowance += amount;
        }
    }

    const nassitEmp = calculateContribution(items, '32', salary);
    // Legacy columns store provident contributions in GratEmp/GratInst.
    const providentEmp = calculateContribution(items, '33', salary);
    const nassitInst = calculateContribution(items, '41', salary);
    const providentInst = calculateContribution(items, '42', salary);
    const totalIncome = roundCurrency(salary + totalAllowance);
    const salaryItem = items.get('01');
    const taxableEarnings = roundCurrency((legacyTrue(salaryItem?.Taxable) ? salary : 0) + taxableAllowance);
    const paye = await payeTaxService.calculateMonthlyPaye({
        companyId,
        payrollDate,
        taxableEarnings,
        employeeNassit: nassitEmp,
        connection: executor
    });
    const taxable = paye.chargeableIncome;
    const tax = paye.tax;
    const ded1 = roundCurrency(latestSalary?.Ded1 || 0);
    const unionDues = roundCurrency(latestSalary?.UnionDues || 0);
    const ded3 = roundCurrency(latestSalary?.Ded3 || 0);
    const ded4 = roundCurrency(latestSalary?.Ded4 || 0);
    const ded5 = roundCurrency(latestSalary?.Ded5 || 0);
    const totalDeduction = roundCurrency(tax + nassitEmp + providentEmp + ded1 + unionDues + ded3 + ded4 + ded5);

    return {
        staff,
        compensation,
        latestSalary,
        fields: {
            PDate: payrollDate,
            PFNo: pfNo,
            Dept: staff.Dept,
            Grade: staff.GradeCode,
            JobTitle: staff.JobTitleCode,
            Annual: annual,
            Salary: salary,
            ...calculated,
            TotAllw: roundCurrency(totalAllowance),
            TotalIncome: totalIncome,
            Taxable: taxable,
            Tax: tax,
            NassitEmp: nassitEmp,
            NassitInst: nassitInst,
            GratEmp: providentEmp,
            GratInst: providentInst,
            Ded1: ded1,
            UnionDues: unionDues,
            Ded3: ded3,
            Ded4: ded4,
            Ded5: ded5,
            TotalDeduction: totalDeduction,
            NetIncome: roundCurrency(totalIncome - totalDeduction)
        }
    };
}

async function upsertAutoCalculatedSalarySetup({
    companyId,
    pfNo,
    payrollDate = new Date(),
    approvedBy = 'System',
    executor = pool,
    approved = -1
}) {
    const now = new Date();
    const calculation = await calculatePayrollSetupForStaff({ companyId, pfNo, payrollDate, executor });
    const baseFields = {
        ...calculation.fields,
        Operator: approvedBy,
        DateKeyed: now,
        TimeKeyed: now,
        Approved: approved,
        ApprovedBy: approvedBy,
        DateApproved: now,
        TimeApproved: now,
        PType: calculation.latestSalary?.PType || '01',
        Paid: calculation.latestSalary?.Paid || 0,
        FullPay: 1,
        HalfPay: 0,
        WithoutPay: 0,
        Linked: calculation.latestSalary?.Linked || 0,
        Posted: 0,
        CompanyID: Number(companyId) || 1
    };

    const targetSalary = calculation.latestSalary;
    if (targetSalary) {
        const updateFields = Object.keys(baseFields);
        const setClause = updateFields.map((field) => `${field} = ?`).join(', ');
        const values = updateFields.map((field) => baseFields[field]);
        await queryWithExecutor(
            executor,
            `
                UPDATE tblsalary
                SET ${setClause}
                WHERE PFNo = ?
                  AND Dept = ?
                  AND PType = ?
                  AND (CompanyID = ? OR CompanyID IS NULL)
            `,
            [
                ...values,
                targetSalary.PFNo,
                targetSalary.Dept,
                targetSalary.PType,
                Number(companyId) || 1
            ]
        );
    } else {
        const columns = Object.keys(baseFields);
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map((field) => baseFields[field]);
        await queryWithExecutor(
            executor,
            `INSERT INTO tblsalary (${columns.join(', ')}) VALUES (${placeholders})`,
            values
        );
    }

    return {
        ...calculation,
        savedFields: baseFields
    };
}

module.exports = {
    calculateStaffCompensation,
    calculatePayrollSetupForStaff,
    upsertAutoCalculatedSalarySetup
};
