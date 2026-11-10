const UNSAFE_SESSION_SECRETS = new Set([
    'secret',
    'secret_key',
    'changeme',
    'change-me',
    'password',
    'development',
    'dev-secret'
]);

function isProductionEnvironment(nodeEnv = process.env.NODE_ENV) {
    return String(nodeEnv || '').trim().toLowerCase() === 'production';
}

function validateUrl(name, value, { requireHttps = false } = {}) {
    try {
        const parsed = new URL(value);
        if (requireHttps && parsed.protocol !== 'https:') {
            return `${name} must use HTTPS in production.`;
        }
        return null;
    } catch (error) {
        return `${name} must be a valid absolute URL.`;
    }
}

function validateProductionEnvironment(env = process.env) {
    const errors = [];
    if (!env.INSTALLATION_COMPANY_ID) errors.push('INSTALLATION_COMPANY_ID is required in production.');
    try { require('./installationCompanyService').getInstallationCompanyId(env); }
    catch (error) { errors.push(error.message); }
    const secret = String(env.SESSION_SECRET || '').trim();

    if (!secret) {
        errors.push('SESSION_SECRET is required.');
    } else if (
        secret.length < 32
        || UNSAFE_SESSION_SECRETS.has(secret.toLowerCase())
        || secret.toLowerCase().startsWith('replace-with-')
        || secret.toLowerCase().includes('your-secret')
    ) {
        errors.push('SESSION_SECRET must be a strong random value of at least 32 characters.');
    }

    const databaseVariables = [
        ['DB_HOST', 'DBHOST'],
        ['DB_NAME', 'DBNAME'],
        ['DB_USER', 'DBUSER'],
        ['DB_PASSWORD', 'DBPASS']
    ];
    const resetSecret = String(env.RESET_TOKEN_SECRET || env.JWT_SECRET || '').trim();
    if (resetSecret.length < 32 || UNSAFE_SESSION_SECRETS.has(resetSecret.toLowerCase())
        || /replace-with|your-secret|reset_secret/i.test(resetSecret)) {
        errors.push('RESET_TOKEN_SECRET must be an independent strong random value of at least 32 characters.');
    }
    for (const [preferredName, legacyName] of databaseVariables) {
        if (!String(env[preferredName] || env[legacyName] || '').trim()) {
            errors.push(`${preferredName} (or legacy ${legacyName}) is required.`);
        }
    }

    if (env.PORT) {
        const port = Number(env.PORT);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            errors.push('PORT must be an integer between 1 and 65535.');
        }
    }

    if (!String(env.APP_BASE_URL || '').trim()) {
        errors.push('APP_BASE_URL is required in production.');
    } else {
        const urlError = validateUrl('APP_BASE_URL', env.APP_BASE_URL, { requireHttps: true });
        if (urlError) errors.push(urlError);
    }

    if (env.TRUST_PROXY_HOPS === undefined || String(env.TRUST_PROXY_HOPS).trim() === '') {
        errors.push('TRUST_PROXY_HOPS is required in production (use 0 for direct TLS or the exact trusted proxy count).');
    } else {
        const trustProxyHops = Number(env.TRUST_PROXY_HOPS);
        if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
            errors.push('TRUST_PROXY_HOPS must be a non-negative integer in production.');
        }
    }

    if (String(env.EMAIL_NOTIFICATIONS_ENABLED || '').trim().toLowerCase() === 'true'
        || String(env.ACCOUNT_EMAIL_ENABLED || '').trim().toLowerCase() === 'true') {
        for (const name of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']) {
            if (!String(env[name] || '').trim()) {
                errors.push(`${name} is required when workflow or account email is enabled.`);
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

function assertEnvironmentIsSafe(env = process.env) {
    if (!isProductionEnvironment(env.NODE_ENV)) {
        return { valid: true, errors: [] };
    }

    const result = validateProductionEnvironment(env);
    if (!result.valid) {
        throw new Error(`Production environment validation failed: ${result.errors.join(' ')}`);
    }

    return result;
}

module.exports = {
    UNSAFE_SESSION_SECRETS,
    isProductionEnvironment,
    validateProductionEnvironment,
    assertEnvironmentIsSafe
};
