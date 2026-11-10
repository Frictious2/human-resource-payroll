const pool = require('../config/db');
const authService = require('./authService');
const auditTrailService = require('./auditTrailService');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mapRoleToPartialsBase(role) {
    switch (role) {
        case 'admin':
            return 'admin/partials';
        case 'manager':
            return 'manager/partials';
        case 'data-entry':
            return 'data_entry/partials';
        case 'auditor':
            return 'auditor/partials';
        case 'finance-officer':
            return 'finance/partials';
        case 'developer':
            return 'developer/partials';
        case 'entity-head':
            return 'entity_head/partials';
        default:
            return 'data_entry/partials';
    }
}

function mapRoleToLabel(role) {
    switch (role) {
        case 'admin':
            return 'Admin';
        case 'manager':
            return 'Manager';
        case 'data-entry':
            return 'Data Entry Officer';
        case 'auditor':
            return 'Auditor';
        case 'finance-officer':
            return 'Finance Officer';
        case 'developer':
            return 'Developer';
        case 'entity-head':
            return 'Entity Head';
        default:
            return 'User';
    }
}

function normalizeName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ');
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function buildValidationError(message, field) {
    const error = new Error(message);
    error.expose = true;
    error.field = field || null;
    return error;
}

async function getPortalProfileByPfno(pfno) {
    const [rows] = await pool.execute(
        `SELECT PFNo, Username, FullName, Email, Level, CompanyID
         FROM tblpassword
         WHERE PFNo = ?
         LIMIT 1`,
        [pfno]
    );

    return rows[0] || null;
}

async function getDeveloperProfileById(id) {
    const [rows] = await pool.execute(
        `SELECT ID, username, email, FullName
         FROM developer
         WHERE ID = ?
         LIMIT 1`,
        [id]
    );

    return rows[0] || null;
}

async function getProfileBySessionUser(user) {
    if (!user) {
        throw buildValidationError('Please sign in to continue.');
    }

    if (user.source === 'developer') {
        const profile = await getDeveloperProfileById(user.id);
        if (!profile) {
            throw buildValidationError('Your profile record could not be found.');
        }

        return {
            source: 'developer',
            id: profile.ID,
            username: profile.username,
            fullName: profile.FullName || '',
            email: profile.email || '',
            level: 'Developer',
            companyId: null
        };
    }

    const profile = await getPortalProfileByPfno(user.id || user.pfno);
    if (!profile) {
        throw buildValidationError('Your profile record could not be found.');
    }

    return {
        source: 'tblpassword',
        id: profile.PFNo,
        username: profile.Username,
        fullName: profile.FullName || '',
        email: profile.Email || '',
        level: profile.Level || mapRoleToLabel(user.role),
        companyId: profile.CompanyID || null
    };
}

async function ensureUniqueEmail({ email, source, id }) {
    const normalizedEmail = normalizeEmail(email);

    const [portalRows] = await pool.execute(
        `SELECT PFNo
         FROM tblpassword
         WHERE LOWER(COALESCE(Email, '')) = ?
           AND PFNo <> ?
         LIMIT 1`,
        [normalizedEmail, source === 'tblpassword' ? id : 0]
    );

    if (portalRows.length) {
        throw buildValidationError('That email address already belongs to another user.', 'email');
    }

    const [developerRows] = await pool.execute(
        `SELECT ID
         FROM developer
         WHERE LOWER(COALESCE(email, '')) = ?
           AND ID <> ?
         LIMIT 1`,
        [normalizedEmail, source === 'developer' ? id : 0]
    );

    if (developerRows.length) {
        throw buildValidationError('That email address already belongs to another user.', 'email');
    }
}

function buildProfilePageData({ sessionUser, profile, feedback, entityScope = null }) {
    return {
        title: 'Profile',
        user: sessionUser,
        profile,
        feedback,
        entityScope,
        partialsBase: mapRoleToPartialsBase(sessionUser.role),
        roleLabel: mapRoleToLabel(sessionUser.role)
    };
}

async function updateProfile({ sessionUser, fullName, email }) {
    const profile = await getProfileBySessionUser(sessionUser);
    const nextName = normalizeName(fullName);
    const nextEmail = normalizeEmail(email);
    const currentEmail = normalizeEmail(profile.email);

    if (!nextName) {
        throw buildValidationError('Full name is required.', 'fullName');
    }

    if (!nextEmail) {
        throw buildValidationError('Email is required.', 'email');
    }

    if (!EMAIL_REGEX.test(nextEmail)) {
        throw buildValidationError('Please enter a valid email address.', 'email');
    }

    if (nextEmail !== currentEmail) {
        await ensureUniqueEmail({ email: nextEmail, source: profile.source, id: profile.id });
    }

    if (profile.source === 'developer') {
        await pool.execute(
            `UPDATE developer
             SET FullName = ?, email = ?
             WHERE ID = ?`,
            [nextName, nextEmail, profile.id]
        );

        await auditTrailService.logUpdate({
            table: 'developer',
            formName: 'developer/profile',
            recordId: profile.id,
            previousRow: { FullName: profile.fullName, email: profile.email },
            nextRow: { FullName: nextName, email: nextEmail },
            changedFields: ['FullName', 'email']
        });
    } else {
        await pool.execute(
            `UPDATE tblpassword
             SET FullName = ?, Email = ?
             WHERE PFNo = ?`,
            [nextName, nextEmail, profile.id]
        );

        await auditTrailService.logUpdate({
            table: 'tblpassword',
            formName: '/profile',
            recordId: profile.id,
            previousRow: { FullName: profile.fullName, Email: profile.email, CompanyID: profile.companyId },
            nextRow: { FullName: nextName, Email: nextEmail, CompanyID: profile.companyId },
            changedFields: ['FullName', 'Email']
        });
    }

    const updatedSessionUser = authService.createSessionUser({
        ...sessionUser,
        id: sessionUser.id,
        pfno: sessionUser.pfno,
        username: sessionUser.username,
        email: nextEmail,
        name: nextName,
        fullName: nextName,
        role: sessionUser.role,
        level: sessionUser.level,
        companyId: sessionUser.companyId,
        source: sessionUser.source
    });

    return {
        updatedSessionUser,
        feedback: {
            type: 'success',
            section: 'profile',
            message: 'Profile information updated successfully.'
        }
    };
}

async function updatePassword({ sessionUser, currentPassword, newPassword, confirmPassword }) {
    await getProfileBySessionUser(sessionUser);
    const currentValue = String(currentPassword || '');
    const newValue = String(newPassword || '');
    const confirmValue = String(confirmPassword || '');

    if (!currentValue) {
        throw buildValidationError('Current password is required.', 'currentPassword');
    }

    if (!newValue) {
        throw buildValidationError('New password is required.', 'newPassword');
    }

    if (!confirmValue) {
        throw buildValidationError('Please confirm the new password.', 'confirmPassword');
    }

    if (newValue !== confirmValue) {
        throw buildValidationError('New password and confirmation do not match.', 'confirmPassword');
    }

    try {
        await require('./accountSecurityService').changeOwnPassword(sessionUser, currentValue, newValue);
    } catch (error) {
        if (error.expose) throw buildValidationError(error.message);
        throw error;
    }

    return {
        feedback: {
            type: 'success',
            section: 'password',
            message: 'Password updated successfully.'
        }
    };
}

module.exports = {
    buildProfilePageData,
    getProfileBySessionUser,
    mapRoleToLabel,
    updateProfile,
    updatePassword
};
