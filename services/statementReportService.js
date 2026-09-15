const pool = require('../config/db');
const { normalizeLogoPath } = require('./brandingService');

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

function sanitizeFilenamePart(value) {
    return String(value || '')
        .replace(/[^a-z0-9\-_. ]/gi, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
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

function deduplicateRowsByPfNo(rows) {
    const seen = new Set();
    return rows.filter((row) => {
        const key = normalizeText(row && row.PFNo);
        if (!key || seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

async function getCompanyInfo(companyId) {
    const resolvedCompanyId = Number(companyId) || 1;
    const [rows] = await pool.query(
        `SELECT CompanyID, Com_Name, Address, Town, City, Country, Phone, Email, LogoPath, Logopath
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
        `SELECT CompanyID, Com_Name, Address, Town, City, Country, Phone, Email, LogoPath, Logopath
         FROM tblcominfo
         ORDER BY CompanyID ASC
         LIMIT 1`
    );

    const fallback = fallbackRows[0] || {};
    return {
        CompanyID: resolvedCompanyId,
        Com_Name: fallback.Com_Name || 'HR & Payroll',
        Address: fallback.Address || '',
        Town: fallback.Town || '',
        City: fallback.City || '',
        Country: fallback.Country || '',
        Phone: fallback.Phone || '',
        Email: fallback.Email || '',
        LogoPath: normalizeLogoPath(fallback.LogoPath || fallback.Logopath),
        fullAddress: buildDisplayAddress(fallback.Address, fallback.Town, fallback.City, fallback.Country)
    };
}

async function getReportSupportLookups(companyId) {
    const resolvedCompanyId = Number(companyId) || 1;
    const [departments, statuses] = await Promise.all([
        pool.query(
            `SELECT Code, Dept
             FROM tbldept
             WHERE CompanyID = ? OR CompanyID IS NULL
             ORDER BY Dept`,
            [resolvedCompanyId]
        ),
        pool.query(
            `SELECT Code, Status
             FROM tblstatus
             WHERE CompanyID = ? OR CompanyID IS NULL
             ORDER BY Status`,
            [resolvedCompanyId]
        )
    ]);

    return {
        departments: departments[0],
        statuses: statuses[0]
    };
}

async function assertStaffInCompany(companyId, pfNo) {
    const normalizedPfNo = normalizeOptionalText(pfNo);
    if (!normalizedPfNo) {
        throw new Error('PFNo is required when staff scope is Single Staff.');
    }

    const [rows] = await pool.query(
        `SELECT PFNo, SName
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

function buildStatementDefaults(filters = {}) {
    const today = new Date();
    return {
        statementType: ['NASSIT', 'GRATUITY'].includes(String(filters.statementType || '').toUpperCase())
            ? String(filters.statementType).toUpperCase()
            : 'NASSIT',
        staffScope: String(filters.staffScope || 'ALL').toUpperCase() === 'SINGLE' ? 'SINGLE' : 'ALL',
        pfNo: normalizeText(filters.pfNo),
        asAtDate: normalizeDateInput(filters.asAtDate, today.toISOString().slice(0, 10)),
        run: String(filters.run || '') === '1'
    };
}

async function getNassitGratuityReportData({ companyId, filters = {} }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalized = buildStatementDefaults(filters);
    const company = await getCompanyInfo(resolvedCompanyId);

    let selectedStaff = null;
    if (normalized.staffScope === 'SINGLE') {
        selectedStaff = await assertStaffInCompany(resolvedCompanyId, normalized.pfNo);
    }

    let rows = [];
    if (normalized.run) {
        const contributionColumnPair = normalized.statementType === 'NASSIT'
            ? ['NassitEmp', 'NassitInst']
            : ['GratEmp', 'GratInst'];
        const accountField = normalized.statementType === 'NASSIT' ? 's.NASSITNo' : 'NULL';
        const params = [resolvedCompanyId, normalized.asAtDate, resolvedCompanyId];
        let staffFilterSql = '';
        if (normalized.staffScope === 'SINGLE') {
            staffFilterSql = ' AND s.PFNo = ?';
            params.push(selectedStaff.PFNo);
        }

        const [statementRows] = await pool.query(
            `
                SELECT
                    s.PFNo,
                    s.SName,
                    ${accountField} AS AccountReference,
                    d.Dept AS DeptName,
                    st.Status AS StatusName,
                    SUM(COALESCE(p.${contributionColumnPair[0]}, 0)) AS EmployeeContribution,
                    SUM(COALESCE(p.${contributionColumnPair[1]}, 0)) AS EmployerContribution,
                    SUM(COALESCE(p.${contributionColumnPair[0]}, 0) + COALESCE(p.${contributionColumnPair[1]}, 0)) AS Balance
                FROM tblpayroll p
                INNER JOIN tblstaff s
                    ON s.PFNo = p.PFNo
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                   AND (d.CompanyID = s.CompanyID OR d.CompanyID IS NULL)
                LEFT JOIN tblstatus st
                    ON st.Code = s.EmpStatus
                   AND (st.CompanyID = s.CompanyID OR st.CompanyID IS NULL)
                WHERE p.CompanyID = ?
                  AND DATE(COALESCE(p.PDate, p.SalDate)) <= ?
                  AND p.Approved IN (-1, 1)
                  AND (
                        NOT EXISTS (
                            SELECT 1
                            FROM payroll_workflow_batches wb_any
                            WHERE wb_any.CompanyID = p.CompanyID
                              AND wb_any.PMonth = p.PMonth
                              AND wb_any.PYear = p.PYear
                              AND wb_any.PType = p.PType
                        )
                        OR EXISTS (
                            SELECT 1
                            FROM payroll_workflow_batches wb_effective
                            WHERE wb_effective.id = (
                                SELECT wb_latest.id
                                FROM payroll_workflow_batches wb_latest
                                WHERE wb_latest.CompanyID = p.CompanyID
                                  AND wb_latest.PMonth = p.PMonth
                                  AND wb_latest.PYear = p.PYear
                                  AND wb_latest.PType = p.PType
                                ORDER BY COALESCE(wb_latest.GenerationNo, 1) DESC, wb_latest.id DESC
                                LIMIT 1
                            )
                              AND wb_effective.Status <> 'REVERSED'
                        )
                  )
                  AND (s.CompanyID = ? OR s.CompanyID IS NULL)
                  ${staffFilterSql}
                GROUP BY s.PFNo, s.SName, AccountReference, d.Dept, st.Status
                HAVING SUM(COALESCE(p.${contributionColumnPair[0]}, 0) + COALESCE(p.${contributionColumnPair[1]}, 0)) <> 0
                ORDER BY s.SName ASC, s.PFNo ASC
            `,
            params
        );

        rows = statementRows.map((row, index) => ({
            ...row,
            RowNo: index + 1
        }));
    }

    const totalBalance = rows.reduce((sum, row) => sum + Number(row.Balance || 0), 0);
    const statementPages = chunkRows(rows, 28).map((pageRows, index, pageList) => ({
        pageNumber: index + 1,
        totalPages: pageList.length,
        rows: pageRows,
        totalBalance: index === pageList.length - 1 ? totalBalance : null
    }));
    const title = normalized.statementType === 'NASSIT'
        ? 'SUMMARY OF NASSIT ACCOUNT BALANCES'
        : 'SUMMARY OF GRATUITY ACCOUNT BALANCES';

    return {
        company,
        report: {
            generated: normalized.run,
            statementType: normalized.statementType,
            title,
            subtitle: `As at ${formatShortDate(normalized.asAtDate)}`,
            asAtDate: normalized.asAtDate,
            asAtDateLabel: formatShortDate(normalized.asAtDate),
            printDateLabel: formatLongDate(new Date()),
            sourceSummary: normalized.statementType === 'NASSIT'
                ? 'Balance is derived from cumulative approved payroll contributions: NassitEmp + NassitInst, excluding reversed payroll generations.'
                : 'Balance is derived from cumulative approved payroll contributions: GratEmp + GratInst, excluding reversed payroll generations.'
        },
        filters: normalized,
        selectedStaff,
        rows,
        pages: statementPages,
        totals: {
            totalBalance
        },
        filenames: {
            pdf: sanitizeFilenamePart(
                `${normalized.statementType}-Statement-${normalized.staffScope === 'SINGLE' && selectedStaff ? `${selectedStaff.PFNo}-${selectedStaff.SName}` : 'All-Staff'}-${normalized.asAtDate}`
            ) + '.pdf'
        }
    };
}

function buildBioDataDefaults(filters = {}) {
    const today = new Date();
    return {
        staffScope: String(filters.staffScope || 'ALL').toUpperCase() === 'SINGLE' ? 'SINGLE' : 'ALL',
        pfNo: normalizeText(filters.pfNo),
        includeDependants: String(filters.includeDependants || '') === '1',
        reportDate: normalizeDateInput(filters.reportDate, today.toISOString().slice(0, 10)),
        run: String(filters.run || '') === '1'
    };
}

async function getBioDataReportData({ companyId, filters = {} }) {
    const resolvedCompanyId = Number(companyId) || 1;
    const normalized = buildBioDataDefaults(filters);
    const [company, lookups] = await Promise.all([
        getCompanyInfo(resolvedCompanyId),
        getReportSupportLookups(resolvedCompanyId)
    ]);

    let selectedStaff = null;
    if (normalized.staffScope === 'SINGLE') {
        selectedStaff = await assertStaffInCompany(resolvedCompanyId, normalized.pfNo);
    }

    let rows = [];
    if (normalized.run) {
        const params = [resolvedCompanyId];
        let singleFilter = '';
        if (normalized.staffScope === 'SINGLE') {
            singleFilter = ' AND s.PFNo = ?';
            params.push(selectedStaff.PFNo);
        }

        const [staffRows] = await pool.query(
            `
                SELECT
                    s.PFNo,
                    s.SName,
                    s.DOB,
                    s.DOE,
                    s.DateConfirmed,
                    s.SexCode,
                    sex.Status AS Gender,
                    s.MStatus,
                    ms.Status AS MaritalStatus,
                    s.Address,
                    s.City,
                    s.Phone,
                    s.Email,
                    s.NKin,
                    s.NKinAddr,
                    s.NKinPhone,
                    s.NKinRelationship,
                    rel.Relation AS NextOfKinRelationshipLabel,
                    s.EmpType,
                    s.Level,
                    s.AccountNo,
                    s.NASSITNo,
                    s.Professional,
                    prof.QType AS ProfessionalSkillLabel,
                    s.Academic,
                    s.CDept,
                    dept.Dept AS DepartmentName,
                    s.JobTitle,
                    jt.JobTitle AS JobTitleName,
                    s.CGrade,
                    grade.Grade AS GradeName,
                    s.EmpStatus,
                    status.Status AS StatusName,
                    s.NationCode,
                    nation.Nation AS Nationality
                FROM tblstaff s
                LEFT JOIN tblsex sex
                    ON sex.SexCode = s.SexCode
                   AND (sex.CompanyID = s.CompanyID OR sex.CompanyID IS NULL)
                LEFT JOIN tblmstatus ms
                    ON ms.Code = s.MStatus
                   AND (ms.CompanyID = s.CompanyID OR ms.CompanyID IS NULL)
                LEFT JOIN tblrelation rel
                    ON rel.RCode = s.NKinRelationship
                   AND (rel.CompanyID = s.CompanyID OR rel.CompanyID IS NULL)
                LEFT JOIN tblqualiftype prof
                    ON prof.Code = s.Professional
                   AND (prof.CompanyID = s.CompanyID OR prof.CompanyID IS NULL)
                LEFT JOIN tbldept dept
                    ON dept.Code = s.CDept
                   AND (dept.CompanyID = s.CompanyID OR dept.CompanyID IS NULL)
                LEFT JOIN tbljobtitle jt
                    ON jt.Code = s.JobTitle
                   AND (jt.CompanyID = s.CompanyID OR jt.CompanyID IS NULL)
                LEFT JOIN tblgrade grade
                    ON grade.GradeCode = s.CGrade
                   AND (grade.CompanyID = s.CompanyID OR grade.CompanyID IS NULL)
                LEFT JOIN tblstatus status
                    ON status.Code = s.EmpStatus
                   AND (status.CompanyID = s.CompanyID OR status.CompanyID IS NULL)
                LEFT JOIN tblnation nation
                    ON nation.NationCode = s.NationCode
                   AND (nation.CompanyID = s.CompanyID OR nation.CompanyID IS NULL)
                WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
                  ${singleFilter}
                ORDER BY s.SName ASC, s.PFNo ASC
            `,
            params
        );

        const uniqueStaffRows = deduplicateRowsByPfNo(staffRows);
        const pfNos = uniqueStaffRows.map((row) => row.PFNo);
        const qualificationMap = new Map();
        const dependantMap = new Map();

        if (pfNos.length) {
            const qualificationPlaceholders = pfNos.map(() => '?').join(', ');
            const [qualificationRows] = await pool.query(
                `
                    SELECT
                        q.PFNo,
                        q.Code,
                        q.QName,
                        qt.QType
                    FROM tblqualif q
                    LEFT JOIN tblqualiftype qt
                        ON qt.Code = q.Code
                       AND (qt.CompanyID = q.CompanyID OR qt.CompanyID IS NULL)
                    WHERE q.PFNo IN (${qualificationPlaceholders})
                      AND (q.CompanyID = ? OR q.CompanyID IS NULL)
                    ORDER BY q.PFNo ASC, q.Code ASC, q.QName ASC
                `,
                [...pfNos, resolvedCompanyId]
            );

            for (const row of qualificationRows) {
                const list = qualificationMap.get(row.PFNo) || [];
                list.push(row.QType ? `${row.QType} - ${row.QName}` : row.QName);
                qualificationMap.set(row.PFNo, list);
            }

            if (normalized.includeDependants) {
                const [dependantRows] = await pool.query(
                    `
                        SELECT
                            d.PFNo,
                            d.DepNo,
                            d.Dependant,
                            d.RCode,
                            r.Relation,
                            d.PhoneNo,
                            d.DOB,
                            d.Closed
                        FROM tbldependant d
                        LEFT JOIN tblrelation r
                            ON r.RCode = d.RCode
                           AND (r.CompanyID = d.CompanyID OR r.CompanyID IS NULL)
                        WHERE d.PFNo IN (${qualificationPlaceholders})
                          AND (d.CompanyID = ? OR d.CompanyID IS NULL)
                          AND COALESCE(d.Closed, 0) = 0
                          AND d.Approved IN (-1, 1)
                        ORDER BY d.PFNo ASC, CAST(d.DepNo AS UNSIGNED) ASC, d.DepNo ASC
                    `,
                    [...pfNos, resolvedCompanyId]
                );

                for (const row of dependantRows) {
                    const list = dependantMap.get(row.PFNo) || [];
                    list.push(row);
                    dependantMap.set(row.PFNo, list);
                }
            }
        }

        rows = uniqueStaffRows.map((row) => ({
            ...row,
            Qualifications: qualificationMap.get(row.PFNo) || [],
            ProfessionalSkill: row.ProfessionalSkillLabel || row.Professional || null,
            NextOfKinRelationship: row.NextOfKinRelationshipLabel || row.NKinRelationship || null,
            Dependants: dependantMap.get(row.PFNo) || []
        }));
    }

    const bioPages = (rows.length ? rows : [null]).map((row, index, pageList) => ({
        pageNumber: index + 1,
        totalPages: pageList.length,
        row,
        pageLabel: row ? `PFNo ${row.PFNo} — ${row.SName || 'Staff'}` : 'No staff data'
    }));

    return {
        company,
        lookups,
        report: {
            generated: normalized.run,
            reportDate: normalized.reportDate,
            reportDateLabel: formatShortDate(normalized.reportDate),
            printDateLabel: formatLongDate(new Date()),
            title: 'BIO DATA REPORT'
        },
        filters: normalized,
        selectedStaff,
        rows,
        pages: bioPages,
        filenames: {
            pdf: sanitizeFilenamePart(
                normalized.staffScope === 'SINGLE' && selectedStaff
                    ? `Bio-Data-${selectedStaff.PFNo}-${selectedStaff.SName}`
                    : `Bio-Data-All-Staff-${normalized.reportDate}`
            ) + '.pdf'
        }
    };
}

module.exports = {
    getBioDataReportData,
    getNassitGratuityReportData
};
