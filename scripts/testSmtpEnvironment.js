const assert = require('node:assert/strict');
const path = require('node:path');
const { loadSmtpEnvironment, SMTP_ENV_FILE } = require('../config/smtpEnvironment');

const env = {
    SMTP_HOST: 'inherited.invalid', SMTP_USER: 'old-user', SMTP_PASS: 'old-password',
    SMTP_FROM: 'old@example.test', SMTP_OTHER: 'old', smtp_host: 'lowercase-old',
    DB_HOST: 'database', SESSION_SECRET: 'unchanged', EMAIL_NOTIFICATIONS_ENABLED: 'false'
};
loadSmtpEnvironment({ env, readFile: (filename) => {
    assert.equal(filename, path.resolve(__dirname, '../.env'));
    return Buffer.from('SMTP_HOST=smtp.example.test\nSMTP_USER=file-user\nSMTP_PASS="file-password#literal"\nSMTP_PORT=465\nSMTP_SECURE=true\nDB_HOST=ignored\n');
} });
assert.equal(env.SMTP_HOST, 'smtp.example.test');
assert.equal(env.SMTP_USER, 'file-user');
assert.equal(env.SMTP_PASS, 'file-password#literal');
assert.equal(env.SMTP_PORT, '465');
assert.equal(env.SMTP_SECURE, 'true');
assert.equal(env.SMTP_FROM, undefined);
assert.equal(env.SMTP_OTHER, undefined);
assert.equal(env.smtp_host, undefined);
assert.equal(env.DB_HOST, 'database');
assert.equal(env.SESSION_SECRET, 'unchanged');
assert.equal(env.EMAIL_NOTIFICATIONS_ENABLED, 'false');
loadSmtpEnvironment({ env, readFile: () => Buffer.from('SMTP_HOST=\n') });
assert.equal(env.SMTP_HOST, '');
assert.equal(env.SMTP_PASS, undefined);
loadSmtpEnvironment({ env, readFile: () => { throw Object.assign(new Error(), { code: 'ENOENT' }); } });
assert.equal(env.SMTP_HOST, undefined);
assert.throws(() => loadSmtpEnvironment({ env, readFile: () => {
    throw Object.assign(new Error('private path'), { code: 'EACCES' });
} }), { message: 'Unable to read the project .env SMTP configuration.' });
assert(path.isAbsolute(SMTP_ENV_FILE));
console.log('PASS: file-only SMTP, no inherited fallback, fixed project path, blank/missing/unreadable file, other settings preserved. No email or database writes.');
