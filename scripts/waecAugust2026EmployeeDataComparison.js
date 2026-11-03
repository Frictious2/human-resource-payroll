require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const payrollSetupAutoCalculationService = require('../services/payrollSetupAutoCalculationService');

const SOURCE_JSON = path.join('docs', 'test-results', 'waec-august-2026-payroll-reconciliation-before.json');
const OUTPUT_JSON = path.join('docs', 'test-results', 'waec-august-2026-employee-data-comparison.json');
const EMPLOYEE_MD = path.join('docs', 'WAEC-AUGUST-2026-EMPLOYEE-DATA-COMPARISON.md');
const CONSOLIDATED_MD = path.join('docs', 'WAEC-AUGUST-2026-CONSOLIDATED-VARIANCES.md');
const RECOMMENDED_MD = path.join('docs', 'WAEC-AUGUST-2026-RECOMMENDED-CORRECTIONS.md');

const COMPANY_ID = 1;
const PAYROLL_MONTH = 8;
const PAYROLL_YEAR = 2026;
const PTYPE = '01';
const PAYROLL_DATE = new Date('2026-08-21T00:00:00Z');
const TOLERANCE = 0.01;

const COMPONENTS = [
    { key: 'monthlyBasic', label: 'Basic Salary', type: 'basic', payrollItem: '01', salaryField: 'Salary', payrollField: 'Salary' },
    { key: 'responsibility', label: 'Responsibility Allowance', type: 'allowance', payrollItem: '11', entitleField: 'Allw11', salaryField: 'Allw11', payrollField: 'Allw11' },
    { key: 'maid', label: 'Maid Allowance', type: 'allowance', payrollItem: '12', entitleField: 'Allw12', salaryField: 'Allw12', payrollField: 'Allw12' },
    // The Excel column is labelled Staff Welfare. In the live payroll rows the
    // matching stored value is Allw07; tblpayrollitems currently labels code 07
    // as BIKE ALLOWANCE, so the report flags the naming/mapping distinction.
    { key: 'staffWelfare', label: 'Staff Welfare', type: 'allowance', payrollItem: '07', entitleField: 'Allw07', salaryField: 'Allw07', payrollField: 'Allw07', manualSensitive: true },
    { key: 'maintenance', label: 'Maintenance', type: 'allowance', payrollItem: '10', entitleField: 'Allw10', salaryField: 'Allw10', payrollField: 'Allw10' },
    { key: 'risk', label: 'Risk', type: 'allowance', payrollItem: '17', entitleField: 'Allw17', salaryField: 'Allw17', payrollField: 'Allw17' },
    { key: 'acting', label: 'Acting', type: 'allowance', payrollItem: '14', entitleField: 'Allw14', salaryField: 'Allw14', payrollField: 'Allw14' },
    { key: 'professional', label: 'Professional', type: 'allowance', payrollItem: '16', entitleField: 'Allw16', salaryField: 'Allw16', payrollField: 'Allw16' },
    { key: 'academic', label: 'Academic', type: 'allowance', payrollItem: '19', entitleField: 'Allw19', salaryField: 'Allw19', payrollField: 'Allw19' },
    { key: 'transport', label: 'Transport', type: 'allowance', payrollItem: '03', entitleField: 'Allw03', salaryField: 'Allw03', payrollField: 'Allw03', manualSensitive: true },
    { key: 'cola', label: 'COLA', type: 'allowance', payrollItem: '06', entitleField: 'Allw06', salaryField: 'Allw06', payrollField: 'Allw06', manualSensitive: true },
    { key: 'totalAllowance', label: 'Total Allowances', type: 'total', salaryField: 'TotAllw', payrollField: null },
    { key: 'totalIncome', label: 'Gross/Total Income', type: 'total', salaryField: 'TotalIncome', payrollField: 'TotalIncome' },
    { key: 'taxable', label: 'Taxable Income', type: 'taxable', salaryField: 'Taxable', payrollField: 'Taxable' },
    { key: 'paye', label: 'PAYE', type: 'tax', salaryField: 'Tax', payrollField: 'Tax' },
    { key: 'employeeNassit', label: 'Employee NASSIT', type: 'nassit', salaryField: 'NassitEmp', payrollField: 'NassitEmp' },
    { key: 'employerNassit', label: 'Employer NASSIT', type: 'nassit', salaryField: 'NassitInst', payrollField: 'NassitInst' },
    { key: 'totalDeduction', label: 'Total Deductions', type: 'deduction', salaryField: 'TotalDeduction', payrollField: null },
    { key: 'netPay', label: 'Net Pay', type: 'net', salaryField: 'NetIncome', payrollField: 'NetIncome' }
];

