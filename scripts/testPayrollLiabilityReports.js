const assert = require('assert');
const crypto = require('crypto');
const ejs = require('ejs');
const path = require('path');
const signature = require('cookie-signature');
const pool = require('../config/db');
const reportService = require('../services/payrollLiabilityReportService');
const { SESSION_COOKIE_NAME, SESSION_TABLE, getSessionSecret } = require('../config/sessionStore');

const TEST_BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';

async function renderView(relativePath, data) {
    const viewPath = path.join(process.cwd(), relativePath);
    return ejs.renderFile(viewPath, data, { async: true });
}

async function createFinanceSessionCookie({ companyId, userId }) {
    const sessionId = crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + (2 * 60 * 60 * 1000));
    const expiresEpochSeconds = Math.floor(expiresAt.getTime() / 1000);
    const payload = {
        cookie: {
            originalMaxAge: 2 * 60 * 60 * 1000,
            expires: expiresAt.toISOString(),
            secure: false,
            httpOnly: true,
            path: '/',
            sameSite: 'lax'
        },
        user: {
            id: userId,
            pfno: '900001',
            username: 'finance.test',
            email: 'finance.test@example.com',
            name: 'Finance Officer',
            fullName: 'Finance Officer',
            role: 'finance-officer',
            companyId,
            source: 'tblpassword'
        },
        companyId,
        CompanyID: companyId
    };

    await pool.execute(
        `REPLACE INTO ${SESSION_TABLE} (session_id, expires, data)
         VALUES (?, ?, ?)`,
        [sessionId, expiresEpochSeconds, JSON.stringify(payload)]
    );

    const signed = `s:${signature.sign(sessionId, getSessionSecret({ isProduction: false }))}`;
    return {
        sessionId,
        cookieHeader: `${SESSION_COOKIE_NAME}=${encodeURIComponent(signed)}`
    };
}

async function destroySession(sessionId) {
    await pool.execute(
        `DELETE FROM ${SESSION_TABLE} WHERE session_id = ?`,
        [sessionId]
    );
}

async function request(pathname, options = {}) {
    return fetch(`${TEST_BASE_URL}${pathname}`, {
        redirect: 'manual',
        ...options
    });
}

async function resolveTestPfNo(companyId) {
    if (process.env.TEST_PFNO) {
        return process.env.TEST_PFNO;
    }

    const [rows] = await pool.query(
        `
            SELECT s.PFNo
            FROM tblstaff s
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND EXISTS (
                  SELECT 1
                  FROM tblpayroll p
                  WHERE p.PFNo = s.PFNo
                    AND (p.CompanyID = ? OR p.CompanyID IS NULL)
                    AND COALESCE(p.Tax, 0) <> 0
              )
            ORDER BY s.PFNo
            LIMIT 1
        `,
        [companyId, companyId]
    );

    if (!rows.length) {
        const error = new Error('Payroll Liability test requires at least one company-scoped staff record with PAYE payroll rows.');
        error.statusCode = 404;
        throw error;
    }

    return rows[0].PFNo;
}

