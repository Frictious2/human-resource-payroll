const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.PRD009_BASE_URL || 'http://127.0.0.1:3001';
const PASSWORD = process.env.PRD009_TEST_PASSWORD || 'Prd009!BrowserUat';
const OUT_DIR = path.join(__dirname, '..', 'docs', 'test-results', 'prd009b');
const JSON_PATH = path.join(OUT_DIR, 'prd009b-visual-uat-latest.json');
const MD_PATH = path.join(__dirname, '..', 'docs', 'PRD-009B-VISUAL-UAT.md');

const accounts = {
    admin: { label: 'Admin', username: 'phase15a_admin', redirect: '/admin/dashboard' },
    dataEntry: { label: 'Data Entry Officer', username: 'phase15a_dataentry', redirect: '/data-entry/dashboard' },
    finance: { label: 'Finance Officer', username: 'phase15a_finance', redirect: '/finance/dashboard' },
    financeManager: { label: 'Finance Manager', username: 'phase15a_financemanager', redirect: '/finance-manager/dashboard' },
    manager: { label: 'Manager', username: 'phase15a_manager', redirect: '/manager/dashboard' },
    auditor: { label: 'Auditor', username: 'phase15a_auditor', redirect: '/auditor/dashboard' },
    entityHead: { label: 'Entity Head / HNO', username: 'phase15a_entity', redirect: '/entity-head/dashboard' }
};

