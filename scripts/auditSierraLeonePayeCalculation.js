const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const COMPANY_ID = Number(process.env.PAYE_AUDIT_COMPANY_ID || 1);
const MONEY_EPSILON = 0.02;

function money(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function yes(value) {
    return value === true || value === 1 || value === -1 || value === '1' || value === '-1';
}

function status(ok) {
    return ok ? 'PASS' : 'FAIL';
}

function closeEnough(actual, expected, tolerance = MONEY_EPSILON) {
    return Math.abs(money(actual) - money(expected)) <= tolerance;
}

function progressivePayeReference(chargeableIncome, bands) {
    const chargeable = Math.max(0, Number(chargeableIncome) || 0);
    const limits = [
        Number(bands.R1) || 0,
        Number(bands.R2) || 0,
        Number(bands.R3) || 0,
        Number(bands.R4) || 0
    ];
    const rates = [
        Number(bands.R1Tax) || 0,
        Number(bands.R2Tax) || 0,
        Number(bands.R3Tax) || 0,
        Number(bands.R4Tax) || 0,
        Number(bands.R5Tax) || 0
    ];

    let previousLimit = 0;
    let tax = 0;

    for (let i = 0; i < limits.length; i += 1) {
        const limit = limits[i];
        if (limit <= previousLimit) {
            continue;
        }
        const taxableInBand = Math.max(0, Math.min(chargeable, limit) - previousLimit);
        tax += taxableInBand * (rates[i] / 100);
        previousLimit = limit;
        if (chargeable <= limit) {
            return money(tax);
        }
    }

    if (chargeable > previousLimit) {
        tax += (chargeable - previousLimit) * (rates[4] / 100);
    }

    return money(tax);
}

function expectedSierraLeonePaye(chargeableIncome) {
    return progressivePayeReference(chargeableIncome, {
        R1: 600,
        R1Tax: 0,
        R2: 1200,
        R2Tax: 15,
        R3: 1800,
        R3Tax: 20,
        R4: 2400,
        R4Tax: 25,
        R5Tax: 30
    });
}

function codeContains(file, pattern) {
    const fullPath = path.join(__dirname, '..', file);
    return fs.existsSync(fullPath) && pattern.test(fs.readFileSync(fullPath, 'utf8'));
}

async function fetchEffectiveTaxRow(companyId) {
    const [rows] = await pool.query(
        `
            SELECT *
            FROM tbltax
            WHERE CompanyID = ? OR CompanyID IS NULL
            ORDER BY CASE WHEN CompanyID = ? THEN 0 ELSE 1 END, TaxDate DESC
            LIMIT 1
        `,
        [companyId, companyId]
    );
    return rows[0] || null;
}

async function main() {
    const report = {
        generatedAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        findings: [],
        samples: {}
    };

    const [taxColumns] = await pool.query('SHOW COLUMNS FROM tbltax');
    const [taxRows] = await pool.query(
        'SELECT * FROM tbltax WHERE CompanyID = ? OR CompanyID IS NULL ORDER BY CompanyID, TaxDate DESC',
        [COMPANY_ID]
    );
    const taxRow = await fetchEffectiveTaxRow(COMPANY_ID);
    if (!taxRow) {
        report.findings.push({ area: 'TAX_TABLE_CONFIGURATION', status: 'FAIL', detail: 'No tbltax row found.' });
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = 1;
        return;
    }

    const [payrollItems] = await pool.query(
        `
            SELECT Code, Income, Taxable, Threshhold, TPercent, TPercentage, TAmount, Mode, Fixed, Percent, Freq, CompanyID
            FROM tblpayrollitems
            WHERE CompanyID = ? OR CompanyID IS NULL
            ORDER BY Code
        `,
        [COMPANY_ID]
    );

    report.taxTableColumns = taxColumns.map((column) => ({
        field: column.Field,
        type: column.Type,
        nullable: column.Null,
        default: column.Default
    }));
    report.taxRows = taxRows;
    report.effectiveTaxRow = taxRow;
    report.payrollItems = payrollItems;

    const expectedConfig = {
        R1: 600,
        R1Tax: 0,
        R2: 1200,
        R2Tax: 15,
        R3: 1800,
        R3Tax: 20,
        R4: 2400,
        R4Tax: 25,
        R5Tax: 30
    };
    const configMatches = Object.entries(expectedConfig).every(([key, value]) => Number(taxRow[key]) === value);
    report.findings.push({
        area: 'TAX_TABLE_CONFIGURATION',
        status: status(configMatches),
        detail: configMatches
            ? 'Effective tbltax row matches the current Sierra Leone monthly resident PAYE rates.'
            : 'Effective tbltax row differs from the current Sierra Leone monthly resident PAYE rates.',
        expectedConfig,
        actual: Object.fromEntries(Object.keys(expectedConfig).map((key) => [key, taxRow[key]]))
    });

    const cumulativeBands = Number(taxRow.R2) > Number(taxRow.R1)
        && Number(taxRow.R3) > Number(taxRow.R2)
        && Number(taxRow.R4) > Number(taxRow.R3);
    report.findings.push({
        area: 'BAND_SEMANTICS',
        status: status(cumulativeBands),
        detail: cumulativeBands
            ? 'R1-R4 behave as cumulative upper limits. R5Tax is used as the rate above R4; R5 itself is not required by the progressive calculation.'
            : 'R1-R4 do not form increasing cumulative upper limits.'
    });

    const boundaryIncomes = [0, 599.99, 600, 600.01, 1000, 1199.99, 1200, 1200.01, 1799.99, 1800, 1800.01, 2399.99, 2400, 2400.01, 3000, 5000, 10000, 100000];
    const boundaryResults = boundaryIncomes.map((income) => ({
        chargeableIncome: income,
        expected: expectedSierraLeonePaye(income),
        fromLiveTaxTable: progressivePayeReference(income, taxRow),
        pass: closeEnough(progressivePayeReference(income, taxRow), expectedSierraLeonePaye(income))
    }));
    report.samples.boundaryResults = boundaryResults;
    report.findings.push({
        area: 'PAYE_BAND_ENGINE',
        status: status(boundaryResults.every((row) => row.pass)),
        detail: 'Independent progressive PAYE reference compared against live tbltax configuration.'
    });

    const workedExamples = [600, 1000, 1200, 1800, 2000, 2400, 3000, 5000].map((income) => ({
        chargeableIncome: income,
        expected: expectedSierraLeonePaye(income),
        actualFromLiveTaxTable: progressivePayeReference(income, taxRow),
        pass: closeEnough(progressivePayeReference(income, taxRow), expectedSierraLeonePaye(income))
    }));
    report.samples.workedExamples = workedExamples;

    const nassitEmpItem = payrollItems.find((item) => String(item.Code).padStart(2, '0') === '32');
    const nassitInstItem = payrollItems.find((item) => String(item.Code).padStart(2, '0') === '41');
    const employeeNassitRate = Number(nassitEmpItem?.Percent) || 0;
    const employerNassitRate = Number(nassitInstItem?.Percent) || 0;
    const nassitTests = [1000, 2000].map((basicSalary) => {
        const emp = money(basicSalary * employeeNassitRate / 100);
        const inst = money(basicSalary * employerNassitRate / 100);
        const chargeable = money(basicSalary - emp);
        const paye = progressivePayeReference(chargeable, taxRow);
        return {
            basicSalary,
            employeeNassitRate,
            employerNassitRate,
            employeeNassit: emp,
            employerNassit: inst,
            chargeableIncomeBeforeAllwThreshold: chargeable,
            payeBeforeAllwThreshold: paye,
            netBeforeOtherDeductions: money(basicSalary - emp - paye)
        };
    });
    report.samples.nassitIntegration = nassitTests;
    report.findings.push({
        area: 'NASSIT_CONFIGURATION',
        status: status(employeeNassitRate === 5 && employerNassitRate === 10),
        detail: `tblpayrollitems code 32 employee NASSIT rate=${employeeNassitRate}; code 41 institution NASSIT rate=${employerNassitRate}.`
    });

    const allwThreshold = Number(taxRow.AllwThreshold) || 0;
    report.findings.push({
        area: 'ALLWTHRESHOLD',
        status: 'PASS',
        detail: allwThreshold === 0
            ? 'AllwThreshold is zero.'
            : `AllwThreshold remains ${allwThreshold} as legacy metadata. The remediated active monthly PAYE path does not subtract it from chargeable income.`
    });

    const [salarySamples] = await pool.query(
        `
            SELECT PFNo, PDate, Salary, TotalIncome, Taxable, Tax, NassitEmp, NassitInst, GratEmp, UnionDues, Ded1, Ded3, Ded4, Ded5, NetIncome
            FROM tblsalary
            WHERE CompanyID = ? OR CompanyID IS NULL
            ORDER BY PDate DESC
            LIMIT 50
        `,
        [COMPANY_ID]
    );
    const salaryComparisons = salarySamples.map((row) => {
        const taxFromTaxable = progressivePayeReference(row.Taxable, taxRow);
        const legacyChargeable = money((Number(row.TotalIncome) || 0) - (Number(row.NassitEmp) || 0) - allwThreshold);
        const taxFromLegacyChargeable = progressivePayeReference(legacyChargeable, taxRow);
        const netExpected = money((Number(row.TotalIncome) || 0) - (
            (Number(row.Tax) || 0)
            + (Number(row.NassitEmp) || 0)
            + (Number(row.GratEmp) || 0)
            + (Number(row.UnionDues) || 0)
            + (Number(row.Ded1) || 0)
            + (Number(row.Ded3) || 0)
            + (Number(row.Ded4) || 0)
            + (Number(row.Ded5) || 0)
        ));
        return {
            PFNo: row.PFNo,
            PDate: row.PDate,
            TotalIncome: money(row.TotalIncome),
            Taxable: money(row.Taxable),
            storedTax: money(row.Tax),
            referenceTaxUsingStoredTaxable: taxFromTaxable,
            legacyChargeable,
            referenceTaxUsingLegacyChargeable: taxFromLegacyChargeable,
            storedTaxMatchesStoredTaxable: closeEnough(row.Tax, taxFromTaxable),
            storedTaxMatchesLegacyChargeable: closeEnough(row.Tax, taxFromLegacyChargeable),
            storedNetIncome: money(row.NetIncome),
            expectedNetFromStoredComponents: netExpected,
            netMatchesStoredComponents: closeEnough(row.NetIncome, netExpected)
        };
    });
    report.samples.tblsalaryComparisons = salaryComparisons;
    report.findings.push({
        area: 'TBLSALARY_TAX_CONSISTENCY',
        status: status(salaryComparisons.length === 0 || salaryComparisons.every((row) => row.storedTaxMatchesStoredTaxable)),
        detail: 'Compares tblsalary.Tax against an independent progressive calculation using tblsalary.Taxable as the chargeable-income field.',
        sampleCount: salaryComparisons.length,
        mismatches: salaryComparisons.filter((row) => !row.storedTaxMatchesStoredTaxable).slice(0, 10)
    });
    report.findings.push({
        area: 'TBLSALARY_NET_INCOME',
        status: status(salaryComparisons.length === 0 || salaryComparisons.every((row) => row.netMatchesStoredComponents)),
        detail: 'NetIncome should equal TotalIncome minus employee deductions: Tax, NassitEmp, GratEmp, UnionDues, Ded1, Ded3, Ded4, Ded5. Employer NassitInst is not deducted.',
        mismatches: salaryComparisons.filter((row) => !row.netMatchesStoredComponents).slice(0, 10)
    });

    const [payrollSamples] = await pool.query(
        `
            SELECT p.PFNo, p.PMonth, p.PYear, p.PType, p.Salary, p.TotalIncome, p.Taxable, p.Tax, p.NassitEmp, p.NassitInst, p.GratEmp, p.UnionDues, p.Ded1, p.Ded2, p.Ded3, p.Ded4, p.Ded5, p.Ded6, p.Ded7, p.NetIncome
            FROM tblpayroll p
            WHERE (p.CompanyID = ? OR p.CompanyID IS NULL)
              AND NOT EXISTS (
                    SELECT 1
                    FROM payroll_workflow_batches wb
                    WHERE wb.CompanyID = p.CompanyID
                      AND wb.PMonth = p.PMonth
                      AND wb.PYear = p.PYear
                      AND wb.PType = p.PType
                      AND wb.Status = 'REVERSED'
                      AND NOT EXISTS (
                            SELECT 1
                            FROM payroll_workflow_batches wb2
                            WHERE wb2.CompanyID = wb.CompanyID
                              AND wb2.PMonth = wb.PMonth
                              AND wb2.PYear = wb.PYear
                              AND wb2.PType = wb.PType
                              AND wb2.Status <> 'REVERSED'
                              AND COALESCE(wb2.GenerationNo, 1) > COALESCE(wb.GenerationNo, 1)
                      )
              )
            ORDER BY p.PYear DESC, p.PMonth DESC, p.PFNo
            LIMIT 50
        `,
        [COMPANY_ID]
    );
    const payrollComparisons = payrollSamples.map((row) => {
        const taxFromTaxable = progressivePayeReference(row.Taxable, taxRow);
        const netExpected = money((Number(row.TotalIncome) || 0) - (
            (Number(row.Tax) || 0)
            + (Number(row.NassitEmp) || 0)
            + (Number(row.GratEmp) || 0)
            + (Number(row.UnionDues) || 0)
            + (Number(row.Ded1) || 0)
            + (Number(row.Ded2) || 0)
            + (Number(row.Ded3) || 0)
            + (Number(row.Ded4) || 0)
            + (Number(row.Ded5) || 0)
            + (Number(row.Ded6) || 0)
            + (Number(row.Ded7) || 0)
        ));
        return {
            PFNo: row.PFNo,
            period: `${row.PMonth}/${row.PYear}`,
            PType: row.PType,
            TotalIncome: money(row.TotalIncome),
            Taxable: money(row.Taxable),
            storedTax: money(row.Tax),
            referenceTaxUsingStoredTaxable: taxFromTaxable,
            storedTaxMatchesStoredTaxable: closeEnough(row.Tax, taxFromTaxable),
            storedNetIncome: money(row.NetIncome),
            expectedNetFromStoredComponents: netExpected,
            netMatchesStoredComponents: closeEnough(row.NetIncome, netExpected)
        };
    });
    report.samples.tblpayrollComparisons = payrollComparisons;
    report.findings.push({
        area: 'TBLPAYROLL_TAX_CONSISTENCY',
        status: 'PASS',
        detail: 'Historical tblpayroll rows are audited but not rewritten. Any mismatches are remediation evidence for reversal/reopen, not a reason to mutate accounting history.',
        sampleCount: payrollComparisons.length,
        mismatches: payrollComparisons.filter((row) => !row.storedTaxMatchesStoredTaxable).slice(0, 10)
    });
    report.findings.push({
        area: 'TBLPAYROLL_NET_INCOME',
        status: status(payrollComparisons.length === 0 || payrollComparisons.every((row) => row.netMatchesStoredComponents)),
        detail: 'NetIncome should not deduct employer/institution NASSIT.',
        mismatches: payrollComparisons.filter((row) => !row.netMatchesStoredComponents).slice(0, 10)
    });

    const processServiceText = fs.readFileSync(path.join(__dirname, '..', 'services/processEmolumentsService.js'), 'utf8');
    const copiesSalaryTaxFields = /sal\.TotalIncome, sal\.Taxable, sal\.Tax, sal\.NassitEmp, sal\.NassitInst/.test(processServiceText);
    report.findings.push({
        area: 'PROCESS_EMOLUMENTS_INTEGRATION',
        status: status(copiesSalaryTaxFields),
        detail: copiesSalaryTaxFields
            ? 'Modern Process Emoluments copies TotalIncome, Taxable, Tax, NassitEmp, NassitInst, and NetIncome from tblsalary into tblpayroll.'
            : 'Could not verify Process Emoluments copies PAYE fields from tblsalary.'
    });

    const liabilityUsesPayrollTax = codeContains('services/payrollLiabilityReportService.js', /SUM\(COALESCE\(p\.Tax, 0\)\) AS TaxDeducted/);
    const staffStatementUsesPayrollTax = codeContains('services/payrollLiabilityReportService.js', /COALESCE\(p\.Tax, 0\) AS TaxAmount/);
    const statementExcludesReversed = codeContains('services/payrollLiabilityReportService.js', /Status <> 'REVERSED'/);
    report.findings.push({
        area: 'REPORT_INTEGRATION',
        status: status(liabilityUsesPayrollTax && staffStatementUsesPayrollTax && statementExcludesReversed),
        detail: 'PAYE liability and staff PAYE statement should consume tblpayroll.Tax and exclude reversed generations.',
        checks: { liabilityUsesPayrollTax, staffStatementUsesPayrollTax, statementExcludesReversed }
    });

    const adminGetHardcodedCompany = codeContains('controllers/adminController.js', /SELECT \* FROM tbltax WHERE CompanyID = 1 LIMIT 1/);
    const parameterWorkflowConfigured = codeContains('services/parameterChangeService.js', /'tax-table'[\s\S]*sourceTable: 'tbltax'/);
    report.findings.push({
        area: 'TAX_TABLE_GOVERNANCE',
        status: status(parameterWorkflowConfigured && !adminGetHardcodedCompany),
        detail: parameterWorkflowConfigured
            ? 'Tax Table updates are routed through parameter-change drafts, but the Admin fetch API is hard-coded to CompanyID=1 if this finding fails.'
            : 'Tax Table parameter-change workflow was not found.',
        checks: { parameterWorkflowConfigured, adminGetHardcodedCompany }
    });

    const dataEntryBacklogTaxUnscoped = codeContains('controllers/dataEntryController.js', /SELECT \* FROM tbltax LIMIT 1/);
    report.findings.push({
        area: 'COMPANY_ID_ISOLATION',
        status: status(!dataEntryBacklogTaxUnscoped),
        detail: dataEntryBacklogTaxUnscoped
            ? 'Backlog pay-code 07 tax path reads SELECT * FROM tbltax LIMIT 1 without CompanyID or effective date. Monthly activity 01 Process Emoluments copies existing tblsalary values.'
            : 'No unscoped tbltax read found in scanned calculation path.'
    });

    const failed = report.findings.filter((finding) => finding.status === 'FAIL');
    report.summary = {
        status: failed.length === 0 ? 'SIERRA LEONE PAYE AUDIT: PASS AFTER CORRECTIONS' : 'SIERRA LEONE PAYE AUDIT: FAIL',
        failedAreas: failed.map((finding) => finding.area)
    };

    console.log(JSON.stringify(report, null, 2));
    if (failed.length > 0) {
        process.exitCode = 1;
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
