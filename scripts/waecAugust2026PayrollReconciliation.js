require('dotenv').config();

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mysql = require('mysql2/promise');

const WORKBOOK_PATH = process.env.WAEC_AUGUST_2026_WORKBOOK
    || 'C:\\Users\\David M. Gegbai\\Downloads\\AUGUST. STAFF SALARY AND PAYSLIP-2026.xlsx';
const OUTPUT_JSON = path.join('docs', 'test-results', 'waec-august-2026-payroll-reconciliation-before.json');
const OUTPUT_MD = path.join('docs', 'WAEC-AUGUST-2026-PAYROLL-RECONCILIATION-BEFORE.md');
const PAYROLL_MONTH = 8;
const PAYROLL_YEAR = 2026;
const ACTIVITY_CODE = '01';
const MONEY_TOLERANCE = 0.01;

const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function parseAttributes(tag) {
    const attributes = {};
    const attrRegex = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
    let match;
    while ((match = attrRegex.exec(tag))) {
        attributes[match[1]] = match[2];
    }
    return attributes;
}

function columnIndex(cellRef) {
    const match = String(cellRef || '').match(/^([A-Z]+)/);
    if (!match) return 0;
    return match[1].split('').reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
}

function unzipEntries(filePath) {
    const buffer = fs.readFileSync(filePath);
    const entries = new Map();
    let offset = 0;
    while (offset < buffer.length) {
        const signature = buffer.readUInt32LE(offset);
        if (signature !== 0x04034b50) break;
        const compression = buffer.readUInt16LE(offset + 8);
        const compressedSize = buffer.readUInt32LE(offset + 18);
        const fileNameLength = buffer.readUInt16LE(offset + 26);
        const extraLength = buffer.readUInt16LE(offset + 28);
        const fileName = buffer.slice(offset + 30, offset + 30 + fileNameLength).toString('utf8');
        const dataStart = offset + 30 + fileNameLength + extraLength;
        const compressed = buffer.slice(dataStart, dataStart + compressedSize);
        let content;
        if (compression === 0) {
            content = compressed;
        } else if (compression === 8) {
            content = zlib.inflateRawSync(compressed);
        } else {
            throw new Error(`Unsupported XLSX compression method ${compression} for ${fileName}`);
        }
        entries.set(fileName, content);
        offset = dataStart + compressedSize;
    }
    return entries;
}

function getEntryText(entries, name) {
    const entry = entries.get(name);
    if (!entry) return '';
    return entry.toString('utf8');
}

function parseSharedStrings(entries) {
    const xml = getEntryText(entries, 'xl/sharedStrings.xml');
    if (!xml) return [];
    const strings = [];
    const siRegex = /<si\b[\s\S]*?<\/si>/g;
    const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let siMatch;
    while ((siMatch = siRegex.exec(xml))) {
        let text = '';
        let tMatch;
        while ((tMatch = tRegex.exec(siMatch[0]))) {
            text += tMatch[1]
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'");
        }
        strings.push(text);
    }
    return strings;
}

function parseWorkbookSheets(entries) {
    const workbookXml = getEntryText(entries, 'xl/workbook.xml');
    const relsXml = getEntryText(entries, 'xl/_rels/workbook.xml.rels');
    const rels = new Map();
    const relRegex = /<Relationship\b([^>]*)\/>/g;
    let relMatch;
    while ((relMatch = relRegex.exec(relsXml))) {
        const attrs = parseAttributes(relMatch[1]);
        rels.set(attrs.Id, attrs.Target);
    }

    const sheets = [];
    const sheetRegex = /<sheet\b([^>]*)\/>/g;
    let sheetMatch;
    while ((sheetMatch = sheetRegex.exec(workbookXml))) {
        const attrs = parseAttributes(sheetMatch[1]);
        const relId = attrs['r:id'] || attrs[`{${OFFICE_REL_NS}}id`];
        const target = rels.get(relId);
        if (!target) continue;
        sheets.push({
            name: attrs.name,
            path: path.posix.normalize(`xl/${target}`)
        });
    }
    return sheets;
}

