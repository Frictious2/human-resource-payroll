#!/usr/bin/env node
require('dotenv').config({ override: true });

const { execFileSync } = require('child_process');
const path = require('path');
const pool = require('../config/db');
const payrollGlPostingService = require('../services/payrollGlPostingService');
const payrollGlPostingValidation = require('../validations/payrollGlPostingValidation');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function runScript(scriptPath) {
    const output = execFileSync(process.execPath, [scriptPath], {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe',
        env: process.env
    }).toString();

    return output.trim();
}

async function main() {
    try {
        const companyId = 1;
        const catalog = await payrollGlPostingService.getActivityGlPostingCatalog(companyId);
        assert(Array.isArray(catalog) && catalog.length > 0, 'Expected GL posting activity catalog rows.');

        const salary = catalog.find((row) => row.code === '01');
        assert(salary, 'Expected Salary activity (01) in the GL posting catalog.');
        assert(salary.supported === true, 'Expected activity 01 to remain supported for Post to Accounts.');

        const unsupportedCodes = catalog.filter((row) => !row.supported).map((row) => row.code);
        assert(unsupportedCodes.length > 0, 'Expected at least one blocked GL posting activity for scope enforcement.');

        for (const code of unsupportedCodes) {
            const readiness = await payrollGlPostingService.getActivityGlPostingReadiness(code, companyId);
            assert(readiness.supported === false, `Expected activity ${code} to be blocked for GL posting.`);
            let blocked = false;
            try {
                await payrollGlPostingService.postMonthlyPayrollToGL({
                    companyId,
                    activityCode: code,
                    postingDate: new Date('2026-03-31T00:00:00Z'),
                    postedBy: 1,
                    postedByUser: { id: 1, role: 'finance-officer', name: 'Finance Officer', companyId }
                });
            } catch (error) {
                blocked = /not yet configured for this payroll activity/i.test(String(error.message || ''));
            }

            assert(blocked, `Expected direct posting attempt for activity ${code} to be blocked server-side.`);
        }

        let companyScopeBlocked = false;
        try {
            payrollGlPostingValidation.assertAuthorizedUser({
                id: 1,
                role: 'finance-officer',
                companyId: 2
            }, 1);
        } catch (error) {
            companyScopeBlocked = /another company/i.test(String(error.message || ''));
        }
        assert(companyScopeBlocked, 'Expected CompanyID scope enforcement for Post to Accounts.');

        let missingMappingsBlocked = false;
        try {
            payrollGlPostingService.validateRequiredGlMappings([
                {
                    payComponentCode: 'UNMAPPED_COMPONENT',
                    amount: 100
                }
            ], []);
        } catch (error) {
            missingMappingsBlocked = /required gl mappings are incomplete/i.test(String(error.message || ''));
        }
        assert(missingMappingsBlocked, 'Expected missing GL mappings to block supported activity posting.');

        const foundationOutput = runScript('scripts/testPayrollWorkflowFoundation.js');
        assert(/verification passed/i.test(foundationOutput), 'Expected salary workflow foundation regression script to pass.');

        const reopenOutput = runScript('scripts/testPhase15PayrollReopenWorkflow.js');
        assert(/verification passed/i.test(reopenOutput), 'Expected salary reopen/generation regression script to pass.');

        console.log('GL posting activity scope verification passed.');
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error('GL posting activity scope verification failed.');
    console.error(error.stack || error.message || error);
    process.exit(1);
});
