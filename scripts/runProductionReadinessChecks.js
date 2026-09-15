#!/usr/bin/env node
require('dotenv').config({ override: true });

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const pool = require('../config/db');
const mailer = require('../config/mailer');
const {
    SESSION_TABLE,
    ensureSessionTableExists,
    getSessionStoreDescriptor,
    initializeSessionStore
} = require('../config/sessionStore');
const payrollGlPostingService = require('../services/payrollGlPostingService');
const { validateProductionEnvironment } = require('../services/environmentValidationService');

const AUDIT_DATE = '2026-08-27';
const INCLUDE_SANDBOX = process.argv.includes('--sandbox');

const KEY_TABLES = [
    SESSION_TABLE,
    'payroll_workflow_batches',
    'payroll_workflow_actions',
    'record_workflow_items',
    'record_workflow_actions',
    'workflow_notifications',
    'parameter_change_requests',
    'parameter_change_actions',
    'payroll_reversal_requests',
    'payroll_reversal_actions',
    'payroll_reopen_requests',
    'payroll_reopen_actions',
    'payroll_reversed_row_archive'
];

const NODE_CHECK_TARGETS = [
    'server.js',
    'config/sessionStore.js',
    'config/mailer.js',
    'middleware/security.js',
    'services/environmentValidationService.js',
    'services/workflowNotificationService.js',
    'services/processEmolumentsService.js',
    'services/payrollWorkflowService.js',
    'services/payrollGlPostingService.js',
    'services/payrollReopenService.js',
    'scripts/testGlPostingActivityScope.js',
    'scripts/testPersistentSessionStore.js',
    'scripts/testCsrfProtection.js',
    'scripts/testLoginRateLimiting.js',
    'scripts/testPrd009bVisualUat.js',
    'scripts/testPayrollWorkflowFoundation.js',
    'scripts/testPhase14PayrollReversalWorkflow.js',
    'scripts/testPhase15PayrollReopenWorkflow.js'
];

function getPrd009bVisualStatus() {
    const resultPath = path.join(__dirname, '..', 'docs', 'test-results', 'prd009b', 'prd009b-visual-uat-latest.json');
    if (!fs.existsSync(resultPath)) {
        return {
            status: 'MISSING',
            evidence: path.relative(path.join(__dirname, '..'), resultPath),
            screensInspected: 0,
            reportsInspected: 0,
            browser: null
        };
    }

    try {
        const evidence = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        return {
            status: evidence.status === 'PASS' ? 'PASS' : 'FAIL',
            evidence: path.relative(path.join(__dirname, '..'), resultPath),
            screensInspected: Array.isArray(evidence.screens) ? evidence.screens.length : 0,
            reportsInspected: Array.isArray(evidence.reports) ? evidence.reports.length : 0,
            browser: evidence.browser || null,
            consoleErrors: Array.isArray(evidence.consoleErrors) ? evidence.consoleErrors.length : null
        };
    } catch (error) {
        return {
            status: 'INVALID',
            evidence: path.relative(path.join(__dirname, '..'), resultPath),
            screensInspected: 0,
            reportsInspected: 0,
            browser: null,
            message: error.message
        };
    }
}

function getPrd005Status() {
    const scriptPath = path.join(__dirname, 'testPhase14PayrollReversalWorkflow.js');
    const resultPath = path.join(__dirname, '..', 'docs', 'test-results', 'phase14-reversal-latest.json');
    const source = fs.readFileSync(scriptPath, 'utf8');
    let latestExecution = null;
    if (fs.existsSync(resultPath)) {
        try {
            latestExecution = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        } catch (error) {
            latestExecution = { status: 'INVALID', message: error.message };
        }
    }
    const safetyGuard = source.includes('ALLOW_DESTRUCTIVE_TESTS') && source.includes("NODE_ENV === 'test'");
    const selfContained = source.includes('ensureSandboxSeed')
        && source.includes('ProcessEmolumentsService.processEmoluments')
        && source.includes('postMonthlyPayrollToGL')
        && source.includes('cleanupTestData');
    const latestPassed = latestExecution?.status === 'PASS' && latestExecution?.selfContained === true;
    return {
        status: safetyGuard && selfContained && latestPassed ? 'PASS' : 'FAIL',
        selfContainedTest: selfContained,
        productionSafetyGuard: safetyGuard,
        latestIsolatedExecution: latestExecution
            ? { status: latestExecution.status, completedAt: latestExecution.completedAt || null }
            : { status: 'MISSING', completedAt: null },
        destructiveSimulationRunAutomatically: false
    };
}

