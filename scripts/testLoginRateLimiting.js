#!/usr/bin/env node
require('dotenv').config({ override: true });

process.env.LOGIN_RATE_LIMIT_MAX = '3';
process.env.LOGIN_RATE_LIMIT_WINDOW_MS = '60000';

const assert = require('assert');
const {
    cleanupUsers,
    cookieFrom,
    csrfFrom,
    pool,
    request,
    seedUsers,
    startTestServer,
    stopTestServer
} = require('./securityHttpTestUtils');

const PORT = Number(process.env.RATE_LIMIT_TEST_PORT || 3192);

async function failedLogin(baseUrl) {
    const page = await request(baseUrl, '/login');
    const cookie = cookieFrom(page);
    const token = csrfFrom(await page.text());
    return request(baseUrl, '/login', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ identifier: 'prd009a_admin', password: 'wrong-password', _csrf: token })
    });
}

async function main() {
    let runtime;
    try {
        await seedUsers();
        runtime = await startTestServer(PORT);
        for (let index = 0; index < 3; index += 1) {
            const response = await failedLogin(runtime.baseUrl);
            assert.strictEqual(response.status, 401, `Attempt ${index + 1} should be allowed and rejected by authentication.`);
        }
        const limited = await failedLogin(runtime.baseUrl);
        assert.strictEqual(limited.status, 429, 'Excessive login attempts did not return 429.');
        assert(!/username exists|password is incorrect/i.test(await limited.text()), 'Rate-limit response leaked account information.');

        const ordinaryPage = await request(runtime.baseUrl, '/login');
        assert.strictEqual(ordinaryPage.status, 200, 'GET browsing was incorrectly rate limited.');
        const staticAsset = await request(runtime.baseUrl, '/css/styles.css');
        assert.notStrictEqual(staticAsset.status, 429, 'Ordinary static browsing was incorrectly rate limited.');

        console.log('Login rate limiting verification passed (3 attempts per 60-second test window).');
    } finally {
        await stopTestServer(runtime).catch(() => {});
        await cleanupUsers().catch(() => {});
        await pool.end();
    }
}

main().catch((error) => {
    console.error('Login rate limiting verification failed.');
    console.error(error.stack || error.message || error);
    process.exit(1);
});
