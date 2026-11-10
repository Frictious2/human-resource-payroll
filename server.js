const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
// Deployment variables take precedence except SMTP, which is project .env-only.
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('./config/smtpEnvironment').loadSmtpEnvironment();

const requestContextMiddleware = require('./middleware/requestContext');
const { attachAuthenticatedUser, requireAuth, requireRoles, redirectAuthenticatedToDashboard } = require('./middleware/auth');
const { attachBranding } = require('./middleware/branding');
const { attachNotificationSummary } = require('./middleware/notificationContext');
const authService = require('./services/authService');
const auditTrailService = require('./services/auditTrailService');
const {
    buildSessionMiddlewareOptions,
    getSessionSecret,
    getTrustProxySetting,
    initializeSessionStore,
    isProductionEnvironment
} = require('./config/sessionStore');

const adminRoutes = require('./routes/admin');
const developerRoutes = require('./routes/developer');
const managerRoutes = require('./routes/manager');
const dataEntryRoutes = require('./routes/dataEntry');
const auditorRoutes = require('./routes/auditor');
const entityHeadRoutes = require('./routes/entityHead');
const financeRoutes = require('./routes/finance');
const financeManagerRoutes = require('./routes/financeManager');
const profileRoutes = require('./routes/profile');
const notificationRoutes = require('./routes/notifications');
const workQueueRoutes = require('./routes/workQueue');
const entityHeadAccessMiddleware = require('./middleware/entityHeadAccess');
const {
    createCsrfProtectionMiddleware,
    createCsrfViewMiddleware,
    createLoginRateLimiter,
    createSecurityHeadersMiddleware,
    initializeSessionCsrfToken,
    isCsrfError
} = require('./middleware/security');
const { assertEnvironmentIsSafe } = require('./services/environmentValidationService');
const { logSecurityEvent } = require('./services/securityEventService');

function renderLogin(req, res, error = null, identifier = '', options = {}) {
    res.render('login', {
        error,
        identifier,
        pageTitle: options.pageTitle || 'Sign In - HR & Payroll',
        accessTitle: options.accessTitle || 'Sign in',
        accessCopy: options.accessCopy || 'Enter your username or email and password to continue.',
        formAction: options.formAction || '/login'
    });
}

async function handleLogin(req, res, options = {}) {
    const identifier = req.body.identifier || req.body.email || '';
    const password = req.body.password || '';

    try {
        const authResult = await authService.authenticateUser({ identifier, password });
        if (!authResult.success) {
            logSecurityEvent('LOGIN_FAILED', req, { outcome: 'denied', reason: 'invalid-credentials' });
            return res.status(401).render('login', {
                error: authResult.message,
                identifier,
                pageTitle: options.pageTitle || 'Sign In - HR & Payroll',
                accessTitle: options.accessTitle || 'Sign in',
                accessCopy: options.accessCopy || 'Enter your username or email and password to continue.',
                formAction: options.formAction || '/login'
            });
        }

        if (options.expectedRole && authResult.user.role !== options.expectedRole) {
            logSecurityEvent('LOGIN_FAILED', req, { outcome: 'denied', reason: 'wrong-login-area' });
            return res.status(403).render('login', {
                error: options.wrongRoleMessage || 'This login area is not available for your account.',
                identifier,
                pageTitle: options.pageTitle || 'Sign In - HR & Payroll',
                accessTitle: options.accessTitle || 'Sign in',
                accessCopy: options.accessCopy || 'Enter your username or email and password to continue.',
                formAction: options.formAction || '/login'
            });
        }

        await new Promise((resolve, reject) => {
            req.session.regenerate((sessionError) => {
                if (sessionError) {
                    reject(sessionError);
                    return;
                }
                resolve();
            });
        });

        req.session.user = authResult.user;
        req.session.companyId = authResult.user.companyId || null;
        req.session.CompanyID = authResult.user.companyId || null;
        // Persist one token before redirects/assets can load the regenerated session concurrently.
        initializeSessionCsrfToken(req);
        await new Promise((resolve, reject) => {
            req.session.save((sessionError) => {
                if (sessionError) {
                    reject(sessionError);
                    return;
                }
                resolve();
            });
        });

        await auditTrailService.logAuthEvent({
            action: 'Logged On',
            userName: authResult.user.name || authResult.user.username || authResult.user.email,
            formName: authResult.user.role === 'developer' ? 'developer/auth' : 'auth',
            companyId: authResult.user.companyId || null,
            loggedout: 0
        });

        return res.redirect(authService.getDashboardPathForRole(authResult.user.role));
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).render('login', {
            error: 'Unable to sign in right now. Please try again.',
            identifier,
            pageTitle: options.pageTitle || 'Sign In - HR & Payroll',
            accessTitle: options.accessTitle || 'Sign in',
            accessCopy: options.accessCopy || 'Enter your username or email and password to continue.',
            formAction: options.formAction || '/login'
        });
    }
}

