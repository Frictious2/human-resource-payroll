const bcrypt = require('bcrypt');
const pool = require('../config/db');

const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'];

const DEFAULT_SEED_DEVELOPER = {
    username: process.env.SEED_DEVELOPER_USERNAME || 'developer',
    email: process.env.SEED_DEVELOPER_EMAIL || 'developer@hrpayroll.local',
    password: process.env.SEED_DEVELOPER_PASSWORD || 'Developer@123',
    fullName: process.env.SEED_DEVELOPER_FULLNAME || 'Seed Developer'
};

function isBcryptHash(value) {
    return typeof value === 'string' && BCRYPT_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function normalizeIdentifier(identifier) {
    return String(identifier || '').trim().toLowerCase();
}

function normalizeRole(level, source = 'tblpassword') {
    if (source === 'developer') {
        return 'developer';
    }

    const normalizedLevel = String(level || '').trim().toLowerCase();

    if (normalizedLevel === 'admin') return 'admin';
    if (normalizedLevel === 'manager') return 'manager';
    if (normalizedLevel === 'data entry' || normalizedLevel === 'data-entry' || normalizedLevel === 'user') return 'data-entry';
    if (normalizedLevel === 'auditor') return 'auditor';
    if (normalizedLevel === 'developer') return 'developer';

    return null;
}

function getDashboardPathForRole(role) {
    switch (role) {
        case 'developer':
            return '/developer/dashboard';
        case 'admin':
            return '/admin/dashboard';
        case 'manager':
            return '/manager/dashboard';
        case 'data-entry':
            return '/data-entry/dashboard';
        case 'auditor':
            return '/auditor/dashboard';
        default:
            return '/login';
    }
}

function createSessionUser(payload) {
    return {
        id: payload.id,
        pfno: payload.pfno || null,
        username: payload.username || '',
        email: payload.email || '',
        name: payload.name || payload.username || payload.email || 'User',
        fullName: payload.fullName || payload.name || '',
        role: payload.role,
        level: payload.level || null,
        companyId: payload.companyId || null,
        source: payload.source
    };
}

async function verifyPassword({ storedPassword, password, onLegacyUpgrade }) {
    if (!storedPassword || !password) {
        return false;
    }

    if (isBcryptHash(storedPassword)) {
        return bcrypt.compare(password, storedPassword);
    }

    const trimmedPassword = String(storedPassword).trim();
    if (!trimmedPassword || /^\*+$/.test(trimmedPassword)) {
        return false;
    }

    const matches = trimmedPassword === password;
    if (matches && typeof onLegacyUpgrade === 'function') {
        const upgradedHash = await bcrypt.hash(password, 10);
        await onLegacyUpgrade(upgradedHash);
    }

    return matches;
}

async function authenticateDeveloper(identifier, password) {
    const [rows] = await pool.execute(
        `SELECT ID, username, email, password, FullName
         FROM developer
         WHERE LOWER(COALESCE(email, '')) = ? OR LOWER(COALESCE(username, '')) = ?
         LIMIT 1`,
        [identifier, identifier]
    );

    if (!rows.length) {
        return null;
    }

    const developer = rows[0];
    const passwordMatches = await verifyPassword({
        storedPassword: developer.password,
        password,
        onLegacyUpgrade: async (hash) => {
            await pool.execute('UPDATE developer SET password = ? WHERE ID = ?', [hash, developer.ID]);
        }
    });

    if (!passwordMatches) {
        return null;
    }

    return createSessionUser({
        id: developer.ID,
        username: developer.username,
        email: developer.email,
        name: developer.FullName || developer.username,
        fullName: developer.FullName || developer.username,
        role: 'developer',
        source: 'developer'
    });
}

async function authenticatePortalUser(identifier, password) {
    const [rows] = await pool.execute(
        `SELECT PFNo, Username, FullName, Email, Pword, CompanyID, Level
         FROM tblpassword
         WHERE LOWER(COALESCE(Email, '')) = ? OR LOWER(COALESCE(Username, '')) = ?
         ORDER BY PFNo DESC`,
        [identifier, identifier]
    );

    for (const row of rows) {
        const role = normalizeRole(row.Level, 'tblpassword');
        if (!role) {
            continue;
        }

        const passwordMatches = await verifyPassword({
            storedPassword: row.Pword,
            password,
            onLegacyUpgrade: async (hash) => {
                await pool.execute('UPDATE tblpassword SET Pword = ? WHERE PFNo = ?', [hash, row.PFNo]);
            }
        });

        if (!passwordMatches) {
            continue;
        }

        return createSessionUser({
            id: row.PFNo,
            pfno: row.PFNo,
            username: row.Username,
            email: row.Email,
            name: row.FullName || row.Username,
            fullName: row.FullName || row.Username,
            role,
            level: row.Level,
            companyId: row.CompanyID,
            source: 'tblpassword'
        });
    }

    return null;
}

async function authenticateUser({ identifier, password }) {
    const normalizedIdentifier = normalizeIdentifier(identifier);
    const normalizedPassword = String(password || '');

    if (!normalizedIdentifier || !normalizedPassword) {
        return {
            success: false,
            message: 'Username/email and password are required.'
        };
    }

    const developer = await authenticateDeveloper(normalizedIdentifier, normalizedPassword);
    if (developer) {
        return { success: true, user: developer };
    }

    const portalUser = await authenticatePortalUser(normalizedIdentifier, normalizedPassword);
    if (portalUser) {
        return { success: true, user: portalUser };
    }

    return {
        success: false,
        message: 'Invalid credentials or password not set.'
    };
}

async function ensureSeedDeveloper() {
    const [rows] = await pool.execute(
        `SELECT ID
         FROM developer
         WHERE LOWER(COALESCE(username, '')) = ? OR LOWER(COALESCE(email, '')) = ?
         LIMIT 1`,
        [DEFAULT_SEED_DEVELOPER.username.toLowerCase(), DEFAULT_SEED_DEVELOPER.email.toLowerCase()]
    );

    if (rows.length) {
        return {
            created: false,
            ...DEFAULT_SEED_DEVELOPER
        };
    }

    const passwordHash = await bcrypt.hash(DEFAULT_SEED_DEVELOPER.password, 10);
    const [result] = await pool.execute(
        `INSERT INTO developer (FullName, username, email, password, createdBy)
         VALUES (?, ?, ?, ?, ?)`,
        [
            DEFAULT_SEED_DEVELOPER.fullName,
            DEFAULT_SEED_DEVELOPER.username,
            DEFAULT_SEED_DEVELOPER.email,
            passwordHash,
            'system-seed'
        ]
    );

    return {
        created: true,
        id: result.insertId,
        ...DEFAULT_SEED_DEVELOPER
    };
}

module.exports = {
    authenticateUser,
    createSessionUser,
    ensureSeedDeveloper,
    getDashboardPathForRole,
    normalizeRole
};
