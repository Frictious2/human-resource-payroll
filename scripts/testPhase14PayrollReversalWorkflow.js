require('./requireDisposableDatabase')();
const pool = require('../config/db');
const fs = require('fs');
const path = require('path');
const ProcessEmolumentsService = require('../services/processEmolumentsService');
const payrollWorkflowService = require('../services/payrollWorkflowService');
const managerPayrollWorkflowService = require('../services/managerPayrollWorkflowService');
const auditorPayrollWorkflowService = require('../services/auditorPayrollWorkflowService');
const entityHeadPayrollWorkflowService = require('../services/entityHeadPayrollWorkflowService');
const payrollGlPostingService = require('../services/payrollGlPostingService');
const payrollReversalService = require('../services/payrollReversalService');
const workflowNotificationService = require('../services/workflowNotificationService');
const fixture = require('./testPhase15PayrollReopenWorkflow');

const {
    TEST_ACTIVITY,
    TEST_COMPANY_ID,
    TEST_MONTH,
    TEST_PAYROLL_DATE,
    TEST_POSTING_DATE,
    TEST_STAFF,
    TEST_USERS,
    TEST_USER_PREFIX,
    TEST_YEAR,
    buildUser,
    cleanupTestData,
    ensureIndexes,
    ensureSandboxSeed,
    getGenerationPayrollSummary,
    getPostingBatch,
    getReversalBatch,
    getReversalLineTotals,
    getWorkflowBatchByGeneration
} = fixture;

const SAFETY_ENABLED = process.env.ALLOW_DESTRUCTIVE_TESTS === 'true' || process.env.NODE_ENV === 'test';
const OTHER_COMPANY_ID = TEST_COMPANY_ID === 1 ? 2 : 1;
const RESULT_FILE = path.join(__dirname, '..', 'docs', 'test-results', 'phase14-reversal-latest.json');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function expectBlocked(label, action, pattern = /not authorized|only|not found|cannot|current status|already|changed/i) {
    try {
        await action();
    } catch (error) {
        assert(pattern.test(String(error.message || '')), `${label} returned an unexpected error: ${error.message}`);
        return;
    }
    throw new Error(`${label} should have been blocked.`);
}

async function getCount(sql, params = [], connection = pool) {
    const [rows] = await connection.query(sql, params);
    return Number(rows[0]?.total || 0);
}

async function getPostingTotals(postingBatchId, connection = pool) {
    const [rows] = await connection.query(
        `SELECT
            COALESCE(SUM(debit_amount), 0) AS debitTotal,
            COALESCE(SUM(credit_amount), 0) AS creditTotal,
            COUNT(*) AS lineCount
         FROM payroll_gl_posting_lines
         WHERE batch_id = ?`,
        [postingBatchId]
    );
    return {
        debitTotal: Number(rows[0]?.debitTotal || 0),
        creditTotal: Number(rows[0]?.creditTotal || 0),
        lineCount: Number(rows[0]?.lineCount || 0)
    };
}

async function assertReadyWithoutArtifacts(requestId) {
    const artifactCount = await getCount(
        'SELECT COUNT(*) AS total FROM payroll_gl_reversal_batches WHERE ReversalRequestID = ?',
        [requestId]
    );
    const [requests] = await pool.query('SELECT Status FROM payroll_reversal_requests WHERE id = ? LIMIT 1', [requestId]);
    assert(artifactCount === 0, 'Rollback must remove attempted reversal GL artifacts.');
    assert(requests[0]?.Status === payrollReversalService.REVERSAL_STATUSES.READY_TO_EXECUTE, 'Rollback must leave the request READY_TO_EXECUTE.');
}