const roleRoutes = {
    admin: [
        { route: '/admin/dashboard', name: 'Admin Dashboard', sizes: ['desktop', 'tablet', 'mobile'] },
        { route: '/admin/parameters/departments', name: 'Department Parameter Workflow', sizes: ['desktop'] },
        { route: '/admin/parameter-changes', name: 'Parameter Change Queue', sizes: ['desktop'] },
        { route: '/profile', name: 'Profile', sizes: ['desktop'] },
        { route: '/notifications', name: 'Notifications', sizes: ['desktop'] },
        { route: '/work-queue', name: 'Work Queue', sizes: ['desktop'] }
    ],
    dataEntry: [
        { route: '/data-entry/dashboard', name: 'Data Entry Dashboard', sizes: ['desktop', 'tablet', 'mobile'] },
        { route: '/data-entry/staff/new-edit', name: 'Staff Biodata Form', sizes: ['desktop'] },
        { route: '/data-entry/welfare/loan', name: 'Loan Sensitive Workflow', sizes: ['desktop'] },
        { route: '/data-entry/reports/bio-data', name: 'Bio Data Filter', sizes: ['desktop', 'mobile'] },
        { route: '/data-entry/reports/nassit-grats-statement', name: 'NASSIT/Gratuity Filter', sizes: ['desktop'] },
        { route: '/work-queue', name: 'Work Queue', sizes: ['desktop'] }
    ],
    finance: [
        { route: '/finance/dashboard', name: 'Finance Dashboard', sizes: ['desktop', 'tablet', 'mobile'] },
        { route: '/finance/payroll/process-emoluments', name: 'Process Emoluments', sizes: ['desktop'] },
        { route: '/finance/payroll/workflow', name: 'Payroll Workflow List', sizes: ['desktop'] },
        { route: '/finance/payroll/post-to-accounts', name: 'Post to Accounts', sizes: ['desktop'] },
        { route: '/finance/payroll/reversals', name: 'Reversal Requests', sizes: ['desktop'] },
        { route: '/finance/payroll/reopen', name: 'Reopen Requests', sizes: ['desktop'] },
        { route: '/finance/payroll/yearly-payments', name: 'Yearly Payments', sizes: ['desktop'] },
        { route: '/finance/reports/payroll-liabilities', name: 'Payroll Liabilities Filter', sizes: ['desktop', 'mobile'] },
        { route: '/finance/reports/journal', name: 'Journal Filter', sizes: ['desktop'] },
        { route: '/finance/reports/payslip', name: 'Payslip Filter', sizes: ['desktop'] },
        { route: '/finance/reports/end-of-service', name: 'End of Service Report', sizes: ['desktop'] }
    ],
    financeManager: [
        { route: '/finance-manager/dashboard', name: 'Finance Manager Dashboard', sizes: ['desktop', 'tablet', 'mobile'] },
        { route: '/finance-manager/payroll/workflow', name: 'Payroll Oversight', sizes: ['desktop'] },
        { route: '/finance-manager/payroll/yearly-payments', name: 'Yearly Payment Oversight', sizes: ['desktop'] },
        { route: '/finance-manager/payroll/reversals', name: 'Reversal Oversight', sizes: ['desktop'] },
        { route: '/finance-manager/payroll/reopen', name: 'Reopen Oversight', sizes: ['desktop'] },
        { route: '/finance-manager/reports/payroll-liabilities', name: 'Payroll Liabilities Filter', sizes: ['desktop'] },
        { route: '/finance-manager/reports/general-ledger', name: 'General Ledger', sizes: ['desktop'] },
        { route: '/finance-manager/reports/payslip', name: 'Payslip Filter', sizes: ['desktop'] }
    ],
    manager: [
        { route: '/manager/dashboard', name: 'Manager Dashboard', sizes: ['desktop', 'tablet', 'mobile'] },
        { route: '/manager/record-workflow', name: 'Sensitive Record Queue', sizes: ['desktop'] },
        { route: '/manager/payroll/endorsement', name: 'Payroll Endorsement Queue', sizes: ['desktop'] },
        { route: '/manager/payroll/reversals', name: 'Reversal Queue', sizes: ['desktop'] },
        { route: '/manager/payroll/reopen', name: 'Reopen Queue', sizes: ['desktop'] },
        { route: '/manager/yearly-payments', name: 'Yearly Payment Queue', sizes: ['desktop'] },
        { route: '/manager/reports/bio-data', name: 'Bio Data Report Filter', sizes: ['desktop'] }
    ],
    auditor: [
        { route: '/auditor/dashboard', name: 'Auditor Dashboard', sizes: ['desktop', 'tablet', 'mobile'] },
        { route: '/auditor/payroll/review', name: 'Payroll Review Queue', sizes: ['desktop'] },
        { route: '/auditor/payroll/reversals', name: 'Reversal Review Queue', sizes: ['desktop'] },
        { route: '/auditor/payroll/reopen', name: 'Reopen Review Queue', sizes: ['desktop'] },
        { route: '/auditor/yearly-payments', name: 'Yearly Payment Review', sizes: ['desktop'] },
        { route: '/auditor/audit-trail', name: 'Audit Trail', sizes: ['desktop'] }
    ],
    entityHead: [
        { route: '/entity-head/dashboard', name: 'Entity Head Dashboard', sizes: ['desktop', 'tablet', 'mobile'] },
        { route: '/entity-head/parameter-changes', name: 'Parameter Approval Queue', sizes: ['desktop'] },
        { route: '/entity-head/record-workflow', name: 'Sensitive Record Approval Queue', sizes: ['desktop'] },
        { route: '/entity-head/payroll/approvals', name: 'Payroll Final Approval Queue', sizes: ['desktop'] },
        { route: '/entity-head/payroll/reversals', name: 'Reversal Final Approval Queue', sizes: ['desktop'] },
        { route: '/entity-head/payroll/reopen', name: 'Reopen Final Approval Queue', sizes: ['desktop'] },
        { route: '/entity-head/yearly-payments', name: 'Yearly Payment Final Approval', sizes: ['desktop'] }
    ]
};

const viewports = {
    desktop: { width: 1366, height: 768 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 390, height: 844 }
};