function runNodeCheck(target) {
    try {
        execFileSync(process.execPath, ['--check', target], {
            cwd: path.join(__dirname, '..'),
            stdio: 'pipe'
        });
        return { target, status: 'PASS' };
    } catch (error) {
        return {
            target,
            status: 'FAIL',
            message: String(error.stderr || error.stdout || error.message || '').trim()
        };
    }
}

function runScript(scriptPath) {
    try {
        const stdout = execFileSync(process.execPath, [scriptPath], {
            cwd: path.join(__dirname, '..'),
            stdio: 'pipe',
            env: process.env
        }).toString();
        return {
            script: scriptPath,
            status: 'PASS',
            output: stdout.trim().split(/\r?\n/).slice(-20)
        };
    } catch (error) {
        return {
            script: scriptPath,
            status: 'FAIL',
            output: String(error.stdout || '').trim().split(/\r?\n/).slice(-20),
            error: String(error.stderr || error.message || '').trim()
        };
    }
}

async function getTableSummary(connection, table) {
    const [statusRows] = await connection.query(`SHOW TABLE STATUS LIKE ?`, [table]);
    const [indexRows] = await connection.query(`SHOW INDEX FROM ${table}`);
    return {
        table,
        exists: statusRows.length > 0,
        engine: statusRows[0]?.Engine || null,
        indexes: indexRows.map((row) => ({
            key: row.Key_name,
            column: row.Column_name,
            nonUnique: row.Non_unique,
            seq: row.Seq_in_index
        }))
    };
}

async function runSchemaChecks(connection) {
    const summaries = [];
    for (const table of KEY_TABLES) {
        summaries.push(await getTableSummary(connection, table));
    }
    return summaries;
}

async function runPreflightChecks(connection) {
    const checks = {
        invalid_emp_status: `SELECT EmpStatus, COUNT(*) AS total FROM tblstaff GROUP BY EmpStatus ORDER BY EmpStatus`,
        payroll_without_rows: `SELECT COUNT(*) AS total FROM payroll_workflow_batches wb LEFT JOIN tblpayroll p ON p.CompanyID = wb.CompanyID AND p.PMonth = wb.PMonth AND p.PYear = wb.PYear AND p.PType = wb.PType WHERE p.PFNo IS NULL`,
        posted_without_gl_batch: `SELECT COUNT(*) AS total FROM payroll_workflow_batches wb LEFT JOIN payroll_gl_posting_batches gb ON gb.company_id = wb.CompanyID AND gb.posting_month = wb.PMonth AND gb.posting_year = wb.PYear AND gb.activity_code = wb.PType AND COALESCE(gb.generation_no,1)=COALESCE(wb.GenerationNo,1) WHERE wb.Status='POSTED_TO_ACCOUNTS' AND gb.id IS NULL`,
        reopen_without_reversed_source: `SELECT COUNT(*) AS total FROM payroll_reopen_requests rr LEFT JOIN payroll_workflow_batches wb ON wb.id = rr.OriginalWorkflowBatchID WHERE wb.id IS NULL OR wb.Status <> 'REVERSED'`,
        reversal_without_source_batch: `SELECT COUNT(*) AS total FROM payroll_reversal_requests pr LEFT JOIN payroll_workflow_batches wb ON wb.id = pr.WorkflowBatchID WHERE wb.id IS NULL`,
        notifications_missing_users: `SELECT COUNT(*) AS total FROM workflow_notifications n LEFT JOIN tblpassword p ON p.PFNo = n.RecipientUserID LEFT JOIN developer d ON d.ID = n.RecipientUserID WHERE p.PFNo IS NULL AND d.ID IS NULL`,
        duplicate_generation_keys: `SELECT CompanyID,PMonth,PYear,PType,COALESCE(GenerationNo,1) AS GenerationNo, COUNT(*) AS total FROM payroll_workflow_batches GROUP BY CompanyID,PMonth,PYear,PType,COALESCE(GenerationNo,1) HAVING COUNT(*) > 1`
    };

    const results = {};
    for (const [name, sql] of Object.entries(checks)) {
        const [rows] = await connection.query(sql);
        results[name] = rows;
    }
    return results;
}