function readCellValue(cellXml, sharedStrings) {
    const openTag = cellXml.match(/^<c\b([^>]*)>/);
    const attrs = openTag ? parseAttributes(openTag[1]) : {};
    if (attrs.t === 'inlineStr') {
        const inline = cellXml.match(/<is\b[\s\S]*?<\/is>/);
        if (!inline) return null;
        const text = [...inline[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
            .map((match) => match[1])
            .join('');
        return decodeXml(text);
    }
    const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
    if (!vMatch) return null;
    const raw = decodeXml(vMatch[1]);
    if (attrs.t === 's') {
        const index = Number(raw);
        return sharedStrings[index] ?? raw;
    }
    if (attrs.t === 'b') {
        return raw === '1';
    }
    return raw;
}

function decodeXml(value) {
    return String(value)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function parseSheet(entries, sheetPath, sharedStrings) {
    const xml = getEntryText(entries, sheetPath);
    const rows = [];
    const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
    const cellRegex = /<c\b[\s\S]*?<\/c>/g;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(xml))) {
        const attrs = parseAttributes(rowMatch[1]);
        const rowNumber = Number(attrs.r || rows.length + 1);
        const values = [];
        let lastIndex = 0;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowMatch[2]))) {
            const refMatch = cellMatch[0].match(/^<c\b[^>]*\sr="([^"]+)"/);
            const idx = columnIndex(refMatch ? refMatch[1] : '');
            while (lastIndex + 1 < idx) {
                values.push(null);
                lastIndex += 1;
            }
            values.push(readCellValue(cellMatch[0], sharedStrings));
            lastIndex = idx;
        }
        rows.push({ rowNumber, values });
    }
    return rows;
}

function toNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    const num = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(num) ? num : 0;
}

function toMoney(value) {
    return Math.round(toNumber(value) * 100) / 100;
}

function normalizePf(value) {
    const text = String(value || '').trim();
    if (!text || /^pf\s*#$/i.test(text)) return '';
    return /^\d+$/.test(text) ? text.padStart(4, '0') : '';
}

function parsePayrollWorkbook(workbookPath) {
    const entries = unzipEntries(workbookPath);
    const sharedStrings = parseSharedStrings(entries);
    const sheets = parseWorkbookSheets(entries);
    const payrollSheet = sheets.find((sheet) => sheet.name === 'AUG. PAYROLL');
    if (!payrollSheet) {
        throw new Error('Workbook does not contain AUG. PAYROLL sheet.');
    }
    const rows = parseSheet(entries, payrollSheet.path, sharedStrings);
    const headerRow = rows.find((row) => row.rowNumber === 4);
    const headers = headerRow?.values || [];

    const employees = [];
    for (const row of rows) {
        if (row.rowNumber <= 4) continue;
        const values = row.values;
        const pf = normalizePf(values[7]);
        const name = String(values[2] || '').trim();
        if (!pf || !name || /^name$/i.test(name)) continue;
        employees.push({
            rowNumber: row.rowNumber,
            no: String(values[1] || '').trim(),
            pf,
            name,
            bank: String(values[3] || '').trim(),
            bban: String(values[4] || '').trim(),
            nassitNo: String(values[5] || '').trim(),
            designation: String(values[6] || '').trim(),
            scale: String(values[8] || '').trim(),
            yearlyBasic: toMoney(values[9]),
            monthlyBasic: toMoney(values[10]),
            afterEmployeeNassit: toMoney(values[11]),
            responsibility: toMoney(values[12]),
            maid: toMoney(values[13]),
            staffWelfare: toMoney(values[14]),
            maintenance: toMoney(values[15]),
            risk: toMoney(values[16]),
            acting: toMoney(values[17]),
            professional: toMoney(values[18]),
            academic: toMoney(values[19]),
            transport: toMoney(values[20]),
            cola: toMoney(values[21]),
            totalAllowance: toMoney(values[22]),
            totalIncome: toMoney(toMoney(values[10]) + toMoney(values[22])),
            taxable: toMoney(values[23]),
            paye: toMoney(values[24]),
            employeeNassit: toMoney(values[25]),
            employerNassit: toMoney(values[26]),
            // The workbook header places RENT at AB and TOTAL DEDUCTION at AF, but the
            // employee rows store the total-deduction formula in AB and leave AC:AF blank.
            // Preserve the populated cached value and do not fabricate the blank detail fields.
            rentDeduction: null,
            vehicleMaintenanceDeduction: null,
            salaryAdvance: toMoney(values[29]),
            interestOnAdvance: toMoney(values[30]),
            totalDeduction: toMoney(values[27]),
            netPay: toMoney(values[32]),
            monthlySalary: toMoney(values[33])
        });
    }

    const totals = employees.reduce((sum, row) => {
        for (const key of [
            'monthlyBasic', 'responsibility', 'maid', 'staffWelfare', 'maintenance', 'risk', 'acting',
            'professional', 'academic', 'transport', 'cola', 'totalAllowance', 'taxable', 'paye',
            'employeeNassit', 'employerNassit', 'totalDeduction', 'netPay'
        ]) {
            sum[key] = toMoney((sum[key] || 0) + row[key]);
        }
        return sum;
    }, {});

    return {
        workbookPath,
        sheets: sheets.map((sheet) => sheet.name),
        primarySheet: 'AUG. PAYROLL',
        headers,
        employees,
        totals
    };
}

function makeDbConfig() {
    return {
        host: process.env.DBHOST || process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DBPORT || process.env.DB_PORT || 3306),
        user: process.env.DBUSER || process.env.DB_USER || 'root',
        password: process.env.DBPASS || process.env.DB_PASSWORD || '',
        database: process.env.DBNAME || process.env.DB_NAME || 'personnel_master'
    };
}

