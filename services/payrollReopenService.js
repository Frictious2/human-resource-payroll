const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const payrollWorkflowService = require('./payrollWorkflowService');
const payrollReversalService = require('./payrollReversalService');
const workflowNotificationService = require('./workflowNotificationService');
const auditTrailService = require('./auditTrailService');

const REOPEN_STATUSES = Object.freeze({
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
    READY_TO_REOPEN: 'READY_TO_REOPEN',
    REOPENED: 'REOPENED',
    CANCELLED: 'CANCELLED'
});

const REOPEN_ACTIONS = Object.freeze({
    REQUEST_REOPEN: 'REQUEST_REOPEN',
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
    MARK_READY_TO_REOPEN: 'MARK_READY_TO_REOPEN',
    REOPEN_GENERATION: 'REOPEN_GENERATION',
    CANCEL_REQUEST: 'CANCEL_REQUEST',
    PROCESS_PAYROLL_REOPEN: 'PROCESS_PAYROLL_REOPEN'
});

const ACTIVE_REOPEN_STATUSES = Object.freeze([
    REOPEN_STATUSES.REQUESTED,
    REOPEN_STATUSES.SUBMITTED_TO_MANAGER,
    REOPEN_STATUSES.MANAGER_ENDORSED,
    REOPEN_STATUSES.RETURNED_BY_MANAGER,
    REOPEN_STATUSES.SUBMITTED_TO_AUDITOR,
    REOPEN_STATUSES.AUDITOR_ENDORSED,
    REOPEN_STATUSES.RETURNED_BY_AUDITOR,
    REOPEN_STATUSES.SUBMITTED_TO_ENTITY_HEAD,
    REOPEN_STATUSES.FINAL_APPROVED,
    REOPEN_STATUSES.READY_TO_REOPEN
]);

const TRANSITIONS = Object.freeze({
    [REOPEN_STATUSES.REQUESTED]: [REOPEN_STATUSES.SUBMITTED_TO_MANAGER, REOPEN_STATUSES.CANCELLED],
    [REOPEN_STATUSES.SUBMITTED_TO_MANAGER]: [REOPEN_STATUSES.MANAGER_ENDORSED, REOPEN_STATUSES.RETURNED_BY_MANAGER],
    [REOPEN_STATUSES.RETURNED_BY_MANAGER]: [REOPEN_STATUSES.SUBMITTED_TO_MANAGER, REOPEN_STATUSES.CANCELLED],
    [REOPEN_STATUSES.MANAGER_ENDORSED]: [REOPEN_STATUSES.SUBMITTED_TO_AUDITOR],
    [REOPEN_STATUSES.SUBMITTED_TO_AUDITOR]: [REOPEN_STATUSES.AUDITOR_ENDORSED, REOPEN_STATUSES.RETURNED_BY_AUDITOR],
    [REOPEN_STATUSES.RETURNED_BY_AUDITOR]: [REOPEN_STATUSES.SUBMITTED_TO_MANAGER, REOPEN_STATUSES.CANCELLED],
    [REOPEN_STATUSES.AUDITOR_ENDORSED]: [REOPEN_STATUSES.SUBMITTED_TO_ENTITY_HEAD],
    [REOPEN_STATUSES.SUBMITTED_TO_ENTITY_HEAD]: [REOPEN_STATUSES.FINAL_APPROVED, REOPEN_STATUSES.FINAL_REJECTED],
    [REOPEN_STATUSES.FINAL_APPROVED]: [REOPEN_STATUSES.READY_TO_REOPEN],
    [REOPEN_STATUSES.READY_TO_REOPEN]: [REOPEN_STATUSES.REOPENED],
    [REOPEN_STATUSES.REOPENED]: [],
    [REOPEN_STATUSES.FINAL_REJECTED]: [],
    [REOPEN_STATUSES.CANCELLED]: []
});

function normalizeCompanyId(companyId) {
    return Number(companyId) || 1;
}

function normalizeRoleValue(value = '') {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
}

function normalizeUser(user = {}) {
    return {
        id: Number(user.id ?? user.PFNo ?? user.pfno ?? 0) || 0,
        role: normalizeRoleValue(user.role || user.level || user.Level),
        name: String(user.name || user.fullName || user.FullName || user.username || user.Username || 'System').trim() || 'System'
    };
}

function createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function getRoleActionUrl(role, requestId) {
    switch (String(role || '').trim().toLowerCase()) {
        case 'finance-officer':
            return `/finance/payroll/reopen/${requestId}`;
        case 'manager':
            return `/manager/payroll/reopen/${requestId}`;
        case 'auditor':
            return `/auditor/payroll/reopen/${requestId}`;
        case 'entity-head':
            return `/entity-head/payroll/reopen/${requestId}`;
        default:
            return `/finance/payroll/reopen/${requestId}`;
    }
}

function getReopenStatusBadgeClass(status) {
    const map = {
        REQUESTED: 'bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle',
        SUBMITTED_TO_MANAGER: 'bg-info-subtle text-info-emphasis border border-info-subtle',
        MANAGER_ENDORSED: 'bg-info-subtle text-info-emphasis border border-info-subtle',
        RETURNED_BY_MANAGER: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        SUBMITTED_TO_AUDITOR: 'bg-primary-subtle text-primary-emphasis border border-primary-subtle',
        AUDITOR_ENDORSED: 'bg-primary-subtle text-primary-emphasis border border-primary-subtle',
        RETURNED_BY_AUDITOR: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        SUBMITTED_TO_ENTITY_HEAD: 'bg-dark-subtle text-dark-emphasis border border-dark-subtle',
        FINAL_APPROVED: 'bg-success-subtle text-success-emphasis border border-success-subtle',
        FINAL_REJECTED: 'bg-danger-subtle text-danger-emphasis border border-danger-subtle',
        READY_TO_REOPEN: 'bg-success text-white',
        REOPENED: 'bg-primary text-white',
        CANCELLED: 'bg-light text-dark border'
    };
    return map[status] || 'bg-light text-dark border';
}

function unwrapWorkflowBatch(detail) {
    if (!detail) {
        return null;
    }
    return detail.batch || detail;
}

