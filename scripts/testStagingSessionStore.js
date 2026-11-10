require('dotenv').config({ quiet: true, override: true });
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const pool = require('../config/db');
const { MysqlSessionStore, ensureSessionTableExists, getSessionCookieConfig, getSessionSecret } = require('../config/sessionStore');
const { validateProductionEnvironment } = require('../services/environmentValidationService');

async function main() {
    const store = new MysqlSessionStore(pool);
    if (process.argv[2] === '--reader') {
        const data = await store.get(process.argv[3]);
        assert.equal(data?.testMarker, 'staging-session-check');
        console.log('CHILD_READ_PASS');
        return;
    }
    const prefix = `waec-stage-${crypto.randomUUID()}-`;
    const ids = Array.from({ length: 5 }, (_, i) => `${prefix}${i}`);
    const payload = { testMarker: 'staging-session-check', cookie: { maxAge: 60000 } };
    try {
        await ensureSessionTableExists(pool);
        await store.set(ids[0], payload);
        assert.equal((await store.get(ids[0])).testMarker, payload.testMarker);
        const second = new MysqlSessionStore(pool);
        assert.equal((await second.get(ids[0])).testMarker, payload.testMarker);
        await Promise.all(ids.slice(1, 4).map(id => second.set(id, payload)));
        assert((await Promise.all(ids.slice(0, 4).map(id => store.get(id)))).every(Boolean));
        await store.touch(ids[0], { ...payload, cookie: { maxAge: 120000 } });
        await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [__filename, '--reader', ids[0]], {
                cwd: require('node:path').resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe']
            });
            let output = '';
            const timer = setTimeout(() => { child.kill(); reject(new Error('Child session read timed out')); }, 30000);
            child.stdout.on('data', chunk => { output += chunk; });
            child.stderr.on('data', () => {});
            child.on('error', error => { clearTimeout(timer); reject(error); });
            child.on('exit', code => {
                clearTimeout(timer);
                if (code === 0 && output.includes('CHILD_READ_PASS')) resolve();
                else reject(new Error('Independent process could not read session'));
            });
        });
        await store.set(ids[4], { ...payload, cookie: { expires: new Date(Date.now() - 1000).toISOString() } });
        assert.equal(await store.get(ids[4]), null);
        await store.destroy(ids[1]);
        assert.equal(await second.get(ids[1]), null);
        await store.close();
        await pool.query('SELECT 1');
        const failed = new MysqlSessionStore({ query: async () => { throw new Error('fixture disconnect'); } });
        await assert.rejects(failed.get('fixture'), /fixture disconnect/);
        assert.equal((await second.get(ids[0])).testMarker, payload.testMarker);
        const cookie = getSessionCookieConfig({ isProduction: true });
        assert.equal(cookie.secure, true);
        assert.equal(cookie.httpOnly, true);
        assert.equal(cookie.sameSite, 'lax');
        assert.throws(() => getSessionSecret({ isProduction: true, sessionSecret: '' }));
        const config = { SESSION_SECRET: crypto.randomBytes(48).toString('hex'), RESET_TOKEN_SECRET: crypto.randomBytes(48).toString('hex'), DB_HOST: '127.0.0.1', DB_NAME: 'fixture',
            DB_USER: 'fixture', DB_PASSWORD: 'fixture', INSTALLATION_COMPANY_ID: '1', APP_BASE_URL: 'https://staging.example.org', TRUST_PROXY_HOPS: '1' };
        assert.equal(validateProductionEnvironment(config).valid, true);
        assert.equal(validateProductionEnvironment({}).valid, false);
        console.log('PASS: DB sessions create/read/touch/expiry/delete; concurrent distinct sessions; independent process read; pool ownership; simulated query failure propagation; production cookie/validation checks.');
        console.log('NOT TESTED: live login/logout/regeneration, database outage recovery, HTTPS proxy or automatic cleanup scheduler.');
    } finally {
        for (const id of ids) await store.destroy(id);
        const [remaining] = await pool.query('SELECT session_id FROM sessions WHERE session_id IN (?, ?, ?, ?, ?)', ids);
        assert.equal(remaining.length, 0);
        console.log('CLEANUP PASS: only five uniquely marked test sessions removed. No user or financial fixtures.');
    }
}

main().catch(error => {
    console.error('FAIL:', error.code || error.message);
    process.exitCode = 1;
}).finally(() => pool.end());