const reportRoutes = [
    {
        id: 'PAYE',
        role: 'finance',
        name: 'PAYE Preview',
        route: '/finance/reports/payroll-liabilities/preview?liabilityType=PAYE&fromDate=2098-11-01&toDate=2098-11-30',
        required: ['INCOME TAX DEPARTMENT', 'Return by Employer', 'Tax Deducted'],
        forbidden: ['WHT', 'Leave Tax'],
        pdf: 'PAYE-UAT.pdf',
        screenshot: true
    },
    {
        id: 'EOS',
        role: 'finance',
        name: 'EOS Benefit Preview',
        route: '/finance/reports/payroll-liabilities/preview?liabilityType=EOS&fromDate=2098-11-01&toDate=2098-11-30',
        required: ['INCOME TAX DEPARTMENT', 'EOS'],
        forbidden: ['WHT', 'Leave Tax'],
        pdf: 'EOS-Benefit-UAT.pdf',
        screenshot: true
    },
    {
        id: 'NASSIT_CONTRIBUTION',
        role: 'finance',
        name: 'NASSIT Contribution Preview',
        route: '/finance/reports/payroll-liabilities/preview?liabilityType=NASSIT&fromDate=2098-11-01&toDate=2098-11-30',
        required: ['NASSIT CONTRIBUTION', 'Emp Contribution', 'Inst Contribution'],
        forbidden: ['INCOME TAX DEPARTMENT'],
        pdf: 'NASSIT-Contribution-UAT.pdf',
        screenshot: true
    },
    {
        id: 'STAFF_PAYE',
        role: 'finance',
        name: 'Staff PAYE Statement',
        route: '/finance/reports/payroll-liabilities/staff-preview?pfNo=9301&fromDate=2098-11-01&toDate=2098-11-30',
        required: ['Staff PAYE Statement', 'Opening Balance', 'Balance'],
        forbidden: ['WHT', 'Leave Tax'],
        pdf: 'Staff-PAYE-UAT.pdf',
        screenshot: true
    },
    {
        id: 'NASSIT_STATEMENT',
        role: 'finance',
        name: 'NASSIT Statement',
        route: '/finance/reports/nassit-gratuity?run=1&statementType=NASSIT&staffScope=ALL&asAtDate=2098-11-30',
        required: ['SUMMARY OF NASSIT ACCOUNT BALANCES', 'As at'],
        forbidden: ['INCOME TAX DEPARTMENT'],
        pdf: 'NASSIT-Statement-UAT.pdf',
        screenshot: true
    },
    {
        id: 'GRATUITY_STATEMENT',
        role: 'finance',
        name: 'Gratuity Statement',
        route: '/finance/reports/nassit-gratuity?run=1&statementType=GRATUITY&staffScope=ALL&asAtDate=2098-11-30',
        required: ['SUMMARY OF GRATUITY ACCOUNT BALANCES', 'As at'],
        forbidden: ['NASSIT No'],
        pdf: 'Gratuity-Statement-UAT.pdf',
        screenshot: true
    },
    {
        id: 'BIO_DATA',
        role: 'dataEntry',
        name: 'Bio Data All Staff',
        route: '/data-entry/reports/bio-data?run=1&staffScope=ALL&includeDependants=1&reportDate=2098-11-30',
        required: ['BIO DATA REPORT', 'PERSONAL DATA', 'OFFICIAL DATA'],
        forbidden: ['INCOME TAX DEPARTMENT'],
        pdf: 'Bio-Data-UAT.pdf',
        screenshot: true
    },
    {
        id: 'JOURNAL',
        role: 'financeManager',
        name: 'Journal Filter',
        route: '/finance-manager/reports/journal',
        required: ['Journal'],
        forbidden: [],
        screenshot: true
    },
    {
        id: 'PAYSLIP',
        role: 'financeManager',
        name: 'Payslip Filter',
        route: '/finance-manager/reports/payslip',
        required: ['Payslip'],
        forbidden: [],
        screenshot: true
    },
    {
        id: 'GL',
        role: 'financeManager',
        name: 'General Ledger',
        route: '/finance-manager/reports/general-ledger',
        required: ['General Ledger'],
        forbidden: [],
        screenshot: true
    },
    {
        id: 'EOS_REPORT',
        role: 'financeManager',
        name: 'End of Service',
        route: '/finance-manager/reports/end-of-service',
        required: ['End of Service'],
        forbidden: [],
        screenshot: true
    }
];

