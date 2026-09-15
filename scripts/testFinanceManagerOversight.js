#!/usr/bin/env node
require('dotenv').config({ override: true });

const assert = require('assert');
const { spawn } = require('child_process');
const crypto = require('crypto');
const signature = require('cookie-signature');
const pool = require('../config/db');
const { SESSION_COOKIE_NAME, SESSION_TABLE, getSessionSecret, ensureSessionTableExists } = require('../config/sessionStore');

const TEST_PORT = Number(process.env.FINANCE_MANAGER_TEST_PORT || 3118);
const TEST_BASE_URL = process.env.TEST_BASE_URL || `http://127.0.0.1:${TEST_PORT}`;
const TEST_COMPANY_ID = Number(process.env.TEST_COMPANY_ID || 1);
const TEST_TIMEOUT_MS = 30000;
const TEST_SESSION_SECRET = process.env.FINANCE_MANAGER_TEST_SESSION_SECRET || 'phase16c-finance-manager-secret';

function buildSignedSessionCookie(sessionId) {
    const signed = `s:${signature.sign(sessionId, getSessionSecret({ isProduction: false, sessionSecret: TEST_SESSION_SECRET }))}`;
    return `${SESSION_COOKIE_NAME}=${encodeURIComponent(signed)}`;
}

async function createSession({ role, companyId, userId, name, username, email }) {
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
            pfno: String(userId),
            username,
            email,
            name,
            fullName: name,
            role,
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

    return {
        sessionId,
        cookieHeader: buildSignedSessionCookie(sessionId)
    };
}

async function destroySession(sessionId) {
    await pool.execute(`DELETE FROM ${SESSION_TABLE} WHERE session_id = ?`, [sessionId]);
}

async function request(pathname, options = {}) {
    const signal = options.signal || AbortSignal.timeout(15000);
    return fetch(`${TEST_BASE_URL}${pathname}`, {
        redirect: 'manual',
        signal,
        ...options
    });
}

function startServer(envOverrides = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['server.js'], {
            cwd: require('path').join(__dirname, '..'),
            env: {
                ...process.env,
                PORT: String(TEST_PORT),
                NODE_ENV: envOverrides.NODE_ENV || 'development',
                SESSION_SECRET: envOverrides.SESSION_SECRET || TEST_SESSION_SECRET,
                ...envOverrides
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error('Timed out while starting the application server for Finance Manager oversight checks.'));
        }, TEST_TIMEOUT_MS);

        let stderr = '';

        child.stdout.on('data', (chunk) => {
            const text = chunk.toString();
            if (text.includes(`Server running on http://localhost:${TEST_PORT}`)) {
                clearTimeout(timeout);
                resolve(child);
            }
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('exit', (code) => {
            clearTimeout(timeout);
            reject(new Error(`Finance Manager test server exited early with code ${code}. ${stderr}`.trim()));
        });
    });
}

async function stopServer(child) {
    if (!child || child.killed) {
        return;
    }

    await new Promise((resolve) => {
        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
        }, 10000);

        child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });

        child.kill();
    });
}

async function expectStatus(response, allowedStatuses, label) {
    assert(
        allowedStatuses.includes(response.status),
        `${label} expected status ${allowedStatuses.join(' or ')}, received ${response.status}`
    );
}

function extractCsrfToken(html) {
    const match = String(html || '').match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
    return match ? match[1] : '';
}

