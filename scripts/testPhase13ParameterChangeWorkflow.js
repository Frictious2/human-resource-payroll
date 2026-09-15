const pool = require('../config/db');
const parameterChangeService = require('../services/parameterChangeService');

const companyId = 1;
const adminUser = { id: 1, role: 'admin', name: 'Phase 13 Admin Tester' };
const entityHeadUser = { id: 5, role: 'entity-head', name: 'Phase 13 Entity Head Tester' };

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function cleanup() {
    await pool.query(
        `DELETE FROM parameter_change_actions
         WHERE ChangeRequestID IN (
            SELECT id
            FROM parameter_change_requests
            WHERE CompanyID = ?
              AND ParameterModule = 'departments'
              AND (Reason LIKE 'Phase 13%' OR ProposedValues LIKE '%Phase13 Test Department%')
         )`,
        [companyId]
    );
    await pool.query(
        `DELETE FROM parameter_change_requests
         WHERE CompanyID = ?
           AND ParameterModule = 'departments'
           AND (Reason LIKE 'Phase 13%' OR ProposedValues LIKE '%Phase13 Test Department%')`,
        [companyId]
    );
    await pool.query(
        `DELETE FROM tbldept
         WHERE CompanyID = ?
           AND Dept LIKE ?`,
        [companyId, 'Phase13 Test %']
    );
}

async function getDeptByCode(code) {
    const [rows] = await pool.query('SELECT * FROM tbldept WHERE Code = ? LIMIT 1', [code]);
    return rows[0] || null;
}

async function getNotificationCount(requestId) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM workflow_notifications
         WHERE Module = 'parameter-change'
           AND ReferenceID = ?`,
        [String(requestId)]
    );
    return Number(rows[0]?.total || 0);
}

async function run() {
    await parameterChangeService.ensureParameterChangeTables();
    await cleanup();

    const initialDraft = await parameterChangeService.createParameterChangeDraft({
        companyId,
        module: 'departments',
        changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
        payload: { Dept: 'Phase13 Test Department' },
        reason: 'Phase 13 test create draft',
        user: adminUser
    });

    const createdCode = initialDraft.proposedValues.Code;
    assert(createdCode, 'Expected generated department code for create draft.');
    assert(!(await getDeptByCode(createdCode)), 'Live department should not exist before approval.');

    await parameterChangeService.submitParameterChange({
        companyId,
        requestId: initialDraft.request.id,
        reason: 'Submit for final approval',
        user: adminUser
    });
    assert((await getNotificationCount(initialDraft.request.id)) > 0, 'Submission should create parameter-change notifications.');

    const submittedDetail = await parameterChangeService.getParameterChangeDetail(companyId, initialDraft.request.id, adminUser);
    assert(submittedDetail.request.Status === parameterChangeService.PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD, 'Draft should move to SUBMITTED_TO_ENTITY_HEAD.');

    await parameterChangeService.entityHeadReturnParameterChange({
        companyId,
        requestId: initialDraft.request.id,
        comments: 'Please refine the department description.',
        user: entityHeadUser
    });

    const returnedDetail = await parameterChangeService.getParameterChangeDetail(companyId, initialDraft.request.id, adminUser);
    assert(returnedDetail.request.Status === parameterChangeService.PARAMETER_CHANGE_STATUSES.RETURNED_BY_ENTITY_HEAD, 'Request should move to RETURNED_BY_ENTITY_HEAD.');

    const updatedDraft = await parameterChangeService.createParameterChangeDraft({
        companyId,
        module: 'departments',
        changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
        payload: { Code: createdCode, Dept: 'Phase13 Test Department Approved' },
        reason: 'Refined after return',
        user: adminUser
    });

    assert(updatedDraft.request.id === initialDraft.request.id, 'Returned draft should be reused for resubmission.');

    await parameterChangeService.submitParameterChange({
        companyId,
        requestId: updatedDraft.request.id,
        reason: 'Resubmitted after correction',
        user: adminUser
    });

    await parameterChangeService.entityHeadApproveParameterChange({
        companyId,
        requestId: updatedDraft.request.id,
        comments: 'Approved for live application.',
        user: entityHeadUser
    });
    assert((await getNotificationCount(updatedDraft.request.id)) > 0, 'Final approval should leave parameter-change notifications recorded.');

    const liveDept = await getDeptByCode(createdCode);
    assert(liveDept && liveDept.Dept === 'Phase13 Test Department Approved', 'Approved department should be applied to the live source table.');

    const updateDraft = await parameterChangeService.createParameterChangeDraft({
        companyId,
        module: 'departments',
        changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
        payload: { Code: createdCode, Dept: 'Phase13 Test Department Updated Again' },
        reason: 'Phase 13 test update draft',
        user: adminUser
    });

    assert((await getDeptByCode(createdCode)).Dept === 'Phase13 Test Department Approved', 'Live department should remain unchanged while update is still draft.');

    await parameterChangeService.submitParameterChange({
        companyId,
        requestId: updateDraft.request.id,
        reason: 'Submit update proposal',
        user: adminUser
    });

    await pool.query('UPDATE tbldept SET Dept = ? WHERE Code = ?', ['Phase13 External Change', createdCode]);

    let checksumBlocked = false;
    try {
        await parameterChangeService.entityHeadApproveParameterChange({
            companyId,
            requestId: updateDraft.request.id,
            comments: 'Trying to approve after live mutation',
            user: entityHeadUser
        });
    } catch (error) {
        checksumBlocked = /changed after submission/i.test(error.message);
    }

    assert(checksumBlocked, 'Approval should be blocked when the live source changes after submission.');

    console.log('Phase 13 parameter change workflow verification passed.');
}

run()
    .catch((error) => {
        console.error('Phase 13 parameter change workflow verification failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await cleanup();
            await pool.end();
        } catch (error) {
            console.error('Phase 13 cleanup warning:', error.message);
        }
    });
