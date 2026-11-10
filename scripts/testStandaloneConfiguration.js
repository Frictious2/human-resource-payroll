const assert = require('node:assert/strict');
const Module = require('node:module');
const company = require('../services/installationCompanyService');
const { validateProductionEnvironment } = require('../services/environmentValidationService');
assert.equal(company.getInstallationCompanyId({ INSTALLATION_COMPANY_ID: '1' }), 1);
for (const value of ['', '0', '-1', '1.5', '1 OR 1=1', '9007199254740992']) {
    assert.throws(() => company.getInstallationCompanyId({ INSTALLATION_COMPANY_ID: value }));
}
const current = company.getInstallationCompanyId();
company.assertCompanyInput({ CompanyID: String(current), nested: { company_id: current } });
assert.throws(() => company.assertCompanyInput({ nested: { CompanyID: current + 1 } }));
assert.throws(() => company.assertCompanyInput({ CompanyID: [String(current)] }));
assert.throws(() => company.assertInstallationUser({ id: 1, companyId: current + 1 }));
assert.throws(() => company.assertInstallationUser({ companyId: current }));
const valid = { INSTALLATION_COMPANY_ID: String(current), SESSION_SECRET: 'fixture-session-'.repeat(4), RESET_TOKEN_SECRET: 'fixture-reset-'.repeat(4),
    DB_HOST: '127.0.0.1', DB_NAME: 'fixture', DB_USER: 'fixture', DB_PASSWORD: 'synthetic', APP_BASE_URL: 'https://synthetic.example.test', TRUST_PROXY_HOPS: '1' };
assert.equal(validateProductionEnvironment(valid).valid, true);
const missing = { ...valid }; delete missing.INSTALLATION_COMPANY_ID;
assert.equal(validateProductionEnvironment(missing).valid, false);
let starts = 0;
const originalLoad = Module._load;
try {
    Module._load = function(name, parent) {
        if (name === './server' && parent.filename.endsWith('app.js')) return { startManagedServer: async () => { starts++; } };
        return originalLoad.apply(this, arguments);
    };
    require('../app');
    assert.equal(starts, 1);
} finally { Module._load = originalLoad; }
console.log('PASS standalone company validation, forged/nested scope rejection, production validation and conventional cPanel bootstrap delegation. Actual Passenger/HTTPS hosting remains untested.');
