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
        name: user.name || user.fullName || user.username || user.email || 'Entity Head',
        source: user.source || 'tblpassword'
    };
}

function getStatusBadgeClass(status) {
    const badgeMap = {
        CORRECTION_IN_PROGRESS: 'bg-warning text-dark',
        SUBMITTED_TO_ENTITY_HEAD: 'bg-info-subtle text-info-emphasis border border-info-subtle',
        FINAL_APPROVED: 'bg-success-subtle text-success-emphasis border border-success-subtle',
        FINAL_REJECTED: 'bg-danger-subtle text-danger-emphasis border border-danger-subtle',
        POSTED_TO_ACCOUNTS: 'bg-success text-white'
    };

    return badgeMap[status] || 'bg-light text-dark border';
}

function buildSummaryBreakdown(payrollRows = []) {
    return payrollRows.reduce((summary, row) => {
        summary.totalLoanDeductions += Number(row.LoanDeduction || 0);
        summary.totalMedicalDeductions += Number(row.MedicalDeduction || 0);
        summary.totalSurchargeDeductions += Number(row.SurchargeDeduction || 0);
        summary.totalOtherDeductions += Number(row.OtherDeductions || 0);
        return summary;
    }, {
        totalLoanDeductions: 0,
        totalMedicalDeductions: 0,
        totalSurchargeDeductions: 0,
        totalOtherDeductions: 0
    });
}

