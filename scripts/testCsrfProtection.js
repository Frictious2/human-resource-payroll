#!/usr/bin/env node
require('dotenv').config({ override: true });

const assert = require('assert');
const { validateProductionEnvironment } = require('../services/environmentValidationService');
const {
    TEST_USERS,
    cleanupUsers,
    login,
    pool,
    request,
    seedUsers,
    startTestServer,
    stopTestServer
} = require('./securityHttpTestUtils');

const PORT = Number(process.env.CSRF_TEST_PORT || 3191);

async function main() {
    let runtime;
    try {
        await seedUsers();
        assert.strictEqual(validateProductionEnvironment({ NODE_ENV: 'production' }).valid, false, 'Empty production environment should fail validation.');
        assert(validateProductionEnvironment({
            NODE_ENV: 'production', SESSION_SECRET: 'secret', DB_HOST: 'db', DB_NAME: 'personnel_master',
            DB_USER: 'user', DB_PASSWORD: 'pass', APP_BASE_URL: 'https://hr.example.test'
        }).errors.some((message) => message.includes('SESSION_SECRET')), 'Unsafe production SESSION_SECRET should be rejected.');
        runtime = await startTestServer(PORT);

        const loginPage = await request(runtime.baseUrl, '/login');
        assert.strictEqual(loginPage.headers.get('x-content-type-options'), 'nosniff');
        assert.strictEqual(loginPage.headers.get('x-frame-options'), 'DENY');
        assert(loginPage.headers.get('content-security-policy'), 'CSP header is missing.');
        assert.strictEqual(loginPage.headers.get('x-powered-by'), null, 'X-Powered-By should be disabled.');

        const routeByRole = {
            admin: '/admin/api/parameters/departments',
            'finance-officer': '/finance/payroll/workflow/1/submit-to-manager',
            manager: '/manager/payroll/endorsement/1/endorse',
            auditor: '/auditor/payroll/review/1/endorse',
            'entity-head': '/entity-head/payroll/approvals/1/approve',
            'data-entry': '/data-entry/staff/transfer',
            'finance-manager': '/notifications/read-all'
        };

        for (const user of TEST_USERS) {
            const session = await login(runtime.baseUrl, user.username);
            const route = routeByRole[user.role];
            const missing = await request(runtime.baseUrl, route, {
                method: 'POST',
                headers: { cookie: session.cookie, accept: 'application/json', 'content-type': 'application/json' },
                body: '{}'
            });
            assert.strictEqual(missing.status, 403, `${user.role} mutation without CSRF was not blocked.`);

            const invalid = await request(runtime.baseUrl, route, {
                method: 'POST',
                headers: { cookie: session.cookie, accept: 'application/json', 'content-type': 'application/json', 'x-csrf-token': 'invalid-token' },
                body: '{}'
            });
            assert.strictEqual(invalid.status, 403, `${user.role} mutation with invalid CSRF was not blocked.`);

            const valid = await request(runtime.baseUrl, '/notifications/read-all', {
                method: 'POST',
                headers: { cookie: session.cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': session.csrfToken },
                body: new URLSearchParams()
            });
            assert.strictEqual(valid.status, 302, `${user.role} authorized mutation with valid CSRF failed.`);
        }

        const observer = await login(runtime.baseUrl, 'prd009a_financemanager');
        const forbidden = await request(runtime.baseUrl, '/finance/payroll/workflow/1/submit-to-manager', {
            method: 'POST',
            headers: { cookie: observer.cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': observer.csrfToken },
            body: new URLSearchParams()
        });
        assert.strictEqual(forbidden.status, 403, 'Valid CSRF bypassed Finance Manager role authorization.');

        console.log('CSRF and security-header verification passed for all seven active roles.');
    } finally {
        await stopTestServer(runtime).catch(() => {});
        await cleanupUsers().catch(() => {});
        await pool.end();
    }
}

main().catch((error) => {
    console.error('CSRF verification failed.');
    console.error(error.stack || error.message || error);
    process.exit(1);
});
