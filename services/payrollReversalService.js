const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const payrollWorkflowService = require('./payrollWorkflowService');
const payrollGlQueryService = require('./payrollGlQueryService');
const workflowNotificationService = require('./workflowNotificationService');
const auditTrailService = require('./auditTrailService');

const REVERSAL_STATUSES = Object.freeze({
    REQUESTED: 'REQUESTED',
    SUBMITTED_TO_MANAGER: 'SUBMITTED_TO_MANAGER',
    MANAGER_ENDORSED: 'MANAGER_ENDORSED',
    RETURNED_BY_MANAGER: 'RETURNED_BY_MANAGER',
    SUBMITTED_TO_AUDITOR: 'SUBMITTED_TO_AUDITOR',
    AUDITOR_ENDORSED: 'AUDITOR_ENDORSED',
    RETURNED_BY_AUDITOR: 'RETURNED_BY_AUDITOR',
    SUBMITTED_TO_ENTITY_HEAD: 'SUBMITTED_TO_ENTITY_HEAD',
    FINAL_APPROVED: 'FINAL_APPROVED',
    FINAL_REJECTED: 'FINAL_REJECTED',
    READY_TO_EXECUTE: 'READY_TO_EXECUTE',
    REVERSAL_IN_PROGRESS: 'REVERSAL_IN_PROGRESS',
    REVERSED: 'REVERSED',
    REVERSAL_FAILED: 'REVERSAL_FAILED',
    CANCELLED: 'CANCELLED'
});

const REVERSAL_ACTIONS = Object.freeze({
    REQUEST_REVERSAL: 'REQUEST_REVERSAL',
    SUBMIT_TO_MANAGER: 'SUBMIT_TO_MANAGER',
    MANAGER_ENDORSE: 'MANAGER_ENDORSE',
    MANAGER_RETURN: 'MANAGER_RETURN',
    SUBMIT_TO_AUDITOR: 'SUBMIT_TO_AUDITOR',
    AUDITOR_ENDORSE: 'AUDITOR_ENDORSE',
    AUDITOR_RETURN: 'AUDITOR_RETURN',
    SUBMIT_TO_ENTITY_HEAD: 'SUBMIT_TO_ENTITY_HEAD',
    FINAL_APPROVE: 'FINAL_APPROVE',
    FINAL_RETURN: 'FINAL_RETURN',
    FINAL_REJECT: 'FINAL_REJECT',
    READY_TO_EXECUTE: 'READY_TO_EXECUTE',
    EXECUTE_REVERSAL: 'EXECUTE_REVERSAL',
    CANCEL_REQUEST: 'CANCEL_REQUEST'
});

const ROLE_GROUPS = Object.freeze({
    FINANCE: 'finance',
    MANAGER: 'manager',
    AUDITOR: 'auditor',
    ENTITY_HEAD: 'entity-head'
});

const ROLE_GROUP_MAP = Object.freeze({
    'finance-officer': ROLE_GROUPS.FINANCE,
    manager: ROLE_GROUPS.MANAGER,
    auditor: ROLE_GROUPS.AUDITOR,
    'entity-head': ROLE_GROUPS.ENTITY_HEAD
});

const VALID_TRANSITIONS = Object.freeze({
    [REVERSAL_STATUSES.REQUESTED]: [REVERSAL_STATUSES.SUBMITTED_TO_MANAGER, REVERSAL_STATUSES.CANCELLED],
    [REVERSAL_STATUSES.SUBMITTED_TO_MANAGER]: [REVERSAL_STATUSES.MANAGER_ENDORSED, REVERSAL_STATUSES.RETURNED_BY_MANAGER],
    [REVERSAL_STATUSES.RETURNED_BY_MANAGER]: [REVERSAL_STATUSES.SUBMITTED_TO_MANAGER, REVERSAL_STATUSES.CANCELLED],
    [REVERSAL_STATUSES.MANAGER_ENDORSED]: [REVERSAL_STATUSES.SUBMITTED_TO_AUDITOR],
    [REVERSAL_STATUSES.SUBMITTED_TO_AUDITOR]: [REVERSAL_STATUSES.AUDITOR_ENDORSED, REVERSAL_STATUSES.RETURNED_BY_AUDITOR],
    [REVERSAL_STATUSES.RETURNED_BY_AUDITOR]: [REVERSAL_STATUSES.SUBMITTED_TO_MANAGER, REVERSAL_STATUSES.CANCELLED],
    [REVERSAL_STATUSES.AUDITOR_ENDORSED]: [REVERSAL_STATUSES.SUBMITTED_TO_ENTITY_HEAD],
    [REVERSAL_STATUSES.SUBMITTED_TO_ENTITY_HEAD]: [REVERSAL_STATUSES.FINAL_APPROVED, REVERSAL_STATUSES.FINAL_REJECTED],
    [REVERSAL_STATUSES.FINAL_APPROVED]: [REVERSAL_STATUSES.READY_TO_EXECUTE],
    [REVERSAL_STATUSES.FINAL_REJECTED]: [],
    [REVERSAL_STATUSES.READY_TO_EXECUTE]: [REVERSAL_STATUSES.REVERSAL_IN_PROGRESS],
    [REVERSAL_STATUSES.REVERSAL_IN_PROGRESS]: [REVERSAL_STATUSES.REVERSED, REVERSAL_STATUSES.REVERSAL_FAILED],
    [REVERSAL_STATUSES.REVERSED]: [],
    [REVERSAL_STATUSES.REVERSAL_FAILED]: [REVERSAL_STATUSES.READY_TO_EXECUTE],
    [REVERSAL_STATUSES.CANCELLED]: []
});

const ACTIVE_REQUEST_STATUSES = new Set([
    REVERSAL_STATUSES.REQUESTED,
    REVERSAL_STATUSES.SUBMITTED_TO_MANAGER,
    REVERSAL_STATUSES.MANAGER_ENDORSED,
    REVERSAL_STATUSES.RETURNED_BY_MANAGER,
    REVERSAL_STATUSES.SUBMITTED_TO_AUDITOR,
    REVERSAL_STATUSES.AUDITOR_ENDORSED,
    REVERSAL_STATUSES.RETURNED_BY_AUDITOR,
    REVERSAL_STATUSES.SUBMITTED_TO_ENTITY_HEAD,
    REVERSAL_STATUSES.FINAL_APPROVED,
    REVERSAL_STATUSES.READY_TO_EXECUTE,
    REVERSAL_STATUSES.REVERSAL_IN_PROGRESS,
    REVERSAL_STATUSES.REVERSAL_FAILED
]);

const TERMINAL_REQUEST_STATUSES = new Set([
    REVERSAL_STATUSES.REVERSED,
    REVERSAL_STATUSES.CANCELLED,
    REVERSAL_STATUSES.FINAL_REJECTED
]);

const PAYROLL_WORKFLOW_REVERSED_STATUS = 'REVERSED';
const PAYROLL_WORKFLOW_REVERSE_ACTION = 'REVERSE_POSTING';

function createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function normalizeCompanyId(companyId) {
    return Number(companyId) || 1;
}

function normalizeText(value) {
    const text = String(value || '').trim();
    return text || '';
}

function normalizeUser(user = {}) {
    return {
        id: Number(user.id ?? user.pfno ?? 0) || 0,
        role: String(user.role || '').trim(),
        name: user.name || user.fullName || user.username || user.email || 'System'
    };
}

function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function buildChecksum(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function getActorGroup(role) {
    return ROLE_GROUP_MAP[String(role || '').trim()] || null;
}

function validateTransition(currentStatus, nextStatus) {
    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
        throw createError(`Invalid reversal transition: ${currentStatus} -> ${nextStatus}.`, 409);
    }
}

async function logAudit(connection, {
    companyId,
    userName,
    action,
    requestId,
    oldValue,
    newValue
}) {
    await auditTrailService.writeAuditEntryWithExecutor(connection, {
        action,
        userName: userName || 'System',
        formName: 'payroll/reversal',
        recordId: String(requestId || '').slice(0, 6) || null,
        fieldName: 'Status',
        oldValue: oldValue || null,
        newValue: newValue || null,
        loggedout: 0,
        companyId: normalizeCompanyId(companyId)
    });
}

function splitSqlStatements(sql) {
    return String(sql || '')
        .split(/;\s*(?:\r?\n|$)/)
        .map((statement) => statement.trim())
        .filter(Boolean);
}

async function ensureReversalTables(connection = null) {
    if (connection) {
        const requiredTables = [
            'payroll_reversal_requests',
            'payroll_reversal_actions',
            'payroll_gl_reversal_batches',
            'payroll_gl_reversal_lines'
        ];
        const [rows] = await connection.query(
            `SELECT TABLE_NAME
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME IN (${requiredTables.map(() => '?').join(', ')})`,
            requiredTables
        );
        if (rows.length !== requiredTables.length) {
            throw createError('Payroll reversal schema is not installed. Apply the Phase 14 migration before using this workflow.', 503);
        }
        return;
    }

    const executor = connection || pool;
    const migrationPath = path.join(__dirname, '..', 'database', 'migrations', '20260714-payroll-reversal-workflow.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    const statements = splitSqlStatements(migrationSql);
    for (const statement of statements) {
        // MySQL2 query() handles single statements safely here.
        await executor.query(statement);
    }
}

function getReversalStatusBadgeClass(status) {
    const badgeMap = {
        REQUESTED: 'bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle',
        SUBMITTED_TO_MANAGER: 'bg-info-subtle text-info-emphasis border border-info-subtle',
        MANAGER_ENDORSED: 'bg-primary-subtle text-primary-emphasis border border-primary-subtle',
        RETURNED_BY_MANAGER: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        SUBMITTED_TO_AUDITOR: 'bg-info-subtle text-info-emphasis border border-info-subtle',
        AUDITOR_ENDORSED: 'bg-primary-subtle text-primary-emphasis border border-primary-subtle',
        RETURNED_BY_AUDITOR: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        SUBMITTED_TO_ENTITY_HEAD: 'bg-dark-subtle text-dark-emphasis border border-dark-subtle',
        FINAL_APPROVED: 'bg-success-subtle text-success-emphasis border border-success-subtle',
        FINAL_REJECTED: 'bg-danger-subtle text-danger-emphasis border border-danger-subtle',
        READY_TO_EXECUTE: 'bg-success text-white',
        REVERSAL_IN_PROGRESS: 'bg-warning text-dark',
        REVERSED: 'bg-danger text-white',
        REVERSAL_FAILED: 'bg-danger-subtle text-danger-emphasis border border-danger-subtle',
        CANCELLED: 'bg-light text-dark border'
    };

    return badgeMap[status] || 'bg-light text-dark border';
}

async function findActiveRequestForBatch(workflowBatchId, excludeRequestId = null, connection = null) {
    const executor = connection || pool;
    const params = [workflowBatchId, ...Array.from(ACTIVE_REQUEST_STATUSES)];
    let sql = `
        SELECT *
        FROM payroll_reversal_requests
        WHERE WorkflowBatchID = ?
          AND Status IN (${Array.from(ACTIVE_REQUEST_STATUSES).map(() => '?').join(', ')})
    `;
    if (excludeRequestId) {
        sql += ' AND id <> ?';
        params.push(excludeRequestId);
    }
    sql += ' ORDER BY id DESC LIMIT 1';
    const [rows] = await executor.query(sql, params);
    return rows[0] || null;
}

async function getReversalRequestById(companyId, requestId, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `SELECT *
         FROM payroll_reversal_requests
         WHERE CompanyID = ?
           AND id = ?
         LIMIT 1`,
        [normalizeCompanyId(companyId), Number(requestId)]
    );
    return rows[0] || null;
}

async function getWorkflowBatchById(companyId, batchId, connection = null) {
    const batch = await payrollWorkflowService.getWorkflowBatchById(normalizeCompanyId(companyId), Number(batchId), connection);
    if (!batch) {
        throw createError('Payroll batch not found.', 404);
    }
    return batch;
}

async function resolvePostingBatchForWorkflowBatch(batch, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `SELECT id, status, posted_by, posted_at, total_lines, total_amount, remarks
         FROM payroll_gl_posting_batches
         WHERE company_id = ?
           AND activity_code = ?
           AND posting_month = ?
           AND posting_year = ?
         LIMIT 1`,
        [batch.CompanyID, String(batch.PType).trim(), Number(batch.PMonth), Number(batch.PYear)]
    );
    return rows[0] || null;
}

async function getPostedPayrollFlags(batch, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `SELECT
            COUNT(*) AS total_rows,
            SUM(CASE WHEN COALESCE(posted_to_gl, 0) = 1 THEN 1 ELSE 0 END) AS posted_rows,
            MAX(gl_posted_batch_id) AS gl_posted_batch_id,
            MAX(gl_posted_at) AS gl_posted_at
         FROM tblpayroll
         WHERE CompanyID = ?
           AND PType = ?
           AND PMonth = ?
           AND PYear = ?`,
        [batch.CompanyID, String(batch.PType).trim(), Number(batch.PMonth), Number(batch.PYear)]
    );
    return rows[0] || {
        total_rows: 0,
        posted_rows: 0,
        gl_posted_batch_id: null,
        gl_posted_at: null
    };
}

async function getOriginalGlSnapshot(companyId, batchId, connection = null) {
    const detail = await payrollGlQueryService.getPostingBatchDetail({
        companyId: normalizeCompanyId(companyId),
        batchId: Number(batchId),
        connection
    });
    if (!detail) {
        throw createError('The original GL posting batch could not be found.', 404);
    }
    const debitTotal = roundMoney(detail.lines.reduce((sum, line) => sum + Number(line.entry_type === 'debit' ? line.amount : 0), 0));
    const creditTotal = roundMoney(detail.lines.reduce((sum, line) => sum + Number(line.entry_type === 'credit' ? line.amount : 0), 0));
    return {
        batch: detail.batch,
        lines: detail.lines,
        totalLines: detail.lines.length,
        totalDebit: debitTotal,
        totalCredit: creditTotal,
        checksum: buildChecksum(detail.lines)
    };
}

