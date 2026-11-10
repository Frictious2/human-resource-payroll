const session = require('express-session');
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

function getExpirySeconds(sess = {}) {
    const cookie = sess.cookie || {};
    if (cookie.expires) {
        const expires = new Date(cookie.expires).getTime();
        if (Number.isFinite(expires)) {
            return Math.floor(expires / 1000);
        }
    }

    const maxAge = Number(cookie.maxAge);
    const effectiveMaxAge = Number.isFinite(maxAge) && maxAge >= 0
        ? maxAge
        : getSessionMaxAgeMs();
    return Math.floor((Date.now() + effectiveMaxAge) / 1000);
}

class MysqlSessionStore extends session.Store {
    constructor(connection = pool, options = {}) {
        super();
        this.connection = connection;
        this.cleanupIntervalMs = options.cleanupIntervalMs ?? Math.max(1000, normalizeNumber(process.env.SESSION_CLEANUP_INTERVAL_MS, DEFAULT_EXPIRATION_SWEEP_MS));
        this.cleanupBatchSize = Math.min(1000, Math.max(1, Math.floor(Number(options.cleanupBatchSize || process.env.SESSION_CLEANUP_BATCH_SIZE) || 100)));
        this.cleanupTimer = null;
        this.cleanupOperation = null;
        this.closed = false;
    }

    async onReady() {
        await ensureSessionTableExists(this.connection);
        this.startCleanup();
        return true;
    }

    startCleanup() {
        if (this.cleanupTimer || this.closed) return;
        this.cleanupTimer = setInterval(() => {
            this.clearExpiredSessions().catch(() => console.error('Session cleanup failed; will retry at next interval.'));
        }, this.cleanupIntervalMs);
        this.cleanupTimer.unref?.();
    }

    clearExpiredSessions() {
        if (this.closed) return Promise.resolve();
        if (this.cleanupOperation) return this.cleanupOperation;
        // The indexed predicate is rechecked by InnoDB; concurrent workers may safely sweep.
        this.cleanupOperation = Promise.resolve().then(() => this.connection.query(
            `DELETE FROM ${SESSION_TABLE} WHERE expires < UNIX_TIMESTAMP() ORDER BY expires LIMIT ${this.cleanupBatchSize}`
        )).finally(() => { this.cleanupOperation = null; });
        return this.cleanupOperation;
    }

    stopCleanup() {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
    }

    async getSession(sessionId) {
        const [rows] = await this.connection.query(
            `SELECT data, expires
             FROM ${SESSION_TABLE}
             WHERE session_id = ?
             LIMIT 1`,
            [sessionId]
        );
        const row = rows[0];
        if (!row) {
            return null;
        }

        if (Number(row.expires || 0) <= Math.floor(Date.now() / 1000)) {
            await this.connection.query(`DELETE FROM ${SESSION_TABLE} WHERE session_id = ? AND expires <= ?`, [sessionId, Math.floor(Date.now() / 1000)]);
            return null;
        }

        return JSON.parse(row.data);
    }

    get(sessionId, callback) {
        const operation = this.getSession(sessionId);
        if (typeof callback === 'function') {
            operation.then((payload) => callback(null, payload)).catch((error) => callback(error));
            return undefined;
        }
        return operation;
    }

    async setSession(sessionId, sess) {
        const expires = getExpirySeconds(sess);
        await this.connection.query(
            `REPLACE INTO ${SESSION_TABLE} (session_id, expires, data)
             VALUES (?, ?, ?)`,
            [sessionId, expires, JSON.stringify(sess)]
        );
    }

    set(sessionId, sess, callback) {
        const operation = this.setSession(sessionId, sess);
        if (typeof callback === 'function') {
            operation.then(() => callback(null)).catch((error) => callback(error));
            return undefined;
        }
        return operation;
    }

    async destroySession(sessionId) {
        await this.connection.query(
            `DELETE FROM ${SESSION_TABLE}
             WHERE session_id = ?`,
            [sessionId]
        );
    }

    destroy(sessionId, callback) {
        const operation = this.destroySession(sessionId);
        if (typeof callback === 'function') {
            operation.then(() => callback(null)).catch((error) => callback(error));
            return undefined;
        }
        return operation;
    }

    touch(sessionId, sess, callback) {
        const operation = this.connection.query(
            `UPDATE ${SESSION_TABLE} SET expires = ? WHERE session_id = ?`,
            [getExpirySeconds(sess), sessionId]
        );
        if (typeof callback === 'function') {
            operation.then(() => callback(null)).catch(callback);
            return;
        }
        return operation;
    }

    close(callback) {
        this.closed = true;
        this.stopCleanup();
        const operation = Promise.resolve(this.cleanupOperation).then(() => undefined);
        if (typeof callback === 'function') operation.then(() => callback(null)).catch(callback);
        return operation;
    }
}

function createSessionStore() {
    return new MysqlSessionStore(pool);
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

    if (store.constructor && (store.constructor.name === 'MysqlSessionStore' || store.constructor.name === 'MySQLStore')) {
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
    MysqlSessionStore,
    createSessionStore,
    ensureSessionTableExists,
    initializeSessionStore,
    buildSessionMiddlewareOptions,
    getSessionStoreDescriptor,
    isProductionEnvironment
};
