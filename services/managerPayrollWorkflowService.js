const pool = require('../config/db');
const payrollWorkflowService = require('./payrollWorkflowService');

function createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function normalizeCompanyId(companyId) {
    return Number(companyId) || 1;
}

function normalizeUser(user = {}) {
    return {
        id: Number(user.id ?? user.pfno ?? 0) || 0,
        role: String(user.role || '').trim(),
        name: user.name || user.fullName || user.username || user.email || 'Manager',
        source: user.source || 'tblpassword'
    };
}

function getStatusBadgeClass(status) {
    const badgeMap = {
        CORRECTION_IN_PROGRESS: 'bg-warning text-dark',
        SUBMITTED_TO_MANAGER: 'bg-info-subtle text-info-emphasis border border-info-subtle',
        MANAGER_ENDORSED: 'bg-primary-subtle text-primary-emphasis border border-primary-subtle',
        RETURNED_BY_MANAGER: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        SUBMITTED_TO_AUDITOR: 'bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle',
        RETURNED_BY_AUDITOR: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        SUBMITTED_TO_ENTITY_HEAD: 'bg-dark-subtle text-dark-emphasis border border-dark-subtle',
        FINAL_APPROVED: 'bg-success-subtle text-success-emphasis border border-success-subtle',
        FINAL_REJECTED: 'bg-danger-subtle text-danger-emphasis border border-danger-subtle',
        POSTED_TO_ACCOUNTS: 'bg-success text-white'
    };

    return badgeMap[status] || 'bg-light text-dark border';
}

async function getManagerQueue(companyId, filters = {}, connection = null) {
    const effectiveFilters = {
        status: filters.status || payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER,
        month: filters.month || '',
        year: filters.year || '',
        pType: filters.pType || ''
    };

    const batches = await payrollWorkflowService.listWorkflowBatches(normalizeCompanyId(companyId), effectiveFilters, connection);
    return {
        filters: effectiveFilters,
        batches
    };
}

async function getManagerBatchDetail(companyId, batchId, connection = null) {
    const detail = await payrollWorkflowService.getWorkflowBatchDetail(normalizeCompanyId(companyId), batchId, connection);
    const canAct = detail.batch.Status === payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER;

    return {
        ...detail,
        canAct
    };
}

async function assertManagerCanAct({ companyId, batchId, user, connection }) {
    const actor = normalizeUser(user);
    if (actor.role !== 'manager') {
        throw createError('You do not have access to this payroll batch.', 403);
    }

    const batch = await payrollWorkflowService.getWorkflowBatchById(companyId, batchId, connection);
    if (!batch) {
        throw createError('You do not have access to this payroll batch.', 404);
    }

    if (batch.Status !== payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER) {
        throw createError('This payroll batch is not awaiting Manager endorsement.', 409);
    }

    await payrollWorkflowService.assertUserCanManagerEndorse(actor, batch, connection);

    const history = await payrollWorkflowService.getWorkflowHistory(batch.id, connection);
    const financeActions = history.filter((entry) => ['PROCESS_PAYROLL', 'SUBMIT_TO_MANAGER'].includes(entry.Action));
    if (financeActions.some((entry) => Number(entry.ActionBy || 0) === actor.id)) {
        throw createError('You cannot endorse a payroll batch that you processed or submitted.', 409);
    }

    const snapshot = await payrollWorkflowService.calculatePayrollSnapshot(batch.CompanyID, batch.PMonth, batch.PYear, batch.PType, connection);
    const integrity = payrollWorkflowService.verifyPayrollSnapshotUnchanged(batch, snapshot);
    if (!integrity.matches) {
        throw createError('Payroll figures have changed since submission. The batch must be returned to Finance and resubmitted.', 409);
    }

    return { actor, batch, snapshot };
}

