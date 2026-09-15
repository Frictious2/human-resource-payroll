const pool = require('../config/db');
const parameterChangeService = require('../services/parameterChangeService');

const companyId = 1;
const adminUser = { id: 1, role: 'admin', name: 'Phase 13A Admin Tester' };
const entityHeadUser = { id: 5, role: 'entity-head', name: 'Phase 13A Entity Head Tester' };
let cleanupCode = '';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function findAvailableCode() {
    const candidates = ['Z9', 'Y9', 'X9', 'W9', 'V9'];
    for (const code of candidates) {
        const [liveRows] = await pool.query('SELECT Code FROM tblpaytype WHERE Code = ? LIMIT 1', [code]);
        const [requestRows] = await pool.query(
            `SELECT id
             FROM parameter_change_requests
             WHERE CompanyID = ?
               AND ParameterModule = 'pay-types'
               AND RecordReference = ?
               AND Status IN (?, ?, ?)
             LIMIT 1`,
            [
                companyId,
                code,
                parameterChangeService.PARAMETER_CHANGE_STATUSES.DRAFT,
                parameterChangeService.PARAMETER_CHANGE_STATUSES.RETURNED_BY_ENTITY_HEAD,
                parameterChangeService.PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD
            ]
        );
        if (!liveRows.length && !requestRows.length) {
            return code;
        }
    }

    throw new Error('No clean Phase 13A pay-type test code was available.');
}

async function cleanup(code) {
    if (!code) {
        return;
    }

    await pool.query(
        `DELETE FROM parameter_change_actions
         WHERE ChangeRequestID IN (
            SELECT id
            FROM parameter_change_requests
            WHERE CompanyID = ?
              AND ParameterModule = 'pay-types'
              AND RecordReference = ?
         )`,
        [companyId, code]
    );

    await pool.query(
        `DELETE FROM workflow_notifications
         WHERE Module = 'parameter-change'
           AND ReferenceID IN (
             SELECT CAST(id AS CHAR)
             FROM parameter_change_requests
             WHERE CompanyID = ?
               AND ParameterModule = 'pay-types'
               AND RecordReference = ?
           )`,
        [companyId, code]
    );

    await pool.query(
        `DELETE FROM parameter_change_requests
         WHERE CompanyID = ?
           AND ParameterModule = 'pay-types'
           AND RecordReference = ?`,
        [companyId, code]
    );

    await pool.query('DELETE FROM tblpaytype WHERE Code = ? AND (CompanyID = ? OR CompanyID IS NULL)', [code, companyId]);
}