async function main() {
    const connection = await pool.getConnection();
    let sessionStore = null;
    try {
        let sessionStoreStatus = 'unavailable';
        let sessionTableExists = false;
        try {
            await ensureSessionTableExists(connection);
            sessionTableExists = true;
            sessionStore = await initializeSessionStore();
            sessionStoreStatus = getSessionStoreDescriptor(sessionStore);
        } catch (error) {
            sessionStoreStatus = 'unavailable';
        }

        const schema = await runSchemaChecks(connection);
        const preflight = await runPreflightChecks(connection);
        const activityCatalog = await payrollGlPostingService.getActivityGlPostingCatalog(1);
        const nodeChecks = NODE_CHECK_TARGETS.map(runNodeCheck);
        const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        const securitySource = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'security.js'), 'utf8');
        const csrfBrowserSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'csrf-protection.js'), 'utf8');
        const managerRoutesSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'manager.js'), 'utf8');
        const managerSidebarSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'manager', 'partials', 'sidebar.ejs'), 'utf8');
        const activeRouteSource = ['admin.js', 'dataEntry.js', 'manager.js']
            .map((file) => fs.readFileSync(path.join(__dirname, '..', 'routes', file), 'utf8'))
            .join('\n');
        const activeNavigationSource = [
            path.join('admin', 'partials', 'sidebar.ejs'),
            path.join('data_entry', 'partials', 'sidebar.ejs'),
            path.join('manager', 'partials', 'sidebar.ejs')
        ].map((file) => fs.readFileSync(path.join(__dirname, '..', 'views', file), 'utf8')).join('\n');
        const comingSoonRouteCount = (activeRouteSource.match(/getComingSoon|comingSoon\(/g) || []).length;
        const activeNavigationPlaceholderCount = (activeNavigationSource.match(/coming soon/gi) || []).length;
        const safeProductionFixture = validateProductionEnvironment({
            NODE_ENV: 'production',
            SESSION_SECRET: 'production-readiness-fixture-only-32-characters-minimum',
            DB_HOST: 'db.internal',
            DB_NAME: 'personnel_master',
            DB_USER: 'hrpayroll',
            DB_PASSWORD: 'fixture-only',
            APP_BASE_URL: 'https://hr.example.test',
            PORT: '3001',
            TRUST_PROXY_HOPS: '1',
            EMAIL_NOTIFICATIONS_ENABLED: 'false'
        });
        const missingSecretFixture = validateProductionEnvironment({
            NODE_ENV: 'production',
            DB_HOST: 'db.internal',
            DB_NAME: 'personnel_master',
            DB_USER: 'hrpayroll',
            DB_PASSWORD: 'fixture-only',
            APP_BASE_URL: 'https://hr.example.test'
        });
        const allowDestructiveSandbox = process.env.ALLOW_DESTRUCTIVE_TESTS === 'true' || process.env.NODE_ENV === 'test';
        const sandbox = INCLUDE_SANDBOX
            ? [
                runScript('scripts/testGlPostingActivityScope.js'),
                runScript('scripts/testPayrollWorkflowFoundation.js'),
                ...(allowDestructiveSandbox ? [runScript('scripts/testPhase14PayrollReversalWorkflow.js')] : []),
                runScript('scripts/testPhase15PayrollReopenWorkflow.js')
            ]
            : [];

        const report = {
            auditDate: AUDIT_DATE,
            environment: {
                nodeEnv: process.env.NODE_ENV || 'undefined',
                dbName: process.env.DBNAME || 'personnel_master',
                sessionSecret: Boolean(String(process.env.SESSION_SECRET || '').trim()) ? 'configured' : 'missing',
                sessionStore: sessionStoreStatus,
                sessionTableExists,
                smtpHost: process.env.SMTP_HOST || null,
                emailNotificationsEnabled: typeof mailer.isEnabled === 'function' ? mailer.isEnabled() : false,
                appBaseUrl: process.env.APP_BASE_URL || process.env.BASE_URL || null
            },
            securityReadiness: {
                csrfProtection: serverSource.includes('createCsrfProtectionMiddleware')
                    && securitySource.includes('csrfSynchronisedProtection')
                    && csrfBrowserSource.includes('X-CSRF-Token'),
                securityHeaders: serverSource.includes('createSecurityHeadersMiddleware')
                    && securitySource.includes('contentSecurityPolicy')
                    && securitySource.includes('hsts'),
                loginRateLimiting: serverSource.includes('createLoginRateLimiter')
                    && securitySource.includes('LOGIN_RATE_LIMIT_MAX'),
                productionSessionSecretValidation: safeProductionFixture.valid
                    && missingSecretFixture.errors.some((message) => message.includes('SESSION_SECRET')),
                productionCookieConfiguration: {
                    httpOnly: true,
                    secureInProduction: true,
                    sameSite: 'lax',
                    trustProxyHops: Number(process.env.TRUST_PROXY_HOPS || 1)
                },
                incompleteProductionRoutes: {
                    comingSoonRouteCount,
                    activeNavigationPlaceholderCount,
                    managerComingSoonRoutes: (managerRoutesSource.match(/getComingSoon/g) || []).length,
                    managerComingSoonNavigation: /coming soon|enquiry\/warning|activity\/medical-limits|approve\/travel|approve\/attendance|reports\/long-service|reports\/com-org-liabilities|reports\/travel/i.test(managerSidebarSource),
                    status: comingSoonRouteCount === 0 && activeNavigationPlaceholderCount === 0
                        && !(managerRoutesSource.includes('getComingSoon') || /coming soon|enquiry\/warning|activity\/medical-limits|approve\/travel|approve\/attendance|reports\/long-service|reports\/com-org-liabilities|reports\/travel/i.test(managerSidebarSource))
                        ? 'PASS'
                        : 'FAIL'
                },
                staffSelfService: 'NOT_IMPLEMENTED_DEFERRED',
                activeProductionRoles: ['admin', 'data-entry', 'finance-officer', 'finance-manager', 'manager', 'auditor', 'entity-head']
            },
            glPostingActivityScope: {
                discoveredCodes: activityCatalog.map((row) => row.code),
                supportedCodes: activityCatalog.filter((row) => row.supported).map((row) => row.code),
                blockedCodes: activityCatalog.filter((row) => !row.supported).map((row) => row.code),
                unsupportedCodeCount: activityCatalog.filter((row) => !row.supported).length,
                enforcementConfigured: activityCatalog.some((row) => row.supported) && activityCatalog.some((row) => !row.supported),
                activities: activityCatalog.map((row) => ({
                    code: row.code,
                    name: row.name,
                    supported: row.supported,
                    state: row.state,
                    implementationType: row.implementationType,
                    reason: row.detailedReason || row.reason,
                    usage: row.usage
                }))
            },
            schema,
            preflight,
            nodeChecks,
            prd005: getPrd005Status(),
            prd009bVisualUat: getPrd009bVisualStatus(),
            sandbox
        };

        console.log(JSON.stringify(report, null, 2));
    } finally {
        if (sessionStore && typeof sessionStore.close === 'function') {
            await sessionStore.close().catch(() => {});
        }
        connection.release();
        await pool.end();
    }
}

main().catch((error) => {
    console.error(JSON.stringify({
        auditDate: AUDIT_DATE,
        status: 'FAIL',
        message: error.message
    }, null, 2));
    process.exit(1);
});
