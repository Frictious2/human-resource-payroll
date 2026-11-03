const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { csrfSync } = require('csrf-sync');
const { logSecurityEvent } = require('../services/securityEventService');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_SCRIPT_PATH = '/js/csrf-protection.js';

const {
    csrfSynchronisedProtection,
    generateToken,
    invalidCsrfTokenError
} = csrfSync({
    getTokenFromRequest: (req) => {
        if (req.body && typeof req.body._csrf === 'string') {
            return req.body._csrf;
        }
        if (req.query && typeof req.query._csrf === 'string' && req.is('multipart/form-data')) {
            return req.query._csrf;
        }
        return req.get('x-csrf-token') || undefined;
    },
    errorConfig: {
        statusCode: 403,
        message: 'The security token is invalid or has expired. Refresh the page and try again.',
        code: 'EBADCSRFTOKEN'
    }
});

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function injectCsrfIntoHtml(html, token) {
    if (!token || typeof html !== 'string' || !/<html[\s>]/i.test(html)) {
        return html;
    }

    const escapedToken = escapeHtml(token);
    let securedHtml = html;

    if (!/name=["']csrf-token["']/i.test(securedHtml)) {
        securedHtml = securedHtml.replace(
            /<\/head>/i,
            `  <meta name="csrf-token" content="${escapedToken}">\n</head>`
        );
    }

    securedHtml = securedHtml.replace(/<form\b([^>]*)>/gi, (formTag, attributes) => {
        const methodMatch = attributes.match(/\bmethod\s*=\s*["']?([^\s"'>]+)/i);
        const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';
        if (SAFE_METHODS.has(method) || /name=["']_csrf["']/i.test(formTag)) {
            return formTag;
        }
        return `${formTag}<input type="hidden" name="_csrf" value="${escapedToken}">`;
    });

    if (!securedHtml.includes(CSRF_SCRIPT_PATH)) {
        securedHtml = securedHtml.replace(
            /<\/body>/i,
            `  <script src="${CSRF_SCRIPT_PATH}" defer></script>\n</body>`
        );
    }

    return securedHtml;
}

function createCsrfViewMiddleware() {
    return (req, res, next) => {
        const token = generateToken(req);
        req.csrfToken = () => token;
        res.locals.csrfToken = token;

        const originalSend = res.send.bind(res);
        res.send = (body) => {
            const contentType = String(res.getHeader('Content-Type') || '');
            if (typeof body === 'string' && (contentType.includes('text/html') || /<html[\s>]/i.test(body))) {
                return originalSend(injectCsrfIntoHtml(body, token));
            }
            return originalSend(body);
        };
        next();
    };
}

function createCsrfProtectionMiddleware() {
    return csrfSynchronisedProtection;
}

function isCsrfError(error) {
    return error === invalidCsrfTokenError || error?.code === 'EBADCSRFTOKEN';
}

function createSecurityHeadersMiddleware({ isProduction = false } = {}) {
    const externalScriptSources = [
        'https://cdn.jsdelivr.net',
        'https://code.jquery.com',
        'https://cdn.datatables.net',
        'https://cdnjs.cloudflare.com',
        'https://cdn.sheetjs.com'
    ];

    return helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                baseUri: ["'self'"],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
                formAction: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", ...externalScriptSources],
                scriptSrcAttr: ["'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'", ...externalScriptSources],
                fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
                imgSrc: ["'self'", 'data:', 'blob:', 'https://picsum.photos', 'https://fastly.picsum.photos', 'https://www.nra.gov.sl'],
                connectSrc: ["'self'"],
                workerSrc: ["'self'", 'blob:'],
                upgradeInsecureRequests: isProduction ? [] : null
            }
        },
        crossOriginEmbedderPolicy: false,
        hsts: isProduction ? {
            maxAge: 15552000,
            includeSubDomains: true,
            preload: false
        } : false,
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        frameguard: { action: 'deny' },
        noSniff: true
    });
}

function createLoginRateLimiter() {
    const windowMs = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
    const limit = Number(process.env.LOGIN_RATE_LIMIT_MAX || 20);

    return rateLimit({
        windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 15 * 60 * 1000,
        limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        skipSuccessfulRequests: true,
        handler: (req, res) => {
            logSecurityEvent('LOGIN_RATE_LIMIT', req, {
                outcome: 'blocked',
                reason: 'too-many-attempts'
            });

            const payload = {
                error: 'Too many sign-in attempts. Please wait and try again.'
            };
            if (req.xhr || String(req.get('accept') || '').includes('application/json')) {
                return res.status(429).json({ success: false, message: payload.error });
            }
            return res.status(429).render('login', {
                ...payload,
                identifier: '',
                pageTitle: 'Sign In - HR & Payroll',
                accessTitle: 'Sign in temporarily unavailable',
                accessCopy: 'Too many sign-in attempts were received from this network.',
                formAction: req.path === '/entity-head/login' ? '/entity-head/login' : '/login'
            });
        }
    });
}

module.exports = {
    createCsrfProtectionMiddleware,
    createCsrfViewMiddleware,
    createLoginRateLimiter,
    createSecurityHeadersMiddleware,
    injectCsrfIntoHtml,
    isCsrfError
};