let reopenTablesReadyPromise = null;

function splitMigrationStatements(sql) {
    return String(sql || '')
        .split(/;\s*\n/g)
        .map((statement) => statement.trim())
        .filter(Boolean)
        .map((statement) => statement.replace(/^DELIMITER\s+\$\$/i, '').replace(/\$\$$/g, '').trim())
        .filter((statement) => statement && !/^DELIMITER\s+/i.test(statement));
}

async function ensureReopenTables() {
    if (!reopenTablesReadyPromise) {
        reopenTablesReadyPromise = (async () => {
            const migrationFiles = [
                path.join(__dirname, '..', 'database', 'migrations', '20260715-payroll-reopen-workflow.sql'),
                path.join(__dirname, '..', 'database', 'migrations', '20260716-fix-payroll-generation-uniqueness.sql')
            ];

            for (const migrationPath of migrationFiles) {
                if (!fs.existsSync(migrationPath)) {
                    continue;
                }

                const sql = fs.readFileSync(migrationPath, 'utf8').trim();
                if (!sql) {
                    continue;
                }

                const sanitizedSql = sql.replace(/DROP TRIGGER IF EXISTS[\s\S]*?END\$\$\s*DELIMITER\s*;/i, '').trim();
                const statements = splitMigrationStatements(sanitizedSql);
                for (const statement of statements) {
                    await pool.query(statement);
                }
            }

            await pool.query('DROP TRIGGER IF EXISTS trg_payroll_gl_posting_batches_before_insert_generation');
            await pool.query(`
        CREATE TRIGGER trg_payroll_gl_posting_batches_before_insert_generation
        BEFORE INSERT ON payroll_gl_posting_batches
        FOR EACH ROW
        BEGIN
            IF NEW.generation_no IS NULL OR NEW.generation_no = 0 THEN
                SELECT GenerationNo, id
                  INTO @wf_generation_no, @wf_batch_id
                  FROM payroll_workflow_batches
                 WHERE CompanyID = NEW.company_id
                   AND PMonth = NEW.posting_month
                   AND PYear = NEW.posting_year
                   AND PType = NEW.activity_code
                 ORDER BY GenerationNo DESC, id DESC
                 LIMIT 1;

                SET NEW.generation_no = COALESCE(@wf_generation_no, 1);
                SET NEW.workflow_batch_id = COALESCE(NEW.workflow_batch_id, @wf_batch_id);
            END IF;
        END
    `);
        })().catch((error) => {
            reopenTablesReadyPromise = null;
            throw error;
        });
    }

    await reopenTablesReadyPromise;
}

async function assertRole(user, expectedRole, message) {
    const actor = normalizeUser(user);
    if (actor.role !== expectedRole) {
        throw createError(message, 403);
    }
    return actor;
}

function validateTransition(fromStatus, toStatus) {
    const allowed = TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
        throw createError(`Invalid payroll reopen transition: ${fromStatus} -> ${toStatus}`, 409);
    }
}

async function getLatestGenerationNo(companyId, pMonth, pYear, pType, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `
            SELECT COALESCE(MAX(GenerationNo), 1) AS latestGenerationNo
            FROM payroll_workflow_batches
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND PType = ?
        `,
        [normalizeCompanyId(companyId), Number(pMonth), Number(pYear), String(pType || '').trim()]
    );
    return Number(rows[0]?.latestGenerationNo || 1);
}

async function getLatestWorkflowGeneration(companyId, pMonth, pYear, pType, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `
            SELECT *
            FROM payroll_workflow_batches
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND PType = ?
            ORDER BY GenerationNo DESC, id DESC
            LIMIT 1
        `,
        [normalizeCompanyId(companyId), Number(pMonth), Number(pYear), String(pType || '').trim()]
    );
    return rows[0] || null;
}

async function getReopenRequestById(companyId, requestId, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `
            SELECT *
            FROM payroll_reopen_requests
            WHERE CompanyID = ?
              AND id = ?
            LIMIT 1
        `,
        [normalizeCompanyId(companyId), Number(requestId) || 0]
    );
    return rows[0] || null;
}

async function getActiveReopenRequestByBatch(workflowBatchId, connection = null) {
    const executor = connection || pool;
    const placeholders = ACTIVE_REOPEN_STATUSES.map(() => '?').join(', ');
    const [rows] = await executor.query(
        `
            SELECT *
            FROM payroll_reopen_requests
            WHERE OriginalWorkflowBatchID = ?
              AND Status IN (${placeholders})
            ORDER BY id DESC
            LIMIT 1
        `,
        [Number(workflowBatchId) || 0, ...ACTIVE_REOPEN_STATUSES]
    );
    return rows[0] || null;
}

async function hasLaterGeneration(originalBatch, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `
            SELECT id
            FROM payroll_workflow_batches
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND PType = ?
              AND GenerationNo > ?
            LIMIT 1
        `,
        [
            normalizeCompanyId(originalBatch.CompanyID),
            Number(originalBatch.PMonth),
            Number(originalBatch.PYear),
            String(originalBatch.PType || '').trim(),
            Number(originalBatch.GenerationNo || 1)
        ]
    );
    return rows.length > 0;
}

async function getSuccessfulReversalForBatch(workflowBatchId, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `
            SELECT *
            FROM payroll_reversal_requests
            WHERE WorkflowBatchID = ?
              AND Status = 'REVERSED'
            ORDER BY id DESC
            LIMIT 1
        `,
        [Number(workflowBatchId) || 0]
    );
    return rows[0] || null;
}