async function getPayType(code) {
    const [rows] = await pool.query('SELECT * FROM tblpaytype WHERE Code = ? LIMIT 1', [code]);
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
    const code = await findAvailableCode();
    cleanupCode = code;
    await cleanup(code);

    const createDraft = await parameterChangeService.createParameterChangeDraft({
        companyId,
        module: 'pay-types',
        changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
        payload: { Code: code, PayType: 'Phase13A Test Activity' },
        reason: 'Phase 13A create pay-type draft',
        user: adminUser
    });

    assert(createDraft.request.RecordReference === code, 'Expected pay-type record reference to use the activity code.');
    assert(!(await getPayType(code)), 'Live tblpaytype row should not exist before approval.');

    const listedBeforeApproval = await parameterChangeService.listPayTypeRows(companyId);
    assert(!listedBeforeApproval.liveRows.some((row) => row.Code === code), 'Pending create proposal must not appear in the live pay-type selector list.');
    assert(listedBeforeApproval.pendingCreates.some((row) => row.RecordReference === code), 'Pending create proposal should appear in the pending-create list.');

    await parameterChangeService.submitParameterChange({
        companyId,
        requestId: createDraft.request.id,
        reason: 'Submit Phase 13A create proposal',
        user: adminUser
    });

    assert((await getNotificationCount(createDraft.request.id)) > 0, 'Submitting pay-type proposal should create notifications.');

    await parameterChangeService.entityHeadReturnParameterChange({
        companyId,
        requestId: createDraft.request.id,
        comments: 'Please refine the activity name.',
        user: entityHeadUser
    });

    const returnedDetail = await parameterChangeService.getParameterChangeDetail(companyId, createDraft.request.id, adminUser);
    assert(
        returnedDetail.request.Status === parameterChangeService.PARAMETER_CHANGE_STATUSES.RETURNED_BY_ENTITY_HEAD,
        'Returned pay-type proposal should move to RETURNED_BY_ENTITY_HEAD.'
    );

    const revisedDraft = await parameterChangeService.createParameterChangeDraft({
        companyId,
        module: 'pay-types',
        changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
        payload: { Code: code, PayType: 'Phase13A Test Activity Approved' },
        reason: 'Phase 13A revise returned pay-type proposal',
        user: adminUser
    });

    assert(revisedDraft.request.id === createDraft.request.id, 'Returned pay-type proposal should reuse the same draft request.');

    await parameterChangeService.submitParameterChange({
        companyId,
        requestId: revisedDraft.request.id,
        reason: 'Resubmit revised pay-type proposal',
        user: adminUser
    });

    await parameterChangeService.entityHeadApproveParameterChange({
        companyId,
        requestId: revisedDraft.request.id,
        comments: 'Approved for live use.',
        user: entityHeadUser
    });

    const appliedRow = await getPayType(code);
    assert(appliedRow && appliedRow.PayType === 'Phase13A Test Activity Approved', 'Approved pay-type proposal should create the live tblpaytype row.');

    const listedAfterApproval = await parameterChangeService.listPayTypeRows(companyId);
    assert(listedAfterApproval.liveRows.some((row) => row.Code === code), 'Applied pay-type should appear in the live pay-type selector list.');

    const updateDraft = await parameterChangeService.createParameterChangeDraft({
        companyId,
        module: 'pay-types',
        changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
        payload: { Code: code, PayType: 'Phase13A Test Activity Updated' },
        reason: 'Phase 13A update pay-type draft',
        user: adminUser
    });

    assert((await getPayType(code)).PayType === 'Phase13A Test Activity Approved', 'Live pay-type value must remain unchanged while update is still draft.');

    await parameterChangeService.submitParameterChange({
        companyId,
        requestId: updateDraft.request.id,
        reason: 'Submit pay-type update proposal',
        user: adminUser
    });

    await pool.query('UPDATE tblpaytype SET PayType = ? WHERE Code = ?', ['Phase13A External Mutation', code]);

    let checksumBlocked = false;
    try {
        await parameterChangeService.entityHeadApproveParameterChange({
            companyId,
            requestId: updateDraft.request.id,
            comments: 'Attempting approval after external source mutation.',
            user: entityHeadUser
        });
    } catch (error) {
        checksumBlocked = /changed after submission/i.test(error.message);
    }

    assert(checksumBlocked, 'Entity Head approval should be blocked when tblpaytype changes after submission.');

    await pool.query('UPDATE tblpaytype SET PayType = ? WHERE Code = ?', ['Phase13A Test Activity Approved', code]);

    let deleteBlocked = false;
    try {
        await parameterChangeService.createParameterChangeDraft({
            companyId,
            module: 'pay-types',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { Code: '01' },
            reason: 'Phase 13A invalid delete proposal for historical activity',
            user: adminUser
        });
    } catch (error) {
        deleteBlocked = /cannot be deleted/i.test(error.message);
    }

    assert(deleteBlocked, 'Historically used payroll activity 01 should not allow delete proposal creation.');

    console.log('Phase 13A pay-type workflow verification passed.');

    await cleanup(code);
}

run()
    .catch((error) => {
        console.error('Phase 13A pay-type workflow verification failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await cleanup(cleanupCode);
            await pool.end();
        } catch (error) {
            console.error('Phase 13A cleanup warning:', error.message);
        }
    });