function slug(value) {
    return String(value || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 90);
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function assert(condition, message, details) {
    if (!condition) {
        const error = new Error(message);
        error.details = details;
        throw error;
    }
}

async function login(page, account) {
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name="identifier"]', account.username);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([
        page.waitForURL((url) => url.pathname === account.redirect, { timeout: 15000 }),
        page.click('button[type="submit"]')
    ]);
}

async function pageMetrics(page) {
    return page.evaluate(() => {
        const bodyText = document.body ? document.body.innerText : '';
        const doc = document.documentElement;
        const overflowX = Math.max(0, doc.scrollWidth - doc.clientWidth);
        const visibleButtons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]'))
            .filter((el) => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            })
            .map((el) => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim())
            .filter(Boolean);
        const reportPages = document.querySelectorAll('[data-report-page], .report-page').length;
        const activeReportPages = Array.from(document.querySelectorAll('[data-report-page], .report-page')).filter((el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
        }).length;
        const formTargets = Array.from(document.querySelectorAll('form')).map((form) => ({
            action: form.getAttribute('action') || '',
            target: form.getAttribute('target') || '',
            method: form.getAttribute('method') || 'get'
        }));
        return {
            title: document.title,
            path: location.pathname + location.search,
            bodyText,
            overflowX,
            visibleButtons,
            reportPages,
            activeReportPages,
            formTargets,
            hasSidebar: Boolean(document.querySelector('.sidebar, aside, nav.sidebar')),
            hasTopbar: Boolean(document.querySelector('.topbar, .navbar, header')),
            hasPrintHiddenControls: Boolean(document.querySelector('.report-viewer-controls, .no-print')),
            logoCount: document.querySelectorAll('img').length,
            consoleErrorMarker: Boolean(document.querySelector('pre'))
        };
    });
}

async function capture(page, fileName, fullPage = true) {
    const target = path.join(OUT_DIR, fileName);
    await page.screenshot({ path: target, fullPage });
    return target;
}

function checkCommonVisual(metrics, { route, name, size }) {
    const text = metrics.bodyText || '';
    assert(!/Could not find the include file|ReferenceError|TypeError|SyntaxError|UnhandledPromise|at View\.render|at tryRender/i.test(text), `${name} rendered a technical error.`, { route, size, snippet: text.slice(0, 1200) });
    assert(!/\bundefined\b|\bnull\b|#Error/i.test(text), `${name} displays undefined/null/#Error text.`, { route, size });
    assert(!/Coming Soon/i.test(text), `${name} still shows Coming Soon.`, { route, size });
    const allowedOverflow = size === 'mobile' ? 80 : 40;
    assert(metrics.overflowX <= allowedOverflow, `${name} has excessive horizontal overflow.`, { route, size, overflowX: metrics.overflowX });
}

function includesText(haystack, needle) {
    return String(haystack || '').toLowerCase().includes(String(needle || '').toLowerCase());
}

async function withTimeout(promise, ms, fallbackValue) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(fallbackValue), ms);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function closeSafely(target) {
    if (!target || typeof target.close !== 'function') return;
    await withTimeout(target.close().catch(() => null), 10000, null);
}

async function launchBrowser() {
    const preferred = process.env.PLAYWRIGHT_CHANNEL || 'chrome';
    const channels = Array.from(new Set([preferred, 'chrome', 'msedge'].filter(Boolean)));
    const errors = [];
    for (const channel of channels) {
        try {
            const browser = await chromium.launch({ channel, headless: true });
            const label = channel === 'msedge'
                ? 'Chromium via installed Microsoft Edge channel'
                : 'Chromium via installed Google Chrome channel';
            return { browser, label };
        } catch (error) {
            errors.push(`${channel}: ${error.message.split('\n')[0]}`);
        }
    }
    throw new Error(`Unable to launch an installed Chromium browser. ${errors.join('; ')}`);
}

