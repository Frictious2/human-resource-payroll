const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');

async function main() {
    const originalEnv = { ...process.env };
    const originalTransport = nodemailer.createTransport;
    const modulePath = require.resolve('../config/mailer');
    let response = { accepted: ['recipient@example.test'], rejected: [] };
    let sent = 0;
    let options;
    nodemailer.createTransport = (config) => {
        options = config;
        return { sendMail: async () => { sent++; return response; } };
    };
    delete require.cache[modulePath];
    const mailer = require(modulePath);
    const message = { to: 'recipient@example.test', subject: 'Test', text: 'Test' };
    try {
        process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';
        delete process.env.ACCOUNT_EMAIL_ENABLED;
        process.env.SMTP_HOST = 'smtp.example.test';
        process.env.SMTP_USER = 'sender@example.test';
        process.env.SMTP_PASS = 'fixture-only';
        process.env.SMTP_PORT = '465';
        process.env.SMTP_SECURE = 'true';
        assert.equal((await mailer.sendMail(message)).skipped, true);
        assert.equal(sent, 0, 'Optional workflow mail stays disabled');
        await mailer.sendMail(message, { required: true });
        assert.equal(sent, 1, 'Account mail works independently of notification switch');
        assert.equal(options.secure, true);
        assert.equal(options.connectionTimeout, 10000);
        response = { accepted: [], rejected: [message.to] };
        await assert.rejects(mailer.sendMail(message, { required: true }), { code: 'ACCOUNT_EMAIL_REJECTED' });
        process.env.ACCOUNT_EMAIL_ENABLED = 'false';
        await assert.rejects(mailer.sendMail(message, { required: true }), { code: 'ACCOUNT_EMAIL_UNAVAILABLE' });
        process.env.ACCOUNT_EMAIL_ENABLED = 'true';
        delete process.env.SMTP_PASS;
        await assert.rejects(mailer.sendMail(message, { required: true }), { code: 'ACCOUNT_EMAIL_UNAVAILABLE' });

        const ejs = require('ejs');
        for (const name of ['admins', 'managers', 'data-entry-officers', 'finance-officers', 'finance-managers', 'auditors', 'entity-heads']) {
            const filename = path.join(__dirname, '../views/admin', `${name}.ejs`);
            const source = fs.readFileSync(filename, 'utf8');
            ejs.compile(source, { filename });
            assert(source.includes('result.error'), `${name} must display resend failures`);
        }
        console.log('PASS: required account mail, optional notification isolation, rejection/configuration failures, and seven EJS templates. No database writes or real email.');
        await testAccountHandlers();
    } finally {
        process.env = originalEnv;
        nodemailer.createTransport = originalTransport;
        delete require.cache[modulePath];
    }
}

async function testAccountHandlers() {
    const Module = require('node:module');
    const originalLoad = Module._load;
    const originalError = console.error;
    const controllerPath = require.resolve('../controllers/adminController');
    let outcome = 'accepted';
    let company = 1;
    let sent = 0;
    let companyUpdates = 0;
    const database = {
        query: async (sql, params) => {
            if (sql.startsWith('SELECT CompanyID, LogoPath FROM tblcominfo')) {
                assert.equal(params[0],1);
                return [[{CompanyID:1,LogoPath:'/uploads/logos/current.png'}]];
            }
            if (sql.includes('UPDATE tblcominfo SET')) {
                assert.equal(params.at(-1),1);
                assert.equal(params.at(-2),'/uploads/logos/current.png');
                companyUpdates++;
                return [{affectedRows:1}];
            }
            throw new Error('Unexpected fixture query');
        },
        execute: async (sql, params) => {
            if (sql.startsWith('INSERT INTO tblpassword')) return [{ insertId: 123 }];
            if (sql.includes('SELECT Email, Username, FullName')) {
                assert(sql.includes('CompanyID = ?'), 'Resend must be company scoped');
                assert.equal(params[2], 1);
                return [company === 1 ? [{ Email: 'user@example.test', Username: 'Fixture', FullName: 'Fixture' }] : []];
            }
            return [[]];
        }
    };
    Module._load = function(request, parent, isMain) {
        if (request === '../config/db') return database;
        if (request === '../config/mailer') return {
            sendMail: async (message, options) => {
                assert.equal(options.required, true);
                assert(message.html.includes('https://payroll.example.test/admin/admins/set-password'));
                sent++;
                if (outcome !== 'accepted') throw Object.assign(new Error('fixture failure'), { code: 'EAUTH' });
                return { accepted: [message.to], rejected: [] };
            }
        };
        if (request === '../services/accountSecurityService') return {
            actorScope: () => ({ companyId: 1 }),
            issueSetupToken: async () => 'fixture-token', recordInvitation: async () => {},
            createAccount: async () => 123
        };
        if (request === '../services/privateFileService') return { createImageUpload: () => ({ single: () => {} }) };
        if (request === '../services/brandingService') return { normalizeLogoPath: value => value };
        if (request === '../services/controllerAuditHelper') return { auditUpdate: async ({applyChange}) => applyChange() };
        if (request.startsWith('../services/')) return {};
        return originalLoad.apply(this, arguments);
    };
    console.error = () => {};
    delete require.cache[controllerPath];
    try {
        process.env.APP_BASE_URL = 'https://payroll.example.test';
        const controller = require(controllerPath);
        const req = { body: { Username: 'Fixture', Email: 'user@example.test', FullName: 'Fixture' },
            params: { pfno: '123' }, user: { companyId: 1 }, protocol: 'http', get: () => 'untrusted.example.test' };
        function result() {
            return { statusCode: 200, status(code) { this.statusCode = code; return this; },
                json(body) { this.body = body; return this; }, redirect(url) { this.location = url; return this; } };
        }
        for (const role of ['Admin', 'Manager', 'DataEntry', 'FinanceOfficer', 'FinanceManager', 'Auditor']) {
            outcome = 'accepted';
            const created = result();
            await controller[`create${role}`](req, created);
            assert(created.location.includes('?success='));
            outcome = 'failed';
            const failed = result();
            await controller[`create${role}`](req, failed);
            assert(failed.location.includes('?warning='), 'Failed mail must not report successful delivery');
        }
        for (const role of ['Admin', 'Manager', 'DataEntry', 'FinanceOfficer', 'FinanceManager', 'Auditor', 'EntityHead']) {
            outcome = 'accepted';
            company = 1;
            const success = result();
            await controller[`resend${role}Link`](req, success);
            assert.equal(success.body.ok, true);
            outcome = 'failed';
            const failure = result();
            await controller[`resend${role}Link`](req, failure);
            assert.equal(failure.statusCode, 503);
            assert.equal(failure.body.ok, false);
            company = 2;
            const before = sent;
            const forbidden = result();
            await controller[`resend${role}Link`](req, forbidden);
            assert.equal(forbidden.statusCode, 404);
            assert.equal(sent, before, 'No cross-company mail');
        }
        const resultResponse=result();
        await controller.updateCompanyInfo({...req,body:{CompanyID:2,currentLogo:'/uploads/untrusted.png'}},resultResponse);
        assert.equal(companyUpdates,1);
        assert(resultResponse.location.includes('success='));
        console.log('PASS: six generic account-create handlers and seven role resend handlers, success/failure and company isolation (mock database/SMTP only).');
    } finally {
        Module._load = originalLoad;
        console.error = originalError;
        delete require.cache[controllerPath];
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
