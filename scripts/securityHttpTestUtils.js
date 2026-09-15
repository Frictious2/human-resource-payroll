const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { initializeSessionStore } = require('../config/sessionStore');
const { createApp } = require('../server');

const TEST_PASSWORD = 'Prd009A!Security';
const TEST_COMPANY_ID = 2;
const TEST_USERS = [
    { pfno: 99801, username: 'prd009a_admin', level: 'Admin', role: 'admin' },
    { pfno: 99802, username: 'prd009a_finance', level: 'Finance Officer', role: 'finance-officer' },
    { pfno: 99803, username: 'prd009a_manager', level: 'Manager', role: 'manager' },
    { pfno: 99804, username: 'prd009a_auditor', level: 'Auditor', role: 'auditor' },
    { pfno: 99805, username: 'prd009a_entity', level: 'Entity Head', role: 'entity-head' },
    { pfno: 99806, username: 'prd009a_dataentry', level: 'Data Entry', role: 'data-entry' },
    { pfno: 99807, username: 'prd009a_financemanager', level: 'Finance Manager', role: 'finance-manager' }
];

function assertSafe() {
    if (process.env.ALLOW_DESTRUCTIVE_TESTS !== 'true' && process.env.NODE_ENV !== 'test') {
        throw new Error('Refusing security fixture changes. Set ALLOW_DESTRUCTIVE_TESTS=true or NODE_ENV=test.');
    }
}

function cookieFrom(response) {
    return String(response.headers.get('set-cookie') || '').split(';', 1)[0];
}

function csrfFrom(html) {
    const source = String(html || '');
    const match = source.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i)
        || source.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i);
    return match ? match[1] : '';
}

async function seedUsers() {
    assertSafe();
    const hash = await bcrypt.hash(TEST_PASSWORD, 10);
    for (const user of TEST_USERS) {
        await pool.query('DELETE FROM tblpassword WHERE CompanyID = ? AND (PFNo = ? OR Username = ?)', [TEST_COMPANY_ID, user.pfno, user.username]);
        await pool.query(
            `INSERT INTO tblpassword (PFNo, DateCreated, Level, Username, FullName, Pword, Email, CompanyID)
             VALUES (?, NOW(), ?, ?, ?, ?, ?, ?)`,
            [user.pfno, user.level, user.username, `PRD-009A ${user.level}`, hash, `${user.username}@security.test`, TEST_COMPANY_ID]
        );
    }
}

async function cleanupUsers() {
    assertSafe();
    for (const user of TEST_USERS) {
        await pool.query('DELETE FROM tblpassword WHERE CompanyID = ? AND PFNo = ? AND Username = ?', [TEST_COMPANY_ID, user.pfno, user.username]);
    }
}

async function startTestServer(port) {
    const store = await initializeSessionStore();
    const app = createApp({ sessionStore: store });
    const server = await new Promise((resolve, reject) => {
        const listener = app.listen(port, '127.0.0.1', () => resolve(listener));
        listener.on('error', reject);
    });
    return { server, store, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopTestServer(runtime) {
    if (runtime?.server) {
        await new Promise((resolve) => runtime.server.close(resolve));
    }
    if (runtime?.store && typeof runtime.store.close === 'function') {
        await runtime.store.close().catch(() => {});
    }
}

async function request(baseUrl, pathname, options = {}) {
    return fetch(`${baseUrl}${pathname}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        ...options
    });
}

async function login(baseUrl, username, password = TEST_PASSWORD) {
    const page = await request(baseUrl, '/login');
    const anonymousCookie = cookieFrom(page);
    const loginToken = csrfFrom(await page.text());
    if (!anonymousCookie || !loginToken) throw new Error('Login page did not provide CSRF session state.');

    const response = await request(baseUrl, '/login', {
        method: 'POST',
        headers: {
            cookie: anonymousCookie,
            'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ identifier: username, password, _csrf: loginToken })
    });
    const cookie = cookieFrom(response);
    if (response.status !== 302 || !cookie) {
        throw new Error(`Login failed for ${username} with HTTP ${response.status}.`);
    }

    const dashboard = await request(baseUrl, '/dashboard', { headers: { cookie } });
    const destination = dashboard.headers.get('location');
    const pageResponse = await request(baseUrl, destination, { headers: { cookie } });
    const csrfToken = csrfFrom(await pageResponse.text());
    if (!csrfToken) throw new Error(`Authenticated page did not expose a CSRF token for ${username}.`);
    return { cookie, csrfToken, destination };
}

module.exports = {
    TEST_COMPANY_ID,
    TEST_PASSWORD,
    TEST_USERS,
    cleanupUsers,
    cookieFrom,
    csrfFrom,
    login,
    pool,
    request,
    seedUsers,
    startTestServer,
    stopTestServer
};
