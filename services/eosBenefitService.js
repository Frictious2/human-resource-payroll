const pool = require('../config/db');
const staffStatusService = require('./staffStatusService');

function normalizeText(value) {
    const text = String(value || '').trim();
    return text || '';
}

function normalizeOptionalText(value) {
    const text = normalizeText(value);
    return text || null;
}

function normalizeDate(value) {
    const text = normalizeText(value);
    if (!text) {
        return null;
    }

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed.toISOString().slice(0, 10);
}

function createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function yearsBetween(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return null;
    }

    let years = end.getFullYear() - start.getFullYear();
    const monthDiff = end.getMonth() - start.getMonth();
    const dayDiff = end.getDate() - start.getDate();
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
        years -= 1;
    }

    return years;
}

function buildPreviewDate(value) {
    return normalizeDate(value) || new Date().toISOString().slice(0, 10);
}

async function getCompanyInfo(connection = pool) {
    const [rows] = await connection.query('SELECT * FROM tblcominfo LIMIT 1');
    return rows[0] || {};
}

async function getDepartments(connection = pool) {
    const [rows] = await connection.query('SELECT Code, Dept FROM tbldept ORDER BY Dept');
    return rows;
}

async function getBenefitStatusPageData({ companyId, filters = {} } = {}) {
    const resolvedCompanyId = Number(companyId) || 1;
    const [company, departments] = await Promise.all([
        getCompanyInfo(),
        getDepartments()
    ]);

    return {
        company,
        departments,
        filters: {
            pfNo: normalizeText(filters.pfNo || filters.staffId || ''),
            department: normalizeText(filters.department || ''),
            previewDate: buildPreviewDate(filters.previewDate || filters.endDate || '')
        }
    };
}

async function getLatestEOSCalcParams(connection, companyId) {
    const resolvedCompanyId = Number(companyId) || 1;
    const [rows] = await connection.query(
        `
            SELECT *
            FROM tbleoscalc
            WHERE (CompanyID = ? OR CompanyID IS NULL)
            ORDER BY EOSDate DESC
            LIMIT 1
        `,
        [resolvedCompanyId]
    );

    if (rows.length === 0) {
        throw createError('EOS calculation parameters are missing.', 500);
    }

    return rows[0];
}