async function main() {
    const companyId = Number(process.env.TEST_COMPANY_ID || 1);
    const pfNo = await resolveTestPfNo(companyId);

    const financeIndex = await reportService.getFinanceIndexPageData({ companyId });
    assert.ok(financeIndex.company.Com_Name, 'Finance liabilities page should load company information.');
    assert.ok(financeIndex.liabilityTypeOptions.some((option) => option.value === 'PAYE' && option.supported), 'PAYE must be supported.');
    assert.ok(financeIndex.liabilityTypeOptions.some((option) => option.value === 'EOS' && option.supported), 'EOS Benefit must be supported.');
    assert.ok(financeIndex.liabilityTypeOptions.some((option) => option.value === 'NASSIT' && option.supported), 'NASSIT must be supported.');
    assert.ok(!financeIndex.liabilityTypeOptions.some((option) => option.value === 'WHT'), 'WHT must be absent from the visible selector.');
    assert.ok(!financeIndex.liabilityTypeOptions.some((option) => option.value === 'LEAVE_TAX'), 'Leave Tax must be absent from the visible selector.');

    const payeData = await reportService.getPayrollLiabilityReportData({
        companyId,
        filters: { liabilityType: 'PAYE', fromDate: '2025-12-01', toDate: '2026-03-31' }
    });
    assert.equal(payeData.report.liabilityType, 'PAYE');
    assert.ok(Array.isArray(payeData.pages) && payeData.pages.length >= 1, 'PAYE report should expose logical pages.');

    const nassitData = await reportService.getPayrollLiabilityReportData({
        companyId,
        filters: { liabilityType: 'NASSIT', fromDate: '2025-12-01', toDate: '2026-03-31' }
    });
    assert.equal(nassitData.report.liabilityType, 'NASSIT');

    const eosData = await reportService.getPayrollLiabilityReportData({
        companyId,
        filters: { liabilityType: 'EOS', fromDate: '2025-12-01', toDate: '2026-03-31' }
    });
    assert.equal(eosData.report.liabilityType, 'EOS');
    assert.ok(eosData.report.emptyMessage, 'EOS report should provide a clean empty state even when no rows exist.');

    await assert.rejects(
        () => reportService.getPayrollLiabilityReportData({
            companyId,
            filters: { liabilityType: 'WHT', fromDate: '2025-12-01', toDate: '2026-03-31' }
        }),
        /Unsupported liability type/,
        'Direct WHT requests should be rejected cleanly.'
    );

    await assert.rejects(
        () => reportService.getPayrollLiabilityReportData({
            companyId,
            filters: { liabilityType: 'LEAVE_TAX', fromDate: '2025-12-01', toDate: '2026-03-31' }
        }),
        /Unsupported liability type/,
        'Direct Leave Tax requests should be rejected cleanly.'
    );

    const staffData = await reportService.getStaffPayeStatementData({
        companyId,
        filters: { pfNo, fromDate: '2025-12-01', toDate: '2026-03-31' }
    });
    assert.equal(staffData.staff.PFNo, pfNo, 'Staff PAYE statement must stay scoped to the requested PFNo.');
    assert.ok(Array.isArray(staffData.pages) && staffData.pages.length >= 1, 'Staff PAYE statement should expose logical pages.');

    const renderedIndex = await renderView('views/reports/payroll_liabilities/index.ejs', {
        title: 'Payroll Liabilities',
        path: '/finance/reports/payroll-liabilities',
        user: { name: 'Finance Officer' },
        branding: { companyName: financeIndex.company.Com_Name, logoPath: financeIndex.company.LogoPath },
        partialsBase: 'finance/partials',
        dashboardPath: '/finance/dashboard',
        workspaceLabel: 'Finance Officer',
        pageData: financeIndex
    });
    assert.ok(renderedIndex.includes('target="_blank"'), 'Preview forms must open generated reports in a new tab.');
    assert.ok(renderedIndex.includes('Staff PAYE Statement of Account'), 'The Staff PAYE modal should be available on the index page.');
    assert.ok(renderedIndex.includes('PAYE'));
    assert.ok(renderedIndex.includes('EOS Benefit'));
    assert.ok(renderedIndex.includes('NASSIT'));
    assert.ok(!renderedIndex.includes('WHT - Withholding Tax'), 'WHT must not appear in the selector UI.');
    assert.ok(!renderedIndex.includes('Leave Tax'), 'Leave Tax must not appear in the selector UI.');

    const renderedPreview = await renderView('views/reports/payroll_liabilities/preview.ejs', {
        title: 'Payroll Liabilities Report',
        path: '/finance/reports/payroll-liabilities/preview',
        user: { name: 'Finance Officer' },
        branding: { companyName: payeData.company.Com_Name, logoPath: payeData.company.LogoPath },
        partialsBase: 'finance/partials',
        dashboardPath: '/finance/dashboard',
        workspaceLabel: 'Finance Officer',
        pageData: payeData
    });
    assert.ok(renderedPreview.includes('data-report-page'), 'Preview should use the shared report viewer pages.');
    assert.ok(renderedPreview.includes('Download Excel'), 'Preview should expose Excel download.');
    assert.ok(renderedPreview.includes('/images/nra-logo.jpg'), 'PAYE preview should render the NRA logo using the local render-safe asset.');
    assert.ok(renderedPreview.includes('INCOME TAX DEPARTMENT'), 'PAYE preview should render the statutory NRA heading.');

    const renderedEosPreview = await renderView('views/reports/payroll_liabilities/preview.ejs', {
        title: 'Payroll Liabilities Report',
        path: '/finance/reports/payroll-liabilities/preview',
        user: { name: 'Finance Officer' },
        branding: { companyName: eosData.company.Com_Name, logoPath: eosData.company.LogoPath },
        partialsBase: 'finance/partials',
        dashboardPath: '/finance/dashboard',
        workspaceLabel: 'Finance Officer',
        pageData: eosData
    });
    assert.ok(renderedEosPreview.includes('/images/nra-logo.jpg'), 'EOS preview should render the NRA logo using the local render-safe asset.');
    assert.ok(renderedEosPreview.includes('INCOME TAX DEPARTMENT'), 'EOS preview should render the statutory NRA heading.');

    const renderedNassitPreview = await renderView('views/reports/payroll_liabilities/preview.ejs', {
        title: 'Payroll Liabilities Report',
        path: '/finance/reports/payroll-liabilities/preview',
        user: { name: 'Finance Officer' },
        branding: { companyName: nassitData.company.Com_Name, logoPath: nassitData.company.LogoPath },
        partialsBase: 'finance/partials',
        dashboardPath: '/finance/dashboard',
        workspaceLabel: 'Finance Officer',
        pageData: nassitData
    });
    assert.ok(!renderedNassitPreview.includes('INCOME TAX DEPARTMENT'), 'NASSIT preview must keep its company-style header and must not use the NRA income-tax header.');

    const renderedStaff = await renderView('views/reports/payroll_liabilities/staff_statement.ejs', {
        title: 'Staff PAYE Statement',
        path: '/finance/reports/payroll-liabilities/staff-preview',
        user: { name: 'Finance Officer' },
        branding: { companyName: staffData.company.Com_Name, logoPath: staffData.company.LogoPath },
        partialsBase: 'finance/partials',
        dashboardPath: '/finance/dashboard',
        workspaceLabel: 'Finance Officer',
        pageData: staffData
    });
    assert.ok(renderedStaff.includes('Opening Balance'), 'Staff PAYE statement should display the opening balance.');
    assert.ok(renderedStaff.includes('data-report-page'), 'Staff statement should use the shared viewer paging markup.');

    const noAuthResponse = await request('/finance/reports/payroll-liabilities');
    assert.ok([302, 303].includes(noAuthResponse.status), 'Unauthenticated users should be redirected away from finance liability reports.');

    const { sessionId, cookieHeader } = await createFinanceSessionCookie({ companyId, userId: 900001 });
    try {
        const indexResponse = await request('/finance/reports/payroll-liabilities', {
            headers: { Cookie: cookieHeader }
        });
        assert.equal(indexResponse.status, 200, 'Finance liabilities index route should load for an authenticated finance session.');
        const indexHtml = await indexResponse.text();
        assert.ok(indexHtml.includes('Payroll Liabilities'));

        const previewResponse = await request('/finance/reports/payroll-liabilities/preview?liabilityType=PAYE&fromDate=2025-12-01&toDate=2026-03-31', {
            headers: { Cookie: cookieHeader }
        });
        assert.equal(previewResponse.status, 200, 'PAYE preview route should render for an authenticated finance session.');
        const previewHtml = await previewResponse.text();
        assert.ok(previewHtml.includes('Tax Deducted'));
        assert.ok(previewHtml.includes('INCOME TAX DEPARTMENT'));
        assert.ok(previewHtml.includes('/images/nra-logo.jpg'));

        const eosPreviewResponse = await request('/finance/reports/payroll-liabilities/preview?liabilityType=EOS&fromDate=2025-12-01&toDate=2026-03-31', {
            headers: { Cookie: cookieHeader }
        });
        assert.equal(eosPreviewResponse.status, 200, 'EOS preview route should render for an authenticated finance session.');
        const eosPreviewHtml = await eosPreviewResponse.text();
        assert.ok(eosPreviewHtml.includes('INCOME TAX DEPARTMENT'));
        assert.ok(eosPreviewHtml.includes('/images/nra-logo.jpg'));

        const nassitPreviewResponse = await request('/finance/reports/payroll-liabilities/preview?liabilityType=NASSIT&fromDate=2025-12-01&toDate=2026-03-31', {
            headers: { Cookie: cookieHeader }
        });
        assert.equal(nassitPreviewResponse.status, 200, 'NASSIT preview route should render for an authenticated finance session.');
        const nassitPreviewHtml = await nassitPreviewResponse.text();
        assert.ok(nassitPreviewHtml.includes('NASSIT CONTRIBUTION'));
        assert.ok(!nassitPreviewHtml.includes('INCOME TAX DEPARTMENT'));

        const whtPreviewResponse = await request('/finance/reports/payroll-liabilities/preview?liabilityType=WHT&fromDate=2025-12-01&toDate=2026-03-31', {
            headers: { Cookie: cookieHeader }
        });
        assert.equal(whtPreviewResponse.status, 400, 'Direct WHT preview requests should be rejected.');

        const leaveTaxPreviewResponse = await request('/finance/reports/payroll-liabilities/preview?liabilityType=LEAVE_TAX&fromDate=2025-12-01&toDate=2026-03-31', {
            headers: { Cookie: cookieHeader }
        });
        assert.equal(leaveTaxPreviewResponse.status, 400, 'Direct Leave Tax preview requests should be rejected.');

        const excelResponse = await request('/finance/reports/payroll-liabilities/excel?liabilityType=PAYE&fromDate=2025-12-01&toDate=2026-03-31', {
            headers: { Cookie: cookieHeader }
        });
        assert.equal(excelResponse.status, 200, 'PAYE Excel export should be available for supported liability types.');
        assert.ok(String(excelResponse.headers.get('content-type') || '').includes('application/vnd.ms-excel'));

        const staffPreviewResponse = await request(`/finance/reports/payroll-liabilities/staff-preview?pfNo=${encodeURIComponent(pfNo)}&fromDate=2025-12-01&toDate=2026-03-31`, {
            headers: { Cookie: cookieHeader }
        });
        assert.equal(staffPreviewResponse.status, 200, 'Staff PAYE preview should render for an authenticated finance session.');
        const staffPreviewHtml = await staffPreviewResponse.text();
        assert.ok(staffPreviewHtml.includes('Staff PAYE Statement'));
    } finally {
        await destroySession(sessionId);
    }

    console.log('Payroll liability report tests passed.');
    await pool.end();
    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    pool.end().catch(() => {});
    process.exit(1);
});
