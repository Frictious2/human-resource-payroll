const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const COMPANY_ID = 1;
const PFNOS = ['0489', '0496', '0692', '0520', '0684', '0587'];
const EXPECTED_TOTALS = {
    salary: 50840.69,
    allowances: 77508.20,
    gross: 128348.89,
    taxable: 125806.85,
    tax: 35582.06,
    nassitEmp: 2542.04,
    net: 85140.72
};

function round2(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function assert(condition, message) {
    if (!condition) {
        const error = new Error(message);
        error.isAssertion = true;
        throw error;
    }
}

function assertMoney(actual, expected, label) {
    const diff = round2(actual) - round2(expected);
    assert(Math.abs(diff) <= 0.01, `${label} expected ${expected}, got ${actual}`);
}

async function query(sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows;
}

async function main() {
    const placeholders = PFNOS.map(() => '?').join(', ');

    const staffRows = await query(
        `SELECT PFNo, SName, CompanyID, Approved, ApprovedBy, DateApproved, TimeApproved, CGrade, GradeCode, Notch, JobTitle
         FROM tblstaff
         WHERE CompanyID = ? AND PFNo IN (${placeholders})
         ORDER BY PFNo`,
        [COMPANY_ID, ...PFNOS]
    );

    const entitlementRows = await query(
        `SELECT PFNo, CompanyID, Approved, ApprovedBy, DateApproved, TimeApproved, Salary,
                Allw03, Allw06, Allw07, Allw10, Allw11, Allw12, Allw14, Allw16, Allw17, Allw19
         FROM tblentitle
         WHERE CompanyID = ? AND PFNo IN (${placeholders})
         ORDER BY PFNo`,
        [COMPANY_ID, ...PFNOS]
    );

    const salaryRows = await query(
        `SELECT PFNo, CompanyID, Approved, ApprovedBy, DateApproved, TimeApproved, PDate, Grade, JobTitle,
                Salary, Allw03, Allw06, Allw07, Allw10, Allw11, Allw12, Allw14, Allw16, Allw17, Allw19,
                TotAllw, TotalIncome, Taxable, Tax, NassitEmp, NetIncome
         FROM tblsalary
         WHERE CompanyID = ? AND PFNo IN (${placeholders})
         ORDER BY PFNo`,
        [COMPANY_ID, ...PFNOS]
    );

    const salaryTotals = await query(
        `SELECT
            ROUND(SUM(Salary), 2) AS salary,
            ROUND(SUM(TotAllw), 2) AS allowances,
            ROUND(SUM(TotalIncome), 2) AS gross,
            ROUND(SUM(Taxable), 2) AS taxable,
            ROUND(SUM(Tax), 2) AS tax,
            ROUND(SUM(NassitEmp), 2) AS nassitEmp,
            ROUND(SUM(NetIncome), 2) AS net
         FROM tblsalary
         WHERE CompanyID = ? AND PFNo IN (${placeholders})`,
        [COMPANY_ID, ...PFNOS]
    );

    const auditRows = await query(
        `SELECT AuditTrailID, ChangeDate, UserName, FormName, Action, RecordID, FieldName, OldValue, NewValue, CompanyID
         FROM tblaudittrail
         WHERE CompanyID = ?
           AND RecordID IN (${placeholders})
           AND ChangeDate >= '2026-10-08'
           AND (
             FormName IN ('manager/approve/new-staff', 'manager/approve/entitlement', 'manager/approve/salary')
             OR FormName LIKE '%approve%'
           )
         ORDER BY ChangeDate, AuditTrailID`,
        [COMPANY_ID, ...PFNOS]
    );

    const workflowRows = await query(
        `SELECT id, CompanyID, PMonth, PYear, PType, GenerationNo, Status, TotalStaff, TotalBasic,
                TotalAllowances, TotalGross, TotalTaxable, TotalTax, TotalNassitEmployee, TotalNet,
                PostedToAccountsBy, PostedToAccountsAt
         FROM payroll_workflow_batches
         WHERE CompanyID = ? AND PMonth = 8 AND PYear = 2026 AND PType = '01'
         ORDER BY GenerationNo, id`,
        [COMPANY_ID]
    );

    const payrollRows = await query(
        `SELECT PFNo, CompanyID, PMonth, PYear, PType, Salary, TotalIncome, Taxable, Tax, NassitEmp, NetIncome,
                Approved, ApprovedBy, posted_to_gl, gl_posted_batch_id, gl_posted_at, GlPostedBatchId, GlPostedAt
         FROM tblpayroll
         WHERE CompanyID = ? AND PMonth = 8 AND PYear = 2026 AND PType = '01'
         ORDER BY PFNo`,
        [COMPANY_ID]
    );

    const payrollTotals = await query(
        `SELECT COUNT(*) AS rowCount,
                ROUND(SUM(Salary), 2) AS salary,
                ROUND(SUM(TotalIncome), 2) AS gross,
                ROUND(SUM(Taxable), 2) AS taxable,
                ROUND(SUM(Tax), 2) AS tax,
                ROUND(SUM(NassitEmp), 2) AS nassitEmp,
                ROUND(SUM(NetIncome), 2) AS net,
                SUM(CASE WHEN COALESCE(posted_to_gl, 0) <> 0 THEN 1 ELSE 0 END) AS postedRows,
                SUM(CASE WHEN gl_posted_batch_id IS NOT NULL OR GlPostedBatchId IS NOT NULL THEN 1 ELSE 0 END) AS linkedRows
         FROM tblpayroll
         WHERE CompanyID = ? AND PMonth = 8 AND PYear = 2026 AND PType = '01'`,
        [COMPANY_ID]
    );

    const postingBatches = await query(
        `SELECT *
         FROM payroll_gl_posting_batches
         WHERE company_id = ? AND posting_month = 8 AND posting_year = 2026 AND activity_code = '01'
         ORDER BY id`,
        [COMPANY_ID]
    );

    const legacyGlRows = await query(
        `SELECT *
         FROM tblgltrans
         WHERE CompanyID = ? AND GLMonth = '8' AND GLYear = '2026'`,
        [COMPANY_ID]
    );

    const controllerSource = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'managerController.js'), 'utf8');
    const futureAuditPatchPresent = {
        salary: /table:\s*'tblsalary'[\s\S]*formName:\s*'manager\/approve\/salary'/.test(controllerSource),
        entitlement: /table:\s*'tblentitle'[\s\S]*formName:\s*'manager\/approve\/entitlement'/.test(controllerSource),
        transactionalHelper: /async function auditApprovalUpdate/.test(controllerSource)
            && /beginTransaction\(\)/.test(controllerSource)
            && /writeAuditEntryWithExecutor/.test(controllerSource)
    };

    assert(staffRows.length === PFNOS.length, 'Expected all six staff rows.');
    assert(entitlementRows.length === PFNOS.length, 'Expected all six entitlement rows.');
    assert(salaryRows.length === PFNOS.length, 'Expected all six salary rows.');
    assert(staffRows.every((row) => Number(row.CompanyID) === COMPANY_ID && Number(row.Approved) === 1), 'All staff rows must be approved for CompanyID 1.');
    assert(entitlementRows.every((row) => Number(row.CompanyID) === COMPANY_ID && Number(row.Approved) === -1), 'All entitlement rows must be approved for CompanyID 1.');
    assert(salaryRows.every((row) => Number(row.CompanyID) === COMPANY_ID && Number(row.Approved) === -1), 'All salary rows must be approved for CompanyID 1.');

    for (const [key, expected] of Object.entries(EXPECTED_TOTALS)) {
        assertMoney(salaryTotals[0][key], expected, `Approved salary total ${key}`);
    }

    assert(workflowRows.some((row) => Number(row.id) === 161 && row.Status === 'PROCESSED'), 'August workflow batch 161 must remain PROCESSED.');
    assert(Number(payrollTotals[0].postedRows || 0) === 0, 'August payroll rows must not be marked posted_to_gl.');
    assert(Number(payrollTotals[0].linkedRows || 0) === 0, 'August payroll rows must not be linked to a GL posting batch.');
    assert(postingBatches.length === 0, 'No modern GL posting batch should exist for August 2026 salary.');
    assert(futureAuditPatchPresent.salary, 'Future salary approval audit logging patch is missing.');
    assert(futureAuditPatchPresent.entitlement, 'Future entitlement approval audit logging patch is missing.');
    assert(futureAuditPatchPresent.transactionalHelper, 'Transactional approval audit helper is missing.');

    const staffApprovalAuditRows = auditRows.filter((row) => row.FormName === 'manager/approve/new-staff' && row.FieldName === 'Approved');
    const entitlementAuditRows = auditRows.filter((row) => row.FormName === 'manager/approve/entitlement');
    const salaryAuditRows = auditRows.filter((row) => row.FormName === 'manager/approve/salary');

    const legacyGlClassification = legacyGlRows.length === 1
        && Number(legacyGlRows[0].Approved) === 0
        && round2(legacyGlRows[0].SalaryWages) === round2(payrollTotals[0].net)
        && round2(legacyGlRows[0].IncomeTax) === round2(payrollTotals[0].tax)
        ? 'RELATED_LEGACY_PROCESSING_SUMMARY_UNAPPROVED'
        : 'UNRESOLVED';

    const result = {
        generatedAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        pfNos: PFNOS,
        approvals: {
            staffRows,
            entitlementRows,
            salaryRows,
            approvedSalaryTotals: salaryTotals[0],
            expectedTotals: EXPECTED_TOTALS
        },
        auditTrail: {
            rows: auditRows,
            staffApprovalAuditRows: staffApprovalAuditRows.length,
            entitlementApprovalAuditRows: entitlementAuditRows.length,
            salaryApprovalAuditRows: salaryAuditRows.length,
            historicalApprovalEvidence: entitlementAuditRows.length === PFNOS.length && salaryAuditRows.length === PFNOS.length
                ? 'VERIFIED'
                : 'INCOMPLETE',
            futureAuditPatchPresent
        },
        augustPayroll: {
            workflowRows,
            payrollRows,
            payrollTotals: payrollTotals[0],
            postingBatches,
            legacyGlRows,
            legacyGlClassification,
            safeToReopen: legacyGlClassification === 'RELATED_LEGACY_PROCESSING_SUMMARY_UNAPPROVED'
                ? 'REQUIRES_AUTHORIZATION_AND_LEGACY_GL_REVIEW'
                : 'NO'
        }
    };

    const outputPath = path.join(__dirname, '..', 'docs', 'test-results', 'waec-approval-audit-and-august-gl-review-latest.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);

    console.log(`WAEC approval audit and August GL review evidence written to ${outputPath}`);
    console.log(JSON.stringify({
        staffApprovalAuditRows: staffApprovalAuditRows.length,
        entitlementApprovalAuditRows: entitlementAuditRows.length,
        salaryApprovalAuditRows: salaryAuditRows.length,
        legacyGlClassification,
        futureAuditPatchPresent,
        safeToReopen: result.augustPayroll.safeToReopen
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = error.isAssertion ? 2 : 1;
    })
    .finally(async () => {
        await pool.end();
    });
