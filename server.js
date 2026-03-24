const express = require('express');
const session = require('express-session');
const path = require('path');
require('dotenv').config({ override: true });

const requestContextMiddleware = require('./middleware/requestContext');
const { attachAuthenticatedUser, requireRoles, redirectAuthenticatedToDashboard } = require('./middleware/auth');
const authService = require('./services/authService');
const auditTrailService = require('./services/auditTrailService');

const adminRoutes = require('./routes/admin');
const developerRoutes = require('./routes/developer');
const managerRoutes = require('./routes/manager');
const dataEntryRoutes = require('./routes/dataEntry');
const auditorRoutes = require('./routes/auditor');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

app.use(requestContextMiddleware);
app.use(attachAuthenticatedUser);

function renderLogin(req, res, error = null, identifier = '') {
    res.render('login', { error, identifier });
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

app.get('/', (req, res) => {
    if (req.user) {
        return res.redirect('/dashboard');
    }

    return res.redirect('/login');
});

app.get('/login', redirectAuthenticatedToDashboard, (req, res) => {
    renderLogin(req, res);
});

app.post('/login', redirectAuthenticatedToDashboard, async (req, res) => {
    const identifier = req.body.identifier || req.body.email || '';
    const password = req.body.password || '';

    try {
        const authResult = await authService.authenticateUser({ identifier, password });
        if (!authResult.success) {
            return res.status(401).render('login', {
                error: authResult.message,
                identifier
            });
        }

        req.session.user = authResult.user;
        req.session.companyId = authResult.user.companyId || null;
        req.session.CompanyID = authResult.user.companyId || null;

        await auditTrailService.logAuthEvent({
            action: 'Logged On',
            userName: authResult.user.name || authResult.user.username || authResult.user.email,
            companyId: authResult.user.companyId || null,
            loggedout: 0
        });

        return res.redirect(authService.getDashboardPathForRole(authResult.user.role));
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).render('login', {
            error: 'Unable to sign in right now. Please try again.',
            identifier
        });
    }
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
app.use('/auditor', requireRoles('auditor'), auditorRoutes);

app.get('/logout', async (req, res) => {
    const userName = req.user
        ? (req.user.name || req.user.username || req.user.email)
        : 'System';
    const companyId = req.user ? req.user.companyId || null : null;

    try {
        await auditTrailService.logAuthEvent({
            action: 'Logged Off',
            userName,
            companyId,
            loggedout: 1
        });
    } catch (error) {
        console.error('Logout audit error:', error);
    }

    req.session.destroy(() => {
        res.redirect('/login');
    });
});

async function startServer() {
    try {
        const seedDeveloper = await authService.ensureSeedDeveloper();
        if (seedDeveloper.created) {
            console.log(`Seed developer created: ${seedDeveloper.username} / ${seedDeveloper.password}`);
        }

        const PORT = process.env.PORT || 3001;
        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
