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
        name: user.name || user.fullName || user.username || user.email || 'Auditor',
        source: user.source || 'tblpassword'
    };
}

function getStatusBadgeClass(status) {
    const badgeMap = {
        CORRECTION_IN_PROGRESS: 'bg-warning text-dark',
        SUBMITTED_TO_AUDITOR: 'bg-info-subtle text-info-emphasis border border-info-subtle',
        AUDITOR_ENDORSED: 'bg-primary-subtle text-primary-emphasis border border-primary-subtle',
        RETURNED_BY_AUDITOR: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        SUBMITTED_TO_ENTITY_HEAD: 'bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle',
        FINAL_APPROVED: 'bg-success-subtle text-success-emphasis border border-success-subtle',
        FINAL_REJECTED: 'bg-danger-subtle text-danger-emphasis border border-danger-subtle',
        POSTED_TO_ACCOUNTS: 'bg-success text-white'
    };

    return badgeMap[status] || 'bg-light text-dark border';
}

async function getAuditorQueue(companyId, filters = {}, connection = null) {
    const effectiveFilters = {
        status: filters.status || payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR,
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

async function getSourceReferences(batch, payrollRows, connection) {
    const executor = connection || pool;
    const pfNos = Array.from(new Set((payrollRows || []).map((row) => String(row.PFNo || '').trim()).filter(Boolean)));
    if (!pfNos.length) {
        return {
            queryAdjustments: [],
            loans: [],
            loanRepayments: [],
            medical: [],
            surcharges: []
        };
    }

    const payrollDate = batch.processPayrollDate || `${batch.PYear}-${String(batch.PMonth).padStart(2, '0')}-28`;
    const placeholders = pfNos.map(() => '?').join(', ');

    const [queryAdjustments, loans, loanRepayments, medical, surcharges] = await Promise.all([
        executor.query(
            `
                SELECT q.PFNO AS PFNo, q.QDate, q.QType, q.QDetails, q.MResponse, q.SDate, q.EDate, q.Percent
                FROM tblquery q
                WHERE (q.CompanyID = ? OR q.CompanyID IS NULL)
                  AND q.PFNO IN (${placeholders})
                  AND COALESCE(q.Approved, 0) IN (-1, 1)
                  AND COALESCE(q.Expired, 0) = 0
                  AND (q.SDate IS NULL OR DATE(q.SDate) <= ?)
                  AND (q.EDate IS NULL OR DATE(q.EDate) >= ?)
                ORDER BY q.PFNO ASC, q.QDate DESC
            `,
            [batch.CompanyID, ...pfNos, payrollDate, payrollDate]
        ),
        executor.query(
            `
                SELECT l.PFNo, l.Amount, l.MonthlyRepayment, l.MonthlyInt, l.LoanBal, l.StartDate, l.ExpDate, l.LTrans, l.TransNo
                FROM tblloan l
                WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
                  AND l.PFNo IN (${placeholders})
                  AND COALESCE(l.Approved, 0) IN (-1, 1)
                  AND COALESCE(l.Expired, 0) = 0
                  AND (l.StartDate IS NULL OR DATE(l.StartDate) <= ?)
                  AND (l.ExpDate IS NULL OR DATE(l.ExpDate) >= ?)
                ORDER BY l.PFNo ASC, l.EntryDate DESC
            `,
            [batch.CompanyID, ...pfNos, payrollDate, payrollDate]
        ),
        executor.query(
            `
                SELECT lr.PFNo, lr.DeductionDate, lr.DAmount, lr.LoanType, lr.DCode, lr.ExpDate, lr.TransRef
                FROM tblloanrepyt lr
                WHERE lr.PFNo IN (${placeholders})
                  AND YEAR(lr.DeductionDate) = ?
                  AND MONTH(lr.DeductionDate) = ?
                ORDER BY lr.PFNo ASC, lr.DeductionDate DESC
            `,
            [...pfNos, Number(batch.PYear), Number(batch.PMonth)]
        ),
        executor.query(
            `
                SELECT m.PFNo, m.EntryDate, m.Amount
                FROM tblmedical m
                WHERE (m.CompanyID = ? OR m.CompanyID IS NULL)
                  AND m.PFNo IN (${placeholders})
                  AND YEAR(m.EntryDate) = ?
                  AND MONTH(m.EntryDate) = ?
                ORDER BY m.PFNo ASC, m.EntryDate DESC
            `,
            [batch.CompanyID, ...pfNos, Number(batch.PYear), Number(batch.PMonth)]
        ),
        executor.query(
            `
                SELECT s.PFNo, s.SAmount
                FROM tblsurcharge s
                WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND s.PFNo IN (${placeholders})
                  AND COALESCE(s.Approved, 0) IN (-1, 1)
                  AND COALESCE(s.Expired, 0) = 0
                ORDER BY s.PFNo ASC
            `,
            [batch.CompanyID, ...pfNos]
        )
    ]);

    return {
        queryAdjustments: queryAdjustments[0],
        loans: loans[0],
        loanRepayments: loanRepayments[0],
        medical: medical[0],
        surcharges: surcharges[0]
    };
}

function buildAuditorSummary(payrollRows = []) {
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

async function getAuditorBatchDetail(companyId, batchId, connection = null) {
    const detail = await payrollWorkflowService.getWorkflowBatchDetail(normalizeCompanyId(companyId), batchId, connection);
    const sourceReferences = await getSourceReferences(detail.batch, detail.payrollRows, connection);
    const summaryBreakdown = buildAuditorSummary(detail.payrollRows);

    return {
        ...detail,
        canAct: detail.batch.Status === payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR,
        sourceReferences,
        summaryBreakdown
    };
}

async function assertAuditorCanAct({ companyId, batchId, user, connection }) {
    const actor = normalizeUser(user);
    if (actor.role !== 'auditor') {
        throw createError('You do not have access to this payroll batch.', 403);
    }

    const batch = await payrollWorkflowService.getWorkflowBatchById(companyId, batchId, connection);
    if (!batch) {
        throw createError('You do not have access to this payroll batch.', 404);
    }

    if (batch.Status !== payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR) {
        throw createError('This payroll batch is not awaiting Auditor review.', 409);
    }

    await payrollWorkflowService.assertUserCanAuditorEndorse(actor, batch, connection);

    const history = await payrollWorkflowService.getWorkflowHistory(batch.id, connection);
    const incompatibleActions = history.filter((entry) => ['PROCESS_PAYROLL', 'SUBMIT_TO_MANAGER', 'MANAGER_ENDORSE', 'SUBMIT_TO_AUDITOR'].includes(entry.Action));
    if (incompatibleActions.some((entry) => Number(entry.ActionBy || 0) === actor.id)) {
        throw createError('You cannot audit a payroll batch in which you performed an incompatible prior action.', 409);
    }

    const snapshot = await payrollWorkflowService.calculatePayrollSnapshot(batch.CompanyID, batch.PMonth, batch.PYear, batch.PType, connection);
    const integrity = payrollWorkflowService.verifyPayrollSnapshotUnchanged(batch, snapshot);
    if (!integrity.matches) {
        throw createError('Payroll figures have changed since Manager endorsement. The batch must be returned for correction and resubmitted.', 409);
    }

    return { actor, batch, snapshot };
}

async function endorseBatch({ companyId, batchId, user, comments = null, testHooks = null, connection = null }) {
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    const savepointName = 'auditor_endorse_savepoint';

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        } else {
            await executor.query(`SAVEPOINT ${savepointName}`);
        }

        const { actor, batch } = await assertAuditorCanAct({
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
            action: payrollWorkflowService.WORKFLOW_ACTIONS.AUDITOR_ENDORSE,
            user: actor,
            comments: comments || null,
            metadata: { stage: 'auditor-review' },
            connection: executor
        });

        if (testHooks?.afterAuditorEndorse) {
            await testHooks.afterAuditorEndorse({ batch, connection: executor });
        }

        const forwarded = await payrollWorkflowService.transitionWorkflow({
            companyId: batch.CompanyID,
            pMonth: batch.PMonth,
            pYear: batch.PYear,
            pType: batch.PType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.SUBMIT_TO_ENTITY_HEAD,
            user: actor,
            comments: 'Forwarded to Entity Head/HNO after audit review.',
            metadata: { stage: 'auditor-forward' },
            connection: executor
        });

        if (testHooks?.afterSubmitToEntityHead) {
            await testHooks.afterSubmitToEntityHead({ batch: forwarded.batch, connection: executor });
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

async function returnBatchForCorrection({ companyId, batchId, user, comments, connection = null }) {
    if (!String(comments || '').trim()) {
        throw createError('Please provide the audit findings or reason for returning the payroll.', 400);
    }

    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    const savepointName = 'auditor_return_savepoint';

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        } else {
            await executor.query(`SAVEPOINT ${savepointName}`);
        }

        const { actor, batch } = await assertAuditorCanAct({
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
            action: payrollWorkflowService.WORKFLOW_ACTIONS.AUDITOR_RETURN,
            user: actor,
            comments: String(comments).trim(),
            metadata: { stage: 'auditor-return' },
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

async function getAuditorDashboardWidgets(companyId) {
    const resolvedCompanyId = normalizeCompanyId(companyId);
    const [awaitingRows] = await pool.query(
        `SELECT COUNT(*) AS count FROM payroll_workflow_batches WHERE CompanyID = ? AND Status = ?`,
        [resolvedCompanyId, payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR]
    );
    const [endorsedRows] = await pool.query(
        `SELECT COUNT(*) AS count FROM payroll_workflow_batches WHERE CompanyID = ? AND Status = ?`,
        [resolvedCompanyId, payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD]
    );
    const [returnedRows] = await pool.query(
        `SELECT COUNT(*) AS count FROM payroll_workflow_batches WHERE CompanyID = ? AND Status = ?`,
        [resolvedCompanyId, payrollWorkflowService.WORKFLOW_STATUSES.RETURNED_BY_AUDITOR]
    );
    const [finalApprovedRows] = await pool.query(
        `SELECT COUNT(*) AS count FROM payroll_workflow_batches WHERE CompanyID = ? AND Status = ?`,
        [resolvedCompanyId, payrollWorkflowService.WORKFLOW_STATUSES.FINAL_APPROVED]
    );
    const [finalRejectedRows] = await pool.query(
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
        [resolvedCompanyId, payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR]
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
              AND a.Action IN ('SUBMIT_TO_AUDITOR', 'AUDITOR_ENDORSE', 'AUDITOR_RETURN', 'SUBMIT_TO_ENTITY_HEAD', 'FINAL_APPROVE', 'FINAL_RETURN', 'FINAL_REJECT')
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
            awaitingAuditReview: Number(awaitingRows[0]?.count || 0),
            endorsedToEntityHead: Number(endorsedRows[0]?.count || 0),
            returnedForCorrection: Number(returnedRows[0]?.count || 0),
            finalApproved: Number(finalApprovedRows[0]?.count || 0),
            finalRejected: Number(finalRejectedRows[0]?.count || 0)
        },
        recentActions: parsedActions,
        latestAwaitingTotals: latestAwaitingRows[0] || null
    };
}

module.exports = {
    endorseBatch,
    getAuditorBatchDetail,
    getAuditorDashboardWidgets,
    getAuditorQueue,
    getStatusBadgeClass,
    returnBatchForCorrection
};