async function endorseBatch({ companyId, batchId, user, comments = null, testHooks = null, connection = null }) {
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    const savepointName = 'manager_endorse_savepoint';
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        } else {
            await executor.query(`SAVEPOINT ${savepointName}`);
        }

        const { actor, batch } = await assertManagerCanAct({
            companyId: normalizeCompanyId(companyId),
            batchId,
            user,
            connection: executor
        });

        await payrollWorkflowService.transitionWorkflow({
            companyId: batch.CompanyID,
            pMonth: batch.PMonth,
            pYear: batch.PYear,
            pType: batch.PType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.MANAGER_ENDORSE,
            user: actor,
            comments: comments || null,
            metadata: {
                stage: 'manager-review'
            },
            connection: executor
        });

        if (testHooks?.afterManagerEndorse) {
            await testHooks.afterManagerEndorse({ batch, connection: executor });
        }

        const forwarded = await payrollWorkflowService.transitionWorkflow({
            companyId: batch.CompanyID,
            pMonth: batch.PMonth,
            pYear: batch.PYear,
            pType: batch.PType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.SUBMIT_TO_AUDITOR,
            user: actor,
            comments: 'Forwarded to Auditor after Manager endorsement.',
            metadata: {
                stage: 'manager-forward'
            },
            connection: executor
        });

        if (testHooks?.afterSubmitToAuditor) {
            await testHooks.afterSubmitToAuditor({ batch: forwarded.batch, connection: executor });
        }

        if (managedConnection) {
            await executor.commit();
        }
        return forwarded.batch;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        } else {
            await executor.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function returnBatchToFinance({ companyId, batchId, user, comments, connection = null }) {
    if (!String(comments || '').trim()) {
        throw createError('Please provide a reason for returning the payroll to Finance.', 400);
    }

    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    const savepointName = 'manager_return_savepoint';
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        } else {
            await executor.query(`SAVEPOINT ${savepointName}`);
        }

        const { actor, batch } = await assertManagerCanAct({
            companyId: normalizeCompanyId(companyId),
            batchId,
            user,
            connection: executor
        });

        const result = await payrollWorkflowService.transitionWorkflow({
            companyId: batch.CompanyID,
            pMonth: batch.PMonth,
            pYear: batch.PYear,
            pType: batch.PType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.MANAGER_RETURN,
            user: actor,
            comments: String(comments).trim(),
            metadata: {
                stage: 'manager-return'
            },
            connection: executor
        });

        if (managedConnection) {
            await executor.commit();
        }
        return result.batch;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        } else {
            await executor.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function getManagerDashboardWidgets(companyId) {
    const resolvedCompanyId = normalizeCompanyId(companyId);
    const statusSets = {
        awaiting: payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER,
        endorsed: payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR,
        returned: payrollWorkflowService.WORKFLOW_STATUSES.RETURNED_BY_MANAGER
    };

    const [awaitingRows] = await pool.query(
        `SELECT COUNT(*) AS count FROM payroll_workflow_batches WHERE CompanyID = ? AND Status = ?`,
        [resolvedCompanyId, statusSets.awaiting]
    );
    const [endorsedRows] = await pool.query(
        `SELECT COUNT(*) AS count FROM payroll_workflow_batches WHERE CompanyID = ? AND Status = ?`,
        [resolvedCompanyId, statusSets.endorsed]
    );
    const [returnedRows] = await pool.query(
        `SELECT COUNT(*) AS count FROM payroll_workflow_batches WHERE CompanyID = ? AND Status = ?`,
        [resolvedCompanyId, statusSets.returned]
    );
    const [returnedByAuditorRows] = await pool.query(
        `SELECT COUNT(*) AS count FROM payroll_workflow_batches WHERE CompanyID = ? AND Status = ?`,
        [resolvedCompanyId, payrollWorkflowService.WORKFLOW_STATUSES.RETURNED_BY_AUDITOR]
    );
    const [auditorEndorsedRows] = await pool.query(
        `SELECT COUNT(*) AS count FROM payroll_workflow_batches WHERE CompanyID = ? AND Status = ?`,
        [resolvedCompanyId, payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD]
    );
    const [finalApprovedRows] = await pool.query(
        `SELECT COUNT(*) AS count FROM payroll_workflow_batches WHERE CompanyID = ? AND Status = ?`,
        [resolvedCompanyId, payrollWorkflowService.WORKFLOW_STATUSES.FINAL_APPROVED]
    );
    const [finalRejectedRows] = await pool.query(
        `SELECT COUNT(*) AS count FROM payroll_workflow_batches WHERE CompanyID = ? AND Status = ?`,
        [resolvedCompanyId, payrollWorkflowService.WORKFLOW_STATUSES.FINAL_REJECTED]
    );
    const [recentActions] = await pool.query(
        `
            SELECT
                a.id,
                a.WorkflowBatchID,
                a.Action,
                a.FromStatus,
                a.ToStatus,
                a.ActionAt,
                a.Comments,
                a.Metadata,
                b.PMonth,
                b.PYear,
                b.PType
            FROM payroll_workflow_actions a
            INNER JOIN payroll_workflow_batches b
                ON b.id = a.WorkflowBatchID
            WHERE a.CompanyID = ?
              AND a.Action IN ('SUBMIT_TO_MANAGER', 'MANAGER_ENDORSE', 'MANAGER_RETURN', 'SUBMIT_TO_AUDITOR', 'FINAL_APPROVE', 'FINAL_RETURN', 'FINAL_REJECT')
            ORDER BY a.ActionAt DESC, a.id DESC
            LIMIT 8
        `,
        [resolvedCompanyId]
    );

    const parsedActions = recentActions.map((row) => {
        let metadata = {};
        try {
            metadata = row.Metadata ? JSON.parse(row.Metadata) : {};
        } catch (error) {
            metadata = {};
        }

        return {
            ...row,
            actorName: metadata.actorName || '',
            actorRole: metadata.actorRole || ''
        };
    });

    return {
        cards: {
            awaitingEndorsement: Number(awaitingRows[0]?.count || 0),
            endorsedToAuditor: Number(endorsedRows[0]?.count || 0),
            returnedToFinance: Number(returnedRows[0]?.count || 0),
            returnedByAuditor: Number(returnedByAuditorRows[0]?.count || 0),
            auditorEndorsed: Number(auditorEndorsedRows[0]?.count || 0),
            finalApproved: Number(finalApprovedRows[0]?.count || 0),
            finalRejected: Number(finalRejectedRows[0]?.count || 0)
        },
        recentActions: parsedActions
    };
}

module.exports = {
    endorseBatch,
    getManagerBatchDetail,
    getManagerDashboardWidgets,
    getManagerQueue,
    getStatusBadgeClass,
    returnBatchToFinance
};