async function assertEligibleForReversal({ companyId, workflowBatchId, connection = null }) {
    const batch = await getWorkflowBatchById(companyId, workflowBatchId, connection);

    if (batch.Status !== payrollWorkflowService.WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS) {
        throw createError('Only posted payroll can be reversed.', 409);
    }

    const postingBatch = await resolvePostingBatchForWorkflowBatch(batch, connection);
    if (!postingBatch) {
        throw createError('The source GL posting batch could not be identified.', 409);
    }

    if (String(postingBatch.status || '').toLowerCase() === 'reversed') {
        throw createError('This payroll batch has already been reversed.', 409);
    }

    const postingFlags = await getPostedPayrollFlags(batch, connection);
    if (Number(postingFlags.total_rows || 0) <= 0 || Number(postingFlags.posted_rows || 0) <= 0) {
        throw createError('The payroll posting flags are inconsistent for this posted batch.', 409);
    }

    const activeRequest = await findActiveRequestForBatch(batch.id, null, connection);
    if (activeRequest) {
        throw createError('A reversal request already exists for this payroll batch.', 409);
    }

    const existingTerminal = await getLatestRequestForBatch(batch.id, connection);
    if (existingTerminal && existingTerminal.Status === REVERSAL_STATUSES.REVERSED) {
        throw createError('This payroll batch has already been reversed.', 409);
    }

    return {
        batch,
        postingBatch,
        postingFlags
    };
}

async function getReversalEligibilityDetail({ companyId, workflowBatchId, connection = null }) {
    const { batch, postingBatch, postingFlags } = await assertEligibleForReversal({
        companyId,
        workflowBatchId,
        connection
    });
    const workflowDetail = await payrollWorkflowService.getWorkflowBatchDetail(batch.CompanyID, batch.id, connection);
    const postingDetail = await payrollGlQueryService.getPostingBatchDetail({ companyId: batch.CompanyID, batchId: postingBatch.id });
    return {
        batch,
        postingBatch,
        postingFlags,
        workflowDetail,
        postingDetail
    };
}

async function getLatestRequestForBatch(workflowBatchId, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `SELECT *
         FROM payroll_reversal_requests
         WHERE WorkflowBatchID = ?
         ORDER BY id DESC
         LIMIT 1`,
        [workflowBatchId]
    );
    return rows[0] || null;
}