async function inspectDatabase() {
    const config = makeDbConfig();
    const result = {
        config: { ...config, password: config.password ? 'configured' : 'blank' },
        connected: false,
        innodb: null,
        tableAccess: {},
        existingAugustPayroll: [],
        existingAugustWorkflow: [],
        currentPayrollRows: [],
        blocker: null
    };

    let connection;
    try {
        connection = await mysql.createConnection(config);
        result.connected = true;
        const [engines] = await connection.query('SHOW ENGINES');
        result.innodb = engines.find((engine) => engine.Engine === 'InnoDB') || null;

        for (const table of ['tblstaff', 'tblsalary', 'tblpayroll']) {
            try {
                const [[row]] = await connection.query(`SELECT COUNT(*) AS count FROM ${table}`);
                result.tableAccess[table] = { ok: true, count: Number(row.count || 0) };
            } catch (error) {
                result.tableAccess[table] = {
                    ok: false,
                    code: error.code,
                    message: error.sqlMessage || error.message
                };
            }
        }

        if (Object.values(result.tableAccess).some((entry) => !entry.ok)) {
            result.blocker = 'Database tables cannot be read. Payroll execution is blocked until table access is restored.';
            return result;
        }

        const [payrollColumns] = await connection.query('SHOW COLUMNS FROM tblpayroll');
        const payrollColumnNames = new Set(payrollColumns.map((column) => column.Field));
        const generationSelect = payrollColumnNames.has('GenerationNo') ? 'GenerationNo' : 'NULL AS GenerationNo';
        const generationGroup = payrollColumnNames.has('GenerationNo') ? ', GenerationNo' : '';
        const generationOrder = payrollColumnNames.has('GenerationNo') ? ', GenerationNo' : '';
        const totalDeductionSelect = payrollColumnNames.has('TotalDeduction')
            ? 'SUM(TotalDeduction) AS TotalDeduction'
            : `SUM(
                    COALESCE(Tax, 0)
                    + COALESCE(NassitEmp, 0)
                    + COALESCE(UnionDues, 0)
                    + COALESCE(GratEmp, 0)
                    + COALESCE(Ded1, 0)
                    + COALESCE(Ded2, 0)
                    + COALESCE(Ded3, 0)
                    + COALESCE(Ded4, 0)
                    + COALESCE(Ded5, 0)
                    + COALESCE(Ded6, 0)
                    + COALESCE(Ded7, 0)
               ) AS TotalDeduction`;

        const [payroll] = await connection.query(
            `SELECT CompanyID, PMonth, PYear, PType, ${generationSelect},
                    COUNT(*) AS rowCount,
                    SUM(Salary) AS Salary,
                    SUM(TotalIncome) AS TotalIncome,
                    SUM(Taxable) AS Taxable,
                    SUM(Tax) AS Tax,
                    SUM(NassitEmp) AS NassitEmp,
                    SUM(NassitInst) AS NassitInst,
                    ${totalDeductionSelect},
                    SUM(NetIncome) AS NetIncome,
                    SUM(COALESCE(posted_to_gl, 0)) AS postedRows
             FROM tblpayroll
             WHERE PMonth = ? AND PYear = ?
             GROUP BY CompanyID, PMonth, PYear, PType${generationGroup}
             ORDER BY CompanyID, PType${generationOrder}`,
            [PAYROLL_MONTH, PAYROLL_YEAR]
        );
        result.existingAugustPayroll = payroll;

        const [currentRows] = await connection.query(
            `SELECT p.PFNo, s.SName,
                    p.Salary,
                    p.Allw11 AS Responsibility,
                    p.Allw12 AS Maid,
                    p.Allw04 AS StaffWelfare,
                    p.Allw10 AS Maintenance,
                    p.Allw17 AS Risk,
                    p.Allw14 AS Acting,
                    p.Allw16 AS Professional,
                    p.Allw19 AS Academic,
                    p.Allw03 AS Transport,
                    p.Allw06 AS COLA,
                    (
                        COALESCE(p.Allw02, 0) + COALESCE(p.Allw03, 0) + COALESCE(p.Allw04, 0)
                        + COALESCE(p.Allw05, 0) + COALESCE(p.Allw06, 0) + COALESCE(p.Allw07, 0)
                        + COALESCE(p.Allw08, 0) + COALESCE(p.Allw09, 0) + COALESCE(p.Allw10, 0)
                        + COALESCE(p.Allw11, 0) + COALESCE(p.Allw12, 0) + COALESCE(p.Allw13, 0)
                        + COALESCE(p.Allw14, 0) + COALESCE(p.Allw15, 0) + COALESCE(p.Allw16, 0)
                        + COALESCE(p.Allw17, 0) + COALESCE(p.Allw18, 0) + COALESCE(p.Allw19, 0)
                        + COALESCE(p.Allw20, 0)
                    ) AS TotalAllowance,
                    p.TotalIncome,
                    p.Taxable,
                    p.Tax,
                    p.NassitEmp,
                    p.NassitInst,
                    (
                        COALESCE(p.Tax, 0) + COALESCE(p.NassitEmp, 0) + COALESCE(p.UnionDues, 0)
                        + COALESCE(p.GratEmp, 0) + COALESCE(p.Ded1, 0) + COALESCE(p.Ded2, 0)
                        + COALESCE(p.Ded3, 0) + COALESCE(p.Ded4, 0) + COALESCE(p.Ded5, 0)
                        + COALESCE(p.Ded6, 0) + COALESCE(p.Ded7, 0)
                    ) AS TotalDeduction,
                    p.NetIncome,
                    p.Approved,
                    COALESCE(p.posted_to_gl, 0) AS posted_to_gl
             FROM tblpayroll p
             LEFT JOIN tblstaff s ON s.PFNo = p.PFNo AND s.CompanyID = p.CompanyID
             WHERE p.CompanyID = ? AND p.PMonth = ? AND p.PYear = ? AND p.PType = ?
             ORDER BY p.PFNo`,
            [1, PAYROLL_MONTH, PAYROLL_YEAR, ACTIVITY_CODE]
        );
        result.currentPayrollRows = currentRows.map((row) => ({
            pf: normalizePf(row.PFNo),
            name: row.SName || '',
            monthlyBasic: toMoney(row.Salary),
            responsibility: toMoney(row.Responsibility),
            maid: toMoney(row.Maid),
            staffWelfare: toMoney(row.StaffWelfare),
            maintenance: toMoney(row.Maintenance),
            risk: toMoney(row.Risk),
            acting: toMoney(row.Acting),
            professional: toMoney(row.Professional),
            academic: toMoney(row.Academic),
            transport: toMoney(row.Transport),
            cola: toMoney(row.COLA),
            totalAllowance: toMoney(row.TotalAllowance),
            totalIncome: toMoney(row.TotalIncome),
            taxable: toMoney(row.Taxable),
            paye: toMoney(row.Tax),
            employeeNassit: toMoney(row.NassitEmp),
            employerNassit: toMoney(row.NassitInst),
            totalDeduction: toMoney(row.TotalDeduction),
            netPay: toMoney(row.NetIncome),
            approved: row.Approved,
            postedToGl: Number(row.posted_to_gl || 0)
        }));

        try {
            const [workflow] = await connection.query(
                `SELECT id, CompanyID, PMonth, PYear, PType, GenerationNo,
                        Status, ProcessedBy, SubmittedToManagerBy, ManagerComments, AuditorComments,
                        EntityHeadComments, CreatedAt, UpdatedAt
                 FROM payroll_workflow_batches
                 WHERE PMonth = ? AND PYear = ?
                 ORDER BY CompanyID, PType, GenerationNo, id`,
                [PAYROLL_MONTH, PAYROLL_YEAR]
            );
            result.existingAugustWorkflow = workflow;
        } catch (error) {
            result.existingAugustWorkflow = [{ error: error.code, message: error.sqlMessage || error.message }];
        }
    } catch (error) {
        result.blocker = error.message;
    } finally {
        if (connection) await connection.end();
    }
    return result;
}

