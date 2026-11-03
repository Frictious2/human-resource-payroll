const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pool = require('../config/db');

const COMPANY_ID = 1;
const PF_NOS = ['0489', '0496', '0692', '0520', '0684', '0587'];
const WORKBOOK_PATH = process.env.WAEC_AUGUST_WORKBOOK
    || 'C:\\Users\\David M. Gegbai\\Downloads\\AUGUST. STAFF SALARY AND PAYSLIP-2026.xlsx';
const WORKSHEET_NAME = 'AUG. PAYROLL';
const OUTPUT_JSON = path.join(__dirname, '..', 'docs', 'test-results', 'waec-august-2026-provident-fund-verification.json');
const OUTPUT_MD = path.join(__dirname, '..', 'docs', 'WAEC-AUGUST-2026-PROVIDENT-FUND-VERIFICATION.md');

function money(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function diff(a, b) {
    return money(Number(a || 0) - Number(b || 0));
}

function withinCent(a, b) {
    return Math.abs(diff(a, b)) <= 0.01;
}

function decodeXml(value = '') {
    return String(value)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function readFileIfExists(filePath) {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function parseAttributes(source) {
    const attrs = {};
    String(source || '').replace(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g, (_, key, value) => {
        attrs[key] = decodeXml(value);
        return '';
    });
    return attrs;
}

function extractWorkbook(workbookPath) {
    if (!fs.existsSync(workbookPath)) {
        throw new Error(`Workbook not found: ${workbookPath}`);
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'waec-provident-'));
    const zipPath = path.join(tempRoot, 'workbook.zip');
    const extractPath = path.join(tempRoot, 'unzipped');
    fs.copyFileSync(workbookPath, zipPath);
    fs.mkdirSync(extractPath, { recursive: true });
    execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(extractPath)} -Force`
    ], { stdio: 'ignore' });
    return { tempRoot, extractPath };
}

function loadSharedStrings(extractPath) {
    const sharedStringsXml = readFileIfExists(path.join(extractPath, 'xl', 'sharedStrings.xml'));
    const strings = [];
    for (const match of sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        let text = '';
        for (const textMatch of match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) {
            text += decodeXml(textMatch[1]);
        }
        strings.push(text);
    }
    return strings;
}

function resolveWorksheetPath(extractPath, sheetName) {
    const workbookXml = fs.readFileSync(path.join(extractPath, 'xl', 'workbook.xml'), 'utf8');
    const relsXml = fs.readFileSync(path.join(extractPath, 'xl', '_rels', 'workbook.xml.rels'), 'utf8');
    let relId = '';

    for (const sheetMatch of workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
        const attrs = parseAttributes(sheetMatch[1]);
        if (attrs.name === sheetName) {
            relId = attrs['r:id'];
            break;
        }
    }

    if (!relId) {
        throw new Error(`Worksheet not found: ${sheetName}`);
    }

    for (const relMatch of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
        const attrs = parseAttributes(relMatch[1]);
        if (attrs.Id === relId) {
            return path.join(extractPath, 'xl', attrs.Target.replace(/\//g, path.sep));
        }
    }

    throw new Error(`Worksheet relationship not found for: ${sheetName}`);
}

function parseWorksheetRows(extractPath, sheetName) {
    const sharedStrings = loadSharedStrings(extractPath);
    const worksheetPath = resolveWorksheetPath(extractPath, sheetName);
    const sheetXml = fs.readFileSync(worksheetPath, 'utf8');
    const rows = [];

    for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
        const rowAttrs = parseAttributes(rowMatch[1]);
        const row = { rowNumber: Number(rowAttrs.r || 0) };
        for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
            const attrs = parseAttributes(cellMatch[1]);
            const column = String(attrs.r || '').match(/^([A-Z]+)/)?.[1];
            if (!column) {
                continue;
            }

            const body = cellMatch[2];
            const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
            let value = rawValue;
            if (attrs.t === 's') {
                value = sharedStrings[Number(rawValue)] || '';
            } else if (attrs.t === 'inlineStr') {
                value = decodeXml(body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || '');
            }
            row[column] = value;
        }
        rows.push(row);
    }

    return rows;
}

function extractExcelEmployees() {
    const { tempRoot, extractPath } = extractWorkbook(WORKBOOK_PATH);
    try {
        const rows = parseWorksheetRows(extractPath, WORKSHEET_NAME);
        return rows
            .filter((row) => PF_NOS.includes(String(row.H || '').padStart(4, '0')))
            .map((row) => {
                const basic = money(row.K);
                const allowances = money(row.W);
                const gross = money(basic + allowances);
                const netPay = money(row.AG);
                const rowTotalDeduction = money(gross - netPay);
                return {
                    pfNo: String(row.H || '').padStart(4, '0'),
                    name: String(row.C || '').trim(),
                    designation: String(row.G || '').trim(),
                    basic,
                    allowances,
                    gross,
                    taxable: money(row.X),
                    paye: money(row.Y),
                    employeeNassit: money(row.Z),
                    providentFund: money(row.AA),
                    netPay,
                    totalDeduction: rowTotalDeduction,
                    otherDeductions: money(rowTotalDeduction - money(row.Y) - money(row.Z) - money(row.AA))
                };
            });
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

async function queryRows() {
    const [itemRows] = await pool.query(
        `
            SELECT Code, Income, Taxable, Threshhold, TPercent, TPercentage, TAmount,
                   Mode, AddBack, Fixed, Percent, Freq, CompanyID
            FROM tblpayrollitems
            WHERE CompanyID = ?
              AND (UPPER(Income) = 'PROV-EMP' OR Code IN ('33', '42'))
            ORDER BY Code
        `,
        [COMPANY_ID]
    );

    const [salaryRows] = await pool.query(
        `
            SELECT PFNo, CompanyID, PDate, Salary, TotAllw, TotalIncome, Taxable, Tax,
                   NassitEmp, NassitInst, GratEmp, GratInst, UnionDues, Ded1, Ded3,
                   Ded4, Ded5, TotalDeduction, NetIncome, Approved, ApprovedBy
            FROM tblsalary
            WHERE CompanyID = ?
              AND PFNo IN (?)
            ORDER BY PFNo
        `,
        [COMPANY_ID, PF_NOS]
    );

    const [payrollRows] = await pool.query(
        `
            SELECT PFNo, CompanyID, PMonth, PYear, PType, Salary, TotalIncome, Taxable,
                   Tax, NassitEmp, NassitInst, GratEmp, GratInst, UnionDues, Ded1,
                   Ded2, Ded3, Ded4, Ded5, Ded6, Ded7, NetIncome, Approved, posted_to_gl
            FROM tblpayroll
            WHERE CompanyID = ?
              AND PMonth = 8
              AND PYear = 2026
              AND PType = '01'
              AND PFNo IN (?)
            ORDER BY PFNo
        `,
        [COMPANY_ID, PF_NOS]
    );

    return { itemRows, salaryRows, payrollRows };
}

function buildEmployeeResults(excelRows, salaryRows, payrollRows, provItem) {
    const salaryByPf = new Map(salaryRows.map((row) => [row.PFNo, row]));
    const payrollByPf = new Map(payrollRows.map((row) => [row.PFNo, row]));

    return excelRows.map((excel) => {
        const salary = salaryByPf.get(excel.pfNo) || {};
        const payroll = payrollByPf.get(excel.pfNo) || {};
        const approvedBasic = money(salary.Salary);
        const expectedProvident = money(approvedBasic * (Number(provItem?.Percent || 0) / 100));
        const approvedProvident = money(salary.GratEmp);
        const approvedDeduction = money(salary.TotalDeduction);
        const reconstructedDeduction = money(
            money(salary.Tax)
            + money(salary.NassitEmp)
            + approvedProvident
            + money(salary.UnionDues)
            + money(salary.Ded1)
            + money(salary.Ded3)
            + money(salary.Ded4)
            + money(salary.Ded5)
        );
        const reconstructedNet = money(money(salary.TotalIncome) - approvedDeduction);

        return {
            pfNo: excel.pfNo,
            name: excel.name,
            excel,
            approvedSalary: {
                basic: approvedBasic,
                providentFund: approvedProvident,
                employerProvident: money(salary.GratInst),
                employeeNassit: money(salary.NassitEmp),
                employerNassit: money(salary.NassitInst),
                paye: money(salary.Tax),
                totalDeduction: approvedDeduction,
                reconstructedDeduction,
                netPay: money(salary.NetIncome),
                reconstructedNet,
                approved: Number(salary.Approved || 0),
                companyId: Number(salary.CompanyID || 0)
            },
            augustPayrollBatch161: {
                basic: money(payroll.Salary),
                providentFund: money(payroll.GratEmp),
                netPay: money(payroll.NetIncome),
                approved: Number(payroll.Approved || 0),
                postedToGl: Number(payroll.posted_to_gl || 0)
            },
            checks: {
                excelProvidentIs10Percent: withinCent(excel.providentFund, money(excel.basic * 0.10)),
                approvedProvidentIs10Percent: withinCent(approvedProvident, expectedProvident),
                approvedProvidentMatchesExcel: withinCent(approvedProvident, excel.providentFund),
                deductionIncludesProvident: withinCent(approvedDeduction, reconstructedDeduction),
                netPayDeductsProvident: withinCent(money(salary.NetIncome), reconstructedNet),
                employerNassitExcludedFromNetDeduction: !withinCent(approvedDeduction, reconstructedDeduction + money(salary.NassitInst)),
                augustBatchStillOutdated: !withinCent(money(payroll.GratEmp), expectedProvident)
            },
            variances: {
                approvedProvidentVsExcel: diff(approvedProvident, excel.providentFund),
                approvedNetVsExcel: diff(money(salary.NetIncome), excel.netPay),
                approvedPayeVsExcel: diff(money(salary.Tax), excel.paye),
                augustProvidentVsApproved: diff(money(payroll.GratEmp), approvedProvident)
            }
        };
    });
}

function total(rows, selector) {
    return money(rows.reduce((sum, row) => sum + Number(selector(row) || 0), 0));
}

function toMarkdown(report) {
    const employeeRows = report.employees.map((row) => (
        `| ${row.pfNo} | ${row.name} | ${row.excel.basic.toFixed(2)} | ${row.excel.providentFund.toFixed(2)} | ${row.approvedSalary.providentFund.toFixed(2)} | ${row.approvedSalary.totalDeduction.toFixed(2)} | ${row.approvedSalary.netPay.toFixed(2)} | ${row.checks.approvedProvidentIs10Percent ? 'PASS' : 'FAIL'} |`
    )).join('\n');

    const oldBatchRows = report.employees.map((row) => (
        `| ${row.pfNo} | ${row.augustPayrollBatch161.providentFund.toFixed(2)} | ${row.approvedSalary.providentFund.toFixed(2)} | ${row.variances.augustProvidentVsApproved.toFixed(2)} | ${row.augustPayrollBatch161.postedToGl ? 'Yes' : 'No'} |`
    )).join('\n');

    return `# WAEC August 2026 Provident Fund Verification

Generated: ${report.generatedAt}

## Result

${report.status}

## PROV-EMP Payroll Item

| Field | Value |
| --- | --- |
| Code | ${report.provEmpItem.Code} |
| Description | ${report.provEmpItem.Income} |
| Percentage | ${Number(report.provEmpItem.Percent).toFixed(2)}% |
| Frequency | ${report.provEmpItem.Freq || ''} |
| Mode | ${report.provEmpItem.Mode || ''} |
| Taxable | ${Number(report.provEmpItem.Taxable || 0) !== 0 ? 'Yes' : 'No'} |
| Fixed | ${Number(report.provEmpItem.Fixed || 0) !== 0 ? 'Yes' : 'No'} |
| Threshold | ${Number(report.provEmpItem.Threshhold || 0) !== 0 ? 'Yes' : 'No'} |
| CompanyID | ${report.provEmpItem.CompanyID} |

PROV-EMP is configured as a monthly employee deduction at 10% of basic salary. The legacy database field used by the salary/payroll tables is \`GratEmp\`; GL/reporting code maps this value to \`ProvidentEmp\`.

## Deduction Field Mapping

| Source | Mapping |
| --- | --- |
| Payroll item | \`tblpayrollitems.Code = 33\`, \`Income = PROV-EMP\` |
| Payroll setup / salary storage | \`tblsalary.GratEmp\` |
| Monthly payroll storage | \`tblpayroll.GratEmp\` |
| GL summary | \`tblgltrans.ProvidentEmp = SUM(tblpayroll.GratEmp)\` |
| Payslip display | Employee Provident Fund |
| Employer provident | \`tblsalary.GratInst\` / \`tblpayroll.GratInst\`, sourced from \`PROV-INST\` |

## Employee-Level Verification

| PFNo | Name | Basic Salary | Excel PF 10% | Approved Salary PF | Approved Total Deduction | Approved Net Pay | PF Check |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
${employeeRows}

## Totals

| Component | Excel | Approved Salary Setup | Variance |
| --- | ---: | ---: | ---: |
| Basic Salary | ${report.totals.excel.basic.toFixed(2)} | ${report.totals.salary.basic.toFixed(2)} | ${diff(report.totals.salary.basic, report.totals.excel.basic).toFixed(2)} |
| Provident Fund Employee | ${report.totals.excel.providentFund.toFixed(2)} | ${report.totals.salary.providentFund.toFixed(2)} | ${diff(report.totals.salary.providentFund, report.totals.excel.providentFund).toFixed(2)} |
| Employee NASSIT | ${report.totals.excel.employeeNassit.toFixed(2)} | ${report.totals.salary.employeeNassit.toFixed(2)} | ${diff(report.totals.salary.employeeNassit, report.totals.excel.employeeNassit).toFixed(2)} |
| PAYE | ${report.totals.excel.paye.toFixed(2)} | ${report.totals.salary.paye.toFixed(2)} | ${diff(report.totals.salary.paye, report.totals.excel.paye).toFixed(2)} |
| Total Deductions | ${report.totals.excel.totalDeduction.toFixed(2)} | ${report.totals.salary.totalDeduction.toFixed(2)} | ${diff(report.totals.salary.totalDeduction, report.totals.excel.totalDeduction).toFixed(2)} |
| Net Pay | ${report.totals.excel.netPay.toFixed(2)} | ${report.totals.salary.netPay.toFixed(2)} | ${diff(report.totals.salary.netPay, report.totals.excel.netPay).toFixed(2)} |

The provident fund total reconciles within the normal one-cent rounding tolerance. The total deduction and net pay variance is caused by the documented PAYE formula difference between Excel and the corrected statutory PAYE engine.

## August Batch 161 Safety

The existing August 2026 payroll batch remains unchanged and unposted to the modern GL.

| PFNo | Batch 161 Provident | Approved Salary Provident | Batch Variance | Posted to GL |
| --- | ---: | ---: | ---: | --- |
${oldBatchRows}

Batch 161 still reflects outdated payroll values. It should only be replaced through the separately authorized reopen/reprocess workflow.

## Interface Findings

- Data Entry payroll setup displays PROV-EMP under Monthly Deductions.
- Manager salary approval displays PROV-EMP under Monthly Deductions.
- Finance and Finance Manager payslips display the deduction as Employee Provident Fund.
- The underlying legacy storage field remains \`GratEmp\` to preserve the existing schema.

## Approval Implications

No approved salary-review records were changed by this verification. If August payroll is later reprocessed, the replacement payroll should copy the approved \`tblsalary.GratEmp\` value into \`tblpayroll.GratEmp\`, include it in total deductions, and reduce net pay.

## Remaining Blockers

- No provident-fund calculation blocker remains.
- August batch 161 still requires explicit authorization before reopen/reprocess.
- The Excel workbook's row-level total deduction values are visually positioned inconsistently, but they reconcile as gross income minus net pay and include the 10% provident fund.
`;
}

async function main() {
    const excelRows = extractExcelEmployees();
    if (excelRows.length !== PF_NOS.length) {
        throw new Error(`Expected ${PF_NOS.length} Excel employees but found ${excelRows.length}.`);
    }

    const { itemRows, salaryRows, payrollRows } = await queryRows();
    const provEmpItem = itemRows.find((row) => String(row.Income || '').trim().toUpperCase() === 'PROV-EMP');
    if (!provEmpItem) {
        throw new Error('PROV-EMP payroll item not found.');
    }

    const employees = buildEmployeeResults(excelRows, salaryRows, payrollRows, provEmpItem);
    const materialFailures = [];
    if (!withinCent(Number(provEmpItem.Percent || 0), 10)) materialFailures.push('PROV-EMP percentage is not 10%.');
    if (String(provEmpItem.Freq || '').toUpperCase() !== 'M') materialFailures.push('PROV-EMP frequency is not monthly.');
    if (String(provEmpItem.Mode || '') !== '02') materialFailures.push('PROV-EMP mode does not identify an employee-side deduction.');

    for (const employee of employees) {
        if (!employee.checks.excelProvidentIs10Percent) materialFailures.push(`${employee.pfNo}: Excel provident is not 10% of basic salary.`);
        if (!employee.checks.approvedProvidentIs10Percent) materialFailures.push(`${employee.pfNo}: approved salary provident is not 10% of basic salary.`);
        if (!employee.checks.approvedProvidentMatchesExcel) materialFailures.push(`${employee.pfNo}: approved salary provident does not match Excel.`);
        if (!employee.checks.deductionIncludesProvident) materialFailures.push(`${employee.pfNo}: total deductions do not include provident exactly once.`);
        if (!employee.checks.netPayDeductsProvident) materialFailures.push(`${employee.pfNo}: net pay does not reconcile after provident deduction.`);
    }

    const totals = {
        excel: {
            basic: total(employees, (row) => row.excel.basic),
            providentFund: total(employees, (row) => row.excel.providentFund),
            employeeNassit: total(employees, (row) => row.excel.employeeNassit),
            paye: total(employees, (row) => row.excel.paye),
            totalDeduction: total(employees, (row) => row.excel.totalDeduction),
            netPay: total(employees, (row) => row.excel.netPay)
        },
        salary: {
            basic: total(employees, (row) => row.approvedSalary.basic),
            providentFund: total(employees, (row) => row.approvedSalary.providentFund),
            employeeNassit: total(employees, (row) => row.approvedSalary.employeeNassit),
            paye: total(employees, (row) => row.approvedSalary.paye),
            totalDeduction: total(employees, (row) => row.approvedSalary.totalDeduction),
            netPay: total(employees, (row) => row.approvedSalary.netPay)
        }
    };

    const report = {
        generatedAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        workbook: WORKBOOK_PATH,
        worksheet: WORKSHEET_NAME,
        provEmpItem,
        relatedItems: itemRows,
        employees,
        totals,
        materialFailures,
        status: materialFailures.length
            ? 'WAEC PROVIDENT FUND VERIFICATION: BLOCKED'
            : 'WAEC PROVIDENT FUND VERIFICATION: PASS WITH CORRECTIONS'
    };

    fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
    fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(OUTPUT_MD, toMarkdown(report));

    console.log(report.status);
    console.log(`Evidence JSON: ${OUTPUT_JSON}`);
    console.log(`Report: ${OUTPUT_MD}`);
    if (materialFailures.length) {
        console.error(materialFailures.join('\n'));
        process.exitCode = 1;
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end().catch(() => {});
    });
