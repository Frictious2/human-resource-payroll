const nodemailer = require('nodemailer');
require('./smtpEnvironment').loadSmtpEnvironment();

function normalizeFlag(value) {
    return String(value || '').trim().toLowerCase();
}

function hasConfiguredCredentials() {
    return Boolean(
        String(process.env.SMTP_HOST || '').trim() &&
        String(process.env.SMTP_USER || '').trim() &&
        String(process.env.SMTP_PASS || '').trim()
    );
}

function isEnabled() {
    return normalizeFlag(process.env.EMAIL_NOTIFICATIONS_ENABLED) === 'true' && hasConfiguredCredentials();
}

let transporter = null;

function getTransporter({ required = false } = {}) {
    if (required && (normalizeFlag(process.env.ACCOUNT_EMAIL_ENABLED) === 'false' || !hasConfiguredCredentials())) {
        const error = new Error('Account email is unavailable. Ask the administrator to configure SMTP and enable account email, then resend the setup link.');
        error.code = 'ACCOUNT_EMAIL_UNAVAILABLE';
        throw error;
    }
    if (!required && !isEnabled()) {
        return null;
    }

    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 465),
            secure: normalizeFlag(process.env.SMTP_SECURE || 'true') === 'true',
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 30000,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }

    return transporter;
}

async function sendMail(message, { required = false } = {}) {
    const activeTransporter = getTransporter({ required });
    if (!activeTransporter) {
        return {
            accepted: [],
            rejected: [],
            skipped: true,
            reason: 'email-disabled'
        };
    }

    const result = await activeTransporter.sendMail(message);
    if (required && (!result.accepted?.length || result.rejected?.length)) {
        const error = new Error('The mail server did not accept the account setup email. Check the recipient and SMTP configuration, then retry.');
        error.code = 'ACCOUNT_EMAIL_REJECTED';
        throw error;
    }
    return result;
}

module.exports = {
    isEnabled,
    hasConfiguredCredentials,
    getTransporter,
    sendMail,
    close: async () => { transporter?.close(); transporter = null; }
};