async function testIntegrityMutation({ requestId, postingBatchId, type, financeUser }) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        if (type === 'payroll') {
            await connection.query(
                `UPDATE tblpayroll SET NetIncome = COALESCE(NetIncome, 0) + 1
                 WHERE CompanyID = ? AND PMonth = ? AND PYear = ? AND PType = ? LIMIT 1`,
                [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
            );
        } else {
            await connection.query(
                `UPDATE payroll_gl_posting_lines SET debit_amount = debit_amount + 1
                 WHERE batch_id = ? ORDER BY id ASC LIMIT 1`,
                [postingBatchId]
            );
        }
        await expectBlocked(
            `${type} mutation integrity check`,
            () => payrollReversalService.executeApprovedReversal({ companyId: TEST_COMPANY_ID, requestId, user: financeUser, connection }),
            /changed since the reversal request was approved/i
        );
        await connection.rollback();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
    await assertReadyWithoutArtifacts(requestId);
}

async function testForcedRollback(requestId, financeUser) {
    const actionsBefore = await getCount('SELECT COUNT(*) AS total FROM payroll_reversal_actions WHERE ReversalRequestID = ?', [requestId]);
    await expectBlocked(
        'forced execution rollback',
        () => payrollReversalService.executeApprovedReversal({
            companyId: TEST_COMPANY_ID,
            requestId,
            user: financeUser,
            testHooks: {
                afterReversalLinesInserted: async () => {
                    throw new Error('PRD-005 forced rollback marker');
                }
            }
        }),
        /PRD-005 forced rollback marker/i
    );
    await assertReadyWithoutArtifacts(requestId);
    const actionsAfter = await getCount('SELECT COUNT(*) AS total FROM payroll_reversal_actions WHERE ReversalRequestID = ?', [requestId]);
    assert(actionsAfter === actionsBefore, 'Forced rollback must not leave orphan action history.');
}