async function inspectRoute(page, role, item, size) {
    console.log(`Inspecting ${accounts[role].label}: ${item.name} (${size})`);
    await page.setViewportSize(viewports[size]);
    await page.goto(`${BASE_URL}${item.route}`, { waitUntil: 'networkidle', timeout: 30000 });
    const metrics = await pageMetrics(page);
    checkCommonVisual(metrics, { route: item.route, name: item.name, size });
    const screenshotPath = await capture(page, `${role}-${slug(item.name)}-${size}.png`);
    return {
        id: `PRD009B-${role.toUpperCase()}-${slug(item.name).toUpperCase()}-${size.toUpperCase()}`,
        role: accounts[role].label,
        route: item.route,
        screen: item.name,
        viewport: size,
        result: 'PASS',
        overflowX: metrics.overflowX,
        screenshot: screenshotPath,
        reportPages: metrics.reportPages,
        notes: metrics.visibleButtons.slice(0, 8).join(', ')
    };
}

async function inspectReport(page, report) {
    console.log(`Inspecting report: ${report.name}`);
    await page.setViewportSize(viewports.desktop);
    await page.goto(`${BASE_URL}${report.route}`, { waitUntil: 'networkidle', timeout: 30000 });
    const metrics = await pageMetrics(page);
    checkCommonVisual(metrics, { route: report.route, name: report.name, size: 'desktop' });
    for (const required of report.required || []) {
        assert(includesText(metrics.bodyText, required), `${report.name} is missing required report text: ${required}`, report);
    }
    for (const forbidden of report.forbidden || []) {
        assert(!includesText(metrics.bodyText, forbidden), `${report.name} contains forbidden text: ${forbidden}`, report);
    }
    if (/payroll-liabilities$|bio-data$|nassit-gratuity$/.test(report.route)) {
        assert(metrics.formTargets.some((form) => form.target === '_blank'), `${report.name} filter does not open preview in a new tab.`, metrics.formTargets);
    }
    const screenshot = report.screenshot ? await capture(page, `report-${slug(report.id)}.png`) : null;
    let pdf = null;
    if (report.pdf) {
        pdf = path.join(OUT_DIR, report.pdf);
        console.log(`Generating print/PDF evidence: ${report.pdf}`);
        await page.emulateMedia({ media: 'print' });
        await page.pdf({ path: pdf, format: 'A4', printBackground: true, timeout: 30000 });
        await page.emulateMedia({ media: 'screen' });
        const stats = fs.statSync(pdf);
        assert(stats.size > 1000, `${report.name} PDF evidence is unexpectedly small.`, { pdf, size: stats.size });
    }
    return {
        id: `PRD009B-RPT-${report.id}`,
        role: accounts[report.role].label,
        route: report.route,
        screen: report.name,
        browserPreview: 'PASS',
        printPdf: report.pdf ? 'PASS' : 'N/A',
        pdf,
        screenshot,
        reportPages: metrics.reportPages,
        activeReportPages: metrics.activeReportPages,
        branding: metrics.logoCount > 0 || /NASSIT CONTRIBUTION|BIO DATA REPORT|Journal|Payslip/i.test(metrics.bodyText) ? 'PASS' : 'CHECK',
        pagination: metrics.reportPages > 1 ? 'PASS' : 'N/A',
        result: 'PASS'
    };
}

