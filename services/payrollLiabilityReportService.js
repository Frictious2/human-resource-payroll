const pool = require('../config/db');
const { normalizeLogoPath } = require('./brandingService');

const NRA_LOGO = {
    authoritativeUrl: 'https://www.nra.gov.sl/images/logo.jpg',
    renderPath: '/images/nra-logo.jpg'
};

const LIABILITY_TYPES = {
    PAYE: {
        label: 'PAYE',
        supported: true
    },
    EOS: {
        label: 'EOS Benefit',
        supported: true
    },
    NASSIT: {
        label: 'NASSIT',
        supported: true
    }
};

function normalizeText(value) {
    const text = String(value || '').trim();
    return text || '';
}

function normalizeOptionalText(value) {
    const text = normalizeText(value);
    return text || null;
}

function normalizeDateInput(value, fallback = null) {
    const text = normalizeText(value);
    if (!text) {
        return fallback;
    }

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
        return fallback;
    }

    return parsed.toISOString().slice(0, 10);
}

function buildDisplayAddress(...parts) {
    const cleaned = [];
    for (const part of parts) {
        const text = normalizeText(part);
        if (!text) continue;
        const previous = cleaned[cleaned.length - 1];
        if (previous && previous.localeCompare(text, undefined, { sensitivity: 'accent' }) === 0) {
            continue;
        }
        cleaned.push(text);
    }
    return cleaned.join(', ');
}

function formatShortDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    }).replace(/ /g, '-');
}

function formatLongDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return date.toLocaleDateString('en-GB', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function formatMonthPeriod(month, year) {
    const monthIndex = Math.max(0, Math.min(11, Number(month || 1) - 1));
    return new Date(Date.UTC(Number(year || 2000), monthIndex, 1)).toLocaleDateString('en-GB', {
        month: 'short',
        year: 'numeric'
    }).toUpperCase();
}

function sanitizeFilenamePart(value) {
    return String(value || '')
        .replace(/[^a-z0-9\-_. ]/gi, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

function chunkRows(rows, pageSize) {
    const size = Math.max(Number(pageSize) || 1, 1);
    if (!rows.length) {
        return [[]];
    }

    const pages = [];
    for (let index = 0; index < rows.length; index += size) {
        pages.push(rows.slice(index, index + size));
    }
    return pages;
}

function money(value) {
    return Number(value || 0);
}

async function getCompanyInfo(companyId) {
    const resolvedCompanyId = Number(companyId) || 1;
    const [rows] = await pool.query(
        `SELECT CompanyID, Com_Name, TinNo, Address, Town, City, Country, Phone, Email, Manager, LogoPath, Logopath
         FROM tblcominfo
         WHERE CompanyID = ?
         LIMIT 1`,
        [resolvedCompanyId]
    );

    const company = rows[0];
    if (company) {
        return {
            ...company,
            LogoPath: normalizeLogoPath(company.LogoPath || company.Logopath),
            fullAddress: buildDisplayAddress(company.Address, company.Town, company.City, company.Country)
        };
    }

    const [fallbackRows] = await pool.query(
        `SELECT CompanyID, Com_Name, TinNo, Address, Town, City, Country, Phone, Email, Manager, LogoPath, Logopath
         FROM tblcominfo
         ORDER BY CompanyID ASC
         LIMIT 1`
    );

    const fallback = fallbackRows[0] || {};
    return {
        CompanyID: resolvedCompanyId,
        Com_Name: fallback.Com_Name || 'HR & Payroll',
        TinNo: fallback.TinNo || '',
        Address: fallback.Address || '',
        Town: fallback.Town || '',
        City: fallback.City || '',
        Country: fallback.Country || '',
        Phone: fallback.Phone || '',
        Email: fallback.Email || '',
        Manager: fallback.Manager || '',
        LogoPath: normalizeLogoPath(fallback.LogoPath || fallback.Logopath),
        fullAddress: buildDisplayAddress(fallback.Address, fallback.Town, fallback.City, fallback.Country)
    };
}

async function getStaffRecord(companyId, pfNo) {
    const normalizedPfNo = normalizeOptionalText(pfNo);
    if (!normalizedPfNo) {
        const error = new Error('PFNo is required.');
        error.expose = true;
        throw error;
    }

    const [rows] = await pool.query(
        `SELECT PFNo, SName, CompanyID
         FROM tblstaff
         WHERE PFNo = ?
           AND (CompanyID = ? OR CompanyID IS NULL)
         LIMIT 1`,
        [normalizedPfNo, Number(companyId) || 1]
    );

    if (!rows.length) {
        const error = new Error('No staff record was found for the selected PFNo within your company.');
        error.expose = true;
        throw error;
    }

    return rows[0];
}

function getLiabilityTypeOptions() {
    return Object.entries(LIABILITY_TYPES).map(([value, config]) => ({
        value,
        label: config.label,
        supported: !!config.supported
    }));
}

function getSupportedLiabilityType(value) {
    const normalized = normalizeText(value).toUpperCase();
    if (!normalized) {
        return 'PAYE';
    }

    if (!LIABILITY_TYPES[normalized]) {
        const error = new Error('Unsupported liability type.');
        error.expose = true;
        throw error;
    }

    return normalized;
}

function getLiabilityDefaults(filters = {}) {
    const today = new Date();
    const todayString = today.toISOString().slice(0, 10);
    return {
        liabilityType: getSupportedLiabilityType(filters.liabilityType),
        fromDate: normalizeDateInput(filters.fromDate, todayString),
        toDate: normalizeDateInput(filters.toDate, todayString),
        autoDownloadPdf: String(filters.autoDownloadPdf || '') === '1'
    };
}

function getStaffStatementDefaults(filters = {}) {
    const today = new Date();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return {
        pfNo: normalizeText(filters.pfNo),
        fromDate: normalizeDateInput(filters.fromDate, monthStart.toISOString().slice(0, 10)),
        toDate: normalizeDateInput(filters.toDate, today.toISOString().slice(0, 10)),
        autoDownloadPdf: String(filters.autoDownloadPdf || '') === '1'
    };
}

function validateDateRange(filters) {
    if (!filters.fromDate || !filters.toDate) {
        const error = new Error('Both From Date and To Date are required.');
        error.expose = true;
        throw error;
    }

    if (filters.fromDate > filters.toDate) {
        const error = new Error('From Date must be earlier than or equal to To Date.');
        error.expose = true;
        throw error;
    }
}

function buildEffectivePayrollClause(alias = 'p') {
    return `
        ${alias}.Approved IN (-1, 1)
        AND (
            NOT EXISTS (
                SELECT 1
                FROM payroll_workflow_batches wb_any
                WHERE wb_any.CompanyID = ${alias}.CompanyID
                  AND wb_any.PMonth = ${alias}.PMonth
                  AND wb_any.PYear = ${alias}.PYear
                  AND wb_any.PType = ${alias}.PType
            )
            OR EXISTS (
                SELECT 1
                FROM payroll_workflow_batches wb_effective
                WHERE wb_effective.id = (
                    SELECT wb_latest.id
                    FROM payroll_workflow_batches wb_latest
                    WHERE wb_latest.CompanyID = ${alias}.CompanyID
                      AND wb_latest.PMonth = ${alias}.PMonth
                      AND wb_latest.PYear = ${alias}.PYear
                      AND wb_latest.PType = ${alias}.PType
                    ORDER BY COALESCE(wb_latest.GenerationNo, 1) DESC, wb_latest.id DESC
                    LIMIT 1
                )
                  AND wb_effective.Status <> 'REVERSED'
            )
        )
    `;
}

async function getPayTypeMap(companyId) {
    const [rows] = await pool.query(
        `SELECT Code, PayType
         FROM tblpaytype
         WHERE CompanyID = ? OR CompanyID IS NULL`,
        [Number(companyId) || 1]
    );

    const map = new Map();
    rows.forEach((row) => {
        const key = String(row.Code || '').padStart(2, '0');
        map.set(key, row.PayType || key);
    });
    return map;
}

async function getFinanceIndexPageData({ companyId, filters = {} }) {
    const [company] = await Promise.all([
        getCompanyInfo(companyId)
    ]);

    return {
        company,
        filters: getLiabilityDefaults(filters),
        staffFilters: getStaffStatementDefaults(filters),
        liabilityTypeOptions: getLiabilityTypeOptions()
    };
}

async function getPayeReportData({ companyId, filters, company }) {
    const allowanceSql = Array.from({ length: 19 }, (_, index) => {
        const code = String(index + 2).padStart(2, '0');
        return `COALESCE(p.Allw${code}, 0)`;
    }).join(' + ');

    const [rows] = await pool.query(
        `
            SELECT
                s.PFNo,
                s.SName,
                SUM(COALESCE(p.Salary, 0)) AS BasicMonthlySalary,
                SUM(COALESCE(p.NassitEmp, 0)) AS NassitDeduction,
                SUM(${allowanceSql}) AS MonthlyAllowance,
                SUM(COALESCE(p.TotalIncome, 0)) AS GrossMonthlyEmoluments,
                SUM(COALESCE(p.Tax, 0)) AS TaxDeducted
            FROM tblpayroll p
            INNER JOIN tblstaff s
                ON s.PFNo = p.PFNo
            WHERE p.CompanyID = ?
              AND DATE(COALESCE(p.PDate, p.SalDate)) >= ?
              AND DATE(COALESCE(p.PDate, p.SalDate)) <= ?
              AND (${buildEffectivePayrollClause('p')})
              AND (s.CompanyID = ? OR s.CompanyID IS NULL)
            GROUP BY s.PFNo, s.SName
            HAVING SUM(COALESCE(p.TotalIncome, 0)) <> 0
                OR SUM(COALESCE(p.Tax, 0)) <> 0
            ORDER BY s.SName ASC, s.PFNo ASC
        `,
        [Number(companyId) || 1, filters.fromDate, filters.toDate, Number(companyId) || 1]
    );

    const reportRows = rows.map((row, index) => ({
        RowNo: index + 1,
        PFNo: row.PFNo,
        StaffName: row.SName,
        BasicMonthlySalary: money(row.BasicMonthlySalary),
        NassitDeduction: money(row.NassitDeduction),
        MonthlyAllowance: money(row.MonthlyAllowance),
        GrossMonthlyEmoluments: money(row.GrossMonthlyEmoluments),
        TaxDeducted: money(row.TaxDeducted)
    }));

    const totals = reportRows.reduce((summary, row) => ({
        staffCount: summary.staffCount + 1,
        basic: summary.basic + row.BasicMonthlySalary,
        nassit: summary.nassit + row.NassitDeduction,
        allowance: summary.allowance + row.MonthlyAllowance,
        gross: summary.gross + row.GrossMonthlyEmoluments,
        tax: summary.tax + row.TaxDeducted
    }), {
        staffCount: 0,
        basic: 0,
        nassit: 0,
        allowance: 0,
        gross: 0,
        tax: 0
    });

    const pages = chunkRows(reportRows, 12).map((pageRows, index, pageList) => ({
        pageNumber: index + 1,
        totalPages: pageList.length,
        rows: pageRows
    }));

    return {
        company,
        filters,
        report: {
            liabilityType: 'PAYE',
            supported: true,
            title: 'Return by Employer of Income Tax Deducted from Employee Remuneration, Section 23 of the Consolidated Income Tax Act 2000',
            shortTitle: 'PAYE Liability Return',
            subtitle: `For Period: ${formatShortDate(filters.fromDate)} to ${formatShortDate(filters.toDate)}`,
            periodLabel: `${formatShortDate(filters.fromDate)} to ${formatShortDate(filters.toDate)}`,
            printDateLabel: formatLongDate(new Date()),
            sourceSummary: 'PAYE is derived from effective approved payroll rows using tblpayroll.Salary, allowance columns, TotalIncome, NassitEmp, and Tax. Reversed generations are excluded.',
            approvalRuleSummary: 'Only effective approved payroll rows contribute. Reversed payroll generations are excluded; reopened corrected generations remain reportable.',
            employerTin: company.TinNo || '',
            employerContact: company.Phone || company.Email || '',
            nraLogoPath: NRA_LOGO.renderPath,
            nraLogoSourceUrl: NRA_LOGO.authoritativeUrl,
            emptyMessage: 'No PAYE records found for the selected period.'
        },
        rows: reportRows,
        pages,
        totals,
        exportRows: reportRows.map((row) => ({
            'Serial No': row.RowNo,
            'Employee Name': row.StaffName,
            'Emp-ID / PFNo': row.PFNo,
            'Basic Monthly Salary': row.BasicMonthlySalary,
            'Less NASSIT Deduction': row.NassitDeduction,
            'Monthly Allowance': row.MonthlyAllowance,
            'Gross Monthly Emoluments': row.GrossMonthlyEmoluments,
            'Tax Deducted': row.TaxDeducted
        })),
        filenames: {
            pdf: sanitizeFilenamePart(`PAYE-Liability-${filters.fromDate}-to-${filters.toDate}`) + '.pdf',
            excel: sanitizeFilenamePart(`PAYE-Liability-${filters.fromDate}-to-${filters.toDate}`) + '.xls'
        }
    };
}

async function getNassitReportData({ companyId, filters, company }) {
    const [rows] = await pool.query(
        `
            SELECT
                s.PFNo,
                s.SName,
                s.NASSITNo,
                SUM(COALESCE(p.Salary, 0)) AS MonthlySalary,
                SUM(COALESCE(p.NassitEmp, 0)) AS EmployeeContribution,
                SUM(COALESCE(p.NassitInst, 0)) AS EmployerContribution
            FROM tblpayroll p
            INNER JOIN tblstaff s
                ON s.PFNo = p.PFNo
            WHERE p.CompanyID = ?
              AND DATE(COALESCE(p.PDate, p.SalDate)) >= ?
              AND DATE(COALESCE(p.PDate, p.SalDate)) <= ?
              AND (${buildEffectivePayrollClause('p')})
              AND (s.CompanyID = ? OR s.CompanyID IS NULL)
            GROUP BY s.PFNo, s.SName, s.NASSITNo
            HAVING SUM(COALESCE(p.NassitEmp, 0) + COALESCE(p.NassitInst, 0)) <> 0
            ORDER BY s.SName ASC, s.PFNo ASC
        `,
        [Number(companyId) || 1, filters.fromDate, filters.toDate, Number(companyId) || 1]
    );

    const reportRows = rows.map((row, index) => ({
        RowNo: index + 1,
        PFNo: row.PFNo,
        StaffName: row.SName,
        NassitNo: row.NASSITNo || '',
        MonthlySalary: money(row.MonthlySalary),
        EmployeeContribution: money(row.EmployeeContribution),
        EmployerContribution: money(row.EmployerContribution),
        TotalContribution: money(row.EmployeeContribution) + money(row.EmployerContribution)
    }));

    const totals = reportRows.reduce((summary, row) => ({
        staffCount: summary.staffCount + 1,
        salary: summary.salary + row.MonthlySalary,
        employee: summary.employee + row.EmployeeContribution,
        employer: summary.employer + row.EmployerContribution,
        total: summary.total + row.TotalContribution
    }), {
        staffCount: 0,
        salary: 0,
        employee: 0,
        employer: 0,
        total: 0
    });

    const pages = chunkRows(reportRows, 14).map((pageRows, index, pageList) => ({
        pageNumber: index + 1,
        totalPages: pageList.length,
        rows: pageRows
    }));

    return {
        company,
        filters,
        report: {
            liabilityType: 'NASSIT',
            supported: true,
            title: 'NASSIT CONTRIBUTION',
            shortTitle: 'NASSIT Contribution',
            subtitle: `FOR PERIOD: ${formatShortDate(filters.fromDate)} to ${formatShortDate(filters.toDate)}`,
            periodLabel: `${formatShortDate(filters.fromDate)} to ${formatShortDate(filters.toDate)}`,
            printDateLabel: formatLongDate(new Date()),
            sourceSummary: 'NASSIT liabilities are derived from effective approved payroll rows using Salary, NassitEmp, and NassitInst. Reversed generations are excluded.',
            approvalRuleSummary: 'Only effective approved payroll rows contribute. Reversed payroll generations are excluded; reopened corrected generations remain reportable.',
            emptyMessage: 'No NASSIT records found for the selected period.'
        },
        rows: reportRows,
        pages,
        totals,
        exportRows: reportRows.map((row) => ({
            'No.': row.RowNo,
            'NASSIT No': row.NassitNo,
            Name: row.StaffName,
            'Emp-ID / PFNo': row.PFNo,
            'Monthly Salary': row.MonthlySalary,
            'Employee Contribution': row.EmployeeContribution,
            'Employer Contribution': row.EmployerContribution,
            Total: row.TotalContribution
        })),
        filenames: {
            pdf: sanitizeFilenamePart(`NASSIT-Contribution-${filters.fromDate}-to-${filters.toDate}`) + '.pdf',
            excel: sanitizeFilenamePart(`NASSIT-Contribution-${filters.fromDate}-to-${filters.toDate}`) + '.xls'
        }
    };
}

async function getEosReportData({ companyId, filters, company }) {
    const [rows] = await pool.query(
        `
            SELECT
                e.PFNo,
                COALESCE(e.SName, s.SName) AS SName,
                SUM(COALESCE(e.Benefit, 0)) AS TotalEOSBenefit,
                SUM(COALESCE(e.Taxable, 0)) AS TaxableLeaveAllowance,
                SUM(COALESCE(e.Tax, 0)) AS TaxDeducted
            FROM tbleosbudget e
            LEFT JOIN tblstaff s
                ON s.PFNo = e.PFNo
            WHERE (e.CompanyID = ? OR (e.CompanyID IS NULL AND (s.CompanyID = ? OR s.CompanyID IS NULL)))
              AND DATE(COALESCE(e.DateApproved, e.ReasonDate, e.Bdate, e.DateKeyed)) >= ?
              AND DATE(COALESCE(e.DateApproved, e.ReasonDate, e.Bdate, e.DateKeyed)) <= ?
              AND e.Approved IN (-1, 1)
            GROUP BY e.PFNo, COALESCE(e.SName, s.SName)
            HAVING SUM(COALESCE(e.Benefit, 0)) <> 0
                OR SUM(COALESCE(e.Tax, 0)) <> 0
                OR SUM(COALESCE(e.Taxable, 0)) <> 0
            ORDER BY COALESCE(e.SName, s.SName) ASC, e.PFNo ASC
        `,
        [Number(companyId) || 1, Number(companyId) || 1, filters.fromDate, filters.toDate]
    );

    const reportRows = rows.map((row, index) => ({
        RowNo: index + 1,
        PFNo: row.PFNo,
        StaffName: row.SName,
        TotalEOSBenefit: money(row.TotalEOSBenefit),
        TaxableLeaveAllowance: money(row.TaxableLeaveAllowance),
        TaxDeducted: money(row.TaxDeducted)
    }));

    const totals = reportRows.reduce((summary, row) => ({
        staffCount: summary.staffCount + 1,
        eosBenefit: summary.eosBenefit + row.TotalEOSBenefit,
        taxableLeave: summary.taxableLeave + row.TaxableLeaveAllowance,
        tax: summary.tax + row.TaxDeducted
    }), {
        staffCount: 0,
        eosBenefit: 0,
        taxableLeave: 0,
        tax: 0
    });

    const pages = chunkRows(reportRows, 12).map((pageRows, index, pageList) => ({
        pageNumber: index + 1,
        totalPages: pageList.length,
        rows: pageRows
    }));

    return {
        company,
        filters,
        report: {
            liabilityType: 'EOS',
            supported: true,
            title: 'End of Service Benefit Tax Liability Return',
            shortTitle: 'EOS Benefit Liability',
            subtitle: `FOR PERIOD: ${formatShortDate(filters.fromDate)} to ${formatShortDate(filters.toDate)}`,
            periodLabel: `${formatShortDate(filters.fromDate)} to ${formatShortDate(filters.toDate)}`,
            printDateLabel: formatLongDate(new Date()),
            sourceSummary: 'EOS liabilities are derived from approved tbleosbudget rows using Benefit, Taxable, and Tax. The reporting date uses DateApproved where available, then ReasonDate/Bdate/DateKeyed.',
            approvalRuleSummary: 'Only approved EOS budget rows contribute. Monthly payroll workflow generation rules do not apply to EOS budget rows directly.',
            declarationText: 'I, Head, Human Resource hereby declare that this return is a true account of all deductions of Income Tax made from End of Service benefits of employees for the stated period.',
            nraLogoPath: NRA_LOGO.renderPath,
            nraLogoSourceUrl: NRA_LOGO.authoritativeUrl,
            emptyMessage: 'No EOS Benefit liabilities found for the selected period.'
        },
        rows: reportRows,
        pages,
        totals,
        exportRows: reportRows.map((row) => ({
            'Serial No': row.RowNo,
            'Employee Name': row.StaffName,
            'Emp-ID / PFNo': row.PFNo,
            'Total EOS Benefit': row.TotalEOSBenefit,
            'Taxable Leave Allowance': row.TaxableLeaveAllowance,
            'Tax Deducted': row.TaxDeducted
        })),
        filenames: {
            pdf: sanitizeFilenamePart(`EOS-Benefit-Liability-${filters.fromDate}-to-${filters.toDate}`) + '.pdf',
            excel: sanitizeFilenamePart(`EOS-Benefit-Liability-${filters.fromDate}-to-${filters.toDate}`) + '.xls'
        }
    };
}

async function getPayrollLiabilityReportData({ companyId, filters = {} }) {
    const normalized = getLiabilityDefaults(filters);
    validateDateRange(normalized);

    const company = await getCompanyInfo(companyId);

    if (normalized.liabilityType === 'PAYE') {
        return getPayeReportData({ companyId, filters: normalized, company });
    }

    if (normalized.liabilityType === 'NASSIT') {
        return getNassitReportData({ companyId, filters: normalized, company });
    }

    if (normalized.liabilityType === 'EOS') {
        return getEosReportData({ companyId, filters: normalized, company });
    }

    const error = new Error('Unsupported liability type.');
    error.expose = true;
    throw error;
}

async function getStaffPayeStatementData({ companyId, filters = {} }) {
    const normalized = getStaffStatementDefaults(filters);
    validateDateRange(normalized);

    const [company, staff, payTypeMap] = await Promise.all([
        getCompanyInfo(companyId),
        getStaffRecord(companyId, normalized.pfNo),
        getPayTypeMap(companyId)
    ]);

    const commonParams = [Number(companyId) || 1, staff.PFNo];
    const effectiveClause = buildEffectivePayrollClause('p');

    const [openingRows, statementRows] = await Promise.all([
        pool.query(
            `
                SELECT SUM(COALESCE(p.Tax, 0)) AS OpeningBalance
                FROM tblpayroll p
                WHERE p.CompanyID = ?
                  AND p.PFNo = ?
                  AND DATE(COALESCE(p.PDate, p.SalDate)) < ?
                  AND (${effectiveClause})
            `,
            [...commonParams, normalized.fromDate]
        ),
        pool.query(
            `
                SELECT
                    DATE(COALESCE(p.PDate, p.SalDate)) AS TxnDate,
                    p.PMonth,
                    p.PYear,
                    p.PType,
                    COALESCE(p.Tax, 0) AS TaxAmount
                FROM tblpayroll p
                WHERE p.CompanyID = ?
                  AND p.PFNo = ?
                  AND DATE(COALESCE(p.PDate, p.SalDate)) >= ?
                  AND DATE(COALESCE(p.PDate, p.SalDate)) <= ?
                  AND (${effectiveClause})
                  AND COALESCE(p.Tax, 0) <> 0
                ORDER BY DATE(COALESCE(p.PDate, p.SalDate)) ASC, p.PYear ASC, p.PMonth ASC, p.PType ASC
            `,
            [...commonParams, normalized.fromDate, normalized.toDate]
        )
    ]);

    const openingBalance = money(openingRows[0][0]?.OpeningBalance);
    let runningBalance = openingBalance;
    const rows = statementRows[0].map((row, index) => {
        const taxAmount = money(row.TaxAmount);
        const debit = taxAmount < 0 ? Math.abs(taxAmount) : 0;
        const credit = taxAmount >= 0 ? taxAmount : 0;
        runningBalance = runningBalance + credit - debit;
        const pTypeCode = String(row.PType || '').padStart(2, '0');
        const activityLabel = payTypeMap.get(pTypeCode) || `Activity ${pTypeCode}`;
        return {
            RowNo: index + 1,
            Date: row.TxnDate,
            Details: `PAYE FOR ${formatMonthPeriod(row.PMonth, row.PYear)}${activityLabel ? ` - ${activityLabel}` : ''}`,
            Debit: debit,
            Credit: credit,
            Balance: runningBalance
        };
    });

    const pages = chunkRows(rows, 18).map((pageRows, index, pageList) => ({
        pageNumber: index + 1,
        totalPages: pageList.length,
        rows: pageRows,
        openingBalance: index === 0 ? openingBalance : null
    }));

    return {
        company,
        staff,
        filters: normalized,
        report: {
            title: 'Staff PAYE Statement',
            subtitle: `${formatShortDate(normalized.fromDate)} to ${formatShortDate(normalized.toDate)}`,
            printDateLabel: formatLongDate(new Date()),
            openingBalance,
            sourceSummary: 'The staff PAYE statement is derived from effective approved payroll tax rows (tblpayroll.Tax) for the selected PFNo. Positive tax amounts are treated as credits to the staff PAYE liability balance.',
            approvalRuleSummary: 'Only effective approved payroll rows contribute. Reversed payroll generations are excluded; corrected active generations remain reportable.',
            emptyMessage: 'No PAYE transactions found for the selected staff and period.'
        },
        rows,
        pages,
        filenames: {
            pdf: sanitizeFilenamePart(`Staff-PAYE-${staff.PFNo}-${staff.SName}-${normalized.fromDate}-to-${normalized.toDate}`) + '.pdf',
            excel: sanitizeFilenamePart(`Staff-PAYE-${staff.PFNo}-${staff.SName}-${normalized.fromDate}-to-${normalized.toDate}`) + '.xls'
        },
        exportRows: rows.map((row) => ({
            Date: formatShortDate(row.Date),
            Details: row.Details,
            Debit: row.Debit,
            Credit: row.Credit,
            Balance: row.Balance
        }))
    };
}

module.exports = {
    getFinanceIndexPageData,
    getLiabilityTypeOptions,
    getPayrollLiabilityReportData,
    getStaffPayeStatementData
};