async function run() {
    if (!SAFETY_ENABLED) {
        throw new Error('Refusing to seed or reverse payroll. Run with ALLOW_DESTRUCTIVE_TESTS=true or NODE_ENV=test against a development/test database.');
    }

    await payrollReversalService.ensureReversalTables();
    await workflowNotificationService.ensureNotificationTable();
    await ensureIndexes();
    await cleanupTestData();
    await ensureSandboxSeed();

    const financeUser = buildUser(TEST_USERS.find((user) => user.role === 'finance-officer'));
    const managerUser = buildUser(TEST_USERS.find((user) => user.role === 'manager'));
    const auditorUser = buildUser(TEST_USERS.find((user) => user.role === 'auditor'));
    const entityHeadUser = buildUser(TEST_USERS.find((user) => user.role === 'entity-head'));
    const otherCompanyUsers = {
        finance: { ...financeUser, companyId: OTHER_COMPANY_ID },
        manager: { ...managerUser, companyId: OTHER_COMPANY_ID },
        entityHead: { ...entityHeadUser, companyId: OTHER_COMPANY_ID }
    };

    const processed = await ProcessEmolumentsService.processEmoluments({
        companyId: TEST_COMPANY_ID,
        activityCode: TEST_ACTIVITY,
        payrollDate: TEST_PAYROLL_DATE,
        processedByName: financeUser.name,
        processedByUser: financeUser,
        userRole: financeUser.role
    });
    assert(processed.workflowStatus === payrollWorkflowService.WORKFLOW_STATUSES.PROCESSED, 'Synthetic payroll should begin PROCESSED.');

    let workflowBatch = await getWorkflowBatchByGeneration(1);
    const payrollSummary = await getGenerationPayrollSummary(1, workflowBatch?.id);
    assert(workflowBatch && Number(workflowBatch.GenerationNo) === 1, 'Generation 1 workflow batch was not created.');
    assert(payrollSummary.rowCount === TEST_STAFF.length, 'Process Emoluments did not create the expected synthetic payroll rows.');
    assert(Boolean(payrollSummary.checksum), 'Processed payroll checksum was not stored.');

    await payrollWorkflowService.transitionWorkflow({
        companyId: TEST_COMPANY_ID,
        pMonth: TEST_MONTH,
        pYear: TEST_YEAR,
        pType: TEST_ACTIVITY,
        action: payrollWorkflowService.WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER,
        user: financeUser,
        comments: 'PRD-005 synthetic payroll submission.'
    });
    workflowBatch = await getWorkflowBatchByGeneration(1);
    assert(workflowBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER, 'Finance submission status mismatch.');
    await managerPayrollWorkflowService.endorseBatch({ companyId: TEST_COMPANY_ID, batchId: workflowBatch.id, user: managerUser, comments: 'PRD-005 Manager payroll endorsement.' });
    workflowBatch = await getWorkflowBatchByGeneration(1);
    assert(workflowBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR, 'Manager endorsement status mismatch.');
    await auditorPayrollWorkflowService.endorseBatch({ companyId: TEST_COMPANY_ID, batchId: workflowBatch.id, user: auditorUser, comments: 'PRD-005 Auditor payroll endorsement.' });
    workflowBatch = await getWorkflowBatchByGeneration(1);
    assert(workflowBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD, 'Auditor endorsement status mismatch.');
    await entityHeadPayrollWorkflowService.approveBatch({ companyId: TEST_COMPANY_ID, batchId: workflowBatch.id, user: entityHeadUser, comments: 'PRD-005 Entity Head payroll approval.' });
    workflowBatch = await getWorkflowBatchByGeneration(1);
    assert(workflowBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.FINAL_APPROVED, 'Entity Head approval status mismatch.');

    const posting = await payrollGlPostingService.postMonthlyPayrollToGL({
        companyId: TEST_COMPANY_ID,
        activityCode: TEST_ACTIVITY,
        postingDate: TEST_POSTING_DATE,
        postedBy: financeUser.id,
        postedByUser: financeUser
    });
    assert(posting.workflowStatus === payrollWorkflowService.WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS, 'Synthetic payroll posting failed.');
    workflowBatch = await getWorkflowBatchByGeneration(1);
    const postingBatch = await getPostingBatch(1);
    const originalTotals = await getPostingTotals(postingBatch.id);
    assert(workflowBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS, 'Workflow did not reach POSTED_TO_ACCOUNTS.');
    assert(Number(postingBatch.generation_no) === 1, 'GL posting batch is not generation-aware.');
    assert(originalTotals.lineCount > 0 && originalTotals.debitTotal === originalTotals.creditTotal, 'Original GL posting is not balanced.');

    const originalPayrollCount = await getCount(
        'SELECT COUNT(*) AS total FROM tblpayroll WHERE CompanyID = ? AND PMonth = ? AND PYear = ? AND PType = ?',
        [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
    );
    await expectBlocked('blank reversal reason', () => payrollReversalService.createReversalRequest({ companyId: TEST_COMPANY_ID, workflowBatchId: workflowBatch.id, reason: '', user: financeUser }), /reason/i);
    const created = await payrollReversalService.createReversalRequest({
        companyId: TEST_COMPANY_ID,
        workflowBatchId: workflowBatch.id,
        reason: 'PRD-005 isolated accounting reversal',
        comments: 'Self-contained Phase 14 test request.',
        user: financeUser
    });
    const requestId = created.request.id;
    assert(created.request.Status === payrollReversalService.REVERSAL_STATUSES.REQUESTED, 'Reversal request did not start REQUESTED.');
    assert(await getCount('SELECT COUNT(*) AS total FROM tblpayroll WHERE CompanyID = ? AND PMonth = ? AND PYear = ? AND PType = ?', [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]) === originalPayrollCount, 'Request creation changed payroll data.');
    assert((await getPostingTotals(postingBatch.id)).lineCount === originalTotals.lineCount, 'Request creation changed GL data.');

    await expectBlocked('duplicate active reversal', () => payrollReversalService.createReversalRequest({ companyId: TEST_COMPANY_ID, workflowBatchId: workflowBatch.id, reason: 'Duplicate', user: financeUser }), /already exists/i);
    await expectBlocked('premature execution', () => payrollReversalService.executeApprovedReversal({ companyId: TEST_COMPANY_ID, requestId, user: financeUser }), /not received final approval/i);
    await expectBlocked('cross-company request view', () => payrollReversalService.getReversalRequestDetail({ companyId: OTHER_COMPANY_ID, requestId }), /not found/i);

    await payrollReversalService.submitRequestToManager({ companyId: TEST_COMPANY_ID, requestId, user: financeUser, comments: 'Submit reversal to Manager.' });
    await expectBlocked('Finance Manager-stage endorsement', () => payrollReversalService.managerEndorseRequest({ companyId: TEST_COMPANY_ID, requestId, user: financeUser, comments: 'Invalid.' }));
    await expectBlocked('cross-company Manager endorsement', () => payrollReversalService.managerEndorseRequest({ companyId: OTHER_COMPANY_ID, requestId, user: otherCompanyUsers.manager, comments: 'Invalid.' }));
    await payrollReversalService.managerEndorseRequest({ companyId: TEST_COMPANY_ID, requestId, user: managerUser, comments: 'Manager endorsed reversal.' });
    await expectBlocked('Manager Auditor-stage endorsement', () => payrollReversalService.auditorEndorseRequest({ companyId: TEST_COMPANY_ID, requestId, user: managerUser, comments: 'Invalid.' }));
    await payrollReversalService.auditorEndorseRequest({ companyId: TEST_COMPANY_ID, requestId, user: auditorUser, comments: 'Auditor endorsed reversal.' });
    await expectBlocked('Auditor Entity-Head approval', () => payrollReversalService.entityHeadApproveRequest({ companyId: TEST_COMPANY_ID, requestId, user: auditorUser, comments: 'Invalid.' }));
    await expectBlocked('cross-company Entity-Head approval', () => payrollReversalService.entityHeadApproveRequest({ companyId: OTHER_COMPANY_ID, requestId, user: otherCompanyUsers.entityHead, comments: 'Invalid.' }));
    await payrollReversalService.entityHeadApproveRequest({ companyId: TEST_COMPANY_ID, requestId, user: entityHeadUser, comments: 'Entity Head approved reversal.' });

    const ready = await payrollReversalService.getReversalRequestDetail({ companyId: TEST_COMPANY_ID, requestId });
    assert(ready.request.Status === payrollReversalService.REVERSAL_STATUSES.READY_TO_EXECUTE, 'Final approval did not produce READY_TO_EXECUTE.');
    await expectBlocked('Entity Head execution', () => payrollReversalService.executeApprovedReversal({ companyId: TEST_COMPANY_ID, requestId, user: entityHeadUser }));
    await expectBlocked('cross-company Finance execution', () => payrollReversalService.executeApprovedReversal({ companyId: OTHER_COMPANY_ID, requestId, user: otherCompanyUsers.finance }));
    await testIntegrityMutation({ requestId, postingBatchId: postingBatch.id, type: 'payroll', financeUser });
    await testIntegrityMutation({ requestId, postingBatchId: postingBatch.id, type: 'gl', financeUser });
    await testForcedRollback(requestId, financeUser);

    const execution = await payrollReversalService.executeApprovedReversal({ companyId: TEST_COMPANY_ID, requestId, user: financeUser });
    assert(execution.workflowStatus === payrollWorkflowService.WORKFLOW_STATUSES.REVERSED, 'Reversal execution did not return REVERSED.');
    const reversalBatch = await getReversalBatch(requestId);
    const reversalTotals = await getReversalLineTotals(reversalBatch.id);
    const reversedWorkflow = await getWorkflowBatchByGeneration(1);
    const finalRequest = await payrollReversalService.getReversalRequestDetail({ companyId: TEST_COMPANY_ID, requestId });
    assert(reversedWorkflow.Status === payrollWorkflowService.WORKFLOW_STATUSES.REVERSED, 'Workflow batch did not become REVERSED.');
    assert(finalRequest.request.Status === payrollReversalService.REVERSAL_STATUSES.REVERSED, 'Reversal request did not become REVERSED.');
    assert(reversalTotals.debitTotal === reversalTotals.creditTotal, 'Reversal entries do not balance.');
    assert(reversalTotals.debitTotal === originalTotals.creditTotal, 'Reversal debits do not equal original credits.');
    assert(reversalTotals.creditTotal === originalTotals.debitTotal, 'Reversal credits do not equal original debits.');

    const retainedPayrollCount = await getCount(
        `SELECT COUNT(*) AS total FROM tblpayroll
         WHERE CompanyID = ? AND PMonth = ? AND PYear = ? AND PType = ?
           AND posted_to_gl = 1 AND gl_posted_batch_id = ?`,
        [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY, postingBatch.id]
    );
    assert(retainedPayrollCount === originalPayrollCount, 'Original posted payroll rows were not preserved.');
    assert((await getPostingTotals(postingBatch.id)).lineCount === originalTotals.lineCount, 'Original GL lines were not preserved.');
    await expectBlocked('duplicate completed reversal', () => payrollReversalService.createReversalRequest({ companyId: TEST_COMPANY_ID, workflowBatchId: workflowBatch.id, reason: 'Second reversal', user: financeUser }), /already been reversed|only posted payroll/i);

    const actionCount = await getCount('SELECT COUNT(*) AS total FROM payroll_reversal_actions WHERE ReversalRequestID = ?', [requestId]);
    const notificationCount = await getCount(
        `SELECT COUNT(*) AS total FROM workflow_notifications
         WHERE CompanyID = ? AND (ReferenceID = ? OR EventKey LIKE ?)`,
        [TEST_COMPANY_ID, String(requestId), `%${requestId}%`]
    );
    const auditCount = await getCount(
        `SELECT COUNT(*) AS total FROM tblaudittrail
         WHERE CompanyID = ? AND FormName = 'payroll/reversal' AND RecordID = ? AND Loggedout = 0`,
        [TEST_COMPANY_ID, String(requestId).slice(0, 6)]
    );
    assert(actionCount >= 6, 'Reversal action history is incomplete.');
    assert(notificationCount > 0, 'Reversal notifications were not created.');
    assert(auditCount >= 6, 'Reversal audit history is incomplete or Loggedout-incompatible.');

    return {
        testEnvironment: {
            companyId: TEST_COMPANY_ID,
            month: TEST_MONTH,
            year: TEST_YEAR,
            activityCode: TEST_ACTIVITY,
            users: TEST_USERS.map(({ pfno, role, username }) => ({ pfno, role, username })),
            staffCount: TEST_STAFF.length,
            cleanupMarker: TEST_USER_PREFIX
        },
        payroll: { workflowBatchId: workflowBatch.id, generationNo: 1, rowCount: payrollSummary.rowCount, checksum: payrollSummary.checksum, postingBatchId: postingBatch.id, finalStatus: reversedWorkflow.Status },
        reversal: { requestId, reversalBatchId: reversalBatch.id, finalStatus: finalRequest.request.Status, actionCount, notificationCount, auditCount },
        reconciliation: {
            originalDebitTotal: originalTotals.debitTotal,
            originalCreditTotal: originalTotals.creditTotal,
            reversalDebitTotal: reversalTotals.debitTotal,
            reversalCreditTotal: reversalTotals.creditTotal,
            netEffect: (originalTotals.debitTotal - originalTotals.creditTotal) + (reversalTotals.debitTotal - reversalTotals.creditTotal)
        },
        checks: {
            duplicateReversalBlocked: true,
            prematureExecutionBlocked: true,
            payrollMutationBlocked: true,
            glMutationBlocked: true,
            separationOfDutiesPassed: true,
            crossCompanyPassed: true,
            forcedRollbackPassed: true
        }
    };
}

async function main() {
    let result = null;
    try {
        if (SAFETY_ENABLED && fs.existsSync(RESULT_FILE)) fs.unlinkSync(RESULT_FILE);
        result = await run();
        console.log('Phase 14 self-contained payroll reversal workflow verification passed.');
        console.log(JSON.stringify(result, null, 2));
    } finally {
        if (SAFETY_ENABLED) await cleanupTestData();
        await pool.end();
    }

    fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
    fs.writeFileSync(RESULT_FILE, `${JSON.stringify({
        status: 'PASS',
        completedAt: new Date().toISOString(),
        selfContained: true,
        safetyGuard: 'ALLOW_DESTRUCTIVE_TESTS=true or NODE_ENV=test',
        ...result
    }, null, 2)}\n`, 'utf8');
}

if (require.main === module) {
    main().catch((error) => {
        console.error('Phase 14 self-contained payroll reversal workflow verification failed.');
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { run };