const ALLOWANCE_COMPONENTS = COMPONENTS.filter((component) => component.type === 'allowance');

function money(value) {
    const number = Number(value || 0);
    return Math.round(number * 100) / 100;
}

function legacyEnabled(value) {
    return value === true || value === 1 || value === -1 || value === '1' || value === '-1';
}

function formatMoney(value) {
    return money(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function variance(systemValue, excelValue) {
    return money(money(systemValue) - money(excelValue));
}

function statusFromVariance(value) {
    return Math.abs(value) <= TOLERANCE ? 'MATCH' : 'MATERIAL_VARIANCE';
}

function classifyComponent({ component, excelValue, entitlementValue, calculatedValue, salaryValue, payrollValue, payrollItem }) {
    const processedVariance = variance(payrollValue, excelValue);
    if (Math.abs(processedVariance) <= TOLERANCE) return 'MATCH';
    if (component.type === 'basic') {
        if (Math.abs(variance(payrollValue, salaryValue)) > TOLERANCE) return 'PAYROLL_COPY_DIFFERENCE';
        if (Math.abs(variance(calculatedValue, excelValue)) > TOLERANCE) return 'BASIC_SALARY_VARIANCE';
        return 'BASIC_SALARY_VARIANCE';
    }
    if (component.type === 'allowance') {
        if (money(excelValue) > 0 && !legacyEnabled(entitlementValue)) return 'ALLOWANCE_NOT_ENABLED';
        if (money(excelValue) > 0 && legacyEnabled(entitlementValue) && Math.abs(money(calculatedValue)) <= TOLERANCE) {
            return 'ENABLED_ALLOWANCE_NOT_CALCULATED';
        }
        if (component.manualSensitive && Math.abs(processedVariance) > TOLERANCE) {
            return money(payrollValue) === 0 ? 'MISSING_MANUAL_ALLOWANCE' : 'MANUAL_ALLOWANCE_VARIANCE';
        }
        if (Number(payrollItem?.Percent || 0) > 0 && Math.abs(processedVariance) > TOLERANCE) {
            return 'BASIC_SALARY_VARIANCE';
        }
        if (legacyEnabled(entitlementValue) && Math.abs(variance(salaryValue, calculatedValue)) > TOLERANCE) {
            return 'ALLOWANCE_CALCULATION_DEFECT';
        }
        return 'ALLOWANCE_CONFIGURATION_VARIANCE';
    }
    if (component.type === 'taxable') return 'TAXABLE_INCOME_VARIANCE';
    if (component.type === 'tax') return 'PAYE_INPUT_OR_EXCEL_FORMULA_VARIANCE';
    if (component.type === 'nassit') return 'NASSIT_VARIANCE';
    if (component.type === 'deduction') return 'DEDUCTION_VARIANCE';
    if (component.type === 'net') return 'NET_PAY_VARIANCE';
    return 'UNRESOLVED';
}

function calculationMethod(item, allowanceConfig) {
    if (!item) return 'No Payroll Item configuration found';
    if (Number(item.Percent || 0) > 0) return `${Number(item.Percent)}% of basic salary`;
    if (legacyEnabled(item.Fixed) && Number(item.TAmount || 0) > 0) return `Fixed Payroll Item amount ${formatMoney(item.TAmount)}`;
    if (allowanceConfig && Number(allowanceConfig.amount || 0) > 0) return `Grade allowance amount ${formatMoney(allowanceConfig.amount)}`;
    if (allowanceConfig && Number(allowanceConfig.rate || 0) > 0) return `Grade allowance rate ${Number(allowanceConfig.rate)}% or rate value`;
    return 'Eligibility/configuration-driven or not calculated by current monthly auto-calculation path';
}

function getAllowanceConfig(allowanceRow, code) {
    if (!allowanceRow) return null;
    return {
        pyItem: allowanceRow[`PyItem${code}`],
        percentFlag: allowanceRow[`Percent${code}`],
        rate: money(allowanceRow[`Rate${code}`]),
        amount: money(allowanceRow[`Amount${code}`]),
        add: allowanceRow[`Add${code}`],
        taxable: allowanceRow[`Taxable${code}`],
        threshold: allowanceRow[`Thresh${code}`],
        frequency: allowanceRow[`Freq${code}`]
    };
}

async function main() {
    const source = JSON.parse(fs.readFileSync(SOURCE_JSON, 'utf8'));
    const employees = source.workbook.employees;
    const pfNos = employees.map((employee) => employee.pf);
    const placeholders = pfNos.map(() => '?').join(', ');

    const [staffRows] = await pool.query(
        `SELECT * FROM tblstaff WHERE CompanyID = ? AND PFNo IN (${placeholders})`,
        [COMPANY_ID, ...pfNos]
    );
    const [entitlementRows] = await pool.query(
        `SELECT * FROM tblentitle WHERE CompanyID = ? AND PFNo IN (${placeholders})`,
        [COMPANY_ID, ...pfNos]
    );
    const [salaryRows] = await pool.query(
        `SELECT s.*
         FROM tblsalary s
         INNER JOIN (
             SELECT PFNo, MAX(PDate) AS MaxPDate
             FROM tblsalary
             WHERE CompanyID = ? AND PFNo IN (${placeholders})
             GROUP BY PFNo
         ) latest
           ON latest.PFNo = s.PFNo AND latest.MaxPDate = s.PDate
         WHERE s.CompanyID = ?`,
        [COMPANY_ID, ...pfNos, COMPANY_ID]
    );
    const [payrollRows] = await pool.query(
        `SELECT * FROM tblpayroll
         WHERE CompanyID = ? AND PMonth = ? AND PYear = ? AND PType = ? AND PFNo IN (${placeholders})`,
        [COMPANY_ID, 8, 2026, '01', ...pfNos]
    );
    const [payrollItems] = await pool.query(
        `SELECT * FROM tblpayrollitems WHERE CompanyID = ? OR CompanyID IS NULL ORDER BY CASE WHEN CompanyID = ? THEN 0 ELSE 1 END, Code`,
        [COMPANY_ID, COMPANY_ID]
    );
    const [allowanceRows] = await pool.query(
        `SELECT a.*
         FROM tblallowance a
         INNER JOIN (
             SELECT Grade, MAX(ScaleDate) AS MaxScaleDate
             FROM tblallowance
             WHERE CompanyID = ?
             GROUP BY Grade
         ) latest
           ON latest.Grade = a.Grade AND latest.MaxScaleDate = a.ScaleDate
         WHERE a.CompanyID = ?`,
        [COMPANY_ID, COMPANY_ID]
    );

    const staffByPf = new Map(staffRows.map((row) => [row.PFNo, row]));
    const entByPf = new Map(entitlementRows.map((row) => [row.PFNo, row]));
    const salaryByPf = new Map(salaryRows.map((row) => [row.PFNo, row]));
    const payrollByPf = new Map(payrollRows.map((row) => [row.PFNo, row]));
    const itemByCode = new Map();
    for (const item of payrollItems) {
        const code = String(item.Code || '').padStart(2, '0');
        if (code && !itemByCode.has(code)) itemByCode.set(code, item);
    }
    const allowanceByGrade = new Map(allowanceRows.map((row) => [row.Grade, row]));

    const calculatedByPf = new Map();
    for (const pfNo of pfNos) {
        try {
            const calculated = await payrollSetupAutoCalculationService.calculatePayrollSetupForStaff({
                companyId: COMPANY_ID,
                pfNo,
                payrollDate: PAYROLL_DATE,
                executor: pool
            });
            calculatedByPf.set(pfNo, calculated.fields);
        } catch (error) {
            calculatedByPf.set(pfNo, { error: error.message });
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        scope: {
            companyId: COMPANY_ID,
            month: PAYROLL_MONTH,
            year: PAYROLL_YEAR,
            pType: PTYPE,
            readOnly: true
        },
        counts: {
            excelEmployees: employees.length,
            staffRows: staffRows.length,
            entitlementRows: entitlementRows.length,
            salaryRows: salaryRows.length,
            payrollRows: payrollRows.length
        },
        missing: {
            staff: pfNos.filter((pfNo) => !staffByPf.has(pfNo)),
            entitlement: pfNos.filter((pfNo) => !entByPf.has(pfNo)),
            salary: pfNos.filter((pfNo) => !salaryByPf.has(pfNo)),
            payroll: pfNos.filter((pfNo) => !payrollByPf.has(pfNo))
        },
        allowanceMapping: ALLOWANCE_COMPONENTS.map((component) => {
            const item = itemByCode.get(component.payrollItem);
            return {
                excelColumn: component.label,
                payrollItemCode: component.payrollItem,
                payrollItemDescription: item?.Income || null,
                systemField: component.salaryField,
                taxable: legacyEnabled(item?.Taxable),
                frequency: item?.Freq || null,
                calculationMethod: calculationMethod(item, null)
            };
        }),
        employees: [],
        consolidated: {},
        recommendations: []
    };

    for (const excel of employees) {
        const staff = staffByPf.get(excel.pf) || {};
        const entitlement = entByPf.get(excel.pf) || {};
        const salary = salaryByPf.get(excel.pf) || {};
        const payroll = payrollByPf.get(excel.pf) || {};
        const calculated = calculatedByPf.get(excel.pf) || {};
        const allowanceConfig = allowanceByGrade.get(staff.CGrade || staff.GradeCode || staff.Grade);
        const components = [];

        for (const component of COMPONENTS) {
            const item = component.payrollItem ? itemByCode.get(component.payrollItem) : null;
            const code = component.payrollItem;
            const config = code ? getAllowanceConfig(allowanceConfig, code) : null;
            const excelValue = money(excel[component.key]);
            let calculatedValue;
            if (component.key === 'totalAllowance') {
                calculatedValue = ALLOWANCE_COMPONENTS.reduce((sum, c) => sum + money(calculated[c.salaryField]), 0);
            } else if (component.key === 'totalDeduction') {
                calculatedValue = money(calculated.TotalDeduction);
            } else if (component.key === 'netPay') {
                calculatedValue = money(calculated.NetIncome);
            } else if (component.key === 'employeeNassit') {
                calculatedValue = money(calculated.NassitEmp);
            } else if (component.key === 'employerNassit') {
                calculatedValue = money(calculated.NassitInst);
            } else if (component.key === 'paye') {
                calculatedValue = money(calculated.Tax);
            } else if (component.key === 'taxable') {
                calculatedValue = money(calculated.Taxable);
            } else if (component.key === 'totalIncome') {
                calculatedValue = money(calculated.TotalIncome);
            } else {
                calculatedValue = money(calculated[component.salaryField]);
            }

            const salaryValue = component.key === 'totalAllowance'
                ? ALLOWANCE_COMPONENTS.reduce((sum, c) => sum + money(salary[c.salaryField]), 0)
                : money(salary[component.salaryField]);
            const payrollValue = component.key === 'totalAllowance'
                ? ALLOWANCE_COMPONENTS.reduce((sum, c) => sum + money(payroll[c.payrollField]), 0)
                : component.key === 'totalDeduction'
                    ? money(money(payroll.Tax) + money(payroll.NassitEmp) + money(payroll.UnionDues) + money(payroll.GratEmp) + money(payroll.Ded1) + money(payroll.Ded2) + money(payroll.Ded3) + money(payroll.Ded4) + money(payroll.Ded5) + money(payroll.Ded6) + money(payroll.Ded7))
                    : money(payroll[component.payrollField]);
            const entitlementValue = component.type === 'basic' ? entitlement.Salary : entitlement[component.entitleField];
            const rootCause = classifyComponent({
                component,
                excelValue,
                entitlementValue,
                calculatedValue,
                salaryValue,
                payrollValue,
                payrollItem: item
            });
            const row = {
                key: component.key,
                label: component.label,
                type: component.type,
                excel: excelValue,
                entitlementFlag: entitlementValue ?? null,
                entitlementStatus: component.type === 'basic' || component.type === 'allowance'
                    ? (legacyEnabled(entitlementValue) ? 'Enabled' : 'Disabled')
                    : 'Not applicable',
                gradeConfig: config,
                payrollItem: item ? {
                    code: component.payrollItem,
                    description: item.Income,
                    taxable: legacyEnabled(item.Taxable),
                    fixed: legacyEnabled(item.Fixed),
                    percent: Number(item.Percent || 0),
                    frequency: item.Freq,
                    threshold: legacyEnabled(item.Threshhold)
                } : null,
                calculationMethod: calculationMethod(item, config),
                calculated: money(calculatedValue),
                tblsalary: salaryValue,
                tblpayroll: payrollValue,
                varianceProcessedVsExcel: variance(payrollValue, excelValue),
                varianceCalculatedVsExcel: variance(calculatedValue, excelValue),
                rootCause,
                status: statusFromVariance(variance(payrollValue, excelValue))
            };
            components.push(row);

            if (!report.consolidated[component.key]) {
                report.consolidated[component.key] = {
                    component: component.label,
                    excelTotal: 0,
                    entitlementExpectedTotal: 0,
                    calculatedSalaryTotal: 0,
                    processedPayrollTotal: 0,
                    variance: 0,
                    rootCauses: {}
                };
            }
            const total = report.consolidated[component.key];
            total.excelTotal = money(total.excelTotal + excelValue);
            total.entitlementExpectedTotal = money(total.entitlementExpectedTotal + calculatedValue);
            total.calculatedSalaryTotal = money(total.calculatedSalaryTotal + salaryValue);
            total.processedPayrollTotal = money(total.processedPayrollTotal + payrollValue);
            total.variance = money(total.processedPayrollTotal - total.excelTotal);
            if (rootCause !== 'MATCH') total.rootCauses[rootCause] = (total.rootCauses[rootCause] || 0) + 1;

            if (row.status !== 'MATCH' && ['basic', 'allowance'].includes(component.type)) {
                report.recommendations.push({
                    pf: excel.pf,
                    name: excel.name,
                    field: component.label,
                    currentDatabaseValue: payrollValue,
                    excelReferenceValue: excelValue,
                    proposedCorrectedValue: excelValue,
                    reason: rootCause,
                    manualOrAutomatic: component.manualSensitive ? 'Manual-sensitive allowance' : (Number(item?.Percent || 0) > 0 ? 'Automatic percentage/basic-driven' : 'Configuration-driven'),
                    managerApprovalRequired: true,
                    expectedPayrollImpact: money(excelValue - payrollValue),
                    classification: rootCause === 'ALLOWANCE_CALCULATION_DEFECT' ? 'CONFIRMED SYSTEM DEFECT' : 'REQUIRES WAEC CONFIRMATION'
                });
            }
        }

        const byKey = Object.fromEntries(components.map((component) => [component.key, component]));
        const netVariance = byKey.netPay.varianceProcessedVsExcel;
        const employeeRootCauses = [...new Set(components.filter((component) => component.rootCause !== 'MATCH').map((component) => component.rootCause))];
        report.employees.push({
            pf: excel.pf,
            excelName: excel.name,
            databaseName: staff.SName || null,
            nameMatch: normalizeName(excel.name) === normalizeName(staff.SName),
            designation: excel.designation,
            databaseGrade: staff.CGrade || null,
            databaseNotch: staff.Notch ?? null,
            latestSalaryDate: salary.PDate || null,
            components,
            conclusion: {
                netPayVariance: netVariance,
                rootCauses: employeeRootCauses,
                summary: employeeRootCauses.length
                    ? `Material differences are driven by ${employeeRootCauses.join(', ')}.`
                    : 'Employee values match within tolerance.'
            }
        });
    }

    writeOutputs(report);
    console.log(JSON.stringify({
        employeesCompared: report.employees.length,
        materialVarianceRows: report.employees.flatMap((employee) => employee.components).filter((component) => component.status !== 'MATCH').length,
        outputs: { json: OUTPUT_JSON, employeeReport: EMPLOYEE_MD, consolidated: CONSOLIDATED_MD, recommended: RECOMMENDED_MD }
    }, null, 2));
}

function normalizeName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function writeOutputs(report) {
    fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2));
    fs.writeFileSync(EMPLOYEE_MD, buildEmployeeMarkdown(report));
    fs.writeFileSync(CONSOLIDATED_MD, buildConsolidatedMarkdown(report));
    fs.writeFileSync(RECOMMENDED_MD, buildRecommendedMarkdown(report));
}

function buildEmployeeMarkdown(report) {
    const lines = ['# WAEC August 2026 Employee Data Comparison', '', `Generated: ${report.generatedAt}`, '', 'Read-only comparison. No financial records were changed.', ''];
    lines.push(`Employees compared: ${report.employees.length}`);
    lines.push('');
    for (const employee of report.employees) {
        lines.push(`## Employee: ${employee.excelName}`);
        lines.push('');
        lines.push(`PF Number: ${employee.pf}`);
        lines.push(`Database Name: ${employee.databaseName || 'Not found'}`);
        lines.push(`Designation: ${employee.designation || ''}`);
        lines.push(`Database Grade/Notch: ${employee.databaseGrade || ''} / ${employee.databaseNotch ?? ''}`);
        lines.push(`Latest tblsalary date: ${employee.latestSalaryDate || ''}`);
        lines.push('');
        lines.push('| Component | Excel | Entitlement/Config | Calculated | tblsalary | tblpayroll | Difference | Root Cause |');
        lines.push('| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |');
        for (const component of employee.components) {
            const config = component.type === 'basic'
                ? component.entitlementStatus
                : `${component.entitlementStatus}${component.payrollItem ? `; ${component.payrollItem.description}; ${component.calculationMethod}` : ''}`;
            lines.push(`| ${component.label} | ${formatMoney(component.excel)} | ${config} | ${formatMoney(component.calculated)} | ${formatMoney(component.tblsalary)} | ${formatMoney(component.tblpayroll)} | ${formatMoney(component.varianceProcessedVsExcel)} | ${component.rootCause} |`);
        }
        lines.push('');
        lines.push(`Conclusion: ${employee.conclusion.summary}`);
        lines.push('');
    }
    return `${lines.join('\n')}\n`;
}

function buildConsolidatedMarkdown(report) {
    const lines = ['# WAEC August 2026 Consolidated Variances', '', 'Read-only comparison. No payroll records were changed.', ''];
    lines.push('| Component | Excel Total | Entitlement Expected Total | Calculated Salary Total | Processed Payroll Total | Variance | Root Cause |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const component of COMPONENTS) {
        const row = report.consolidated[component.key];
        const causes = Object.keys(row.rootCauses).length
            ? Object.entries(row.rootCauses).map(([cause, count]) => `${cause} (${count})`).join(', ')
            : 'MATCH';
        lines.push(`| ${row.component} | ${formatMoney(row.excelTotal)} | ${formatMoney(row.entitlementExpectedTotal)} | ${formatMoney(row.calculatedSalaryTotal)} | ${formatMoney(row.processedPayrollTotal)} | ${formatMoney(row.variance)} | ${causes} |`);
    }
    lines.push('');
    return `${lines.join('\n')}\n`;
}

function buildRecommendedMarkdown(report) {
    const lines = ['# WAEC August 2026 Recommended Corrections', '', 'No corrections were applied. These recommendations require WAEC/client confirmation and the normal approval workflow before any payroll reprocessing.', ''];
    lines.push('| PFNo | Name | Field | Current DB Value | Excel Reference | Proposed Value | Reason | Manual/Automatic | Manager Approval | Expected Payroll Impact | Classification |');
    lines.push('| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |');
    for (const row of report.recommendations) {
        lines.push(`| ${row.pf} | ${row.name} | ${row.field} | ${formatMoney(row.currentDatabaseValue)} | ${formatMoney(row.excelReferenceValue)} | ${formatMoney(row.proposedCorrectedValue)} | ${row.reason} | ${row.manualOrAutomatic} | ${row.managerApprovalRequired ? 'Yes' : 'No'} | ${formatMoney(row.expectedPayrollImpact)} | ${row.classification} |`);
    }
    lines.push('');
    return `${lines.join('\n')}\n`;
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
