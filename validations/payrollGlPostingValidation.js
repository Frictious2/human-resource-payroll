const ALLOWED_ACTIVITY_CODES = new Set(['01', '02', '05', '08', '09', '13', '15']);
const ALLOWED_ROLES = new Set([
    'payroll admin',
    'accountant manager',
    'hr/payroll super admin',
    'payroll_admin',
    'accountant_manager',
    'hr_payroll_super_admin'
]);

function normalizeRole(role) {
    return String(role || '')
        .trim()
        .toLowerCase();
}

function parsePositiveInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveAuthenticatedUser(req) {
    return req.user || (req.session && req.session.user) || null;
}

function resolveUserId(user) {
    const userId = parsePositiveInteger(
        user && (user.id || user.user_id || user.UserID || user.PFNo)
    );
    if (!userId) {
        // Temporary compatibility fallback for the current session stub,
        // which often contains only name/email until full auth is wired.
        return 1;
    }

    return userId;
}

function assertAuthorizedUser(user, companyId) {
    if (!user) {
        const error = new Error('Authentication is required.');
        error.statusCode = 401;
        throw error;
    }

    const normalizedRole = normalizeRole(user.role || user.userType || user.level || '');
    if (!ALLOWED_ROLES.has(normalizedRole)) {
        const error = new Error('You are not authorized to post payroll activities to GL accounts.');
        error.statusCode = 403;
        throw error;
    }

    const userCompanyId = parsePositiveInteger(user.company_id || user.companyId || user.CompanyID);
    if (userCompanyId && companyId && userCompanyId !== companyId) {
        const error = new Error('You are not allowed to post for another company.');
        error.statusCode = 403;
        throw error;
    }
}

function validatePostingPayload(payload) {
    const companyId = parsePositiveInteger(payload.companyId);
    const activityCode = String(payload.activityCode || '').trim();
    const postingDate = String(payload.postingDate || '').trim();

    if (!companyId) {
        const error = new Error('companyId is required.');
        error.statusCode = 400;
        throw error;
    }

    if (!activityCode) {
        const error = new Error('activityCode is required.');
        error.statusCode = 400;
        throw error;
    }

    if (!ALLOWED_ACTIVITY_CODES.has(activityCode)) {
        const error = new Error('activityCode is invalid.');
        error.statusCode = 400;
        throw error;
    }

    if (!postingDate) {
        const error = new Error('postingDate is required.');
        error.statusCode = 400;
        throw error;
    }

    const parsedPostingDate = new Date(`${postingDate}T00:00:00`);
    if (Number.isNaN(parsedPostingDate.getTime())) {
        const error = new Error('postingDate must be a valid date.');
        error.statusCode = 400;
        throw error;
    }

    return {
        companyId,
        activityCode,
        postingDate: parsedPostingDate,
        postingMonth: parsedPostingDate.getMonth() + 1,
        postingYear: parsedPostingDate.getFullYear()
    };
}

function validateHistoryQuery(query) {
    return {
        companyId: parsePositiveInteger(query.companyId),
        activityCode: query.activityCode ? String(query.activityCode).trim() : null,
        month: parsePositiveInteger(query.month),
        year: parsePositiveInteger(query.year),
        status: query.status ? String(query.status).trim() : null,
        page: parsePositiveInteger(query.page) || 1,
        pageSize: Math.min(parsePositiveInteger(query.pageSize) || 20, 100)
    };
}

function validateBatchId(value) {
    const batchId = parsePositiveInteger(value);
    if (!batchId) {
        const error = new Error('A valid posting batch id is required.');
        error.statusCode = 400;
        throw error;
    }

    return batchId;
}

module.exports = {
    assertAuthorizedUser,
    resolveAuthenticatedUser,
    resolveUserId,
    validateBatchId,
    validateHistoryQuery,
    validatePostingPayload
};
