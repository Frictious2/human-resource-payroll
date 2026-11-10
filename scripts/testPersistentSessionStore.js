#!/usr/bin/env node
require('dotenv').config({ override: true });
require('./requireDisposableDatabase')();

const assert = require('assert');
const crypto = require('crypto');
const { spawn } = require('child_process');
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const {
    SESSION_TABLE,
    ensureSessionTableExists,
    getSessionSecret,
    getSessionStoreDescriptor,
    initializeSessionStore
} = require('../config/sessionStore');

const TEST_PORT = Number(process.env.SESSION_TEST_PORT || 3116);
const TEST_COMPANY_ID = 2;
const TEST_TIMEOUT_MS = 30000;

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCookieHeader(setCookieHeaders) {
    return (setCookieHeaders || [])
        .map((value) => String(value).split(';')[0].trim())
        .filter(Boolean)
        .join('; ');
}

function extractCsrfToken(html) {
    const match = String(html || '').match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i)
        || String(html || '').match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i);
    assert(match, 'Expected a CSRF token in the rendered page.');
    return match[1];
}

function parseSessionIdFromCookie(cookieHeader, cookieName = process.env.SESSION_COOKIE_NAME || 'hrpayroll.sid') {
    const match = String(cookieHeader || '')
        .split(/;\s*/)
        .find((entry) => entry.startsWith(`${cookieName}=`));

    assert(match, 'Authenticated cookie was not returned by the application.');
    const rawValue = decodeURIComponent(match.slice(cookieName.length + 1));
    const unsignedValue = rawValue.startsWith('s:') ? rawValue.slice(2) : rawValue;
    const dotIndex = unsignedValue.lastIndexOf('.');
    assert(dotIndex > 0, 'Unable to parse the signed session identifier from the cookie.');
    return unsignedValue.slice(0, dotIndex);
}

async function createTemporaryPortalAccount({ username, email, password, fullName }) {
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.execute(
        `INSERT INTO tblpassword (DateCreated, Username, Email, Pword, FullName, Level, CompanyID)
         VALUES (NOW(), ?, ?, ?, ?, 'Finance Manager', ?)`,
        [username, email, passwordHash, fullName, TEST_COMPANY_ID]
    );
}

async function deleteTemporaryPortalAccount(email) {
    await pool.execute(
        'DELETE FROM tblpassword WHERE Email = ? AND CompanyID = ?',
        [email, TEST_COMPANY_ID]
    );
}

async function countSessionRows(sessionId) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM ${SESSION_TABLE}
         WHERE session_id = ?`,
        [sessionId]
    );

    return Number(rows[0]?.total || 0);
}

function startServer(envOverrides = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['server.js'], {
            cwd: require('path').join(__dirname, '..'),
            env: {
                ...process.env,
                INSTALLATION_COMPANY_ID: String(TEST_COMPANY_ID),
                PORT: String(TEST_PORT),
                NODE_ENV: envOverrides.NODE_ENV || 'development',
                SESSION_SECRET: envOverrides.SESSION_SECRET || process.env.SESSION_SECRET || 'phase16a-session-secret',
                ...envOverrides
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error('Timed out while starting the application server.'));
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
            reject(new Error(`Application server exited early with code ${code}. ${stderr}`.trim()));
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

async function request(pathname, options = {}) {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}${pathname}`, {
        redirect: 'manual',
        ...options
    });
    return response;
}

async function runDirectStoreChecks(store) {
    const roles = [
        'admin',
        'finance-officer',
        'manager',
        'auditor',
        'data-entry',
        'entity-head',
        'staff'
    ];

    for (const role of roles) {
        const sid = `phase16a-${role}-${Date.now()}-${crypto.randomUUID()}`;
        const sessionData = {
            cookie: {
                maxAge: 15 * 60 * 1000
            },
            user: {
                id: `${role}-tester`,
                name: `${role} tester`,
                role,
                companyId: TEST_COMPANY_ID
            },
            companyId: TEST_COMPANY_ID,
            CompanyID: TEST_COMPANY_ID
        };

        await store.set(sid, sessionData);
        const stored = await store.get(sid);
        assert(stored, `Expected persisted session payload for role ${role}.`);
        assert.strictEqual(stored.user.role, role, `Expected persisted role ${role}.`);
        assert.strictEqual(stored.companyId, TEST_COMPANY_ID, 'Expected persisted companyId.');
        assert.strictEqual(stored.CompanyID, TEST_COMPANY_ID, 'Expected persisted CompanyID.');
        await store.destroy(sid);
    }

    const expiredSessionId = `phase16a-expired-${Date.now()}-${crypto.randomUUID()}`;
    await store.set(expiredSessionId, {
        cookie: {
            expires: new Date(Date.now() - 60 * 1000)
        },
        user: {
            id: 'expired-user',
            role: 'developer'
        }
    });

    const expiredPayload = await store.get(expiredSessionId);
    assert.strictEqual(expiredPayload, null, 'Expired session should not be returned by the store.');
    if (typeof store.clearExpiredSessions === 'function') {
        await store.clearExpiredSessions();
    }
}

