const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.PRD009_BASE_URL || 'http://localhost:3001';
const PASSWORD = process.env.PRD009_TEST_PASSWORD || 'Prd009!BrowserUat';
const RESULT_PATH = path.join(__dirname, '..', 'docs', 'test-results', 'prd009-http-uat-latest.json');

const accounts = {
    admin: { username: 'phase15a_admin', redirect: '/admin/dashboard' },
    dataEntry: { username: 'phase15a_dataentry', redirect: '/data-entry/dashboard' },
    finance: { username: 'phase15a_finance', redirect: '/finance/dashboard' },
    financeManager: { username: 'phase15a_financemanager', redirect: '/finance-manager/dashboard' },
    manager: { username: 'phase15a_manager', redirect: '/manager/dashboard' },
    auditor: { username: 'phase15a_auditor', redirect: '/auditor/dashboard' },
    entityHead: { username: 'phase15a_entity', redirect: '/entity-head/dashboard' }
};

const pageRoutes = {
    admin: [
        '/admin/dashboard', '/admin/finance-managers', '/admin/parameters/departments',
        '/admin/parameters/pay-types', '/admin/parameter-changes', '/profile',
        '/notifications', '/work-queue'
    ],
    dataEntry: [
        '/data-entry/dashboard', '/data-entry/staff/new-edit', '/data-entry/staff/dependants',
        '/data-entry/reports/bio-data', '/data-entry/reports/nassit-grats-statement',
        '/profile', '/notifications', '/work-queue'
    ],
    finance: [
        '/finance/dashboard', '/finance/payroll/workflow', '/finance/payroll/reversals',
        '/finance/payroll/reopen', '/finance/payroll/yearly-payments',
        '/finance/payroll/post-to-accounts', '/finance/reports/journal',
        '/finance/reports/payslip', '/finance/reports/end-of-service',
        '/finance/reports/payroll-liabilities', '/profile', '/notifications', '/work-queue'
    ],
    financeManager: [
        '/finance-manager/dashboard', '/finance-manager/payroll/workflow',
        '/finance-manager/payroll/yearly-payments', '/finance-manager/payroll/reversals',
        '/finance-manager/payroll/reopen', '/finance-manager/reports/journal',
        '/finance-manager/reports/payslip', '/finance-manager/reports/general-ledger',
        '/finance-manager/reports/end-of-service',
        '/finance-manager/reports/payroll-liabilities', '/profile', '/notifications'
    ],
    manager: [
        '/manager/dashboard', '/manager/record-workflow', '/manager/payroll/endorsement',
        '/manager/payroll/reversals', '/manager/payroll/reopen', '/manager/yearly-payments',
        '/manager/reports/bio-data', '/manager/reports/nassit-grats',
        '/profile', '/notifications', '/work-queue'
    ],
    auditor: [
        '/auditor/dashboard', '/auditor/payroll/review', '/auditor/payroll/reversals',
        '/auditor/payroll/reopen', '/auditor/yearly-payments', '/auditor/audit-trail',
        '/profile', '/notifications', '/work-queue'
    ],
    entityHead: [
        '/entity-head/dashboard', '/entity-head/parameter-changes',
        '/entity-head/record-workflow', '/entity-head/payroll/approvals',
        '/entity-head/payroll/reversals', '/entity-head/payroll/reopen',
        '/entity-head/yearly-payments', '/profile', '/notifications', '/work-queue'
    ]
};

const mutationProbes = [
    { actor: 'financeManager', route: '/finance/payroll/workflow/1/submit-to-manager' },
    { actor: 'dataEntry', route: '/finance/payroll/reversals/1/execute' },
    { actor: 'finance', route: '/manager/payroll/endorsement/1/endorse' },
    { actor: 'manager', route: '/auditor/payroll/review/1/endorse' },
    { actor: 'auditor', route: '/entity-head/payroll/approvals/1/approve' },
    { actor: 'entityHead', route: '/finance/payroll/reversals/1/execute' }
];

function assertion(condition, message, evidence) {
    if (!condition) {
        const error = new Error(message);
        error.evidence = evidence;
        throw error;
    }
}

function getCookie(response) {
    const raw = response.headers.get('set-cookie') || '';
    return raw.split(';', 1)[0];
}