function adminAccessMiddleware(req, res, next) {
    if (req.path === '/admins/set-password') {
        return next();
    }

    return requireRoles('admin')(req, res, next);
}

function developerAccessMiddleware(req, res, next) {
    if (/^\/admins\/[^/]+\/set-password$/.test(req.path)) {
        return next();
    }

    return requireRoles('developer')(req, res, next);
}

function createApp({ sessionStore } = {}) {
    const app = express();
    const isProduction = isProductionEnvironment();

    assertEnvironmentIsSafe(process.env);
    getSessionSecret({ isProduction });

    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.set('trust proxy', getTrustProxySetting({ isProduction }));
    app.disable('x-powered-by');

    app.use(createSecurityHeadersMiddleware({ isProduction }));
    const publicFiles = express.static(path.join(__dirname, 'public'));
    app.use((req, res, next) => {
        // Never let express.static fall through to a confidential upload.
        let url;
        try { url = decodeURIComponent(req.path).replace(/\\/g, '/').toLowerCase(); }
        catch { return res.sendStatus(400); }
        if (url.split('/').includes('uploads')) return next();
        return publicFiles(req, res, next);
    });
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.use(session(buildSessionMiddlewareOptions({
        store: sessionStore,
        isProduction
    })));

    app.use(requestContextMiddleware);
    app.use(attachAuthenticatedUser);
    app.use(require('./middleware/installationCompany'));
    app.use('/uploads', require('./services/privateFileService').createPrivateFileHandler());
    app.use(createCsrfProtectionMiddleware());
    app.use(createCsrfViewMiddleware());
    app.use(attachBranding);
    app.use(attachNotificationSummary);

    const loginRateLimiter = createLoginRateLimiter();
    const accountRateLimiter = require('express-rate-limit').rateLimit({
        windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
        message: 'Too many account setup attempts. Please try again later.'
    });
    app.use((req, res, next) => (/\/set-password$|\/resend-link$|^\/profile\/password$/.test(req.path)
        || (['POST','PATCH','DELETE'].includes(req.method) && /^\/(admin|developer)\/(api\/)?(admins|developers|managers|finance-managers|finance-officers|data-entry-officers|auditors|entity-heads)(\/[^/]+)?$/.test(req.path)))
        ? accountRateLimiter(req, res, next) : next());

    app.get('/', (req, res) => {
        if (req.user) {
            return res.redirect('/dashboard');
        }

        return res.redirect('/login');
    });

    app.get('/login', redirectAuthenticatedToDashboard, (req, res) => {
        renderLogin(req, res);
    });

    app.post('/login', loginRateLimiter, redirectAuthenticatedToDashboard, async (req, res) => {
        return handleLogin(req, res);
    });

    app.get('/entity-head/login', redirectAuthenticatedToDashboard, (req, res) => {
        renderLogin(req, res, null, '', {
            pageTitle: 'Entity Head Sign In - HR & Payroll',
            accessTitle: 'Entity Head sign in',
            accessCopy: 'Sign in to access the read-only dashboard and reports for your assigned entity.',
            formAction: '/entity-head/login'
        });
    });

    app.post('/entity-head/login', loginRateLimiter, redirectAuthenticatedToDashboard, async (req, res) => {
        return handleLogin(req, res, {
            expectedRole: 'entity-head',
            wrongRoleMessage: 'This login area is reserved for Entity Head accounts only.',
            pageTitle: 'Entity Head Sign In - HR & Payroll',
            accessTitle: 'Entity Head sign in',
            accessCopy: 'Sign in to access the read-only dashboard and reports for your assigned entity.',
            formAction: '/entity-head/login'
        });
    });

    app.get('/dashboard', (req, res) => {
        if (!req.user) {
            return res.redirect('/login');
        }

        return res.redirect(authService.getDashboardPathForRole(req.user.role));
    });

    app.use('/admin', adminAccessMiddleware, adminRoutes);
    app.use('/developer', developerAccessMiddleware, developerRoutes);
    app.use('/manager', requireRoles('manager'), managerRoutes);
    app.use('/data-entry', requireRoles('data-entry'), dataEntryRoutes);
    app.use('/finance', requireRoles('finance-officer'), financeRoutes);
    app.use('/finance-manager', requireRoles('finance-manager'), financeManagerRoutes);
    app.use('/auditor', requireRoles('auditor'), auditorRoutes);
    app.use('/entity-head', requireRoles('entity-head'), entityHeadAccessMiddleware, entityHeadRoutes);
    app.use('/profile', requireAuth, profileRoutes);
    app.use('/notifications', requireAuth, notificationRoutes);
    app.use('/work-queue', requireAuth, workQueueRoutes);

    app.get('/favicon.ico', async (req, res) => {
        try {
            const pool = require('./config/db');
            const [rows] = await pool.query(
                `SELECT LogoPath
                 FROM tblcominfo
                 WHERE CompanyID = ? AND LogoPath IS NOT NULL
                   AND LogoPath <> ''
                 ORDER BY CompanyID ASC
                 LIMIT 1`, [require('./services/installationCompanyService').getInstallationCompanyId()]
            );

            const logoPath = rows[0] && rows[0].LogoPath ? String(rows[0].LogoPath).trim() : '';
            if (!logoPath) {
                return res.status(204).end();
            }

            const normalizedPath = logoPath.replace(/^\/+/, '').replace(/\//g, path.sep);
            const absolutePath = path.join(__dirname, 'public', normalizedPath);

            if (!absolutePath.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(absolutePath)) {
                return res.status(204).end();
            }

            return res.sendFile(absolutePath, {
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });
        } catch (error) {
            console.error('Favicon error:', error);
            return res.status(204).end();
        }
    });

    app.post('/logout', requireAuth, async (req, res) => {
        const userName = req.user
            ? (req.user.name || req.user.username || req.user.email)
            : 'System';
        const companyId = req.user ? req.user.companyId || null : null;

        try {
            await auditTrailService.logAuthEvent({
                action: 'Logged Off',
                userName,
                formName: req.user?.role === 'developer' ? 'developer/auth' : 'auth',
                companyId,
                loggedout: 1
            });
        } catch (error) {
            console.error('Logout audit error:', error);
        }

        req.session.destroy((sessionError) => {
            if (sessionError) {
                console.error('Session destroy error:', sessionError);
            }
            res.clearCookie(buildSessionMiddlewareOptions({ isProduction }).name, {
                path: '/',
                httpOnly: true,
                sameSite: 'lax',
                secure: isProduction
            });
            res.redirect('/login');
        });
    });

    app.get('/logout', (req, res) => {
        return res.status(405).render('shared/error', {
            title: 'Method not allowed',
            message: 'Please use the secure Logout action from the account menu.',
            backUrl: req.user ? '/dashboard' : '/login'
        });
    });

    app.use((req, res) => {
        if (req.xhr || String(req.get('accept') || '').includes('application/json')) {
            return res.status(404).json({ success: false, message: 'The requested resource was not found.' });
        }
        return res.status(404).render('shared/error', {
            title: 'Page not found',
            message: 'The requested page is not available.',
            backUrl: req.user ? '/dashboard' : '/login'
        });
    });

    app.use((error, req, res, next) => {
        if (res.headersSent) {
            return next(error);
        }

        if (isCsrfError(error)) {
            logSecurityEvent('INVALID_CSRF', req, { outcome: 'blocked', reason: 'invalid-or-missing-token' });
            const message = 'The security token is invalid or has expired. Refresh the page and try again.';
            if (req.xhr || String(req.get('accept') || '').includes('application/json')) {
                return res.status(403).json({ success: false, message });
            }
            return res.status(403).render('shared/error', {
                title: 'Request could not be verified',
                message,
                backUrl: req.get('referer') || (req.user ? '/dashboard' : '/login')
            });
        }

        console.error('Unhandled request error:', {
            method: req.method,
            path: String(req.originalUrl || '').split('?')[0],
            message: error && error.message
        });
        const status = Number(error && error.status) >= 400 && Number(error.status) < 600
            ? Number(error.status)
            : 500;
        const message = status === 500
            ? 'The request could not be completed. Please try again or contact support.'
            : (error.message || 'The request could not be completed.');
        if (req.xhr || String(req.get('accept') || '').includes('application/json')) {
            return res.status(status).json({ success: false, message });
        }
        return res.status(status).render('shared/error', {
            title: status === 500 ? 'Unexpected error' : 'Request error',
            message,
            backUrl: req.user ? '/dashboard' : '/login'
        });
    });

    return app;
}

async function startServer() {
    assertEnvironmentIsSafe(process.env);
    const sessionStore = await initializeSessionStore();
    const app = createApp({ sessionStore });

    const PORT = process.env.PORT || 3001;
    return new Promise((resolve, reject) => {
        const host = process.env.APP_HOST || (isProductionEnvironment() ? '127.0.0.1' : undefined);
        const server = app.listen(PORT, host, () => {
            console.log(`Server running on http://localhost:${PORT}`);
            resolve({ app, server, sessionStore });
        });

        server.on('error', reject);
    });
}

async function startManagedServer() {
    const runtime = await startServer();
    const { server, sessionStore } = runtime;
        const shutdown = require('./services/shutdownService').createShutdownHandler({
            server, sessionStore, pool: require('./config/db'), mailer: require('./config/mailer')
        });
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    return runtime;
}

if (require.main === module) {
    startManagedServer().catch((error) => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });
}

module.exports = {
    createApp,
    startManagedServer,
    startServer
};
