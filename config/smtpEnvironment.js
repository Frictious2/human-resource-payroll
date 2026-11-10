const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const SMTP_ENV_FILE = path.resolve(__dirname, '..', '.env');

// SMTP is deliberately file-only; other deployment variables keep normal precedence.
function loadSmtpEnvironment({ env = process.env, readFile = fs.readFileSync } = {}) {
    for (const name of Object.keys(env)) {
        if (name.toUpperCase().startsWith('SMTP_')) delete env[name];
    }
    let parsed;
    try {
        parsed = dotenv.parse(readFile(SMTP_ENV_FILE));
    } catch (error) {
        if (error.code === 'ENOENT') return;
        throw new Error('Unable to read the project .env SMTP configuration.');
    }
    for (const [name, value] of Object.entries(parsed)) {
        if (name.startsWith('SMTP_')) env[name] = value;
    }
}

module.exports = { loadSmtpEnvironment, SMTP_ENV_FILE };
