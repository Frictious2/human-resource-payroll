const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const pool = require('./db');

const SESSION_TABLE = 'sessions';
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'hrpayroll.sid';
const DEFAULT_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 8;
const DEFAULT_EXPIRATION_SWEEP_MS = 1000 * 60 * 15;

function normalizeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isProductionEnvironment(nodeEnv = process.env.NODE_ENV) {
    return String(nodeEnv || '').trim().toLowerCase() === 'production';
}

function getSessionSecret({ isProduction = isProductionEnvironment(), sessionSecret = process.env.SESSION_SECRET } = {}) {
    const normalizedSecret = String(sessionSecret || '').trim();
    const unsafeSecrets = new Set(['secret', 'secret_key', 'changeme', 'change-me', 'password', 'development', 'dev-secret']);
    const normalizedLower = normalizedSecret.toLowerCase();
    if (isProduction && (
        !normalizedSecret
        || normalizedSecret.length < 32
        || unsafeSecrets.has(normalizedLower)
        || normalizedLower.startsWith('replace-with-')
        || normalizedLower.includes('your-secret')
    )) {
        throw new Error('SESSION_SECRET must be a strong random value of at least 32 characters before starting production.');
    }

    return normalizedSecret || 'secret_key';
}

function getSessionMaxAgeMs() {
    return normalizeNumber(process.env.SESSION_MAX_AGE_MS, DEFAULT_SESSION_MAX_AGE_MS);
}

function getTrustProxySetting({ isProduction = isProductionEnvironment() } = {}) {
    if (!isProduction) {
        return 0;
    }

    return normalizeNumber(process.env.TRUST_PROXY_HOPS, 0);
}

function getSessionCookieConfig({ isProduction = isProductionEnvironment() } = {}) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: getSessionMaxAgeMs()
    };
}

function getSessionStoreOptions() {
    return {
        clearExpired: true,
        checkExpirationInterval: normalizeNumber(process.env.SESSION_CLEANUP_INTERVAL_MS, DEFAULT_EXPIRATION_SWEEP_MS),
        expiration: getSessionMaxAgeMs(),
        createDatabaseTable: false,
        endConnectionOnClose: false,
        disableTouch: false,
        schema: {
            tableName: SESSION_TABLE,
            columnNames: {
                session_id: 'session_id',
                expires: 'expires',
                data: 'data'
            }
        }
    };
}

function createSessionStore() {
    return new MySQLStore(getSessionStoreOptions(), pool);
}

async function ensureSessionTableExists(connection = pool) {
    const [rows] = await connection.query('SHOW TABLE STATUS LIKE ?', [SESSION_TABLE]);
    if (!rows.length) {
        throw new Error(`Required session table "${SESSION_TABLE}" was not found. Apply the persistent session migration before starting the application.`);
    }

    return rows[0];
}

async function initializeSessionStore() {
    const store = createSessionStore();
    await ensureSessionTableExists(pool);
    await store.onReady();
    return store;
}

function buildSessionMiddlewareOptions({ store, isProduction = isProductionEnvironment() } = {}) {
    return {
        name: SESSION_COOKIE_NAME,
        secret: getSessionSecret({ isProduction }),
        store,
        resave: false,
        saveUninitialized: false,
        rolling: false,
        unset: 'destroy',
        cookie: getSessionCookieConfig({ isProduction })
    };
}

function getSessionStoreDescriptor(store) {
    if (!store) {
        return 'unavailable';
    }

    if (store.constructor && store.constructor.name === 'MySQLStore') {
        return 'MySQL';
    }

    return store.constructor && store.constructor.name
        ? store.constructor.name
        : 'unknown';
}

module.exports = {
    SESSION_TABLE,
    SESSION_COOKIE_NAME,
    getSessionSecret,
    getSessionMaxAgeMs,
    getTrustProxySetting,
    getSessionCookieConfig,
    getSessionStoreOptions,
    createSessionStore,
    ensureSessionTableExists,
    initializeSessionStore,
    buildSessionMiddlewareOptions,
    getSessionStoreDescriptor,
    isProductionEnvironment
};