function summarizeStatus(report) {
    if (report.database.blocker) {
        return 'BLOCKED_DATABASE_INNODB_UNAVAILABLE';
    }
    if (report.database.existingAugustPayroll.some((row) => Number(row.postedRows || 0) > 0)) {
        return 'BLOCKED_EXISTING_POSTED_AUGUST_PAYROLL_REQUIRES_REVERSAL_REOPEN_REVIEW';
    }
    return 'READY_FOR_CONTROLLED_WORKFLOW_RECONCILIATION';
}

const COMPARISON_FIELDS = [
    ['monthlyBasic', 'Basic Salary'],
    ['responsibility', 'Responsibility'],
    ['maid', 'Maid'],
    ['staffWelfare', 'Staff Welfare'],
    ['maintenance', 'Maintenance'],
    ['risk', 'Risk'],
    ['acting', 'Acting'],
    ['professional', 'Professional'],
    ['academic', 'Academic'],
    ['transport', 'Transport'],
    ['cola', 'COLA'],
    ['totalAllowance', 'Total Allowance'],
    ['totalIncome', 'Gross/Total Income'],
    ['taxable', 'Taxable Income'],
    ['paye', 'PAYE'],
    ['employeeNassit', 'Employee NASSIT'],
    ['employerNassit', 'Employer NASSIT'],
    ['totalDeduction', 'Total Deductions'],
    ['netPay', 'Net Pay']
];

