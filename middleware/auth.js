const authService = require('../services/authService');
const { logSecurityEvent } = require('../services/securityEventService');

function isJsonRequest(req) {
    const acceptHeader = req.get('accept') || '';
    return req.xhr || req.path.startsWith('/api/') || acceptHeader.includes('application/json');
}

function handleUnauthorized(req, res, message = 'Please sign in to continue.') {
    logSecurityEvent('UNAUTHORIZED_ROUTE', req, { outcome: 'blocked', reason: 'authentication-required' });
    if (isJsonRequest(req)) {
        return res.status(401).json({
            success: false,
            message
        });
    }

    return res.redirect('/login');
}

function handleForbidden(req, res, message = 'You are not authorized to access this page.') {
    logSecurityEvent('FORBIDDEN_ROUTE', req, { outcome: 'blocked', reason: 'role-not-authorized' });
    if (isJsonRequest(req)) {
        return res.status(403).json({
            success: false,
            message
        });
    }

    return res.status(403).render('shared/error', {
        title: 'Access Denied',
        message,
        backUrl: req.user ? '/dashboard' : '/login'
    });
}

function attachAuthenticatedUser(req, res, next) {
    const user = req.session && req.session.user ? req.session.user : null;
    req.user = user;
    res.locals.currentUser = user;
    next();
}

function requireAuth(req, res, next) {
    if (!req.user) {
        return handleUnauthorized(req, res);
    }

    return next();
}

function requireRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return handleUnauthorized(req, res);
        }

        if (!allowedRoles.includes(req.user.role)) {
            return handleForbidden(req, res);
        }

        return next();
    };
}

function redirectAuthenticatedToDashboard(req, res, next) {
    if (req.user && req.user.role) {
        return res.redirect(authService.getDashboardPathForRole(req.user.role));
    }

    return next();
}

module.exports = {
    attachAuthenticatedUser,
    requireAuth,
    requireRoles,
    redirectAuthenticatedToDashboard
};