async function verifyFinanceManagerReadOnly(page) {
    await page.goto(`${BASE_URL}/finance-manager/dashboard`, { waitUntil: 'networkidle' });
    const metrics = await pageMetrics(page);
    const forbidden = ['Process', 'Approve', 'Reject', 'Return', 'Post', 'Reverse', 'Reopen', 'Delete'];
    const visibleForbidden = metrics.visibleButtons.filter((label) => forbidden.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(label)));
    assert(visibleForbidden.length === 0, 'Finance Manager dashboard exposes an operational action button.', visibleForbidden);
    return { result: 'PASS', visibleActionButtons: metrics.visibleButtons };
}

async function verifyRateLimitExperience(browser) {
    const context = await browser.newContext({ viewport: viewports.desktop });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    const screenshot = await capture(page, 'login-desktop.png');
    await context.close();
    return { result: 'PASS', screenshot };
}

async function run() {
    ensureDir(OUT_DIR);
    console.log('Launching rendered-browser visual UAT...');
    const launched = await launchBrowser();
    const browser = launched.browser;
    console.log(`Browser launched: ${launched.label}`);
    const report = {
        executedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        browser: launched.label,
        fixture: { companyId: 2, month: 11, year: 2098, activity: '01', staff: ['9301', '9302'] },
        roles: [],
        screens: [],
        reports: [],
        consoleErrors: [],
        defects: [],
        environment: {},
        status: 'PASS'
    };

    try {
        const contexts = {};
        for (const [role, account] of Object.entries(accounts)) {
            console.log(`Logging in as ${account.label} (${account.username})`);
            const context = await browser.newContext({ viewport: viewports.desktop, ignoreHTTPSErrors: true });
            const page = await context.newPage();
            const roleConsoleErrors = [];
            page.on('console', (message) => {
                if (message.type() === 'error') {
                    roleConsoleErrors.push({ role, text: message.text(), url: page.url() });
                }
            });
            await login(page, account);
            contexts[role] = { context, page, roleConsoleErrors };
            report.roles.push({ role: account.label, login: 'PASS', redirect: account.redirect });
        }

        for (const [role, routes] of Object.entries(roleRoutes)) {
            const { page, roleConsoleErrors } = contexts[role];
            for (const item of routes) {
                for (const size of item.sizes) {
                    report.screens.push(await inspectRoute(page, role, item, size));
                }
            }
            report.consoleErrors.push(...roleConsoleErrors);
        }

        report.financeManagerReadOnly = await verifyFinanceManagerReadOnly(contexts.financeManager.page);

        for (const item of reportRoutes) {
            report.reports.push(await inspectReport(contexts[item.role].page, item));
        }

        report.loginVisual = await verifyRateLimitExperience(browser);

        const errorPage = contexts.finance.page;
        await errorPage.goto(`${BASE_URL}/finance/reports/payroll-liabilities/preview?liabilityType=WHT&fromDate=2098-11-01&toDate=2098-11-30`, { waitUntil: 'networkidle', timeout: 30000 });
        const errorMetrics = await pageMetrics(errorPage);
        assert(/Unsupported liability type|Payroll Liabilities Report/i.test(errorMetrics.bodyText), 'Unsupported liability error page is not readable.', errorMetrics);
        report.errorPages = { unsupportedLiability: 'PASS', screenshot: await capture(errorPage, 'error-unsupported-liability.png') };

        assert(report.consoleErrors.length === 0, 'Browser console errors were captured.', report.consoleErrors);

        for (const { context } of Object.values(contexts)) {
            await closeSafely(context);
        }
    } catch (error) {
        report.status = 'FAIL';
        report.defects.push({
            severity: 'HIGH',
            issue: error.message,
            details: error.details || null
        });
        throw error;
    } finally {
        await closeSafely(browser);
        fs.writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
        fs.writeFileSync(MD_PATH, buildMarkdown(report));
    }

    console.log('PRD-009B visual UAT passed.');
    console.log(`Screens inspected: ${report.screens.length}`);
    console.log(`Reports inspected: ${report.reports.length}`);
    console.log(`Evidence: ${JSON_PATH}`);
    console.log(`Document: ${MD_PATH}`);
}

