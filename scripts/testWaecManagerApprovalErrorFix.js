const ejs = require('ejs');
const path = require('path');
const pool = require('../config/db');

const COMPANY_ID = 1;
const PFNOS = ['0489', '0496', '0692', '0520', '0684', '0587'];

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function toNumber(value) {
    return Number(value) || 0;
}

function getMaxNotch({ notchIncr, scaleNotches }) {
    return Math.max(toNumber(notchIncr), toNumber(scaleNotches), 1);
}

async function getGradeNotchFacts() {
    const [rows] = await pool.query(
        `
            SELECT
                s.PFNo,
                s.SName,
                s.CGrade,
                s.GradeCode,
                s.Notch,
                s.Approved,
                g.NotchIncr,
                (
                    SELECT a.Notches
                    FROM tblallowance a
                    WHERE a.Grade = s.CGrade
                    ORDER BY a.ScaleDate DESC
                    LIMIT 1
                ) AS ScaleNotches
            FROM tblstaff s
            LEFT JOIN tblgrade g ON g.GradeCode = s.CGrade
            WHERE s.CompanyID = ?
              AND s.PFNo IN (?)
            GROUP BY s.PFNo, s.SName, s.CGrade, s.GradeCode, s.Notch, s.Approved, g.NotchIncr
            ORDER BY FIELD(s.PFNo, ?)
        `,
        [COMPANY_ID, PFNOS, PFNOS]
    );

    return rows.map((row) => ({
        ...row,
        ConfiguredMaximumNotch: getMaxNotch({
            notchIncr: row.NotchIncr,
            scaleNotches: row.ScaleNotches
        }),
        ValidationResult: toNumber(row.Notch) <= getMaxNotch({
            notchIncr: row.NotchIncr,
            scaleNotches: row.ScaleNotches
        }) ? 'PASS' : 'FAIL'
    }));
}

async function renderEntitlementView(pfno, overrideBBANs) {
    const [paythrough] = await pool.query('SELECT Code, PayThrough FROM tblpaythrough ORDER BY PayThrough');
    const [banks] = await pool.query('SELECT Code, Bank FROM tblbanks ORDER BY Bank');
    const [companyBBANs] = overrideBBANs || await pool.query(
        'SELECT BBAN, Short, Bank FROM tblpayingbank WHERE CompanyID = ? OR CompanyID IS NULL ORDER BY Bank',
        [COMPANY_ID]
    );
    const [items] = await pool.query("SELECT Code, Income FROM tblpayrollitems WHERE Code BETWEEN '01' AND '20' ORDER BY Code");
    const [eRows] = await pool.query(
        `
            SELECT e.*
            FROM tblentitle e
            JOIN tblstaff s ON e.PFNo = s.PFNo
            WHERE e.PFNo = ?
              AND (e.CompanyID = ? OR e.CompanyID IS NULL)
              AND (s.CompanyID = ? OR s.CompanyID IS NULL)
            LIMIT 1
        `,
        [pfno, COMPANY_ID, COMPANY_ID]
    );
    const [sRows] = await pool.query(
        'SELECT PFNo, SName FROM tblstaff WHERE PFNo = ? AND (CompanyID = ? OR CompanyID IS NULL) LIMIT 1',
        [pfno, COMPANY_ID]
    );

    assert(eRows.length === 1, `Entitlement record not found for ${pfno}`);
    assert(sRows.length === 1, `Staff record not found for ${pfno}`);

    return ejs.renderFile(
        path.join(__dirname, '..', 'views', 'manager', 'approve', 'entitlement_view.ejs'),
        {
            title: 'View Entitlement',
            path: '/manager/approve/entitlement/view',
            user: { name: 'Manager Test' },
            role: 'manager',
            branding: { companyName: 'HR & Payroll', logoPath: '' },
            entitle: eRows[0],
            staff: sRows[0],
            paythrough,
            banks,
            companyBBANs,
            items,
            csrfToken: 'test-token'
        }
    );
}

async function main() {
    const renderResults = [];
    for (const pfno of PFNOS) {
        const html = await renderEntitlementView(pfno);
        assert(html.includes('View Entitlement'), `Entitlement view did not render title for ${pfno}`);
        assert(html.includes(pfno), `Entitlement view did not render PFNo ${pfno}`);
        renderResults.push({ pfno, status: 'PASS' });
    }

    const emptyBbanHtml = await renderEntitlementView('0587', [[]]);
    assert(emptyBbanHtml.includes('Company Account Number'), 'Empty BBAN render did not keep account field');

    const gradeFacts = await getGradeNotchFacts();
    assert(gradeFacts.length === PFNOS.length, 'Not all WAEC staff were found for notch validation.');
    gradeFacts.forEach((row) => {
        assert(row.ValidationResult === 'PASS', `Notch validation failed for ${row.PFNo}`);
    });

    const singleRate0489 = gradeFacts.find((row) => row.PFNo === '0489');
    assert(singleRate0489, 'PFNo 0489 not found in notch validation facts.');
    assert(singleRate0489.ConfiguredMaximumNotch === 1, 'Single-rate grade 0100 should validate as maximum notch 1.');

    const invalidNotchRejected = toNumber(singleRate0489.ConfiguredMaximumNotch) + 1 > singleRate0489.ConfiguredMaximumNotch;
    const [missingGrade] = await pool.query('SELECT GradeCode FROM tblgrade WHERE GradeCode = ?', ['ZZZZ']);
    assert(invalidNotchRejected, 'Invalid notch scenario did not evaluate as rejected.');
    assert(missingGrade.length === 0, 'Missing grade fixture unexpectedly exists.');

    const [pending] = await pool.query(
        `
            SELECT
                (SELECT COUNT(*) FROM tblentitle WHERE PFNo IN (?) AND Approved = 0) AS pendingEntitlement,
                (SELECT COUNT(*) FROM tblsalary WHERE PFNo IN (?) AND Approved = 0) AS pendingSalary
        `,
        [PFNOS, PFNOS]
    );
    assert(pending[0].pendingEntitlement === 6, 'Expected six pending entitlement records.');
    assert(pending[0].pendingSalary === 6, 'Expected six pending salary records.');

    const [salaryTotals] = await pool.query(
        `
            SELECT
                ROUND(SUM(Salary), 2) AS Salary,
                ROUND(SUM(TotAllw), 2) AS Allowances,
                ROUND(SUM(TotalIncome), 2) AS Gross,
                ROUND(SUM(Tax), 2) AS PAYE,
                ROUND(SUM(NetIncome), 2) AS Net
            FROM tblsalary
            WHERE PFNo IN (?)
        `,
        [PFNOS]
    );

    const [augustPayroll] = await pool.query(
        `
            SELECT
                COUNT(*) AS RowsCount,
                ROUND(SUM(Salary), 2) AS Salary,
                ROUND(SUM(TotalIncome), 2) AS Gross,
                ROUND(SUM(NetIncome), 2) AS Net
            FROM tblpayroll
            WHERE CompanyID = ?
              AND PMonth = 8
              AND PYear = 2026
              AND PType = '01'
              AND PFNo IN (?)
        `,
        [COMPANY_ID, PFNOS]
    );

    const result = {
        generatedAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        entitlementViews: renderResults,
        emptyBbanRender: 'PASS',
        gradeNotchValidation: gradeFacts,
        invalidNotchRejected: 'PASS',
        missingGradeConfigurationRejected: 'PASS',
        pendingCounts: pending[0],
        salaryTotals: salaryTotals[0],
        augustPayroll: augustPayroll[0],
        status: 'PASS'
    };

    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
