const authService = require('../services/authService');

function isJsonRequest(req) {
    const acceptHeader = req.get('accept') || '';
    return req.xhr || req.path.startsWith('/api/') || acceptHeader.includes('application/json');
}

function handleUnauthorized(req, res, message = 'Please sign in to continue.') {
    if (isJsonRequest(req)) {
        return res.status(401).json({
            success: false,
            message
        });
    }

    return res.redirect('/login');
}

function handleForbidden(req, res, message = 'You are not authorized to access this page.') {
    if (isJsonRequest(req)) {
        return res.status(403).json({
            success: false,
            message
        });
    }

    return res.status(403).render('shared/coming-soon', {
        role: req.user ? req.user.role : 'user',
        title: 'Access Denied',
        group: 'Security',
        user: req.user || { name: 'User' },
        message
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