async function getApprovalQueue(companyId, filters = {}, connection = null) {
    const effectiveFilters = {
        status: filters.status || payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD,
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

async function getBatchDetail(companyId, batchId, connection = null) {
    const detail = await payrollWorkflowService.getWorkflowBatchDetail(normalizeCompanyId(companyId), batchId, connection);
    return {
        ...detail,
        canAct: detail.batch.Status === payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD,
        summaryBreakdown: buildSummaryBreakdown(detail.payrollRows)
    };
}

async function assertEntityHeadCanAct({ companyId, batchId, user, connection }) {
    const actor = normalizeUser(user);
    if (actor.role !== 'entity-head') {
        throw createError('You do not have access to this payroll batch.', 403);
    }

    const batch = await payrollWorkflowService.getWorkflowBatchById(companyId, batchId, connection);
    if (!batch) {
        throw createError('You do not have access to this payroll batch.', 404);
    }

    if (batch.Status !== payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD) {
        throw createError('This payroll batch is not awaiting final approval.', 409);
    }

    await payrollWorkflowService.assertUserCanFinalApprove(actor, batch, connection);

    const history = await payrollWorkflowService.getWorkflowHistory(batch.id, connection);
    const incompatibleActions = history.filter((entry) => [
        'PROCESS_PAYROLL',
        'SUBMIT_TO_MANAGER',
        'MANAGER_ENDORSE',
        'SUBMIT_TO_AUDITOR',
        'AUDITOR_ENDORSE',
        'SUBMIT_TO_ENTITY_HEAD'
    ].includes(entry.Action));

    if (incompatibleActions.some((entry) => Number(entry.ActionBy || 0) === actor.id)) {
        throw createError('You cannot approve a payroll batch in which you performed an incompatible prior action.', 409);
    }

    const snapshot = await payrollWorkflowService.calculatePayrollSnapshot(batch.CompanyID, batch.PMonth, batch.PYear, batch.PType, connection);
    const integrity = payrollWorkflowService.verifyPayrollSnapshotUnchanged(batch, snapshot);
    if (!integrity.matches) {
        throw createError('Payroll figures have changed since Auditor endorsement. The batch must be returned for correction and resubmitted.', 409);
    }

    return { actor, batch, snapshot };
}

async function approveBatch({ companyId, batchId, user, comments = null, testHooks = null, connection = null }) {
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    const savepointName = 'entity_head_approve_savepoint';

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        } else {
            await executor.query(`SAVEPOINT ${savepointName}`);
        }

        const { actor, batch } = await assertEntityHeadCanAct({
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
            action: payrollWorkflowService.WORKFLOW_ACTIONS.FINAL_APPROVE,
            user: actor,
            comments: comments || null,
            metadata: { stage: 'entity-head-approval', decisionType: 'approve' },
            connection: executor
        });

        if (testHooks?.afterFinalApprove) {
            await testHooks.afterFinalApprove({ batch: result.batch, connection: executor });
        }

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

async function returnBatchForCorrection({ companyId, batchId, user, comments, connection = null }) {
    if (!String(comments || '').trim()) {
        throw createError('Please provide a reason for returning the payroll.', 400);
    }

    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    const savepointName = 'entity_head_return_savepoint';

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        } else {
            await executor.query(`SAVEPOINT ${savepointName}`);
        }

        const { actor, batch } = await assertEntityHeadCanAct({
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
            action: payrollWorkflowService.WORKFLOW_ACTIONS.FINAL_RETURN,
            user: actor,
            comments: String(comments).trim(),
            metadata: { stage: 'entity-head-return', decisionType: 'return' },
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

async function rejectBatch({ companyId, batchId, user, comments, connection = null }) {
    if (!String(comments || '').trim()) {
        throw createError('Please provide a reason for rejecting the payroll.', 400);
    }

    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    const savepointName = 'entity_head_reject_savepoint';

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        } else {
            await executor.query(`SAVEPOINT ${savepointName}`);
        }

        const { actor, batch } = await assertEntityHeadCanAct({
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
            action: payrollWorkflowService.WORKFLOW_ACTIONS.FINAL_REJECT,
            user: actor,
            comments: String(comments).trim(),
            metadata: { stage: 'entity-head-rejection', decisionType: 'reject' },
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

async function getEntityHeadDashboardWidgets(companyId) {
    const resolvedCompanyId = normalizeCompanyId(companyId);
    const [awaitingRows] = await pool.query(
        `SELECT COUNT(*) AS count FROM payroll_workflow_batches WHERE CompanyID = ? AND Status = ?`,
        [resolvedCompanyId, payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD]
    );
    const [approvedRows] = await pool.query(
        `SELECT COUNT(*) AS count FROM payroll_workflow_batches WHERE CompanyID = ? AND Status = ?`,
        [resolvedCompanyId, payrollWorkflowService.WORKFLOW_STATUSES.FINAL_APPROVED]
    );
    const [rejectedRows] = await pool.query(
        `SELECT COUNT(*) AS count FROM payroll_workflow_batches WHERE CompanyID = ? AND Status = ?`,
        [resolvedCompanyId, payrollWorkflowService.WORKFLOW_STATUSES.FINAL_REJECTED]
    );
    const [latestAwaitingRows] = await pool.query(
        `
            SELECT TotalStaff, TotalGross, TotalNet, PMonth, PYear, PType
            FROM payroll_workflow_batches
            WHERE CompanyID = ?
              AND Status = ?
            ORDER BY PYear DESC, PMonth DESC, id DESC
            LIMIT 1
        `,
        [resolvedCompanyId, payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD]
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
              AND a.Action IN ('SUBMIT_TO_ENTITY_HEAD', 'FINAL_APPROVE', 'FINAL_RETURN', 'FINAL_REJECT')
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
            actorRole: metadata.actorRole || '',
            decisionType: metadata.decisionType || ''
        };
    });

    return {
        cards: {
            awaitingFinalApproval: Number(awaitingRows[0]?.count || 0),
            finalApproved: Number(approvedRows[0]?.count || 0),
            finalRejected: Number(rejectedRows[0]?.count || 0)
        },
        recentActions: parsedActions,
        latestAwaitingTotals: latestAwaitingRows[0] || null
    };
}

module.exports = {
    approveBatch,
    getApprovalQueue,
    getBatchDetail,
    getEntityHeadDashboardWidgets,
    getStatusBadgeClass,
    rejectBatch,
    returnBatchForCorrection
};
