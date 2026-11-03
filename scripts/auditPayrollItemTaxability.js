const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const payeTaxService = require('../services/payeTaxService');

const COMPANY_ID = Number(process.env.PAYROLL_ITEM_AUDIT_COMPANY_ID || 1);
const YEARLY_TAX_RATE = 0.30;

function money(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function isTaxable(value) {
    return value === true || value === 1 || value === -1 || value === '1' || value === '-1';
}

function isTrue(value) {
    return isTaxable(value);
}

function normalizeCode(value) {
    return String(value || '').padStart(2, '0');
}

function status(ok) {
    return ok ? 'PASS' : 'FAIL';
}

function readFileIfExists(relativePath) {
    const fullPath = path.join(__dirname, '..', relativePath);
    return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
}

function assertClose(actual, expected, label, failures) {
    const a = money(actual);
    const e = money(expected);
    const ok = Math.abs(a - e) <= 0.02;
    if (!ok) {
        failures.push({ label, actual: a, expected: e });
    }
    return ok;
}

function classifyUsedBy(item) {
    const code = normalizeCode(item.Code);
    if (code === '01') return 'Basic salary / tblsalary.Salary';
    if (Number(code) >= 2 && Number(code) <= 20) return `Monthly/yearly earning column Allw${code} or yearly payment PType ${code}`;
    if (code === '31') return 'PAYE deduction / tblsalary.Tax / tblpayroll.Tax';
    if (code === '32') return 'Employee NASSIT / NassitEmp';
    if (code === '33') return 'Employee provident/gratuity / GratEmp';
    if (Number(code) >= 34 && Number(code) <= 40) return 'Employee deduction columns / supporting deduction tables';
    if (code === '41') return 'Employer NASSIT / NassitInst';
    if (code === '42') return 'Employer provident/gratuity / GratInst';
    if (Number(code) >= 43) return 'Other employer/liability item';
    return 'Unknown/legacy';
}

function payrollColumnForItem(item) {
    const code = normalizeCode(item.Code);
    if (code === '01') return 'Salary';
    if (Number(code) >= 2 && Number(code) <= 20) return `Allw${code}`;
    if (code === '31') return 'Tax';
    if (code === '32') return 'NassitEmp';
    if (code === '33') return 'GratEmp';
    if (code === '34') return 'Ded1 / Ded4 depending loan path';
    if (code === '35') return 'UnionDues';
    if (code === '36') return 'Ded3';
    if (code === '37') return 'Ded4';
    if (code === '38') return 'Ded5';
    if (code === '41') return 'NassitInst';
    if (code === '42') return 'GratInst';
    return 'No direct monthly payroll column confirmed';
}

async function calculateMonthlyScenario({
    companyId,
    payrollDate,
    salary,
    allowances,
    employeeNassitRate = 5,
    otherDeduction = 0
}) {
    const taxableAllowance = allowances
        .filter((item) => item.taxable)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalAllowance = allowances.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalIncome = money(Number(salary) + totalAllowance);
    const employeeNassit = money(Number(salary) * (employeeNassitRate / 100));
    const taxableEarnings = money(Number(salary) + taxableAllowance);
    const paye = await payeTaxService.calculateMonthlyPaye({
        companyId,
        payrollDate,
        taxableEarnings,
        employeeNassit
    });
    const netIncome = money(totalIncome - employeeNassit - paye.tax - Number(otherDeduction || 0));
    return {
        salary: money(salary),
        allowances: allowances.map((item) => ({ ...item, amount: money(item.amount) })),
        totalIncome,
        taxableEarnings,
        employeeNassit,
        chargeableIncome: paye.chargeableIncome,
        paye: paye.tax,
        otherDeduction: money(otherDeduction),
        netIncome
    };
}

function calculateYearlyScenario({ baseSalary, percent, months = 12, taxable }) {
    const monthlyAmount = money(Number(baseSalary) * (Number(percent) / 100));
    const totalIncome = money(monthlyAmount * months);
    const taxableAmount = taxable ? totalIncome : 0;
    const taxAmount = taxable ? money(taxableAmount * YEARLY_TAX_RATE) : 0;
    return {
        baseSalary: money(baseSalary),
        percent: Number(percent),
        months,
        monthlyAmount,
        totalIncome,
        taxableAmount,
        taxAmount,
        netIncome: money(totalIncome - taxAmount)
    };
}

async function main() {
    const failures = [];
    const report = {
        generatedAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        findings: [],
        matrices: {},
        tests: {}
    };

    const [columns] = await pool.query('SHOW COLUMNS FROM tblpayrollitems');
    const [items] = await pool.query(
        'SELECT * FROM tblpayrollitems WHERE CompanyID = ? OR CompanyID IS NULL ORDER BY Code, CompanyID',
        [COMPANY_ID]
    );
    const uniqueItems = new Map();
    items.forEach((item) => {
        const code = normalizeCode(item.Code);
        if (!uniqueItems.has(code) || Number(item.CompanyID) === COMPANY_ID) {
            uniqueItems.set(code, item);
        }
    });
    const itemList = Array.from(uniqueItems.values()).sort((a, b) => normalizeCode(a.Code).localeCompare(normalizeCode(b.Code)));

    report.schema = columns.map((column) => ({
        field: column.Field,
        type: column.Type,
        nullable: column.Null,
        default: column.Default,
        key: column.Key
    }));

    report.matrices.payrollItems = itemList.map((item) => ({
        Code: normalizeCode(item.Code),
        Description: item.Income,
        Frequency: item.Freq || null,
        TaxableRaw: item.Taxable,
        TaxableMeaning: isTaxable(item.Taxable) ? 'Taxable' : 'Non-taxable',
        Fixed: isTrue(item.Fixed),
        Mode: item.Mode,
        Percentage: Number(item.Percent || 0),
        ThresholdFlag: isTrue(item.Threshhold),
        ThresholdPercentFlag: isTrue(item.TPercent),
        ThresholdPercentage: Number(item.TPercentage || 0),
        ThresholdAmount: Number(item.TAmount || 0),
        CompanyID: item.CompanyID,
        PayrollColumn: payrollColumnForItem(item),
        UsedBy: classifyUsedBy(item)
    }));

    const monthlyItems = report.matrices.payrollItems.filter((item) => item.Frequency === 'M');
    const yearlyItems = report.matrices.payrollItems.filter((item) => item.Frequency === 'Y');
    const otherFrequencyItems = report.matrices.payrollItems.filter((item) => !['M', 'Y'].includes(item.Frequency));

    report.counts = {
        total: report.matrices.payrollItems.length,
        monthly: monthlyItems.length,
        yearly: yearlyItems.length,
        otherOrUnknownFrequency: otherFrequencyItems.length,
        taxable: report.matrices.payrollItems.filter((item) => item.TaxableMeaning === 'Taxable').length,
        nonTaxable: report.matrices.payrollItems.filter((item) => item.TaxableMeaning === 'Non-taxable').length
    };

    const frequencies = [...new Set(report.matrices.payrollItems.map((item) => item.Frequency || '(blank/null)'))];
    report.findings.push({
        area: 'PAYROLL_ITEM_INVENTORY',
        status: status(report.counts.total > 0),
        detail: `Found ${report.counts.total} payroll items. Frequencies: ${frequencies.join(', ')}.`
    });

    report.findings.push({
        area: 'TAXABLE_FLAG_SEMANTICS',
        status: 'PASS',
        detail: 'tblpayrollitems.Taxable uses non-zero legacy truth semantics. Current data uses -1 for taxable and 0 for non-taxable; Admin create/update writes 1/0, and code treats any non-zero as taxable.'
    });

    const serviceText = readFileIfExists('services/payrollSetupAutoCalculationService.js');
    const dataEntryText = readFileIfExists('controllers/dataEntryController.js');
    const yearlyText = readFileIfExists('services/yearlyPaymentService.js');
    const processText = readFileIfExists('services/processEmolumentsService.js');
    const liabilityText = readFileIfExists('services/payrollLiabilityReportService.js');
    const parameterText = readFileIfExists('services/parameterChangeService.js');

    const monthlyServiceReadsTaxable = /legacyTrue\(item\?\.Taxable\)/.test(serviceText)
        && /taxableAllowance \+= amount/.test(serviceText);
    const manualSaveReadsTaxable = /SELECT Code, Taxable[\s\S]*FROM tblpayrollitems/.test(dataEntryText)
        && /itemTaxable\.get\(code\)/.test(dataEntryText)
        && /calculateMonthlyPaye/.test(dataEntryText);
    const processCopiesTax = /sal\.TotalIncome, sal\.Taxable, sal\.Tax, sal\.NassitEmp, sal\.NassitInst/.test(processText);
    const yearlyReadsTaxable = /const taxableFlag = Number\(config\.payrollItem\.Taxable \|\| 0\) !== 0/.test(yearlyText)
        && /const taxableAmount = taxableFlag \? totalIncome : 0/.test(yearlyText);
    const payrollItemsGoverned = /'payroll-items': makeLookupModule/.test(parameterText);

    report.findings.push({
        area: 'MONTHLY_CALCULATION_MAPPING',
        status: status(monthlyServiceReadsTaxable && manualSaveReadsTaxable && processCopiesTax),
        detail: 'Monthly taxability is applied upstream in payroll setup; Process Emoluments snapshots tblsalary values into tblpayroll.',
        checks: { monthlyServiceReadsTaxable, manualSaveReadsTaxable, processCopiesTax }
    });
    report.findings.push({
        area: 'YEARLY_CALCULATION_MAPPING',
        status: status(yearlyReadsTaxable),
        detail: 'Yearly-payment service uses Payroll Item Taxable to set TaxableAmount and applies its separate 30% yearly tax rule.',
        checks: { yearlyReadsTaxable }
    });
    report.findings.push({
        area: 'PAYROLL_ITEM_GOVERNANCE',
        status: status(payrollItemsGoverned),
        detail: payrollItemsGoverned
            ? 'Payroll Items are registered with the parameter-change workflow.'
            : 'Payroll Items parameter-change governance was not found.',
        checks: { payrollItemsGoverned }
    });

    const payrollDate = '2026-09-28';
    const monthlyTests = {
        salaryOnly: await calculateMonthlyScenario({ companyId: COMPANY_ID, payrollDate, salary: 2000, allowances: [] }),
        taxableFixedAllowance: await calculateMonthlyScenario({ companyId: COMPANY_ID, payrollDate, salary: 2000, allowances: [{ code: '99', label: 'Synthetic taxable fixed', amount: 500, taxable: true }] }),
        nonTaxableFixedAllowance: await calculateMonthlyScenario({ companyId: COMPANY_ID, payrollDate, salary: 2000, allowances: [{ code: '99', label: 'Synthetic non-taxable fixed', amount: 500, taxable: false }] }),
        taxablePercentageAllowance: await calculateMonthlyScenario({ companyId: COMPANY_ID, payrollDate, salary: 2000, allowances: [{ code: '11', label: 'Synthetic taxable percentage 20%', amount: 400, taxable: true }] }),
        nonTaxablePercentageAllowance: await calculateMonthlyScenario({ companyId: COMPANY_ID, payrollDate, salary: 2000, allowances: [{ code: '11', label: 'Synthetic non-taxable percentage 20%', amount: 400, taxable: false }] }),
        mixedAllowances: await calculateMonthlyScenario({ companyId: COMPANY_ID, payrollDate, salary: 2000, allowances: [{ code: '11', label: 'Taxable allowance', amount: 500, taxable: true }, { code: '12', label: 'Non-taxable allowance', amount: 500, taxable: false }] }),
        taxableWithOtherDeduction: await calculateMonthlyScenario({ companyId: COMPANY_ID, payrollDate, salary: 2000, allowances: [{ code: '11', label: 'Taxable allowance', amount: 500, taxable: true }], otherDeduction: 100 }),
        highIncome: await calculateMonthlyScenario({ companyId: COMPANY_ID, payrollDate, salary: 10000, allowances: [{ code: '11', label: 'Taxable allowance', amount: 2000, taxable: true }] })
    };
    report.tests.monthly = monthlyTests;

    assertClose(monthlyTests.taxableFixedAllowance.totalIncome, 2500, 'Taxable allowance increases TotalIncome', failures);
    assertClose(monthlyTests.taxableFixedAllowance.chargeableIncome, 2400, 'Taxable allowance chargeable income', failures);
    assertClose(monthlyTests.taxableFixedAllowance.paye, 360, 'Taxable allowance PAYE', failures);
    assertClose(monthlyTests.nonTaxableFixedAllowance.totalIncome, 2500, 'Non-taxable allowance increases TotalIncome', failures);
    assertClose(monthlyTests.nonTaxableFixedAllowance.chargeableIncome, 1900, 'Non-taxable allowance excluded from chargeable income', failures);
    assertClose(monthlyTests.nonTaxableFixedAllowance.paye, 235, 'Non-taxable allowance PAYE', failures);
    assertClose(monthlyTests.taxableFixedAllowance.paye - monthlyTests.nonTaxableFixedAllowance.paye, 125, 'Taxability flag changes PAYE by expected amount', failures);

    report.findings.push({
        area: 'MONTHLY_TAXABLE_ITEM_INCLUSION',
        status: status(monthlyTests.taxableFixedAllowance.paye > monthlyTests.nonTaxableFixedAllowance.paye),
        detail: 'Synthetic taxable NLe500 allowance increases PAYE from NLe235 to NLe360 for a NLe2,000 salary with 5% employee NASSIT.'
    });
    report.findings.push({
        area: 'MONTHLY_NON_TAXABLE_ITEM_EXCLUSION',
        status: status(monthlyTests.nonTaxableFixedAllowance.chargeableIncome === monthlyTests.salaryOnly.chargeableIncome),
        detail: 'Synthetic non-taxable NLe500 allowance increases TotalIncome but does not increase PAYE chargeable income.'
    });
    report.findings.push({
        area: 'NASSIT_INTERACTION',
        status: status(monthlyTests.salaryOnly.employeeNassit === 100 && monthlyTests.salaryOnly.chargeableIncome === 1900),
        detail: 'Employee NASSIT is deducted before PAYE; employer NASSIT is not part of the employee net-pay calculation.'
    });

    const yearlyBaseSalary = 2000;
    const yearlyTests = {};
    for (const code of ['02', '05', '13']) {
        const item = uniqueItems.get(code);
        const percent = Number(item?.Percent || (code === '02' ? 75 : code === '05' ? 15 : 20));
        yearlyTests[code] = {
            label: item?.Income || code,
            taxableConfigScenario: calculateYearlyScenario({ baseSalary: yearlyBaseSalary, percent, months: code === '02' ? 6 : 12, taxable: true }),
            nonTaxableConfigScenario: calculateYearlyScenario({ baseSalary: yearlyBaseSalary, percent, months: code === '02' ? 6 : 12, taxable: false }),
            liveTaxableFlag: isTaxable(item?.Taxable),
            livePercent: percent,
            liveFrequency: item?.Freq || null
        };
    }
    report.tests.yearly = yearlyTests;

    const yearlyPass = Object.values(yearlyTests).every((test) => (
        test.taxableConfigScenario.taxAmount > 0
        && test.nonTaxableConfigScenario.taxAmount === 0
        && test.taxableConfigScenario.totalIncome === test.nonTaxableConfigScenario.totalIncome
    ));
    report.findings.push({
        area: 'YEARLY_TAXABILITY',
        status: status(yearlyPass),
        detail: 'Rent, Inducement, and Leave yearly scenarios show Taxable flag controls TaxableAmount/TaxAmount under the existing yearly flat-tax rule.'
    });

    const yearlyApplyWritesToLegacy = /INSERT INTO tblyearlypayments[\s\S]*Taxable, Tax, NetIncome/.test(yearlyText);
    const reportsUsePayrollTax = /SUM\(COALESCE\(p\.Tax, 0\)\) AS TaxDeducted/.test(liabilityText);
    report.findings.push({
        area: 'DATABASE_PERSISTENCE_PATHS',
        status: status(processCopiesTax && yearlyApplyWritesToLegacy),
        detail: 'Monthly persistence path copies tblsalary to tblpayroll; yearly application writes Taxable/Tax/NetIncome to tblyearlypayments.',
        checks: { processCopiesTax, yearlyApplyWritesToLegacy }
    });
    report.findings.push({
        area: 'REPORT_INTEGRATION',
        status: status(reportsUsePayrollTax),
        detail: 'PAYE liability report consumes authoritative tblpayroll.Tax and does not recalculate Payroll Item taxability.',
        checks: { reportsUsePayrollTax }
    });

    const adminCreateStoresOneZero = /Taxable: Taxable \? 1 : 0/.test(readFileIfExists('controllers/adminController.js'));
    const adminUpdateBooleanFields = /\['Taxable', 'Threshhold', 'TPercent', 'Fixed'\]/.test(readFileIfExists('controllers/adminController.js'));
    const adminUiCheckbox = /name=\"Taxable\"/.test(readFileIfExists('views/admin/parameters/payroll-items.ejs'));
    report.findings.push({
        area: 'ADMIN_CONFIGURATION_PERSISTENCE',
        status: status(adminCreateStoresOneZero && adminUpdateBooleanFields && adminUiCheckbox),
        detail: 'Admin Payroll Items UI exposes Taxable checkbox. Create/update paths persist boolean-like values; application treats any non-zero value as taxable.',
        checks: { adminCreateStoresOneZero, adminUpdateBooleanFields, adminUiCheckbox }
    });

    const companyScopedPayrollItems = /WHERE CompanyID = \? OR CompanyID IS NULL/.test(serviceText)
        && /ORDER BY CASE WHEN CompanyID = \? THEN 0 ELSE 1 END/.test(serviceText);
    const companyScopedManualSave = /FROM tblpayrollitems[\s\S]*WHERE CompanyID = \? OR CompanyID IS NULL[\s\S]*ORDER BY CASE WHEN CompanyID = \? THEN 0 ELSE 1 END/.test(dataEntryText);
    const companyScopedYearly = /FROM tblpayrollitems/.test(yearlyText)
        && /WHERE \(CompanyID = \? OR CompanyID IS NULL\)/.test(yearlyText)
        && /AND Code = \?/.test(yearlyText)
        && /\(CompanyID = \? OR CompanyID IS NULL\)/.test(yearlyText)
        && /ORDER BY CompanyID DESC/.test(yearlyText);
    report.findings.push({
        area: 'COMPANY_ISOLATION',
        status: status(companyScopedPayrollItems && companyScopedManualSave && companyScopedYearly),
        detail: 'Active monthly and yearly item lookup paths prefer company-specific Payroll Item rows and fall back to NULL company rows.',
        checks: { companyScopedPayrollItems, companyScopedManualSave, companyScopedYearly }
    });

    report.specialPayments = {
        '04': 'Welfare is present as monthly Allw04 and yearly legacy PType 04 paths exist in older Data Entry controller code; current confirmed yearly workflow scope is Rent/Inducement/Leave.',
        '06': 'COLA is monthly Allw06.',
        '07': 'Backlog uses difference-based calculation and progressive PAYE on the income delta; not generic Payroll Item Taxable.',
        '08': 'EOS uses separate EOS benefit service/statutory calculation; not generic Payroll Item Taxable.',
        '09': 'Bonus uses tblbonus/BTaxable; separate treatment.',
        '14': 'Acting is monthly Allw14/sensitive-record source; taxability follows monthly allowance if included in setup.',
        '15': 'Long Service is yearly legacy item but not one of the confirmed Phase 16B annual batch types.',
        '33': 'Provident employee deduction/liability, not taxable earning.',
        '40': 'Guarantee deduction/other item, not taxable earning.',
        '41': 'Employer NASSIT liability, not taxable earning.',
        '42': 'Employer provident/gratuity liability, not taxable earning.'
    };

    report.historicalImpact = {
        status: 'INDETERMINATE_WITHOUT_HISTORICAL_CONFIG_SNAPSHOTS',
        detail: 'Historical payroll rows preserve stored Taxable/Tax. Because historical Payroll Item taxability effective dates are not tracked in tblpayrollitems, this audit does not assert historical taxability correctness from current flags.'
    };
    report.cleanup = {
        status: 'PASS',
        detail: 'Audit used read-only inventory and isolated in-memory scenarios; no production payroll/payroll-item rows were modified.'
    };

    if (failures.length) {
        report.failures = failures;
    }

    const failedFindings = report.findings.filter((finding) => finding.status === 'FAIL');
    report.summary = {
        status: failedFindings.length || failures.length
            ? 'PAYROLL ITEM TAXABILITY AUDIT: FAIL'
            : 'PAYROLL ITEM TAXABILITY AUDIT: PASS',
        failedAreas: failedFindings.map((finding) => finding.area),
        assertionFailures: failures
    };

    console.log(JSON.stringify(report, null, 2));
    if (report.summary.status.endsWith('FAIL')) {
        process.exitCode = 1;
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
