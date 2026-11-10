require('dotenv').config({ quiet: true, override: true });
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mailer = require('../config/mailer');

async function main() {
    const recipient = process.argv[2];
    if (process.argv[3] !== '--approved' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient || '')) throw new Error('An explicitly approved recipient is required.');
    const file = path.resolve(__dirname, '../docs/test-results/staging-acceptance-email-attempt.json');
    const reference = crypto.randomUUID();
    const evidence = { reference, attemptedAt: new Date().toISOString(), recipientHash: crypto.createHash('sha256').update(recipient.toLowerCase()).digest('hex'),
        status: 'ATTEMPT_RECORDED', receiptConfirmed: false };
    // A ledger is written before sending; a timeout must not cause an automatic duplicate.
    fs.writeFileSync(file, JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o600 });
    try {
        const result = await mailer.sendMail({ from: process.env.SMTP_USER, to: recipient,
            subject: 'WAEC staging acceptance: non-sensitive email test',
            text: `This is the single authorized, non-sensitive staging email delivery test. No employee or payroll data is included. Please confirm receipt. Reference: ${reference}`
        }, { required: true });
        evidence.status = 'SMTP_ACCEPTED'; evidence.messageId = result.messageId;
        console.log(JSON.stringify({ status: evidence.status, reference, messageId: result.messageId, receiptConfirmed: false }));
    } catch (error) {
        evidence.status = 'SEND_FAILED_OR_UNCERTAIN'; evidence.errorCode = error.code || 'MAIL_FAILED';
        console.log(JSON.stringify({ status: evidence.status, errorCode: evidence.errorCode }));
        process.exitCode = 1;
    } finally { fs.writeFileSync(file, JSON.stringify(evidence, null, 2), { mode: 0o600 }); }
}

main().catch(error => { console.error(error.code === 'EEXIST' ? 'Email already attempted; do not resend automatically.' : error.code || error.message); process.exitCode=1; }).finally(()=>mailer.close());