function getCsrfToken(html) {
    const match = String(html || '').match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i)
        || String(html || '').match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i);
    return match ? match[1] : '';
}

async function request(route, options = {}) {
    return fetch(`${BASE_URL}${route}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        ...options
    });
}

async function login(username, password = PASSWORD) {
    const loginPage = await request('/login');
    const anonymousCookie = getCookie(loginPage);
    const token = getCsrfToken(await loginPage.text());
    assertion(token && anonymousCookie, 'Login page did not issue CSRF/session state.', { status: loginPage.status });
    const body = new URLSearchParams({ identifier: username, password, _csrf: token });
    const response = await request('/login', {
        method: 'POST',
        headers: { cookie: anonymousCookie, 'content-type': 'application/x-www-form-urlencoded' },
        body
    });
    return {
        status: response.status,
        location: response.headers.get('location'),
        cookie: getCookie(response),
        body: await response.text()
    };
}

async function authenticatedGet(cookie, route) {
    const response = await request(route, { headers: { cookie } });
    const body = await response.text();
    return {
        route,
        status: response.status,
        location: response.headers.get('location'),
        contentType: response.headers.get('content-type') || '',
        bytes: Buffer.byteLength(body),
        body
    };
}

async function authenticatedPost(cookie, csrfToken, route, values = {}) {
    const response = await request(route, {
        method: 'POST',
        headers: {
            cookie,
            'content-type': 'application/x-www-form-urlencoded',
            'x-csrf-token': csrfToken
        },
        body: new URLSearchParams(values)
    });
    return {
        route,
        status: response.status,
        location: response.headers.get('location'),
        body: await response.text()
    };
}

async function main() {
    const report = {
        executedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        fixture: { companyId: 2, month: 11, year: 2098, activity: '01', staffCount: 2 },
        roles: {},
        security: [],
        reports: [],
        assets: [],
        session: {},
        limitations: [
            'Visual browser, print-preview, responsive-layout and screenshot acceptance require the in-app browser bridge.'
        ]
    };

    const invalid = await login(accounts.admin.username, 'definitely-wrong-password');
    assertion(invalid.status === 401, 'Invalid password was not rejected with 401.', invalid);
    report.session.invalidPassword = 'PASS';

    for (const [role, account] of Object.entries(accounts)) {
        console.log(`Checking ${role}...`);
        const session = await login(account.username);
        assertion(session.status === 302, `${role} login did not redirect.`, session);
        assertion(session.location === account.redirect, `${role} login redirected incorrectly.`, session);
        assertion(session.cookie.startsWith('hrpayroll.sid='), `${role} did not receive the expected session cookie.`, session);

        const checks = [];
        let csrfToken = '';
        for (const route of pageRoutes[role]) {
            const result = await authenticatedGet(session.cookie, route);
            assertion(result.status === 200, `${role} route failed: ${route}`, result);
            assertion(result.bytes > 100, `${role} route rendered an unexpectedly empty response: ${route}`, result);
            assertion(!/Could not find the include file|ReferenceError|TypeError:/i.test(result.body), `${role} route leaked a render/runtime error: ${route}`, result);
            csrfToken = csrfToken || getCsrfToken(result.body);
            checks.push({ route, status: result.status, bytes: result.bytes });
        }
        assertion(csrfToken, `${role} protected pages did not expose a CSRF token.`, checks[0]);
        report.roles[role] = { login: 'PASS', redirect: session.location, routes: checks, csrfToken };
        report.roles[role].cookie = session.cookie;
    }

    for (const probe of mutationProbes) {
        const cookie = report.roles[probe.actor].cookie;
        const csrfToken = report.roles[probe.actor].csrfToken;
        const result = await authenticatedPost(cookie, csrfToken, probe.route, { comments: 'PRD-009 authorization probe' });
        assertion([302, 401, 403, 404].includes(result.status), `Unauthorized mutation returned unexpected status: ${probe.route}`, result);
        assertion(result.status !== 500, `Unauthorized mutation caused a server error: ${probe.route}`, result);
        report.security.push({ ...probe, status: result.status, location: result.location });
    }

    const financeCookie = report.roles.finance.cookie;
    const managerCookie = report.roles.manager.cookie;
    const financeManagerCookie = report.roles.financeManager.cookie;

    const crossRole = await authenticatedGet(managerCookie, '/finance/dashboard');
    assertion([302, 403, 404].includes(crossRole.status), 'Manager could access the Finance workspace.', crossRole);
    report.security.push({ actor: 'manager', route: '/finance/dashboard', status: crossRole.status });

    const assetRoutes = ['/images/nra-logo.jpg', '/js/report-viewer.js'];
    for (const route of assetRoutes) {
        const response = await request(route);
        const bytes = Buffer.byteLength(await response.arrayBuffer());
        assertion(response.status === 200 && bytes > 100, `Static asset failed: ${route}`, { status: response.status, bytes });
        report.assets.push({ route, status: response.status, bytes, contentType: response.headers.get('content-type') });
    }

    const params = '?liabilityType=PAYE&fromDate=2098-11-01&toDate=2098-11-30';
    const reportChecks = [
        { actor: 'finance', cookie: financeCookie, route: `/finance/reports/payroll-liabilities/preview${params}`, expected: /INCOME TAX DEPARTMENT/i },
        { actor: 'finance', cookie: financeCookie, route: `/finance/reports/payroll-liabilities/pdf${params}`, expected: /INCOME TAX DEPARTMENT/i },
        { actor: 'finance', cookie: financeCookie, route: `/finance/reports/payroll-liabilities/excel${params}`, expectedType: /application\/vnd\.ms-excel/i },
        { actor: 'financeManager', cookie: financeManagerCookie, route: `/finance-manager/reports/payroll-liabilities/preview${params}`, expected: /INCOME TAX DEPARTMENT/i }
    ];

    for (const check of reportChecks) {
        const result = await authenticatedGet(check.cookie, check.route);
        assertion(result.status === 200, `Report route failed: ${check.route}`, result);
        if (check.expected) assertion(check.expected.test(result.body), `Report markup is missing expected content: ${check.route}`, result);
        if (check.expectedType) assertion(check.expectedType.test(result.contentType), `Report content type is incorrect: ${check.route}`, result);
        report.reports.push({ actor: check.actor, route: check.route, status: result.status, contentType: result.contentType, bytes: result.bytes });
    }

    for (const unsupported of ['WHT', 'LEAVE_TAX']) {
        const result = await authenticatedGet(financeCookie, `/finance/reports/payroll-liabilities/preview?liabilityType=${unsupported}&fromDate=2098-11-01&toDate=2098-11-30`);
        assertion(result.status === 400, `${unsupported} was not rejected by backend validation.`, result);
        report.security.push({ actor: 'finance', route: `liability:${unsupported}`, status: result.status });
    }

    const beforeLogoutCookie = report.roles.admin.cookie;
    const logout = await request('/logout', {
        method: 'POST',
        headers: {
            cookie: beforeLogoutCookie,
            'content-type': 'application/x-www-form-urlencoded',
            'x-csrf-token': report.roles.admin.csrfToken
        },
        body: new URLSearchParams()
    });
    assertion(logout.status === 302, 'Logout did not redirect.', { status: logout.status, location: logout.headers.get('location') });
    const afterLogout = await authenticatedGet(beforeLogoutCookie, '/admin/dashboard');
    assertion(afterLogout.status === 302 && afterLogout.location === '/login', 'Destroyed session remained usable after logout.', afterLogout);
    report.session.logoutDestruction = 'PASS';

    for (const role of Object.keys(report.roles)) {
        delete report.roles[role].cookie;
        delete report.roles[role].csrfToken;
    }
    fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true });
    fs.writeFileSync(RESULT_PATH, `${JSON.stringify(report, null, 2)}\n`);

    console.log('PRD-009 authenticated HTTP UAT passed.');
    console.log(`Roles: ${Object.keys(report.roles).length}`);
    console.log(`Protected pages: ${Object.values(report.roles).reduce((sum, role) => sum + role.routes.length, 0)}`);
    console.log(`Security probes: ${report.security.length}`);
    console.log(`Report/export probes: ${report.reports.length}`);
    console.log(`Evidence: ${RESULT_PATH}`);
    process.exit(0);
}

main().catch((error) => {
    console.error('PRD-009 authenticated HTTP UAT failed.');
    console.error(error.message);
    if (error.evidence) console.error(JSON.stringify(error.evidence, null, 2));
    process.exitCode = 1;
});