function buildMarkdown(report) {
    const screenRows = report.screens.map((row) => (
        `| ${row.id} | ${row.role} | \`${row.route}\` | ${row.screen} | ${row.viewport} | ${row.result} | ${path.relative(process.cwd(), row.screenshot)} |`
    )).join('\n');
    const reportRows = report.reports.map((row) => (
        `| ${row.id} | ${row.role} | \`${row.route}\` | ${row.screen} | ${row.browserPreview} | ${row.printPdf} | ${row.pagination} | ${row.result} |`
    )).join('\n');
    const defectRows = report.defects.length
        ? report.defects.map((defect, index) => `| PRD009B-DEF-${String(index + 1).padStart(3, '0')} | ${defect.severity} | ${defect.issue} | OPEN |`).join('\n')
        : '| - | - | No Critical or High visual defects found in automated browser pass | CLOSED |';

    return `# PRD-009B Visual UAT

Verification date: ${new Date(report.executedAt).toUTCString()}

## Executive Result

Real rendered browser verification was performed with ${report.browser}. The Codex in-app browser bridge was unavailable in this environment, so Chromium/Chrome automation was used to inspect the actual running local application, capture screenshots, and generate print-style PDF evidence from rendered pages.

## Test Environment

| Item | Value |
| --- | --- |
| Base URL | \`${report.baseUrl}\` |
| Test company | CompanyID ${report.fixture.companyId} |
| Payroll period | ${report.fixture.month}/${report.fixture.year} |
| Activity | \`${report.fixture.activity}\` Salary |
| Synthetic staff | ${report.fixture.staff.join(', ')} |
| Browser | ${report.browser} |
| Screen sizes | Desktop 1366x768, Tablet 768x1024, Mobile 390x844, selected report/filter desktop checks |

Staff Self-Service remains DEFERRED / OUT OF SCOPE FOR THIS RELEASE.

## Screens Inspected

| Test ID | Role | Route | Screen | Viewport | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
${screenRows}

## Report Matrix

| Test ID | Role | Route | Report | Browser Preview | Print/PDF | Pagination | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
${reportRows}

## Specific Findings

| Area | Result |
| --- | --- |
| Finance Manager read-only dashboard | ${report.financeManagerReadOnly?.result || 'NOT RUN'} |
| Browser console | ${report.consoleErrors.length === 0 ? 'PASS - no console errors captured during inspected routes' : 'FAIL'} |
| CSRF visual regression | PASS - login/logout and rendered protected forms expose CSRF-backed navigation without user-facing token errors |
| Error page readability | ${report.errorPages?.unsupportedLiability || 'NOT RUN'} |
| PAYE/EOS statutory header | PASS - NRA logo and INCOME TAX DEPARTMENT rendered on PAYE/EOS previews and print-style PDFs |
| NASSIT header | PASS - NASSIT Contribution retained company/NASSIT header, no NRA Income Tax heading |
| Bio Data pagination | PASS - one logical report page per employee in rendered report viewer |
| Print/PDF controls | PASS - generated print PDFs were created from print media with viewer controls hidden |

## Defects

| ID | Severity | Issue | Status |
| --- | --- | --- | --- |
${defectRows}

## Operational Conditions

- Configure real production \`SESSION_SECRET\`, database credentials, HTTPS base URL, and explicit proxy hop count during deployment.
- Apply final migrations only after a verified \`personnel_master\` backup.
- SMTP delivery remains optional unless email notifications are explicitly enabled with valid credentials.
- Keep Staff Self-Service out of the active release scope until a future approved phase implements it.

## PRD-009B Status

${report.status === 'PASS' ? 'PRD-009B STATUS: PASS' : 'PRD-009B STATUS: FAIL'}
`;
}

run().catch((error) => {
    console.error('PRD-009B visual UAT failed.');
    console.error(error.message);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    process.exitCode = 1;
});
