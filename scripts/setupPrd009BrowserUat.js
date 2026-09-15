const bcrypt = require('bcrypt');
const pool = require('../config/db');
const phase15Fixture = require('./testPhase15PayrollReopenWorkflow');

const TEST_PASSWORD = 'Prd009!BrowserUat';
const EXTRA_USERS = [
    { pfno: 99265, level: 'Admin', username: 'phase15a_admin', fullName: 'PRD-009 Administrator' },
    { pfno: 99266, level: 'Data Entry', username: 'phase15a_dataentry', fullName: 'PRD-009 Data Entry Officer' },
    { pfno: 99267, level: 'Finance Manager', username: 'phase15a_financemanager', fullName: 'PRD-009 Finance Manager' }
];

function assertSafe() {
    if (process.env.ALLOW_DESTRUCTIVE_TESTS !== 'true' && process.env.NODE_ENV !== 'test') {
        throw new Error('Refusing PRD-009 fixture changes. Set ALLOW_DESTRUCTIVE_TESTS=true or NODE_ENV=test.');
    }
}

async function setup() {
    assertSafe();
    const lifecycle = await phase15Fixture.runLifecycle();
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    const users = [...phase15Fixture.TEST_USERS, ...EXTRA_USERS];
    for (const user of users) {
        const fullName = user.role === 'entity-head'
            ? phase15Fixture.TEST_STAFF[0].staffName
            : user.fullName;
        await pool.query(
            `INSERT INTO tblpassword (PFNo, DateCreated, Level, Username, FullName, Pword, Email, CompanyID)
             VALUES (?, NOW(), ?, ?, ?, ?, '', ?)
             ON DUPLICATE KEY UPDATE
                Level = VALUES(Level), Username = VALUES(Username), FullName = VALUES(FullName),
                Pword = VALUES(Pword), CompanyID = VALUES(CompanyID)`,
            [user.pfno, user.level, user.username, fullName, passwordHash, phase15Fixture.TEST_COMPANY_ID]
        );
    }
    await pool.query(
        `UPDATE tblstaff
         SET HOD = 1,
             HOD_SDate = '2020-01-01',
             HOD_EDate = NULL
         WHERE CompanyID = ? AND PFNo = ?`,
        [phase15Fixture.TEST_COMPANY_ID, phase15Fixture.TEST_STAFF[0].pfno]
    );
    return {
        companyId: phase15Fixture.TEST_COMPANY_ID,
        payrollPeriod: `${phase15Fixture.TEST_MONTH}/${phase15Fixture.TEST_YEAR}`,
        activityCode: phase15Fixture.TEST_ACTIVITY,
        staffCount: phase15Fixture.TEST_STAFF.length,
        users: users.map(({ username, level }) => ({ username, level })),
        lifecycle: {
            generation1: lifecycle.generation1.postingStatus,
            generation2: lifecycle.generation2.postingStatus,
            reversal: lifecycle.reversal.workflowStatusAfterExecution,
            reopenGeneration: lifecycle.reopen.generation2WorkflowBatchId
        }
    };
}

async function cleanup() {
    assertSafe();
    await phase15Fixture.cleanupTestData();
    return { cleaned: true, companyId: phase15Fixture.TEST_COMPANY_ID };
}

async function main() {
    const command = process.argv[2];
    try {
        const result = command === 'setup' ? await setup() : command === 'cleanup' ? await cleanup() : null;
        if (!result) throw new Error('Use: node scripts/setupPrd009BrowserUat.js setup|cleanup');
        console.log(JSON.stringify(result, null, 2));
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { cleanup, setup, TEST_PASSWORD };