async function getEOSCandidates(connection, {
    companyId,
    pfNo,
    department,
    previewDate
}) {
    const resolvedCompanyId = Number(companyId) || 1;
    const conditions = [
        '(s.CompanyID = ? OR s.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];
    const params = [previewDate, resolvedCompanyId];

    if (pfNo) {
        conditions.push('s.PFNo = ?');
        params.push(pfNo);
    }

    if (department) {
        conditions.push('s.CDept = ?');
        params.push(department);
    }

    const [rows] = await connection.query(
        `
            SELECT
                s.PFNo,
                s.SName,
                s.CGrade,
                s.DOB,
                s.DOE,
                s.CDept,
                d.Dept AS DeptName,
                salary.Salary AS MonthlyBasicSalary
            FROM tblstaff s
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            LEFT JOIN tblsalary salary
                ON salary.PFNo = s.PFNo
               AND salary.PDate = (
                    SELECT MAX(s2.PDate)
                    FROM tblsalary s2
                    WHERE s2.PFNo = s.PFNo
                      AND COALESCE(s2.Approved, 0) IN (-1, 1)
                      AND DATE(s2.PDate) <= DATE(?)
               )
            WHERE ${conditions.join('\n              AND ')}
            ORDER BY d.Dept ASC, s.SName ASC, s.PFNo ASC
        `,
        params
    );

    return rows;
}

async function getExGratiaCandidates(connection, {
    companyId,
    pfNo,
    department,
    previewDate
}) {
    const resolvedCompanyId = Number(companyId) || 1;
    const conditions = [
        '(s.CompanyID = ? OR s.CompanyID IS NULL)',
        staffStatusService.getActiveStaffFilter('s')
    ];
    const params = [previewDate, resolvedCompanyId];

    if (pfNo) {
        conditions.push('s.PFNo = ?');
        params.push(pfNo);
    }

    if (department) {
        conditions.push('s.CDept = ?');
        params.push(department);
    }

    const [rows] = await connection.query(
        `
            SELECT
                s.PFNo,
                s.SName,
                s.DOE,
                s.DOB,
                s.CDept,
                d.Dept AS DeptName,
                salary.Salary AS MonthlyBasicSalary
            FROM tblstaff s
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            LEFT JOIN tblsalary salary
                ON salary.PFNo = s.PFNo
               AND salary.PDate = (
                    SELECT MAX(s2.PDate)
                    FROM tblsalary s2
                    WHERE s2.PFNo = s.PFNo
                      AND COALESCE(s2.Approved, 0) IN (-1, 1)
                      AND DATE(s2.PDate) <= DATE(?)
               )
            WHERE ${conditions.join('\n              AND ')}
            ORDER BY d.Dept ASC, s.SName ASC, s.PFNo ASC
        `,
        params
    );

    return rows;
}

function resolveEOSBenefitDays(yearsServed, params) {
    const y1 = Number(params.Y1 || 0);
    const y2 = Number(params.Y2 || 0);
    const d1 = Number(params.D1 || 0);
    const d2 = Number(params.D2 || 0);
    const d3 = Number(params.D3 || 0);

    if (yearsServed <= y1) {
        return d1;
    }
    if (yearsServed > y1 && yearsServed <= y2) {
        return d2;
    }
    return d3;
}

function buildEOSPreviewRows(candidates, { previewDate, params, singleStaffMode = false }) {
    const rows = [];
    const warnings = [];
    const exemption = Number(params.Exemption || 0);
    const eosTax = Number(params.EOSTax || 0);

    for (const candidate of candidates) {
        const rowWarnings = [];
        if (!candidate.DOE) {
            rowWarnings.push('employment date is missing');
        }
        if (!candidate.DOB) {
            rowWarnings.push('date of birth is missing');
        }
        if (!(Number(candidate.MonthlyBasicSalary || 0) > 0)) {
            rowWarnings.push('basic salary is missing');
        }

        if (rowWarnings.length > 0) {
            warnings.push(`${candidate.PFNo}: ${rowWarnings.join(', ')}.`);
            continue;
        }

        const age = yearsBetween(candidate.DOB, previewDate);
        const yearsServed = yearsBetween(candidate.DOE, previewDate);
        if (age === null || yearsServed === null) {
            warnings.push(`${candidate.PFNo}: unable to calculate age or years served.`);
            continue;
        }

        const monthlyBasicSalary = Number(candidate.MonthlyBasicSalary || 0);
        const benefitDays = resolveEOSBenefitDays(yearsServed, params);
        const benefit = Math.floor((monthlyBasicSalary / 22) * benefitDays * yearsServed);
        const taxable = benefit > exemption ? Math.round(benefit - exemption) : 0;
        const tax = taxable > 0 ? Math.round((taxable * eosTax) / 100) : 0;
        const final = benefit - tax;

        rows.push({
            PFNo: candidate.PFNo,
            SName: candidate.SName,
            Grade: candidate.CGrade,
            Dept: candidate.CDept,
            DeptName: candidate.DeptName || candidate.CDept || 'Unknown Department',
            DateEmp: candidate.DOE,
            PreviewDate: previewDate,
            Age: age,
            Years: yearsServed,
            Salary: monthlyBasicSalary,
            Days: benefitDays,
            Benefit: benefit,
            Taxable: taxable,
            Tax: tax,
            Final: final,
            NetBenefit: final,
            EligibilityStatus: benefit > 0 ? 'Eligible' : 'Not Eligible'
        });
    }

    if (!singleStaffMode) {
        return { rows, warnings };
    }

    return { rows, warnings };
}

function buildExGratiaPreviewRows(candidates, { previewDate, singleStaffMode = false }) {
    const rows = [];
    const warnings = [];

    for (const candidate of candidates) {
        const rowWarnings = [];
        if (!candidate.DOE) {
            rowWarnings.push('employment date is missing');
        }
        if (!(Number(candidate.MonthlyBasicSalary || 0) > 0)) {
            rowWarnings.push('basic salary is missing');
        }

        if (rowWarnings.length > 0) {
            warnings.push(`${candidate.PFNo}: ${rowWarnings.join(', ')}.`);
            continue;
        }

        const yearsServed = yearsBetween(candidate.DOE, previewDate);
        if (yearsServed === null) {
            warnings.push(`${candidate.PFNo}: unable to calculate years served.`);
            continue;
        }

        const age = candidate.DOB ? yearsBetween(candidate.DOB, previewDate) : null;
        const yearsLeftToEligibility = age === null ? null : Math.max(60 - age, 0);

        const monthlyBasicSalary = Number(candidate.MonthlyBasicSalary || 0);
        const annualBasicSalary = monthlyBasicSalary * 12;
        let exGratiaAmount = 0;

        if (yearsServed >= 20) {
            exGratiaAmount = annualBasicSalary * 2;
        } else if (yearsServed >= 15) {
            exGratiaAmount = annualBasicSalary;
        }

        const row = {
            PFNo: candidate.PFNo,
            SName: candidate.SName,
            Dept: candidate.CDept,
            DeptName: candidate.DeptName || candidate.CDept || 'Unknown Department',
            DateEmp: candidate.DOE,
            PreviewDate: previewDate,
            Age: age,
            YearsServed: yearsServed,
            YearsLeftToEligibility: yearsLeftToEligibility,
            MonthlyBasicSalary: monthlyBasicSalary,
            AnnualBasicSalary: annualBasicSalary,
            ExGratiaAmount: exGratiaAmount,
            Benefit: exGratiaAmount,
            Final: exGratiaAmount,
            Taxable: 0,
            Tax: 0,
            EligibilityStatus: exGratiaAmount > 0 ? 'Eligible' : 'Not Eligible'
        };

        if (!singleStaffMode && row.EligibilityStatus !== 'Eligible') {
            continue;
        }

        rows.push(row);
    }

    return { rows, warnings };
}

async function calculateEOSPreview(connection, {
    companyId,
    pfNo,
    department,
    previewDate
}) {
    const normalizedPreviewDate = buildPreviewDate(previewDate);
    const normalizedPfNo = normalizeOptionalText(pfNo);
    const normalizedDepartment = normalizeOptionalText(department);
    const singleStaffMode = Boolean(normalizedPfNo);

    const [params, candidates] = await Promise.all([
        getLatestEOSCalcParams(connection, companyId),
        getEOSCandidates(connection, {
            companyId,
            pfNo: normalizedPfNo,
            department: normalizedDepartment,
            previewDate: normalizedPreviewDate
        })
    ]);

    if (singleStaffMode && candidates.length === 0) {
        throw createError('PFNo was not found among active staff records.', 404);
    }

    const { rows, warnings } = buildEOSPreviewRows(candidates, {
        previewDate: normalizedPreviewDate,
        params,
        singleStaffMode
    });

    if (singleStaffMode && rows.length === 0 && warnings.length > 0) {
        throw createError(warnings[0], 400);
    }

    return {
        rows,
        warnings,
        previewDate: normalizedPreviewDate,
        filters: {
            pfNo: normalizedPfNo || '',
            department: normalizedDepartment || '',
            previewDate: normalizedPreviewDate
        }
    };
}

async function calculateExGratiaPreview(connection, {
    companyId,
    pfNo,
    department,
    previewDate
}) {
    const normalizedPreviewDate = buildPreviewDate(previewDate);
    const normalizedPfNo = normalizeOptionalText(pfNo);
    const normalizedDepartment = normalizeOptionalText(department);
    const singleStaffMode = Boolean(normalizedPfNo);

    const candidates = await getExGratiaCandidates(connection, {
        companyId,
        pfNo: normalizedPfNo,
        department: normalizedDepartment,
        previewDate: normalizedPreviewDate
    });

    if (singleStaffMode && candidates.length === 0) {
        throw createError('PFNo was not found among active staff records.', 404);
    }

    const { rows, warnings } = buildExGratiaPreviewRows(candidates, {
        previewDate: normalizedPreviewDate,
        singleStaffMode
    });

    if (singleStaffMode && rows.length === 0 && warnings.length > 0) {
        throw createError(warnings[0], 400);
    }

    return {
        rows,
        warnings,
        previewDate: normalizedPreviewDate,
        filters: {
            pfNo: normalizedPfNo || '',
            department: normalizedDepartment || '',
            previewDate: normalizedPreviewDate
        }
    };
}

module.exports = {
    calculateEOSPreview,
    calculateExGratiaPreview,
    getBenefitStatusPageData,
    getCompanyInfo
};