async function main() {
    await ensureSessionTableExists(pool);
    const serverProcess = await startServer();

    try {
        const financeManagerSession = await createSession({
            role: 'finance-manager',
            companyId: TEST_COMPANY_ID,
            userId: 960001,
            name: 'Phase16C Finance Manager',
            username: 'phase16c.finance.manager',
            email: 'phase16c.finance.manager@example.com'
        });

        const fmHeaders = { cookie: financeManagerSession.cookieHeader };
        let csrfToken = '';

        const readOnlyRoutes = [
            '/finance-manager/dashboard',
            '/finance-manager/payroll/workflow',
            '/finance-manager/payroll/yearly-payments',
            '/finance-manager/payroll/reversals',
            '/finance-manager/payroll/reopen',
            '/finance-manager/reports/journal',
            '/finance-manager/reports/payslip',
            '/finance-manager/reports/general-ledger',
            '/finance-manager/reports/end-of-service',
            '/finance-manager/reports/payroll-liabilities'
        ];

        for (const pathname of readOnlyRoutes) {
            console.log(`Checking read route ${pathname}`);
            const response = await request(pathname, { headers: fmHeaders });
            await expectStatus(response, [200], `Finance Manager read route ${pathname}`);
            const body = await response.text();
            csrfToken = csrfToken || extractCsrfToken(body);
        }
        assert(csrfToken, 'Finance Manager pages must expose a CSRF token for browser mutations.');

        console.log('Checking payroll liabilities preview and PDF routes');
        const liabilitiesPreview = await request('/finance-manager/reports/payroll-liabilities/preview?liabilityType=PAYE&fromDate=2026-01-01&toDate=2026-01-31', {
            headers: fmHeaders
        });
        await expectStatus(liabilitiesPreview, [200], 'Finance Manager PAYE liability preview');

        const liabilitiesPdf = await request('/finance-manager/reports/payroll-liabilities/pdf?liabilityType=NASSIT&fromDate=2026-01-01&toDate=2026-01-31', {
            headers: fmHeaders
        });
        await expectStatus(liabilitiesPdf, [200], 'Finance Manager NASSIT liability PDF');

        const mutationAttempts = [
            { method: 'POST', path: '/finance/payroll/workflow/1/submit-to-manager', label: 'Finance payroll submission' },
            { method: 'POST', path: '/finance/payroll/workflow/1/start-correction', label: 'Finance payroll correction start' },
            { method: 'POST', path: '/finance/payroll/reversals', label: 'Finance reversal request' },
            { method: 'POST', path: '/finance/payroll/reopen', label: 'Finance reopen request' },
            { method: 'POST', path: '/manager/payroll/workflow/1/endorse', label: 'Manager endorsement' },
            { method: 'POST', path: '/auditor/payroll/review/1/endorse', label: 'Auditor review' },
            { method: 'POST', path: '/entity-head/payroll/approvals/1/approve', label: 'Entity Head approval' },
            { method: 'POST', path: '/admin/parameter-changes/1/submit', label: 'Admin parameter submit' }
        ];

        for (const attempt of mutationAttempts) {
            console.log(`Checking denial for ${attempt.label}`);
            const response = await request(attempt.path, {
                method: attempt.method,
                headers: {
                    ...fmHeaders,
                    'content-type': 'application/x-www-form-urlencoded',
                    'x-csrf-token': csrfToken
                },
                body: ''
            });
            await expectStatus(response, [403], attempt.label);
        }

        const [otherCompanyPayroll] = await pool.query(
            `SELECT id
             FROM payroll_workflow_batches
             WHERE CompanyID <> ?
             ORDER BY id DESC
             LIMIT 1`,
            [TEST_COMPANY_ID]
        );

        if (otherCompanyPayroll.length) {
            const response = await request(`/finance-manager/payroll/workflow/${otherCompanyPayroll[0].id}`, {
                headers: fmHeaders
            });
            await expectStatus(response, [302, 404], 'Cross-company payroll detail access');
        }

        const [otherCompanyStaff] = await pool.query(
            `SELECT PFNo
             FROM tblstaff
             WHERE CompanyID <> ?
             ORDER BY PFNo ASC
             LIMIT 1`,
            [TEST_COMPANY_ID]
        );

        if (otherCompanyStaff.length) {
            const response = await request(
                `/finance-manager/reports/payroll-liabilities/staff-preview?pfNo=${encodeURIComponent(otherCompanyStaff[0].PFNo)}&fromDate=2026-01-01&toDate=2026-01-31`,
                { headers: fmHeaders }
            );
            await expectStatus(response, [400], 'Cross-company staff PAYE statement access');
        }

        console.log('Finance Manager oversight verification passed.');
        console.log(`Verified ${readOnlyRoutes.length} read-only routes and ${mutationAttempts.length} mutation denials.`);
        await destroySession(financeManagerSession.sessionId);
    } finally {
        await stopServer(serverProcess);
        await pool.end();
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Finance Manager oversight verification failed:', error);
        process.exit(1);
    });