function classifyVariance(field, variance) {
    if (Math.abs(variance) <= MONEY_TOLERANCE) return 'EXACT_OR_ROUNDING_MATCH';
    if (field === 'monthlyBasic') return 'BASIC_SALARY_VARIANCE';
    if (['responsibility', 'maid', 'staffWelfare', 'maintenance', 'risk', 'acting', 'professional', 'academic'].includes(field)) {
        return 'TAXABLE_ALLOWANCE_VARIANCE';
    }
    if (['transport', 'cola'].includes(field)) return 'MANUAL_ENTITLEMENT_ALLOWANCE_VARIANCE';
    if (field === 'taxable') return 'TAXABLE_INCOME_VARIANCE';
    if (field === 'paye') return 'PAYE_VARIANCE_REVIEW_FORMULA_AND_BASE';
    if (field === 'employeeNassit') return 'NASSIT_VARIANCE';
    if (field === 'employerNassit') return 'NASSIT_VARIANCE';
    if (field === 'totalDeduction') return 'DEDUCTION_VARIANCE';
    if (field === 'netPay') return 'NET_PAY_VARIANCE';
    return 'MATERIAL_VARIANCE';
}

function buildComparison(workbook, database) {
    const systemByPf = new Map((database.currentPayrollRows || []).map((row) => [row.pf, row]));
    const excelByPf = new Map((workbook.employees || []).map((row) => [row.pf, row]));
    const employeeRows = [];
    const fieldTotals = {};
    const unmatched = {
        excelOnly: [],
        systemOnly: []
    };

    for (const [pf, excel] of excelByPf.entries()) {
        const system = systemByPf.get(pf);
        if (!system) {
            unmatched.excelOnly.push({ pf, name: excel.name });
            continue;
        }
        for (const [field, label] of COMPARISON_FIELDS) {
            const excelValue = toMoney(excel[field]);
            const systemValue = toMoney(system[field]);
            const variance = toMoney(systemValue - excelValue);
            const status = Math.abs(variance) <= MONEY_TOLERANCE ? 'MATCH' : 'MATERIAL_VARIANCE';
            employeeRows.push({
                pf,
                name: excel.name,
                systemName: system.name,
                field,
                label,
                excel: excelValue,
                systemBefore: systemValue,
                variance,
                status,
                likelyCause: classifyVariance(field, variance)
            });
            if (!fieldTotals[field]) {
                fieldTotals[field] = { label, excel: 0, systemBefore: 0, variance: 0, materialVarianceCount: 0 };
            }
            fieldTotals[field].excel = toMoney(fieldTotals[field].excel + excelValue);
            fieldTotals[field].systemBefore = toMoney(fieldTotals[field].systemBefore + systemValue);
            fieldTotals[field].variance = toMoney(fieldTotals[field].systemBefore - fieldTotals[field].excel);
            if (status !== 'MATCH') fieldTotals[field].materialVarianceCount += 1;
        }
    }

    for (const [pf, system] of systemByPf.entries()) {
        if (!excelByPf.has(pf)) {
            unmatched.systemOnly.push({ pf, name: system.name });
        }
    }

    return {
        matchedEmployees: workbook.employees.filter((employee) => systemByPf.has(employee.pf)).length,
        excelEmployeeCount: workbook.employees.length,
        systemEmployeeCount: database.currentPayrollRows.length,
        unmatched,
        fieldTotals,
        employeeRows,
        materialVarianceCount: employeeRows.filter((row) => row.status !== 'MATCH').length
    };
}