async function getReopenEligibilityDetail(companyId, workflowBatchId, connection = null) {
    const executor = connection || pool;
    await ensureReopenTables();

    const originalBatchDetail = await payrollWorkflowService.getWorkflowBatchDetail(
        normalizeCompanyId(companyId),
        Number(workflowBatchId) || 0,
        executor
    );
    const originalBatch = unwrapWorkflowBatch(originalBatchDetail);
    if (!originalBatch) {
        throw createError('No workflow batch was found for the selected payroll period.', 404);
    }

    const reversalRequest = await getSuccessfulReversalForBatch(originalBatch.id, executor);
    const activeReopenRequest = await getActiveReopenRequestByBatch(originalBatch.id, executor);
    const laterGenerationExists = await hasLaterGeneration(originalBatch, executor);
    const [reversalLineRows] = reversalRequest
        ? await executor.query(
            `SELECT COUNT(*) AS total FROM payroll_gl_reversal_lines WHERE ReversalBatchID IN (
                SELECT id FROM payroll_gl_reversal_batches WHERE ReversalRequestID = ?
            )`,
            [reversalRequest.id]
        )
        : [[{ total: 0 }]];

    const reasons = [];
    if (originalBatch.Status !== payrollWorkflowService.WORKFLOW_STATUSES.REVERSED) {
        reasons.push('Only a successfully reversed payroll batch can be reopened.');
    }
    if (!reversalRequest) {
        reasons.push('A successful payroll reversal must exist before the batch can be reopened.');
    }
    if (activeReopenRequest) {
        reasons.push('A payroll reopen request is already active for this reversed batch.');
    }
    if (laterGenerationExists) {
        reasons.push('A later payroll generation already exists for this period and activity.');
    }
    if (reversalRequest && Number(reversalLineRows[0]?.total || 0) === 0) {
        reasons.push('The reversal request does not have reversal GL lines and cannot be reopened safely.');
    }

    return {
        canRequest: reasons.length === 0,
        reasons,
        originalBatch,
        originalBatchDetail,
        reversalRequest,
        activeReopenRequest,
        laterGenerationExists,
        proposedGenerationNo: Number(originalBatch.GenerationNo || 1) + 1
    };
}

async function createAction(connection, payload) {
    const [result] = await connection.query(
        `
            INSERT INTO payroll_reopen_actions
                (ReopenRequestID, Action, FromStatus, ToStatus, ActionBy, ActionAt, Comments, Metadata, Result)
            VALUES
                (?, ?, ?, ?, ?, NOW(), ?, ?, ?)
        `,
        [
            Number(payload.requestId) || 0,
            payload.action,
            payload.fromStatus || null,
            payload.toStatus,
            String(payload.actionBy || ''),
            payload.comments || null,
            payload.metadata ? JSON.stringify(payload.metadata) : null,
            payload.result || 'SUCCESS'
        ]
    );
    return Number(result.insertId || 0);
}

async function logAudit(connection, { companyId, userName, action, requestId, oldValue, newValue }) {
    await auditTrailService.writeAuditEntryWithExecutor(connection, {
        action: String(action || ''),
        userName: String(userName || 'System'),
        formName: 'payroll/reopen',
        recordId: String(requestId || '').slice(0, 6) || null,
        fieldName: 'Status',
        oldValue: oldValue == null ? null : String(oldValue),
        newValue: newValue == null ? null : String(newValue),
        loggedout: 0,
        companyId: normalizeCompanyId(companyId)
    });
}