async function createAction(connection, {
    requestId,
    action,
    fromStatus,
    toStatus,
    actionBy,
    comments,
    metadata,
    result = 'SUCCESS'
}) {
    const [insertResult] = await connection.query(
        `INSERT INTO payroll_reversal_actions
        (ReversalRequestID, Action, FromStatus, ToStatus, ActionBy, ActionAt, Comments, Metadata, Result)
        VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
        [
            requestId,
            action,
            fromStatus || null,
            toStatus,
            actionBy,
            comments || null,
            metadata ? JSON.stringify(metadata) : null,
            result
        ]
    );
    return insertResult.insertId;
}

async function updateRequest(connection, requestId, values) {
    const assignments = [];
    const params = [];
    Object.entries(values).forEach(([field, value]) => {
        assignments.push(`${field} = ?`);
        params.push(value);
    });
    assignments.push('UpdatedAt = NOW()');
    params.push(requestId);
    await connection.query(
        `UPDATE payroll_reversal_requests
         SET ${assignments.join(', ')}
         WHERE id = ?`,
        params
    );
}

async function assertRole(user, expectedRole, message) {
    const actor = normalizeUser(user);
    if (actor.role !== expectedRole) {
        throw createError(message, 403);
    }
    return actor;
}

async function assertNoIncompatiblePriorAction(requestId, actor, disallowedActorGroups, connection) {
    const [rows] = await connection.query(
        `SELECT ActionBy, Metadata
         FROM payroll_reversal_actions
         WHERE ReversalRequestID = ?`,
        [requestId]
    );
    for (const row of rows) {
        let metadata = {};
        try {
            metadata = row.Metadata ? JSON.parse(row.Metadata) : {};
        } catch (error) {
            metadata = {};
        }
        if (Number(row.ActionBy || 0) === actor.id && disallowedActorGroups.includes(metadata.actorGroup)) {
            throw createError('You performed an incompatible earlier action on this reversal request.', 409);
        }
    }
}

function getRoleActionUrl(role, requestId = '') {
    const suffix = requestId ? `/${requestId}` : '';
    switch (role) {
        case 'finance-officer':
            return `/finance/payroll/reversals${suffix}`;
        case 'manager':
            return `/manager/payroll/reversals${suffix}`;
        case 'auditor':
            return `/auditor/payroll/reversals${suffix}`;
        case 'entity-head':
            return `/entity-head/payroll/reversals${suffix}`;
        default:
            return '/work-queue';
    }
}

async function notifyReversalAction({
    companyId,
    request,
    action,
    actionId,
    actor,
    comments = '',
    connection
}) {
    const recipients = [];
    const referenceId = String(request.id);
    const referenceType = 'payroll_reversal_request';
    const actorName = actor?.name || 'System';
    const payrollReference = `${String(request.PMonth).padStart(2, '0')}/${request.PYear}/${String(request.PType).trim()}`;
    let title = '';
    let message = '';
    let actionUrl = '';

    if (action === REVERSAL_ACTIONS.SUBMIT_TO_MANAGER) {
        recipients.push(...await workflowNotificationService.getUsersByRole(companyId, 'manager', connection));
        title = 'Payroll reversal awaiting Manager endorsement';
        message = `${actorName} submitted a payroll reversal request for ${payrollReference}.`;
        actionUrl = getRoleActionUrl('manager', request.id);
    } else if (action === REVERSAL_ACTIONS.MANAGER_RETURN) {
        recipients.push(...await workflowNotificationService.resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
        title = 'Payroll reversal returned by Manager';
        message = `Payroll reversal ${payrollReference} was returned by the Manager${comments ? `: ${comments}` : '.'}`;
        actionUrl = getRoleActionUrl('finance-officer', request.id);
    } else if (action === REVERSAL_ACTIONS.SUBMIT_TO_AUDITOR) {
        recipients.push(...await workflowNotificationService.getUsersByRole(companyId, 'auditor', connection));
        title = 'Payroll reversal awaiting Auditor review';
        message = `${actorName} forwarded payroll reversal ${payrollReference} to the Auditor.`;
        actionUrl = getRoleActionUrl('auditor', request.id);
    } else if (action === REVERSAL_ACTIONS.AUDITOR_RETURN) {
        recipients.push(...await workflowNotificationService.resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
        title = 'Payroll reversal returned after audit review';
        message = `Payroll reversal ${payrollReference} was returned after audit review${comments ? `: ${comments}` : '.'}`;
        actionUrl = getRoleActionUrl('finance-officer', request.id);
    } else if (action === REVERSAL_ACTIONS.SUBMIT_TO_ENTITY_HEAD) {
        recipients.push(...await workflowNotificationService.getUsersByRole(companyId, 'entity-head', connection));
        title = 'Payroll reversal awaiting final approval';
        message = `${actorName} forwarded payroll reversal ${payrollReference} for final approval.`;
        actionUrl = getRoleActionUrl('entity-head', request.id);
    } else if (action === REVERSAL_ACTIONS.READY_TO_EXECUTE) {
        recipients.push(...await workflowNotificationService.resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
        title = 'Payroll reversal approved and ready to execute';
        message = `Payroll reversal ${payrollReference} has received final approval and is ready for execution.`;
        actionUrl = getRoleActionUrl('finance-officer', request.id);
    } else if (action === REVERSAL_ACTIONS.FINAL_REJECT || action === REVERSAL_ACTIONS.FINAL_RETURN) {
        recipients.push(...await workflowNotificationService.resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
        recipients.push(...await workflowNotificationService.getUsersByRole(companyId, 'manager', connection));
        recipients.push(...await workflowNotificationService.getUsersByRole(companyId, 'auditor', connection));
        title = action === REVERSAL_ACTIONS.FINAL_REJECT ? 'Payroll reversal rejected' : 'Payroll reversal returned';
        message = `Payroll reversal ${payrollReference} ${action === REVERSAL_ACTIONS.FINAL_REJECT ? 'was rejected' : 'was returned'}${comments ? `: ${comments}` : '.'}`;
        actionUrl = getRoleActionUrl('finance-officer', request.id);
    } else if (action === REVERSAL_ACTIONS.EXECUTE_REVERSAL) {
        recipients.push(...await workflowNotificationService.resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
        recipients.push(...await workflowNotificationService.getUsersByRole(companyId, 'manager', connection));
        recipients.push(...await workflowNotificationService.getUsersByRole(companyId, 'auditor', connection));
        recipients.push(...await workflowNotificationService.getUsersByRole(companyId, 'entity-head', connection));
        title = 'Payroll reversal completed';
        message = `Payroll reversal ${payrollReference} was executed successfully.`;
        actionUrl = getRoleActionUrl('finance-officer', request.id);
    } else {
        return;
    }

    if (!recipients.length) {
        return;
    }

    const deduped = new Map();
    for (const recipient of recipients) {
        if (!recipient?.id) {
            continue;
        }
        deduped.set(recipient.id, recipient);
    }

    await workflowNotificationService.createNotifications(
        Array.from(deduped.values()).map((recipient) => ({
            companyId,
            recipientUserId: recipient.id,
            recipientRole: recipient.role,
            notificationType: 'payroll-reversal',
            module: 'payroll-reversal',
            title,
            message,
            referenceType,
            referenceId,
            actionUrl,
            eventKey: workflowNotificationService.buildEventKey(
                'payroll-reversal',
                companyId,
                recipient.id,
                action,
                `${request.id}:${actionId || request.id}`
            ),
            createdBy: actor?.id || null,
            metadata: {
                action,
                requestId: request.id,
                workflowBatchId: request.WorkflowBatchID,
                glPostingBatchId: request.GLPostingBatchID,
                status: request.Status
            }
        })),
        connection
    );
}

async function createReversalRequest({ companyId, workflowBatchId, reason, comments = '', user, connection = null }) {
    const actor = await assertRole(user, 'finance-officer', 'Only Finance Officers can create reversal requests.');
    if (!normalizeText(reason)) {
        throw createError('A reason for the payroll reversal is required.', 400);
    }
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }

        await ensureReversalTables(executor);
        const { batch, postingBatch, postingFlags } = await assertEligibleForReversal({
            companyId: normalizeCompanyId(companyId),
            workflowBatchId: Number(workflowBatchId),
            connection: executor
        });

        const workflowDetail = await payrollWorkflowService.getWorkflowBatchDetail(batch.CompanyID, batch.id, executor);
        const glSnapshot = await getOriginalGlSnapshot(batch.CompanyID, postingBatch.id, executor);
        const [insertResult] = await executor.query(
            `INSERT INTO payroll_reversal_requests
            (WorkflowBatchID, GLPostingBatchID, CompanyID, PMonth, PYear, PType, Status, Reason, RequestedBy, RequestedAt, OriginalPayrollChecksum, OriginalPayrollSnapshot, OriginalGLSnapshot, CreatedAt, UpdatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, NOW(), NOW())`,
            [
                batch.id,
                postingBatch.id,
                batch.CompanyID,
                batch.PMonth,
                batch.PYear,
                batch.PType,
                REVERSAL_STATUSES.REQUESTED,
                normalizeText(reason) || normalizeText(comments),
                actor.id,
                batch.PayrollChecksum || '',
                JSON.stringify({
                    batch: workflowDetail.batch,
                    summary: {
                        totalStaff: workflowDetail.batch.TotalStaff,
                        totalGross: workflowDetail.batch.TotalGross,
                        totalDeductions: workflowDetail.batch.TotalDeductions,
                        totalNet: workflowDetail.batch.TotalNet,
                        payrollRowCount: workflowDetail.batch.PayrollRowCount
                    },
                    postingFlags
                }),
                JSON.stringify(glSnapshot)
            ]
        );

        await createAction(executor, {
            requestId: insertResult.insertId,
            action: REVERSAL_ACTIONS.REQUEST_REVERSAL,
            fromStatus: null,
            toStatus: REVERSAL_STATUSES.REQUESTED,
            actionBy: actor.id,
            comments: normalizeText(comments) || normalizeText(reason),
            metadata: {
                actorGroup: ROLE_GROUPS.FINANCE,
                actorName: actor.name,
                workflowBatchId: batch.id,
                glPostingBatchId: postingBatch.id
            }
        });

        await logAudit(executor, {
            companyId: batch.CompanyID,
            userName: actor.name,
            action: 'PAYROLL_REVERSAL_REQUEST',
            requestId: insertResult.insertId,
            oldValue: 'NONE',
            newValue: REVERSAL_STATUSES.REQUESTED
        });

        if (managedConnection) {
            await executor.commit();
        }

        return getReversalRequestDetail({ companyId: batch.CompanyID, requestId: insertResult.insertId, connection: executor });
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function getReversalRequestDetail({ companyId, requestId, connection = null }) {
    const executor = connection || pool;
    await ensureReversalTables(executor);
    const request = await getReversalRequestById(companyId, requestId, executor);
    if (!request) {
        throw createError('Reversal request not found.', 404);
    }

    const workflowDetail = await payrollWorkflowService.getWorkflowBatchDetail(normalizeCompanyId(companyId), request.WorkflowBatchID, executor);
    const postingDetail = request.GLPostingBatchID
        ? await payrollGlQueryService.getPostingBatchDetail({ companyId: normalizeCompanyId(companyId), batchId: request.GLPostingBatchID })
        : null;

    const [actions] = await executor.query(
        `SELECT *
         FROM payroll_reversal_actions
         WHERE ReversalRequestID = ?
         ORDER BY ActionAt ASC, id ASC`,
        [request.id]
    );

    const [reversalBatchRows] = await executor.query(
        `SELECT *
         FROM payroll_gl_reversal_batches
         WHERE ReversalRequestID = ?
         LIMIT 1`,
        [request.id]
    );
    const reversalBatch = reversalBatchRows[0] || null;
    let reversalLines = [];
    if (reversalBatch) {
        const [lineRows] = await executor.query(
            `SELECT *
             FROM payroll_gl_reversal_lines
             WHERE ReversalBatchID = ?
             ORDER BY GLAccountCode ASC, id ASC`,
            [reversalBatch.id]
        );
        reversalLines = lineRows;
    }

    const originalPayrollSnapshot = request.OriginalPayrollSnapshot ? JSON.parse(request.OriginalPayrollSnapshot) : null;
    const originalGlSnapshot = request.OriginalGLSnapshot ? JSON.parse(request.OriginalGLSnapshot) : null;

    const canSubmit = [REVERSAL_STATUSES.REQUESTED, REVERSAL_STATUSES.RETURNED_BY_MANAGER, REVERSAL_STATUSES.RETURNED_BY_AUDITOR].includes(request.Status);
    const canCancel = [REVERSAL_STATUSES.REQUESTED, REVERSAL_STATUSES.RETURNED_BY_MANAGER, REVERSAL_STATUSES.RETURNED_BY_AUDITOR].includes(request.Status);
    const canExecute = request.Status === REVERSAL_STATUSES.READY_TO_EXECUTE;

    return {
        request: {
            ...request,
            badgeClass: getReversalStatusBadgeClass(request.Status)
        },
        workflowDetail,
        postingDetail,
        actions,
        reversalBatch,
        reversalLines,
        originalPayrollSnapshot,
        originalGlSnapshot,
        canSubmit,
        canCancel,
        canExecute
    };
}

async function listReversalRequests({ companyId, role, filters = {}, connection = null }) {
    const executor = connection || pool;
    await ensureReversalTables(executor);
    const roleName = String(role || '').trim();
    const roleDefaults = {
        'finance-officer': [REVERSAL_STATUSES.REQUESTED, REVERSAL_STATUSES.RETURNED_BY_MANAGER, REVERSAL_STATUSES.RETURNED_BY_AUDITOR, REVERSAL_STATUSES.READY_TO_EXECUTE],
        manager: [REVERSAL_STATUSES.SUBMITTED_TO_MANAGER],
        auditor: [REVERSAL_STATUSES.SUBMITTED_TO_AUDITOR],
        'entity-head': [REVERSAL_STATUSES.SUBMITTED_TO_ENTITY_HEAD]
    };
    const statuses = [];
    const params = [normalizeCompanyId(companyId)];
    const where = ['r.CompanyID = ?'];

    if (filters.status) {
        where.push('r.Status = ?');
        params.push(filters.status);
    } else if (roleDefaults[roleName]) {
        where.push(`r.Status IN (${roleDefaults[roleName].map(() => '?').join(', ')})`);
        params.push(...roleDefaults[roleName]);
    }

    if (filters.month) {
        where.push('r.PMonth = ?');
        params.push(Number(filters.month));
    }
    if (filters.year) {
        where.push('r.PYear = ?');
        params.push(Number(filters.year));
    }
    if (filters.pType) {
        where.push('r.PType = ?');
        params.push(String(filters.pType).trim());
    }

    const [rows] = await executor.query(
        `SELECT
            r.*,
            w.TotalStaff,
            w.TotalGross,
            w.TotalDeductions,
            w.TotalNet,
            p.status AS gl_posting_status,
            p.posted_by,
            p.posted_at
         FROM payroll_reversal_requests r
         INNER JOIN payroll_workflow_batches w
           ON w.id = r.WorkflowBatchID
         LEFT JOIN payroll_gl_posting_batches p
           ON p.id = r.GLPostingBatchID
         WHERE ${where.join(' AND ')}
         ORDER BY r.UpdatedAt DESC, r.id DESC`,
        params
    );

    return rows.map((row) => ({
        ...row,
        badgeClass: getReversalStatusBadgeClass(row.Status)
    }));
}

async function transitionRequest({ request, action, nextStatus, actor, comments, metadata, connection }) {
    validateTransition(request.Status, nextStatus);
    await updateRequest(connection, request.id, { Status: nextStatus });
    const actionId = await createAction(connection, {
        requestId: request.id,
        action,
        fromStatus: request.Status,
        toStatus: nextStatus,
        actionBy: actor.id,
        comments,
        metadata: {
            actorGroup: getActorGroup(actor.role),
            actorName: actor.name,
            ...(metadata || {})
        }
    });
    const updated = await getReversalRequestById(request.CompanyID, request.id, connection);
    await logAudit(connection, {
        companyId: request.CompanyID,
        userName: actor.name,
        action,
        requestId: request.id,
        oldValue: request.Status,
        newValue: nextStatus
    });
    await workflowNotificationService.notifyPayrollReversalAction({
        companyId: request.CompanyID,
        request: updated,
        action,
        actionId,
        actor,
        comments,
        connection
    });
    return updated;
}

async function submitRequestToManager({ companyId, requestId, user, comments = '', connection = null }) {
    const actor = await assertRole(user, 'finance-officer', 'Only the Finance Officer can submit a reversal request.');
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        await ensureReversalTables(executor);
        const request = await getReversalRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Reversal request not found.', 404);
        }
        if (![REVERSAL_STATUSES.REQUESTED, REVERSAL_STATUSES.RETURNED_BY_MANAGER, REVERSAL_STATUSES.RETURNED_BY_AUDITOR].includes(request.Status)) {
            throw createError('This reversal request cannot be submitted in its current status.', 409);
        }
        if (Number(request.RequestedBy || 0) !== actor.id) {
            throw createError('Only the requesting Finance Officer can submit this reversal request.', 403);
        }

        const updated = await transitionRequest({
            request,
            action: REVERSAL_ACTIONS.SUBMIT_TO_MANAGER,
            nextStatus: REVERSAL_STATUSES.SUBMITTED_TO_MANAGER,
            actor,
            comments: normalizeText(comments) || request.Reason,
            metadata: { requestedBy: request.RequestedBy },
            connection: executor
        });

        if (managedConnection) {
            await executor.commit();
        }
        return updated;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function cancelRequest({ companyId, requestId, user, comments = '', connection = null }) {
    const actor = await assertRole(user, 'finance-officer', 'Only the Finance Officer can cancel a reversal request.');
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        const request = await getReversalRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Reversal request not found.', 404);
        }
        if (![REVERSAL_STATUSES.REQUESTED, REVERSAL_STATUSES.RETURNED_BY_MANAGER, REVERSAL_STATUSES.RETURNED_BY_AUDITOR].includes(request.Status)) {
            throw createError('Only reversal requests that are still with Finance can be cancelled.', 409);
        }
        if (Number(request.RequestedBy || 0) !== actor.id) {
            throw createError('Only the requesting Finance Officer can cancel this reversal request.', 403);
        }
        const updated = await transitionRequest({
            request,
            action: REVERSAL_ACTIONS.CANCEL_REQUEST,
            nextStatus: REVERSAL_STATUSES.CANCELLED,
            actor,
            comments: normalizeText(comments) || 'Cancelled by Finance.',
            metadata: {},
            connection: executor
        });
        if (managedConnection) {
            await executor.commit();
        }
        return updated;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function managerEndorseRequest({ companyId, requestId, user, comments = '', connection = null }) {
    const actor = await assertRole(user, 'manager', 'Only a Manager can endorse this reversal request.');
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        const request = await getReversalRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Reversal request not found.', 404);
        }
        if (request.Status !== REVERSAL_STATUSES.SUBMITTED_TO_MANAGER) {
            throw createError('This reversal request is not awaiting Manager endorsement.', 409);
        }
        await assertNoIncompatiblePriorAction(request.id, actor, [ROLE_GROUPS.FINANCE], executor);
        const managerUpdated = await transitionRequest({
            request,
            action: REVERSAL_ACTIONS.MANAGER_ENDORSE,
            nextStatus: REVERSAL_STATUSES.MANAGER_ENDORSED,
            actor,
            comments: normalizeText(comments) || 'Endorsed by Manager.',
            metadata: {},
            connection: executor
        });
        await updateRequest(executor, managerUpdated.id, {
            ManagerEndorsedBy: actor.id,
            ManagerEndorsedAt: new Date(),
            ManagerComments: normalizeText(comments) || null
        });
        const managerRefreshed = await getReversalRequestById(companyId, requestId, executor);
        const submitted = await transitionRequest({
            request: managerRefreshed,
            action: REVERSAL_ACTIONS.SUBMIT_TO_AUDITOR,
            nextStatus: REVERSAL_STATUSES.SUBMITTED_TO_AUDITOR,
            actor,
            comments: 'Forwarded to Auditor after Manager endorsement.',
            metadata: {},
            connection: executor
        });
        if (managedConnection) {
            await executor.commit();
        }
        return submitted;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function managerReturnRequest({ companyId, requestId, user, comments, connection = null }) {
    const actor = await assertRole(user, 'manager', 'Only a Manager can return this reversal request.');
    if (!normalizeText(comments)) {
        throw createError('Please provide a reason for returning the reversal request.', 400);
    }
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        const request = await getReversalRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Reversal request not found.', 404);
        }
        if (request.Status !== REVERSAL_STATUSES.SUBMITTED_TO_MANAGER) {
            throw createError('This reversal request is not awaiting Manager endorsement.', 409);
        }
        await updateRequest(executor, request.id, {
            ManagerComments: normalizeText(comments)
        });
        const updated = await transitionRequest({
            request,
            action: REVERSAL_ACTIONS.MANAGER_RETURN,
            nextStatus: REVERSAL_STATUSES.RETURNED_BY_MANAGER,
            actor,
            comments: normalizeText(comments),
            metadata: {},
            connection: executor
        });
        if (managedConnection) {
            await executor.commit();
        }
        return updated;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function auditorEndorseRequest({ companyId, requestId, user, comments = '', connection = null }) {
    const actor = await assertRole(user, 'auditor', 'Only an Auditor can review this reversal request.');
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        const request = await getReversalRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Reversal request not found.', 404);
        }
        if (request.Status !== REVERSAL_STATUSES.SUBMITTED_TO_AUDITOR) {
            throw createError('This reversal request is not awaiting Auditor review.', 409);
        }
        await assertNoIncompatiblePriorAction(request.id, actor, [ROLE_GROUPS.FINANCE, ROLE_GROUPS.MANAGER], executor);
        const endorsed = await transitionRequest({
            request,
            action: REVERSAL_ACTIONS.AUDITOR_ENDORSE,
            nextStatus: REVERSAL_STATUSES.AUDITOR_ENDORSED,
            actor,
            comments: normalizeText(comments) || 'Endorsed by Auditor.',
            metadata: {},
            connection: executor
        });
        await updateRequest(executor, endorsed.id, {
            AuditorEndorsedBy: actor.id,
            AuditorEndorsedAt: new Date(),
            AuditorComments: normalizeText(comments) || null
        });
        const refreshed = await getReversalRequestById(companyId, requestId, executor);
        const submitted = await transitionRequest({
            request: refreshed,
            action: REVERSAL_ACTIONS.SUBMIT_TO_ENTITY_HEAD,
            nextStatus: REVERSAL_STATUSES.SUBMITTED_TO_ENTITY_HEAD,
            actor,
            comments: 'Forwarded to Entity Head/HNO after audit review.',
            metadata: {},
            connection: executor
        });
        if (managedConnection) {
            await executor.commit();
        }
        return submitted;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function auditorReturnRequest({ companyId, requestId, user, comments, connection = null }) {
    const actor = await assertRole(user, 'auditor', 'Only an Auditor can return this reversal request.');
    if (!normalizeText(comments)) {
        throw createError('Please provide the audit findings or reason for returning the reversal request.', 400);
    }
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        const request = await getReversalRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Reversal request not found.', 404);
        }
        if (request.Status !== REVERSAL_STATUSES.SUBMITTED_TO_AUDITOR) {
            throw createError('This reversal request is not awaiting Auditor review.', 409);
        }
        await updateRequest(executor, request.id, {
            AuditorComments: normalizeText(comments)
        });
        const updated = await transitionRequest({
            request,
            action: REVERSAL_ACTIONS.AUDITOR_RETURN,
            nextStatus: REVERSAL_STATUSES.RETURNED_BY_AUDITOR,
            actor,
            comments: normalizeText(comments),
            metadata: {},
            connection: executor
        });
        if (managedConnection) {
            await executor.commit();
        }
        return updated;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function entityHeadApproveRequest({ companyId, requestId, user, comments = '', connection = null }) {
    const actor = await assertRole(user, 'entity-head', 'Only the Entity Head/HNO can approve this reversal request.');
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        const request = await getReversalRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Reversal request not found.', 404);
        }
        if (request.Status !== REVERSAL_STATUSES.SUBMITTED_TO_ENTITY_HEAD) {
            throw createError('This reversal request is not awaiting final approval.', 409);
        }
        await assertNoIncompatiblePriorAction(request.id, actor, [ROLE_GROUPS.FINANCE, ROLE_GROUPS.MANAGER, ROLE_GROUPS.AUDITOR], executor);
        const approved = await transitionRequest({
            request,
            action: REVERSAL_ACTIONS.FINAL_APPROVE,
            nextStatus: REVERSAL_STATUSES.FINAL_APPROVED,
            actor,
            comments: normalizeText(comments) || 'Approved by Entity Head/HNO.',
            metadata: {},
            connection: executor
        });
        await updateRequest(executor, approved.id, {
            FinalApprovedBy: actor.id,
            FinalApprovedAt: new Date(),
            EntityHeadComments: normalizeText(comments) || null
        });
        const refreshed = await getReversalRequestById(companyId, requestId, executor);
        const ready = await transitionRequest({
            request: refreshed,
            action: REVERSAL_ACTIONS.READY_TO_EXECUTE,
            nextStatus: REVERSAL_STATUSES.READY_TO_EXECUTE,
            actor,
            comments: 'Reversal approved and ready for Finance execution.',
            metadata: {},
            connection: executor
        });
        if (managedConnection) {
            await executor.commit();
        }
        return ready;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function entityHeadReturnRequest({ companyId, requestId, user, comments, connection = null }) {
    const actor = await assertRole(user, 'entity-head', 'Only the Entity Head/HNO can return this reversal request.');
    if (!normalizeText(comments)) {
        throw createError('Please provide a reason for returning the reversal request.', 400);
    }
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        const request = await getReversalRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Reversal request not found.', 404);
        }
        if (request.Status !== REVERSAL_STATUSES.SUBMITTED_TO_ENTITY_HEAD) {
            throw createError('This reversal request is not awaiting final approval.', 409);
        }
        await updateRequest(executor, request.id, {
            EntityHeadComments: normalizeText(comments)
        });
        const updated = await transitionRequest({
            request,
            action: REVERSAL_ACTIONS.FINAL_RETURN,
            nextStatus: REVERSAL_STATUSES.FINAL_REJECTED,
            actor,
            comments: normalizeText(comments),
            metadata: { decisionType: 'return' },
            connection: executor
        });
        if (managedConnection) {
            await executor.commit();
        }
        return updated;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function entityHeadRejectRequest({ companyId, requestId, user, comments, connection = null }) {
    const actor = await assertRole(user, 'entity-head', 'Only the Entity Head/HNO can reject this reversal request.');
    if (!normalizeText(comments)) {
        throw createError('Please provide a reason for rejecting the reversal request.', 400);
    }
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        const request = await getReversalRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Reversal request not found.', 404);
        }
        if (request.Status !== REVERSAL_STATUSES.SUBMITTED_TO_ENTITY_HEAD) {
            throw createError('This reversal request is not awaiting final approval.', 409);
        }
        await updateRequest(executor, request.id, {
            EntityHeadComments: normalizeText(comments)
        });
        const updated = await transitionRequest({
            request,
            action: REVERSAL_ACTIONS.FINAL_REJECT,
            nextStatus: REVERSAL_STATUSES.FINAL_REJECTED,
            actor,
            comments: normalizeText(comments),
            metadata: { decisionType: 'reject' },
            connection: executor
        });
        if (managedConnection) {
            await executor.commit();
        }
        return updated;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function verifyExecutionIntegrity(request, connection) {
    const workflowBatch = await payrollWorkflowService.getWorkflowBatchById(request.CompanyID, request.WorkflowBatchID, connection);
    if (!workflowBatch) {
        throw createError('The original payroll workflow batch no longer exists.', 409);
    }
    if (workflowBatch.Status !== payrollWorkflowService.WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS) {
        throw createError('Only posted payroll can be reversed.', 409);
    }

    const currentSnapshot = await payrollWorkflowService.calculatePayrollSnapshot(workflowBatch.CompanyID, workflowBatch.PMonth, workflowBatch.PYear, workflowBatch.PType, connection);
    if (String(currentSnapshot.payrollChecksum || '') !== String(request.OriginalPayrollChecksum || '')) {
        throw createError('Posted payroll or GL records have changed since the reversal request was approved. The reversal cannot proceed.', 409);
    }

    const postingBatch = await resolvePostingBatchForWorkflowBatch(workflowBatch, connection);
    if (!postingBatch || Number(postingBatch.id || 0) !== Number(request.GLPostingBatchID || 0)) {
        throw createError('The original GL posting batch could not be identified.', 409);
    }
    if (String(postingBatch.status || '').toLowerCase() === 'reversed') {
        throw createError('This payroll batch has already been reversed.', 409);
    }

    const postingFlags = await getPostedPayrollFlags(workflowBatch, connection);
    if (Number(postingFlags.posted_rows || 0) !== Number(workflowBatch.PayrollRowCount || 0)) {
        throw createError('Posted payroll or GL records have changed since the reversal request was approved. The reversal cannot proceed.', 409);
    }
    if (Number(postingFlags.gl_posted_batch_id || 0) !== Number(request.GLPostingBatchID || 0)) {
        throw createError('Posted payroll or GL records have changed since the reversal request was approved. The reversal cannot proceed.', 409);
    }

    const currentGlSnapshot = await getOriginalGlSnapshot(request.CompanyID, request.GLPostingBatchID, connection);
    const storedGlSnapshot = request.OriginalGLSnapshot ? JSON.parse(request.OriginalGLSnapshot) : null;
    if (!storedGlSnapshot || String(storedGlSnapshot.checksum || '') !== String(currentGlSnapshot.checksum || '')) {
        throw createError('Posted payroll or GL records have changed since the reversal request was approved. The reversal cannot proceed.', 409);
    }

    const activeRequest = await findActiveRequestForBatch(request.WorkflowBatchID, request.id, connection);
    if (activeRequest) {
        throw createError('A reversal request already exists for this payroll batch.', 409);
    }

    return {
        workflowBatch,
        currentSnapshot,
        postingBatch,
        currentGlSnapshot,
        postingFlags
    };
}

async function executeApprovedReversal({ companyId, requestId, user, testHooks = null, connection = null }) {
    const actor = await assertRole(user, 'finance-officer', 'You are not authorized to execute this payroll reversal.');
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }

        await ensureReversalTables(executor);
        const request = await getReversalRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Reversal request not found.', 404);
        }
        if (request.Status !== REVERSAL_STATUSES.READY_TO_EXECUTE) {
            throw createError('This reversal request has not received final approval.', 409);
        }
        if (Number(request.RequestedBy || 0) !== actor.id) {
            const activeFinanceUsers = await workflowNotificationService.resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, executor);
            const isFinanceInScope = activeFinanceUsers.some((entry) => Number(entry.id || 0) === actor.id);
            if (!isFinanceInScope) {
                throw createError('Only the Finance Officer assigned to this company can execute the reversal.', 403);
            }
        }

        const integrity = await verifyExecutionIntegrity(request, executor);
        const inProgress = await transitionRequest({
            request,
            action: REVERSAL_ACTIONS.EXECUTE_REVERSAL,
            nextStatus: REVERSAL_STATUSES.REVERSAL_IN_PROGRESS,
            actor,
            comments: 'Reversal execution started.',
            metadata: {
                workflowBatchId: integrity.workflowBatch.id,
                glPostingBatchId: integrity.postingBatch.id
            },
            connection: executor
        });

        if (testHooks?.afterMarkedInProgress) {
            await testHooks.afterMarkedInProgress({ request: inProgress, connection: executor });
        }

        const reversalLines = integrity.currentGlSnapshot.lines.map((line) => ({
            originalLineId: line.id || null,
            companyId: request.CompanyID,
            activityCode: request.PType,
            employeeId: line.employee_id || null,
            glAccountCode: line.gl_account_code,
            glAccountName: line.gl_account_name,
            debitAmount: roundMoney(line.entry_type === 'credit' ? line.amount : 0),
            creditAmount: roundMoney(line.entry_type === 'debit' ? line.amount : 0),
            narration: `Reversal of GL batch #${request.GLPostingBatchID}: ${line.narration || ''}`.trim(),
            sourceTable: line.source_table || 'payroll_gl_posting_lines',
            sourceRecordId: line.source_record_id || String(line.id || '')
        }));

        const reversalDebitTotal = roundMoney(reversalLines.reduce((sum, line) => sum + Number(line.debitAmount || 0), 0));
        const reversalCreditTotal = roundMoney(reversalLines.reduce((sum, line) => sum + Number(line.creditAmount || 0), 0));
        if (reversalDebitTotal !== reversalCreditTotal) {
            throw createError('The reversal debit and credit totals do not balance.', 409);
        }

        const reversalReference = `REV-${request.WorkflowBatchID}-${request.id}`;
        const [batchResult] = await executor.query(
            `INSERT INTO payroll_gl_reversal_batches
            (ReversalRequestID, OriginalGLPostingBatchID, CompanyID, ActivityCode, PostingMonth, PostingYear, Status, TotalLines, TotalDebit, TotalCredit, ExecutedBy, ExecutedAt, Remarks, CreatedAt, UpdatedAt)
            VALUES (?, ?, ?, ?, ?, ?, 'reversed', ?, ?, ?, ?, NOW(), ?, NOW(), NOW())`,
            [
                request.id,
                request.GLPostingBatchID,
                request.CompanyID,
                request.PType,
                request.PMonth,
                request.PYear,
                reversalLines.length,
                reversalDebitTotal,
                reversalCreditTotal,
                actor.name,
                `Reversal ${reversalReference} for payroll batch ${request.PMonth}/${request.PYear}/${request.PType}`
            ]
        );
        const reversalBatchId = batchResult.insertId;

        if (reversalLines.length) {
            await executor.query(
                `INSERT INTO payroll_gl_reversal_lines
                (ReversalBatchID, OriginalLineID, CompanyID, ActivityCode, EmployeeID, GLAccountCode, GLAccountName, DebitAmount, CreditAmount, Narration, SourceTable, SourceRecordID, CreatedAt)
                VALUES ?`,
                [reversalLines.map((line) => [
                    reversalBatchId,
                    line.originalLineId,
                    line.companyId,
                    line.activityCode,
                    line.employeeId,
                    line.glAccountCode,
                    line.glAccountName,
                    line.debitAmount,
                    line.creditAmount,
                    line.narration,
                    line.sourceTable,
                    line.sourceRecordId,
                    new Date()
                ])]
            );
        }

        if (testHooks?.afterReversalLinesInserted) {
            await testHooks.afterReversalLinesInserted({ reversalBatchId, reversalLines, connection: executor });
        }

        await executor.query(
            `UPDATE payroll_gl_posting_batches
             SET status = 'reversed',
                 remarks = CONCAT(COALESCE(remarks, ''), CASE WHEN COALESCE(remarks, '') = '' THEN '' ELSE ' | ' END, ?),
                 updated_at = NOW()
             WHERE id = ?`,
            [`Reversed by ${reversalReference}`, request.GLPostingBatchID]
        );

        await payrollWorkflowService.transitionWorkflow({
            companyId: request.CompanyID,
            pMonth: request.PMonth,
            pYear: request.PYear,
            pType: request.PType,
            action: PAYROLL_WORKFLOW_REVERSE_ACTION,
            user: actor,
            comments: `Payroll posting reversed under ${reversalReference}.`,
            metadata: {
                stage: 'payroll-reversal',
                reversalRequestId: request.id,
                originalPostingBatchId: request.GLPostingBatchID,
                reversalBatchId
            },
            connection: executor
        });

        await updateRequest(executor, request.id, {
            Status: REVERSAL_STATUSES.REVERSED,
            ExecutedBy: actor.id,
            ExecutedAt: new Date(),
            ReversalBatchReference: reversalReference
        });

        await createAction(executor, {
            requestId: request.id,
            action: 'COMPLETE_REVERSAL',
            fromStatus: REVERSAL_STATUSES.REVERSAL_IN_PROGRESS,
            toStatus: REVERSAL_STATUSES.REVERSED,
            actionBy: actor.id,
            comments: 'Payroll reversal completed successfully.',
            metadata: {
                actorGroup: ROLE_GROUPS.FINANCE,
                actorName: actor.name,
                reversalBatchId,
                reversalReference,
                totalDebit: reversalDebitTotal,
                totalCredit: reversalCreditTotal
            }
        });

        await logAudit(executor, {
            companyId: request.CompanyID,
            userName: actor.name,
            action: 'PAYROLL_REVERSAL_EXECUTE',
            requestId: request.id,
            oldValue: REVERSAL_STATUSES.READY_TO_EXECUTE,
            newValue: REVERSAL_STATUSES.REVERSED
        });

        const completedRequest = await getReversalRequestById(companyId, request.id, executor);
        await workflowNotificationService.notifyPayrollReversalAction({
            companyId: request.CompanyID,
            request: completedRequest,
            action: REVERSAL_ACTIONS.EXECUTE_REVERSAL,
            actionId: completedRequest.id,
            actor,
            comments: '',
            connection: executor
        });

        if (managedConnection) {
            await executor.commit();
        }

        return {
            requestId: request.id,
            reversalBatchId,
            reversalReference,
            workflowBatchId: request.WorkflowBatchID,
            workflowStatus: PAYROLL_WORKFLOW_REVERSED_STATUS,
            totalDebit: reversalDebitTotal,
            totalCredit: reversalCreditTotal
        };
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function getRoleDashboardSummary(companyId) {
    await ensureReversalTables();
    const [rows] = await pool.query(
        `SELECT Status, COUNT(*) AS total
         FROM payroll_reversal_requests
         WHERE CompanyID = ?
         GROUP BY Status`,
        [normalizeCompanyId(companyId)]
    );
    return rows.reduce((acc, row) => {
        acc[row.Status] = Number(row.total || 0);
        return acc;
    }, {});
}

module.exports = {
    ACTIVE_REQUEST_STATUSES,
    PAYROLL_WORKFLOW_REVERSED_STATUS,
    PAYROLL_WORKFLOW_REVERSE_ACTION,
    REVERSAL_ACTIONS,
    REVERSAL_STATUSES,
    cancelRequest,
    createReversalRequest,
    ensureReversalTables,
    getReversalEligibilityDetail,
    entityHeadApproveRequest,
    entityHeadRejectRequest,
    entityHeadReturnRequest,
    executeApprovedReversal,
    getReversalRequestDetail,
    getReversalStatusBadgeClass,
    getRoleDashboardSummary,
    listReversalRequests,
    managerEndorseRequest,
    managerReturnRequest,
    submitRequestToManager,
    auditorEndorseRequest,
    auditorReturnRequest,
    verifyExecutionIntegrity
};