function writeMarkdown(report) {
    const lines = [];
    lines.push('# WAEC August 2026 Payroll Reconciliation - Before Run');
    lines.push('');
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push('');
    lines.push(`Status: \`${report.status}\``);
    lines.push('');
    lines.push('## Workbook Reference');
    lines.push('');
    lines.push(`- Workbook: \`${report.workbook.workbookPath}\``);
    lines.push(`- Primary sheet: \`${report.workbook.primarySheet}\``);
    lines.push(`- Parsed employee rows: ${report.workbook.employees.length}`);
    lines.push(`- Workbook sheets: ${report.workbook.sheets.map((sheet) => `\`${sheet}\``).join(', ')}`);
    lines.push('');
    lines.push('## Workbook Totals');
    lines.push('');
    lines.push('| Area | Excel Total |');
    lines.push('| --- | ---: |');
    const totalRows = [
        ['Basic Salary', 'monthlyBasic'],
        ['Responsibility', 'responsibility'],
        ['Maid', 'maid'],
        ['Staff Welfare', 'staffWelfare'],
        ['Maintenance', 'maintenance'],
        ['Risk', 'risk'],
        ['Acting', 'acting'],
        ['Professional', 'professional'],
        ['Academic', 'academic'],
        ['Transport', 'transport'],
        ['COLA', 'cola'],
        ['Total Allowance', 'totalAllowance'],
        ['Taxable', 'taxable'],
        ['PAYE', 'paye'],
        ['Employee NASSIT', 'employeeNassit'],
        ['Employer NASSIT', 'employerNassit'],
        ['Total Deduction', 'totalDeduction'],
        ['Net Pay', 'netPay']
    ];
    for (const [label, key] of totalRows) {
        lines.push(`| ${label} | ${formatMoney(report.workbook.totals[key])} |`);
    }
    lines.push('');
    lines.push('## Parsed Employees');
    lines.push('');
    lines.push('| PFNo | Name | Bank | Monthly Basic | PAYE | Employee NASSIT | Net Pay |');
    lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: |');
    for (const employee of report.workbook.employees) {
        lines.push(`| ${employee.pf} | ${employee.name} | ${employee.bank} | ${formatMoney(employee.monthlyBasic)} | ${formatMoney(employee.paye)} | ${formatMoney(employee.employeeNassit)} | ${formatMoney(employee.netPay)} |`);
    }
    lines.push('');
    lines.push('## Database Preflight');
    lines.push('');
    lines.push(`- Connected: ${report.database.connected ? 'Yes' : 'No'}`);
    lines.push(`- DB host: ${report.database.config.host}`);
    lines.push(`- DB port: ${report.database.config.port}`);
    lines.push(`- DB name: ${report.database.config.database}`);
    lines.push(`- InnoDB support: ${report.database.innodb?.Support || 'Unavailable'}`);
    if (report.database.blocker) {
        lines.push(`- Blocker: ${report.database.blocker}`);
    }
    lines.push('');
    lines.push('| Table | Result | Count / Error |');
    lines.push('| --- | --- | --- |');
    for (const [table, access] of Object.entries(report.database.tableAccess || {})) {
        lines.push(`| ${table} | ${access.ok ? 'PASS' : 'FAIL'} | ${access.ok ? access.count : `${access.code}: ${access.message}`} |`);
    }
    lines.push('');
    lines.push('## Existing August 2026 Payroll');
    lines.push('');
    if (!report.database.existingAugustPayroll.length) {
        lines.push('No existing August payroll rows could be read, or the check is blocked by database access.');
    } else {
        lines.push('| CompanyID | PType | Generation | Rows | Posted Rows | Net Income |');
        lines.push('| ---: | --- | ---: | ---: | ---: | ---: |');
        for (const row of report.database.existingAugustPayroll) {
            lines.push(`| ${row.CompanyID} | ${row.PType} | ${row.GenerationNo || ''} | ${row.rowCount} | ${row.postedRows} | ${formatMoney(row.NetIncome)} |`);
        }
    }
    lines.push('');
    lines.push('## Next Required Action');
    lines.push('');
    if (report.status === 'BLOCKED_DATABASE_INNODB_UNAVAILABLE') {
        lines.push('Restore MariaDB InnoDB access before running payroll workflow. The current local MariaDB service reports InnoDB support as unavailable, so staff/salary/payroll tables cannot be read safely.');
        lines.push('');
        lines.push('A local configuration backup was created before reducing `innodb_buffer_pool_size` from `256M` to `128M`, but this session could not restart the Windows service without elevated permissions. Restart WAMP/MariaDB as Administrator, then rerun this script.');
    } else {
        lines.push('Proceed with controlled August 2026 payroll workflow and employee-by-employee reconciliation.');
    }
    lines.push('');
    if (report.comparison) {
        lines.push('## BEFORE Comparison Summary');
        lines.push('');
        lines.push(`- Excel employee count: ${report.comparison.excelEmployeeCount}`);
        lines.push(`- System employee count: ${report.comparison.systemEmployeeCount}`);
        lines.push(`- Matched employee count: ${report.comparison.matchedEmployees}`);
        lines.push(`- Material variance rows: ${report.comparison.materialVarianceCount}`);
        lines.push('');
        lines.push('| Area | Excel | System Before | Variance | Material Variance Count |');
        lines.push('| --- | ---: | ---: | ---: | ---: |');
        for (const [field] of COMPARISON_FIELDS) {
            const total = report.comparison.fieldTotals[field];
            if (!total) continue;
            lines.push(`| ${total.label} | ${formatMoney(total.excel)} | ${formatMoney(total.systemBefore)} | ${formatMoney(total.variance)} | ${total.materialVarianceCount} |`);
        }
        lines.push('');
        lines.push('## BEFORE Employee Variances');
        lines.push('');
        lines.push('| PFNo | Name | Component | Excel | System Before | Variance | Cause |');
        lines.push('| --- | --- | --- | ---: | ---: | ---: | --- |');
        for (const row of report.comparison.employeeRows.filter((entry) => entry.status !== 'MATCH')) {
            lines.push(`| ${row.pf} | ${row.name} | ${row.label} | ${formatMoney(row.excel)} | ${formatMoney(row.systemBefore)} | ${formatMoney(row.variance)} | ${row.likelyCause} |`);
        }
        lines.push('');
    }
    fs.writeFileSync(OUTPUT_MD, `${lines.join('\n')}\n`);
}

function formatMoney(value) {
    return Number(value || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

async function main() {
    const workbook = parsePayrollWorkbook(WORKBOOK_PATH);
    const database = await inspectDatabase();
    const report = {
        generatedAt: new Date().toISOString(),
        payrollPeriod: { month: PAYROLL_MONTH, year: PAYROLL_YEAR, activityCode: ACTIVITY_CODE },
        tolerance: MONEY_TOLERANCE,
        workbook,
        database
    };
    report.status = summarizeStatus(report);
    if (!database.blocker) {
        report.comparison = buildComparison(workbook, database);
    }
    ensureDir(OUTPUT_JSON);
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2));
    writeMarkdown(report);
    console.log(JSON.stringify({
        status: report.status,
        workbookEmployees: workbook.employees.length,
        workbookNetPay: workbook.totals.netPay,
        dbBlocker: database.blocker || null,
        outputs: { json: OUTPUT_JSON, markdown: OUTPUT_MD }
    }, null, 2));
    if (report.status !== 'READY_FOR_CONTROLLED_WORKFLOW_RECONCILIATION') {
        process.exitCode = 2;
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