async function runAuthenticatedRestartTest() {
    const uniqueSuffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const username = `qa_session_${crypto.randomBytes(6).toString('hex')}`;
    const email = `qa_session_${uniqueSuffix}@example.test`;
    const password = 'Phase16A!123';
    const fullName = 'Synthetic Session Finance Manager';

    await createTemporaryPortalAccount({ username, email, password, fullName });

    let child;
    try {
        child = await startServer();
        await wait(1500);

        const loginPage = await request('/login');
        const anonymousCookie = buildCookieHeader(loginPage.headers.getSetCookie());
        const loginToken = extractCsrfToken(await loginPage.text());

        const loginResponse = await request('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Cookie: anonymousCookie
            },
            body: new URLSearchParams({
                identifier: email,
                password,
                _csrf: loginToken
            }).toString()
        });

        assert.strictEqual(loginResponse.status, 302, 'Successful login should redirect.');
        const cookieHeader = buildCookieHeader(loginResponse.headers.getSetCookie());
        const sessionId = parseSessionIdFromCookie(cookieHeader);
        assert((await countSessionRows(sessionId)) === 1, 'Expected a persisted session row after login.');

        const protectedResponse = await request('/dashboard', {
            headers: {
                Cookie: cookieHeader
            }
        });
        assert.strictEqual(protectedResponse.status, 302, 'Authenticated dashboard request should redirect to the role dashboard.');
        assert.strictEqual(protectedResponse.headers.get('location'), '/finance-manager/dashboard', 'Company-scoped session should resolve to its dashboard.');

        await stopServer(child);
        child = await startServer();
        await wait(1500);

        const postRestartResponse = await request('/dashboard', {
            headers: {
                Cookie: cookieHeader
            }
        });
        assert.strictEqual(postRestartResponse.status, 302, 'Session should survive a Node restart.');
        assert.strictEqual(postRestartResponse.headers.get('location'), '/finance-manager/dashboard', 'Restarted session should still resolve to its dashboard.');

        const portalPage = await request('/finance-manager/dashboard', {
            headers: {
                Cookie: cookieHeader
            }
        });
        const logoutToken = extractCsrfToken(await portalPage.text());
        const logoutResponse = await request('/logout', {
            method: 'POST',
            headers: {
                Cookie: cookieHeader,
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-CSRF-Token': logoutToken
            },
            body: new URLSearchParams().toString()
        });
        assert.strictEqual(logoutResponse.status, 302, 'Logout should redirect.');
        await wait(1000);
        assert.strictEqual(await countSessionRows(sessionId), 0, 'Logout should remove the persisted session row.');
    } finally {
        await stopServer(child).catch(() => {});
        await deleteTemporaryPortalAccount(email).catch(() => {});
    }
}

async function main() {
    let store = null;
    try {
        await ensureSessionTableExists();
        store = await initializeSessionStore();
        assert.strictEqual(getSessionStoreDescriptor(store), 'MySQL', 'Production session store should be MySQL-backed.');
        assert.ok(getSessionSecret({ isProduction: true, sessionSecret: 'phase16a-production-secret-with-strong-entropy' }), 'Expected production secret resolution to succeed.');
        assert.throws(
            () => getSessionSecret({ isProduction: true, sessionSecret: '' }),
            /SESSION_SECRET must be a strong random value/,
            'Expected production startup to require a real SESSION_SECRET.'
        );

        await runDirectStoreChecks(store);
        await runAuthenticatedRestartTest();

        console.log('Persistent MySQL session store verification passed.');
    } finally {
        if (store && typeof store.close === 'function') {
            await store.close().catch(() => {});
        }
        await pool.end();
    }
}

main().catch((error) => {
    console.error('Persistent MySQL session store verification failed.');
    console.error(error.stack || error.message || error);
    process.exit(1);
});