async function notifyReopenAction({ companyId, request, action, actionId, actor, comments = '', connection }) {
    const recipients = [];
    const actorName = actor?.name || 'System';
    const referenceType = 'payroll_reopen_request';
    const referenceId = String(request.id);
    const payrollReference = `${String(request.PMonth).padStart(2, '0')}/${request.PYear}/${String(request.PType || '').trim()} · Gen ${request.ProposedGenerationNo}`;
    let title = '';
    let message = '';
    let actionUrl = '';

    if (action === REOPEN_ACTIONS.SUBMIT_TO_MANAGER) {
        recipients.push(...await workflowNotificationService.getUsersByRole(companyId, 'manager', connection));
        title = 'Payroll reopen awaiting Manager endorsement';
        message = `${actorName} submitted payroll reopen ${payrollReference} for Manager review.`;
        actionUrl = getRoleActionUrl('manager', request.id);
    } else if (action === REOPEN_ACTIONS.MANAGER_RETURN) {
        recipients.push(...await workflowNotificationService.resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
        title = 'Payroll reopen returned by Manager';
        message = `Payroll reopen ${payrollReference} was returned by the Manager${comments ? `: ${comments}` : '.'}`;
        actionUrl = getRoleActionUrl('finance-officer', request.id);
    } else if (action === REOPEN_ACTIONS.SUBMIT_TO_AUDITOR) {
        recipients.push(...await workflowNotificationService.getUsersByRole(companyId, 'auditor', connection));
        title = 'Payroll reopen awaiting Auditor review';
        message = `${actorName} forwarded payroll reopen ${payrollReference} to the Auditor.`;
        actionUrl = getRoleActionUrl('auditor', request.id);
    } else if (action === REOPEN_ACTIONS.AUDITOR_RETURN) {
        recipients.push(...await workflowNotificationService.resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
        title = 'Payroll reopen returned after audit review';
        message = `Payroll reopen ${payrollReference} was returned after audit review${comments ? `: ${comments}` : '.'}`;
        actionUrl = getRoleActionUrl('finance-officer', request.id);
    } else if (action === REOPEN_ACTIONS.SUBMIT_TO_ENTITY_HEAD) {
        recipients.push(...await workflowNotificationService.getUsersByRole(companyId, 'entity-head', connection));
        title = 'Payroll reopen awaiting final approval';
        message = `${actorName} forwarded payroll reopen ${payrollReference} for final approval.`;
        actionUrl = getRoleActionUrl('entity-head', request.id);
    } else if (action === REOPEN_ACTIONS.MARK_READY_TO_REOPEN) {
        recipients.push(...await workflowNotificationService.resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
        title = 'Payroll reopen approved and ready to reprocess';
        message = `Payroll reopen ${payrollReference} received final approval and is ready for reprocessing.`;
        actionUrl = getRoleActionUrl('finance-officer', request.id);
    } else if (action === REOPEN_ACTIONS.FINAL_RETURN || action === REOPEN_ACTIONS.FINAL_REJECT) {
        recipients.push(...await workflowNotificationService.resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
        recipients.push(...await workflowNotificationService.getUsersByRole(companyId, 'manager', connection));
        recipients.push(...await workflowNotificationService.getUsersByRole(companyId, 'auditor', connection));
        title = action === REOPEN_ACTIONS.FINAL_REJECT ? 'Payroll reopen rejected' : 'Payroll reopen returned';
        message = `Payroll reopen ${payrollReference} ${action === REOPEN_ACTIONS.FINAL_REJECT ? 'was rejected' : 'was returned'}${comments ? `: ${comments}` : '.'}`;
        actionUrl = getRoleActionUrl('finance-officer', request.id);
    } else if (action === REOPEN_ACTIONS.REOPEN_GENERATION || action === REOPEN_ACTIONS.PROCESS_PAYROLL_REOPEN) {
        recipients.push(...await workflowNotificationService.resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
        title = action === REOPEN_ACTIONS.REOPEN_GENERATION ? 'Payroll reopen generation created' : 'Reopened payroll processed';
        message = action === REOPEN_ACTIONS.REOPEN_GENERATION
            ? `Payroll reopen ${payrollReference} created a new payroll generation for reprocessing.`
            : `The reopened payroll generation for ${payrollReference} was processed and is ready for the approval chain.`;
        actionUrl = request.NewWorkflowBatchID ? `/finance/payroll/workflow/${request.NewWorkflowBatchID}` : getRoleActionUrl('finance-officer', request.id);
    } else {
        return [];
    }

    if (!recipients.length) {
        return [];
    }

    return workflowNotificationService.createNotifications(connection, {
        companyId,
        recipients,
        notificationType: action,
        module: 'payroll-reopen',
        title,
        message,
        referenceType,
        referenceId,
        actionUrl,
        createdBy: actor?.id || null,
        metadata: { requestId: request.id, actionId, originalWorkflowBatchId: request.OriginalWorkflowBatchID, proposedGenerationNo: request.ProposedGenerationNo },
        eventKeyBase: workflowNotificationService.buildEventKey('payroll-reopen', actionId, action, request.id, request.ProposedGenerationNo)
    });
}

async function updateRequest(connection, requestId, fields) {
    const entries = Object.entries(fields || {}).filter(([, value]) => value !== undefined);
    if (!entries.length) {
        return;
    }

    const fragments = entries.map(([key]) => `${key} = ?`);
    const values = entries.map(([, value]) => value);
    values.push(Number(requestId) || 0);
    await connection.query(
        `UPDATE payroll_reopen_requests SET ${fragments.join(', ')}, UpdatedAt = NOW() WHERE id = ?`,
        values
    );
}

async function transitionRequest({ request, action, nextStatus, actor, comments = '', metadata = null, connection }) {
    validateTransition(request.Status, nextStatus);
    await updateRequest(connection, request.id, { Status: nextStatus });
    const actionId = await createAction(connection, {
        requestId: request.id,
        action,
        fromStatus: request.Status,
        toStatus: nextStatus,
        actionBy: actor.name,
        comments,
        metadata
    });
    const updated = await getReopenRequestById(request.CompanyID, request.id, connection);
    await logAudit(connection, {
        companyId: request.CompanyID,
        userName: actor.name,
        action,
        requestId: request.id,
        oldValue: request.Status,
        newValue: nextStatus
    });
    await notifyReopenAction({
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

async function createReopenRequest({ companyId, workflowBatchId, reason, comments = '', user, connection = null }) {
    const actor = await assertRole(user, 'finance-officer', 'Only the Finance Officer can request payroll reopen.');
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;

    try {
        await ensureReopenTables();
        if (managedConnection) {
            await executor.beginTransaction();
        }
        const eligibility = await getReopenEligibilityDetail(companyId, workflowBatchId, executor);
        if (!eligibility.canRequest) {
            throw createError(eligibility.reasons[0] || 'This payroll batch is not eligible for reopening.', 409);
        }
        if (!String(reason || '').trim()) {
            throw createError('Please provide a reason for reopening this payroll batch.', 422);
        }

        const now = new Date();
        const [result] = await executor.query(
            `
                INSERT INTO payroll_reopen_requests
                    (
                        OriginalWorkflowBatchID, ReversalRequestID, CompanyID, PMonth, PYear, PType,
                        OriginalGenerationNo, ProposedGenerationNo, Status, Reason, RequestedBy, RequestedAt,
                        OriginalPayrollChecksum, OriginalReversalReference, CreatedAt, UpdatedAt
                    )
                VALUES
                    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW(), NOW())
            `,
            [
                eligibility.originalBatch.id,
                eligibility.reversalRequest.id,
                normalizeCompanyId(companyId),
                Number(eligibility.originalBatch.PMonth),
                Number(eligibility.originalBatch.PYear),
                String(eligibility.originalBatch.PType || '').trim(),
                Number(eligibility.originalBatch.GenerationNo || 1),
                Number(eligibility.proposedGenerationNo),
                REOPEN_STATUSES.REQUESTED,
                String(reason || '').trim(),
                String(actor.id),
                String(eligibility.originalBatch.PayrollChecksum || ''),
                String(eligibility.reversalRequest.ReversalBatchReference || '')
            ]
        );

        const requestId = Number(result.insertId || 0);
        await createAction(executor, {
            requestId,
            action: REOPEN_ACTIONS.REQUEST_REOPEN,
            fromStatus: null,
            toStatus: REOPEN_STATUSES.REQUESTED,
            actionBy: actor.name,
            comments: comments || reason,
            metadata: {
                originalWorkflowBatchId: eligibility.originalBatch.id,
                reversalRequestId: eligibility.reversalRequest.id,
                originalGenerationNo: eligibility.originalBatch.GenerationNo || 1,
                proposedGenerationNo: eligibility.proposedGenerationNo,
                requestedAt: now.toISOString()
            }
        });

        await logAudit(executor, {
            companyId,
            userName: actor.name,
            action: REOPEN_ACTIONS.REQUEST_REOPEN,
            requestId,
            oldValue: null,
            newValue: REOPEN_STATUSES.REQUESTED
        });

        if (managedConnection) {
            await executor.commit();
        }

        return {
            request: await getReopenRequestById(companyId, requestId, managedConnection ? null : executor),
            eligibility
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

async function listReopenRequests(companyId, role, filters = {}, connection = null) {
    const executor = connection || pool;
    await ensureReopenTables();

    const conditions = ['CompanyID = ?'];
    const params = [normalizeCompanyId(companyId)];
    if (filters.status) {
        conditions.push('Status = ?');
        params.push(String(filters.status).trim());
    }
    if (filters.month) {
        conditions.push('PMonth = ?');
        params.push(Number(filters.month));
    }
    if (filters.year) {
        conditions.push('PYear = ?');
        params.push(Number(filters.year));
    }
    if (filters.pType) {
        conditions.push('PType = ?');
        params.push(String(filters.pType).trim());
    }

    const normalizedRole = String(role || '').trim().toLowerCase();
    if (normalizedRole === 'finance-officer') {
        conditions.push(`Status IN ('${REOPEN_STATUSES.REQUESTED}', '${REOPEN_STATUSES.RETURNED_BY_MANAGER}', '${REOPEN_STATUSES.RETURNED_BY_AUDITOR}', '${REOPEN_STATUSES.READY_TO_REOPEN}', '${REOPEN_STATUSES.REOPENED}', '${REOPEN_STATUSES.FINAL_REJECTED}', '${REOPEN_STATUSES.CANCELLED}')`);
    } else if (normalizedRole === 'manager') {
        conditions.push(`Status IN ('${REOPEN_STATUSES.SUBMITTED_TO_MANAGER}', '${REOPEN_STATUSES.MANAGER_ENDORSED}', '${REOPEN_STATUSES.RETURNED_BY_MANAGER}', '${REOPEN_STATUSES.SUBMITTED_TO_AUDITOR}', '${REOPEN_STATUSES.SUBMITTED_TO_ENTITY_HEAD}', '${REOPEN_STATUSES.FINAL_APPROVED}', '${REOPEN_STATUSES.REOPENED}')`);
    } else if (normalizedRole === 'auditor') {
        conditions.push(`Status IN ('${REOPEN_STATUSES.SUBMITTED_TO_AUDITOR}', '${REOPEN_STATUSES.AUDITOR_ENDORSED}', '${REOPEN_STATUSES.RETURNED_BY_AUDITOR}', '${REOPEN_STATUSES.SUBMITTED_TO_ENTITY_HEAD}', '${REOPEN_STATUSES.FINAL_APPROVED}', '${REOPEN_STATUSES.REOPENED}')`);
    } else if (normalizedRole === 'entity-head') {
        conditions.push(`Status IN ('${REOPEN_STATUSES.SUBMITTED_TO_ENTITY_HEAD}', '${REOPEN_STATUSES.FINAL_APPROVED}', '${REOPEN_STATUSES.FINAL_REJECTED}', '${REOPEN_STATUSES.READY_TO_REOPEN}', '${REOPEN_STATUSES.REOPENED}')`);
    }

    const [rows] = await executor.query(
        `
            SELECT *
            FROM payroll_reopen_requests
            WHERE ${conditions.join(' AND ')}
            ORDER BY UpdatedAt DESC, id DESC
        `,
        params
    );
    return rows;
}

async function getReopenRequestDetail({ companyId, requestId, connection = null }) {
    const executor = connection || pool;
    await ensureReopenTables();
    const request = await getReopenRequestById(companyId, requestId, executor);
    if (!request) {
        throw createError('Payroll reopen request was not found.', 404);
    }

    const [actions] = await executor.query(
        `
            SELECT *
            FROM payroll_reopen_actions
            WHERE ReopenRequestID = ?
            ORDER BY ActionAt ASC, id ASC
        `,
        [request.id]
    );

    const [newBatchRows] = request.NewWorkflowBatchID
        ? await executor.query(`SELECT * FROM payroll_workflow_batches WHERE id = ? LIMIT 1`, [request.NewWorkflowBatchID])
        : [[]];

    return {
        request,
        actions,
        originalBatch: unwrapWorkflowBatch(await payrollWorkflowService.getWorkflowBatchDetail(normalizeCompanyId(companyId), request.OriginalWorkflowBatchID, executor)),
        reversalDetail: await payrollReversalService.getReversalRequestDetail({ companyId: normalizeCompanyId(companyId), requestId: request.ReversalRequestID, connection: executor }),
        newWorkflowBatch: newBatchRows[0] || null
    };
}

async function loadRequestForRole(companyId, requestId, expectedRole, user, connection, message) {
    const actor = await assertRole(user, expectedRole, message);
    const request = await getReopenRequestById(companyId, requestId, connection);
    if (!request) {
        throw createError('Payroll reopen request was not found.', 404);
    }
    return { actor, request };
}

async function submitReopenToManager({ companyId, requestId, user, comments = '', connection = null }) {
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        await ensureReopenTables();
        if (managedConnection) await executor.beginTransaction();
        const { actor, request } = await loadRequestForRole(companyId, requestId, 'finance-officer', user, executor, 'Only the Finance Officer can submit a payroll reopen request.');
        if (![REOPEN_STATUSES.REQUESTED, REOPEN_STATUSES.RETURNED_BY_MANAGER, REOPEN_STATUSES.RETURNED_BY_AUDITOR].includes(request.Status)) {
            throw createError('This payroll reopen request is not ready for Manager submission.', 409);
        }
        const updated = await transitionRequest({
            request,
            action: REOPEN_ACTIONS.SUBMIT_TO_MANAGER,
            nextStatus: REOPEN_STATUSES.SUBMITTED_TO_MANAGER,
            actor,
            comments,
            connection: executor
        });
        if (managedConnection) await executor.commit();
        return updated;
    } catch (error) {
        if (managedConnection) await executor.rollback();
        throw error;
    } finally {
        if (managedConnection) executor.release();
    }
}

async function cancelReopenRequest({ companyId, requestId, user, comments = '', connection = null }) {
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        await ensureReopenTables();
        if (managedConnection) await executor.beginTransaction();
        const { actor, request } = await loadRequestForRole(companyId, requestId, 'finance-officer', user, executor, 'Only the Finance Officer can cancel a payroll reopen request.');
        if (![REOPEN_STATUSES.REQUESTED, REOPEN_STATUSES.RETURNED_BY_MANAGER, REOPEN_STATUSES.RETURNED_BY_AUDITOR].includes(request.Status)) {
            throw createError('This payroll reopen request can no longer be cancelled.', 409);
        }
        const updated = await transitionRequest({
            request,
            action: REOPEN_ACTIONS.CANCEL_REQUEST,
            nextStatus: REOPEN_STATUSES.CANCELLED,
            actor,
            comments,
            connection: executor
        });
        if (managedConnection) await executor.commit();
        return updated;
    } catch (error) {
        if (managedConnection) await executor.rollback();
        throw error;
    } finally {
        if (managedConnection) executor.release();
    }
}

async function managerEndorseReopen({ companyId, requestId, user, comments = '', connection = null }) {
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        await ensureReopenTables();
        if (managedConnection) await executor.beginTransaction();
        const { actor, request } = await loadRequestForRole(companyId, requestId, 'manager', user, executor, 'Only the Manager can endorse a payroll reopen request.');
        if (request.Status !== REOPEN_STATUSES.SUBMITTED_TO_MANAGER) {
            throw createError('This payroll reopen request is not awaiting Manager endorsement.', 409);
        }
        await updateRequest(executor, request.id, {
            ManagerEndorsedBy: String(actor.id),
            ManagerEndorsedAt: new Date(),
            ManagerComments: comments || null
        });
        const endorsed = await transitionRequest({
            request: await getReopenRequestById(companyId, request.id, executor),
            action: REOPEN_ACTIONS.MANAGER_ENDORSE,
            nextStatus: REOPEN_STATUSES.MANAGER_ENDORSED,
            actor,
            comments,
            connection: executor
        });
        const forwarded = await transitionRequest({
            request: endorsed,
            action: REOPEN_ACTIONS.SUBMIT_TO_AUDITOR,
            nextStatus: REOPEN_STATUSES.SUBMITTED_TO_AUDITOR,
            actor,
            comments,
            connection: executor
        });
        if (managedConnection) await executor.commit();
        return forwarded;
    } catch (error) {
        if (managedConnection) await executor.rollback();
        throw error;
    } finally {
        if (managedConnection) executor.release();
    }
}

async function managerReturnReopen({ companyId, requestId, user, comments, connection = null }) {
    if (!String(comments || '').trim()) {
        throw createError('Please provide a reason for returning the payroll reopen request.', 422);
    }
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        await ensureReopenTables();
        if (managedConnection) await executor.beginTransaction();
        const { actor, request } = await loadRequestForRole(companyId, requestId, 'manager', user, executor, 'Only the Manager can return a payroll reopen request.');
        if (request.Status !== REOPEN_STATUSES.SUBMITTED_TO_MANAGER) {
            throw createError('This payroll reopen request is not awaiting Manager endorsement.', 409);
        }
        await updateRequest(executor, request.id, {
            ManagerComments: String(comments).trim()
        });
        const updated = await transitionRequest({
            request,
            action: REOPEN_ACTIONS.MANAGER_RETURN,
            nextStatus: REOPEN_STATUSES.RETURNED_BY_MANAGER,
            actor,
            comments,
            connection: executor
        });
        if (managedConnection) await executor.commit();
        return updated;
    } catch (error) {
        if (managedConnection) await executor.rollback();
        throw error;
    } finally {
        if (managedConnection) executor.release();
    }
}

async function auditorEndorseReopen({ companyId, requestId, user, comments = '', connection = null }) {
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        await ensureReopenTables();
        if (managedConnection) await executor.beginTransaction();
        const { actor, request } = await loadRequestForRole(companyId, requestId, 'auditor', user, executor, 'Only the Auditor can endorse a payroll reopen request.');
        if (request.Status !== REOPEN_STATUSES.SUBMITTED_TO_AUDITOR) {
            throw createError('This payroll reopen request is not awaiting Auditor review.', 409);
        }
        await updateRequest(executor, request.id, {
            AuditorEndorsedBy: String(actor.id),
            AuditorEndorsedAt: new Date(),
            AuditorComments: comments || null
        });
        const endorsed = await transitionRequest({
            request: await getReopenRequestById(companyId, request.id, executor),
            action: REOPEN_ACTIONS.AUDITOR_ENDORSE,
            nextStatus: REOPEN_STATUSES.AUDITOR_ENDORSED,
            actor,
            comments,
            connection: executor
        });
        const forwarded = await transitionRequest({
            request: endorsed,
            action: REOPEN_ACTIONS.SUBMIT_TO_ENTITY_HEAD,
            nextStatus: REOPEN_STATUSES.SUBMITTED_TO_ENTITY_HEAD,
            actor,
            comments,
            connection: executor
        });
        if (managedConnection) await executor.commit();
        return forwarded;
    } catch (error) {
        if (managedConnection) await executor.rollback();
        throw error;
    } finally {
        if (managedConnection) executor.release();
    }
}

async function auditorReturnReopen({ companyId, requestId, user, comments, connection = null }) {
    if (!String(comments || '').trim()) {
        throw createError('Please provide audit findings before returning the payroll reopen request.', 422);
    }
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        await ensureReopenTables();
        if (managedConnection) await executor.beginTransaction();
        const { actor, request } = await loadRequestForRole(companyId, requestId, 'auditor', user, executor, 'Only the Auditor can return a payroll reopen request.');
        if (request.Status !== REOPEN_STATUSES.SUBMITTED_TO_AUDITOR) {
            throw createError('This payroll reopen request is not awaiting Auditor review.', 409);
        }
        await updateRequest(executor, request.id, {
            AuditorComments: String(comments).trim()
        });
        const updated = await transitionRequest({
            request,
            action: REOPEN_ACTIONS.AUDITOR_RETURN,
            nextStatus: REOPEN_STATUSES.RETURNED_BY_AUDITOR,
            actor,
            comments,
            connection: executor
        });
        if (managedConnection) await executor.commit();
        return updated;
    } catch (error) {
        if (managedConnection) await executor.rollback();
        throw error;
    } finally {
        if (managedConnection) executor.release();
    }
}

async function entityHeadApproveReopen({ companyId, requestId, user, comments = '', connection = null }) {
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        await ensureReopenTables();
        if (managedConnection) await executor.beginTransaction();
        const { actor, request } = await loadRequestForRole(companyId, requestId, 'entity-head', user, executor, 'Only the Entity Head/HNO can approve a payroll reopen request.');
        if (request.Status !== REOPEN_STATUSES.SUBMITTED_TO_ENTITY_HEAD) {
            throw createError('This payroll reopen request is not awaiting final approval.', 409);
        }
        await updateRequest(executor, request.id, {
            FinalApprovedBy: String(actor.id),
            FinalApprovedAt: new Date(),
            EntityHeadComments: comments || null
        });
        const approved = await transitionRequest({
            request: await getReopenRequestById(companyId, request.id, executor),
            action: REOPEN_ACTIONS.FINAL_APPROVE,
            nextStatus: REOPEN_STATUSES.FINAL_APPROVED,
            actor,
            comments,
            connection: executor
        });
        const ready = await transitionRequest({
            request: approved,
            action: REOPEN_ACTIONS.MARK_READY_TO_REOPEN,
            nextStatus: REOPEN_STATUSES.READY_TO_REOPEN,
            actor,
            comments,
            connection: executor
        });
        if (managedConnection) await executor.commit();
        return ready;
    } catch (error) {
        if (managedConnection) await executor.rollback();
        throw error;
    } finally {
        if (managedConnection) executor.release();
    }
}

async function entityHeadReturnReopen({ companyId, requestId, user, comments, connection = null }) {
    if (!String(comments || '').trim()) {
        throw createError('Please provide a reason for returning the payroll reopen request.', 422);
    }
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        await ensureReopenTables();
        if (managedConnection) await executor.beginTransaction();
        const { actor, request } = await loadRequestForRole(companyId, requestId, 'entity-head', user, executor, 'Only the Entity Head/HNO can return a payroll reopen request.');
        if (request.Status !== REOPEN_STATUSES.SUBMITTED_TO_ENTITY_HEAD) {
            throw createError('This payroll reopen request is not awaiting final approval.', 409);
        }
        await updateRequest(executor, request.id, {
            EntityHeadComments: String(comments).trim()
        });
        const updated = await transitionRequest({
            request,
            action: REOPEN_ACTIONS.FINAL_RETURN,
            nextStatus: REOPEN_STATUSES.FINAL_REJECTED,
            actor,
            comments,
            connection: executor
        });
        if (managedConnection) await executor.commit();
        return updated;
    } catch (error) {
        if (managedConnection) await executor.rollback();
        throw error;
    } finally {
        if (managedConnection) executor.release();
    }
}

async function entityHeadRejectReopen({ companyId, requestId, user, comments, connection = null }) {
    if (!String(comments || '').trim()) {
        throw createError('Please provide a reason for rejecting the payroll reopen request.', 422);
    }
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        await ensureReopenTables();
        if (managedConnection) await executor.beginTransaction();
        const { actor, request } = await loadRequestForRole(companyId, requestId, 'entity-head', user, executor, 'Only the Entity Head/HNO can reject a payroll reopen request.');
        if (request.Status !== REOPEN_STATUSES.SUBMITTED_TO_ENTITY_HEAD) {
            throw createError('This payroll reopen request is not awaiting final approval.', 409);
        }
        await updateRequest(executor, request.id, {
            EntityHeadComments: String(comments).trim()
        });
        const updated = await transitionRequest({
            request,
            action: REOPEN_ACTIONS.FINAL_REJECT,
            nextStatus: REOPEN_STATUSES.FINAL_REJECTED,
            actor,
            comments,
            connection: executor
        });
        if (managedConnection) await executor.commit();
        return updated;
    } catch (error) {
        if (managedConnection) await executor.rollback();
        throw error;
    } finally {
        if (managedConnection) executor.release();
    }
}

async function archiveAndRemoveReversedPayrollRows({ request, actor, connection }) {
    const [rows] = await connection.query(
        `
            SELECT *
            FROM tblpayroll
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND PMonth = ?
              AND PYear = ?
              AND PType = ?
        `,
        [normalizeCompanyId(request.CompanyID), Number(request.PMonth), Number(request.PYear), String(request.PType || '').trim()]
    );

    for (const row of rows) {
        const payload = JSON.stringify(row);
        const checksum = crypto.createHash('sha256').update(payload).digest('hex');
        await connection.query(
            `
                INSERT INTO payroll_reversed_row_archive
                    (
                        OriginalWorkflowBatchID, OriginalGenerationNo, ReversalRequestID, ReopenRequestID,
                        CompanyID, PMonth, PYear, PType, PFNo, ArchivedAt, ArchivedBy, RowChecksum, PayrollRowData
                    )
                VALUES
                    (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
            `,
            [
                Number(request.OriginalWorkflowBatchID),
                Number(request.OriginalGenerationNo || 1),
                Number(request.ReversalRequestID || 0) || null,
                Number(request.id),
                normalizeCompanyId(request.CompanyID),
                Number(request.PMonth),
                Number(request.PYear),
                String(request.PType || '').trim(),
                row.PFNo || row.PFNO || null,
                String(actor.id),
                checksum,
                payload
            ]
        );
    }

    await connection.query(
        `
            DELETE FROM tblpayroll
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND PMonth = ?
              AND PYear = ?
              AND PType = ?
        `,
        [normalizeCompanyId(request.CompanyID), Number(request.PMonth), Number(request.PYear), String(request.PType || '').trim()]
    );

    return rows.length;
}

async function startReopenReprocessing({ companyId, requestId, user, connection = null }) {
    const actor = await assertRole(user, 'finance-officer', 'Only the Finance Officer can start payroll reprocessing.');
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        await ensureReopenTables();
        if (managedConnection) await executor.beginTransaction();
        const request = await getReopenRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Payroll reopen request was not found.', 404);
        }
        if (request.Status !== REOPEN_STATUSES.READY_TO_REOPEN) {
            throw createError('This payroll reopen request has not received final approval to reopen.', 409);
        }

        const originalBatch = unwrapWorkflowBatch(await payrollWorkflowService.getWorkflowBatchDetail(normalizeCompanyId(companyId), request.OriginalWorkflowBatchID, executor));
        if (!originalBatch || originalBatch.Status !== payrollWorkflowService.WORKFLOW_STATUSES.REVERSED) {
            throw createError('Only a reversed payroll batch can be reopened for reprocessing.', 409);
        }

        const existingLater = await getLatestWorkflowGeneration(companyId, request.PMonth, request.PYear, request.PType, executor);
        if (existingLater && Number(existingLater.GenerationNo || 1) >= Number(request.ProposedGenerationNo) && Number(existingLater.id) !== Number(request.OriginalWorkflowBatchID)) {
            throw createError('A newer payroll generation already exists for this period and activity.', 409);
        }

        const [insertResult] = await executor.query(
            `
                INSERT INTO payroll_workflow_batches
                    (
                        CompanyID, PMonth, PYear, PType, GenerationNo, OriginalWorkflowBatchID, ReopenRequestID,
                        Status, TotalStaff, TotalBasic, TotalAllowances, TotalGross, TotalTaxable, TotalTax,
                        TotalNassitEmployee, TotalNassitEmployer, TotalDeductions, TotalNet, PayrollRowCount,
                        CreatedAt, UpdatedAt
                    )
                VALUES
                    (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, NOW(), NOW())
            `,
            [
                normalizeCompanyId(companyId),
                Number(request.PMonth),
                Number(request.PYear),
                String(request.PType || '').trim(),
                Number(request.ProposedGenerationNo),
                Number(request.OriginalWorkflowBatchID),
                Number(request.id),
                payrollWorkflowService.WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS
            ]
        );

        const newWorkflowBatchId = Number(insertResult.insertId || 0);
        const archivedRows = await archiveAndRemoveReversedPayrollRows({ request, actor, connection: executor });

        await updateRequest(executor, request.id, {
            Status: REOPEN_STATUSES.REOPENED,
            ReopenedBy: String(actor.id),
            ReopenedAt: new Date(),
            NewWorkflowBatchID: newWorkflowBatchId
        });

        const actionId = await createAction(executor, {
            requestId: request.id,
            action: REOPEN_ACTIONS.REOPEN_GENERATION,
            fromStatus: request.Status,
            toStatus: REOPEN_STATUSES.REOPENED,
            actionBy: actor.name,
            comments: `Archived ${archivedRows} reversed payroll row(s) and created payroll generation ${request.ProposedGenerationNo}.`,
            metadata: { newWorkflowBatchId, archivedRows, generationNo: request.ProposedGenerationNo }
        });

        await executor.query(
            `
                INSERT INTO payroll_workflow_actions
                    (WorkflowBatchID, CompanyID, PMonth, PYear, PType, Action, FromStatus, ToStatus, ActionBy, ActionAt, Comments, Result, Metadata)
                VALUES
                    (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 'SUCCESS', ?)
            `,
            [
                newWorkflowBatchId,
                normalizeCompanyId(companyId),
                Number(request.PMonth),
                Number(request.PYear),
                String(request.PType || '').trim(),
                REOPEN_ACTIONS.REOPEN_GENERATION,
                payrollWorkflowService.WORKFLOW_STATUSES.REVERSED,
                payrollWorkflowService.WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS,
                actor.id,
                `Payroll generation ${request.ProposedGenerationNo} opened for reprocessing after approved reopen request.`,
                JSON.stringify({ reopenRequestId: request.id, originalWorkflowBatchId: request.OriginalWorkflowBatchID, actionId })
            ]
        );

        await logAudit(executor, {
            companyId,
            userName: actor.name,
            action: REOPEN_ACTIONS.REOPEN_GENERATION,
            requestId: request.id,
            oldValue: request.Status,
            newValue: REOPEN_STATUSES.REOPENED
        });

        const updated = await getReopenRequestById(companyId, request.id, executor);
        await notifyReopenAction({
            companyId,
            request: updated,
            action: REOPEN_ACTIONS.REOPEN_GENERATION,
            actionId,
            actor,
            comments: '',
            connection: executor
        });

        if (managedConnection) await executor.commit();
        return {
            request: updated,
            newWorkflowBatchId,
            archivedRows,
            processUrl: `/finance/payroll/process-emoluments?month=${request.PMonth}&year=${request.PYear}&ptype=${encodeURIComponent(request.PType)}&generation=${request.ProposedGenerationNo}&reopenRequestId=${request.id}`
        };
    } catch (error) {
        if (managedConnection) await executor.rollback();
        throw error;
    } finally {
        if (managedConnection) executor.release();
    }
}

async function getRoleDashboardSummary(companyId) {
    await ensureReopenTables();
    const [rows] = await pool.query(
        `
            SELECT Status, COUNT(*) AS total
            FROM payroll_reopen_requests
            WHERE CompanyID = ?
            GROUP BY Status
        `,
        [normalizeCompanyId(companyId)]
    );
    return rows.reduce((acc, row) => {
        acc[row.Status] = Number(row.total || 0);
        return acc;
    }, {});
}

module.exports = {
    ACTIVE_REOPEN_STATUSES,
    REOPEN_ACTIONS,
    REOPEN_STATUSES,
    cancelReopenRequest,
    createReopenRequest,
    ensureReopenTables,
    entityHeadApproveReopen,
    entityHeadRejectReopen,
    entityHeadReturnReopen,
    getLatestGenerationNo,
    getLatestWorkflowGeneration,
    getReopenEligibilityDetail,
    getReopenRequestDetail,
    getReopenStatusBadgeClass,
    getRoleDashboardSummary,
    listReopenRequests,
    managerEndorseReopen,
    managerReturnReopen,
    startReopenReprocessing,
    submitReopenToManager,
    auditorEndorseReopen,
    auditorReturnReopen
};
