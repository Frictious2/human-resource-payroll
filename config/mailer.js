const nodemailer = require('nodemailer');

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

function getTransporter() {
    if (!isEnabled()) {
        return null;
    }

    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 465),
            secure: normalizeFlag(process.env.SMTP_SECURE || 'true') === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }

    return transporter;
}

async function sendMail(message) {
    const activeTransporter = getTransporter();
    if (!activeTransporter) {
        return {
            accepted: [],
            rejected: [],
            skipped: true,
            reason: 'email-disabled'
        };
    }

    return activeTransporter.sendMail(message);
}

module.exports = {
    isEnabled,
    hasConfiguredCredentials,
    getTransporter,
    sendMail
};
