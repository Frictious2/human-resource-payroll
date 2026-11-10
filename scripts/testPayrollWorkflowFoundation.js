const fs = require('fs');
const path = require('path');
require('./requireDisposableDatabase')();
const pool = require('../config/db');
const payrollWorkflowService = require('../services/payrollWorkflowService');
const managerPayrollWorkflowService = require('../services/managerPayrollWorkflowService');
const auditorPayrollWorkflowService = require('../services/auditorPayrollWorkflowService');
const entityHeadPayrollWorkflowService = require('../services/entityHeadPayrollWorkflowService');
const payrollGlPostingService = require('../services/payrollGlPostingService');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function ensureWorkflowTablesExist(connection) {
    const migrationPath = path.join(__dirname, '..', 'database', 'migrations', '20260711-payroll-workflow.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const statements = sql
        .split(/;\s*\n/)
        .map((statement) => statement.trim())
        .filter(Boolean);

    for (const statement of statements) {
        await connection.query(statement);
    }
}

async function getCandidatePayrollBatch(connection) {
    const [rows] = await connection.query(
        `
            SELECT
                CompanyID,
                PMonth,
                PYear,
                TRIM(PType) AS PType,
                COUNT(*) AS RowCount
            FROM tblpayroll
            WHERE CompanyID IS NOT NULL
              AND PYear < 2090
            GROUP BY CompanyID, PMonth, PYear, TRIM(PType)
            HAVING COUNT(*) > 0
            ORDER BY PYear DESC, PMonth DESC, RowCount DESC
            LIMIT 1
        `
    );

    if (!rows.length) {
        throw new Error('No payroll batch rows were found for workflow verification.');
    }

    return rows[0];
}

async function countActions(connection, batchId) {
    const [rows] = await connection.query(
        'SELECT COUNT(*) AS count FROM payroll_workflow_actions WHERE WorkflowBatchID = ?',
        [batchId]
    );
    return Number(rows[0]?.count || 0);
}

async function cleanupWorkflowBatchRecords(connection, companyId, pMonth, pYear, pType) {
    await connection.query(
        `
            DELETE FROM payroll_workflow_actions
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND PType = ?
        `,
        [companyId, pMonth, pYear, pType]
    );

    await connection.query(
        `
            DELETE FROM payroll_workflow_batches
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND PType = ?
        `,
        [companyId, pMonth, pYear, pType]
    );
}

async function cleanupTemporaryPayrollBatch(connection, companyId, pMonth, pYear, pType) {
    await cleanupWorkflowBatchRecords(connection, companyId, pMonth, pYear, pType);
    await connection.query(
        `
            DELETE l
            FROM payroll_gl_posting_lines l
            INNER JOIN payroll_gl_posting_batches b
                ON b.id = l.batch_id
            WHERE b.company_id = ?
              AND b.posting_month = ?
              AND b.posting_year = ?
              AND b.activity_code = ?
        `,
        [companyId, pMonth, pYear, pType]
    );
    await connection.query(
        `
            DELETE FROM payroll_gl_posting_batches
            WHERE company_id = ?
              AND posting_month = ?
              AND posting_year = ?
              AND activity_code = ?
        `,
        [companyId, pMonth, pYear, pType]
    );
    await connection.query(
        `
            DELETE FROM tblexport
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND TCode = ?
              AND YEAR(EntryDate) = ?
              AND MONTH(EntryDate) = ?
        `,
        [companyId, pType, pYear, pMonth]
    );
    await connection.query(
        `
            DELETE FROM tblpayroll
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND PType = ?
        `,
        [companyId, pMonth, pYear, pType]
    );
}

async function buildTemporaryPayrollBatch(connection, sourceBatch) {
    const temporaryBatch = {
        companyId: Number(sourceBatch.CompanyID) || 1,
        pMonth: 12,
        pYear: 2098,
        pType: String(sourceBatch.PType).trim()
    };

    await cleanupTemporaryPayrollBatch(
        connection,
        temporaryBatch.companyId,
        temporaryBatch.pMonth,
        temporaryBatch.pYear,
        temporaryBatch.pType
    );

    const [sourceRows] = await connection.query(
        `
            SELECT *
            FROM tblpayroll
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND TRIM(PType) = ?
            ORDER BY PFNo ASC
        `,
        [
            temporaryBatch.companyId,
            Number(sourceBatch.PMonth),
            Number(sourceBatch.PYear),
            String(sourceBatch.PType)
        ]
    );

    if (!sourceRows.length) {
        throw new Error('Unable to load source payroll rows for workflow verification.');
    }

    const columns = Object.keys(sourceRows[0]);
    const placeholders = `(${columns.map(() => '?').join(', ')})`;
    const values = [];

    sourceRows.forEach((row) => {
        const clonedRow = { ...row };
        clonedRow.PMonth = temporaryBatch.pMonth;
        clonedRow.PYear = temporaryBatch.pYear;
        clonedRow.PType = temporaryBatch.pType;
        clonedRow.CompanyID = temporaryBatch.companyId;
        if (Object.prototype.hasOwnProperty.call(clonedRow, 'posted_to_gl')) {
            clonedRow.posted_to_gl = 0;
        }
        if (Object.prototype.hasOwnProperty.call(clonedRow, 'gl_posted_batch_id')) {
            clonedRow.gl_posted_batch_id = null;
        }
        if (Object.prototype.hasOwnProperty.call(clonedRow, 'gl_posted_at')) {
            clonedRow.gl_posted_at = null;
        }
        columns.forEach((column) => {
            values.push(clonedRow[column]);
        });
    });

    await connection.query(
        `
            INSERT INTO tblpayroll (${columns.join(', ')})
            VALUES ${Array.from({ length: sourceRows.length }, () => placeholders).join(', ')}
        `,
        values
    );

    return temporaryBatch;
}

async function cleanupCommittedRollbackTest(companyId, pMonth, pYear, pType) {
    const connection = await pool.getConnection();
    try {
        await cleanupWorkflowBatchRecords(connection, companyId, pMonth, pYear, pType);
    } finally {
        connection.release();
    }
}

async function run() {
    const connection = await pool.getConnection();

    let temporaryBatch;

    try {
        await ensureWorkflowTablesExist(connection);
        await cleanupTemporaryPayrollBatch(connection, 1, 12, 2098, '98');
        await cleanupWorkflowBatchRecords(connection, 1, 12, 2099, '99');
        const sourceBatch = await getCandidatePayrollBatch(connection);
        temporaryBatch = await buildTemporaryPayrollBatch(connection, sourceBatch);
        const companyId = temporaryBatch.companyId;
        const pMonth = temporaryBatch.pMonth;
        const pYear = temporaryBatch.pYear;
        const pType = temporaryBatch.pType;
        const financeUser = { id: 900001, role: 'finance-officer', name: 'Finance Officer Test', source: 'tblpassword' };
        const managerUser = { id: 900002, role: 'manager', name: 'Manager Test', source: 'tblpassword' };
        const auditorUser = { id: 900003, role: 'auditor', name: 'Auditor Test', source: 'tblpassword' };
        const entityHeadUser = { id: 900004, role: 'entity-head', name: 'Entity Head Test', source: 'tblpassword' };

        const snapshot = await payrollWorkflowService.calculatePayrollSnapshot(companyId, pMonth, pYear, pType, connection);
        assert(snapshot.payrollRowCount > 0, 'Payroll snapshot should contain at least one row.');
        assert(snapshot.payrollChecksum, 'Payroll snapshot checksum should be generated.');

        await connection.beginTransaction();

        const createdBatch = await payrollWorkflowService.createWorkflowBatch({
            companyId,
            pMonth,
            pYear,
            pType,
            status: payrollWorkflowService.WORKFLOW_STATUSES.DRAFT,
            snapshot,
            connection
        });
        assert(createdBatch && createdBatch.id, 'Workflow batch should be created.');

        let duplicateErrorCaught = false;
        try {
            await payrollWorkflowService.createWorkflowBatch({
                companyId,
                pMonth,
                pYear,
                pType,
                status: payrollWorkflowService.WORKFLOW_STATUSES.DRAFT,
                snapshot,
                connection
            });
        } catch (error) {
            duplicateErrorCaught = error.statusCode === 409;
        }
        assert(duplicateErrorCaught, 'Duplicate workflow batches should be prevented.');

        const step1 = await payrollWorkflowService.transitionWorkflow({
            companyId,
            pMonth,
            pYear,
            pType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.PROCESS_PAYROLL,
            user: financeUser,
            comments: 'Processed for verification',
            connection
        });
        assert(step1.batch.Status === payrollWorkflowService.WORKFLOW_STATUSES.PROCESSED, 'Batch should be processed.');

        const [submissionProbeRows] = await connection.query(
            `
                SELECT PFNo, COALESCE(Ded1, 0) AS Ded1
                FROM tblpayroll
                WHERE (CompanyID = ? OR CompanyID IS NULL)
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                ORDER BY PFNo ASC
                LIMIT 1
            `,
            [companyId, pMonth, pYear, pType, String(Number(pType))]
        );
        assert(submissionProbeRows.length > 0, 'A payroll row should be available for submission integrity verification.');
        await connection.query(
            `
                UPDATE tblpayroll
                SET Ded1 = COALESCE(Ded1, 0) + 5
                WHERE PFNo = ?
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                  AND (CompanyID = ? OR CompanyID IS NULL)
                LIMIT 1
            `,
            [submissionProbeRows[0].PFNo, pMonth, pYear, pType, String(Number(pType)), companyId]
        );

        let integrityErrorCaught = false;
        try {
            await payrollWorkflowService.transitionWorkflow({
                companyId,
                pMonth,
                pYear,
                pType,
                action: payrollWorkflowService.WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER,
                user: financeUser,
                connection
            });
        } catch (error) {
            integrityErrorCaught = error.statusCode === 409;
        }
        assert(integrityErrorCaught, 'Changed payroll figures should block submission to manager.');

        await connection.query(
            `
                UPDATE tblpayroll
                SET Ded1 = ?
                WHERE PFNo = ?
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                  AND (CompanyID = ? OR CompanyID IS NULL)
                LIMIT 1
            `,
            [submissionProbeRows[0].Ded1, submissionProbeRows[0].PFNo, pMonth, pYear, pType, String(Number(pType)), companyId]
        );
        const restoredSnapshot = await payrollWorkflowService.calculatePayrollSnapshot(companyId, pMonth, pYear, pType, connection);
        await payrollWorkflowService.updatePayrollSnapshot({
            batchId: step1.batch.id,
            snapshot: restoredSnapshot,
            connection
        });

        const step2 = await payrollWorkflowService.transitionWorkflow({
            companyId,
            pMonth,
            pYear,
            pType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER,
            user: financeUser,
            connection
        });
        assert(step2.batch.Status === payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER, 'Batch should be submitted to manager.');

        const loadedBatch = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(loadedBatch && loadedBatch.id === step2.batch.id, 'Workflow batch lookup by id should work.');
        const loadedDetail = await payrollWorkflowService.getWorkflowBatchDetail(companyId, step2.batch.id, connection);
        assert(loadedDetail.history.length >= 2, 'Workflow detail should include action history.');
        assert(loadedDetail.payrollRows.length > 0, 'Workflow detail should include payroll rows.');

        const managerQueue = await managerPayrollWorkflowService.getManagerQueue(companyId, {
            status: payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER
        }, connection);
        assert(managerQueue.batches.some((row) => row.id === step2.batch.id), 'Manager queue should show submitted payroll batches.');

        let selfEndorseBlocked = false;
        try {
            await managerPayrollWorkflowService.endorseBatch({
                companyId,
                batchId: step2.batch.id,
                user: { id: financeUser.id, role: 'manager', name: 'Manager Finance Clash', source: 'tblpassword' },
                connection
            });
        } catch (error) {
            selfEndorseBlocked = /processed or submitted/i.test(error.message);
        }
        assert(selfEndorseBlocked, 'Finance user should not be able to endorse as Manager on the same batch.');

        const managerDetail = await managerPayrollWorkflowService.getManagerBatchDetail(companyId, step2.batch.id, connection);
        assert(managerDetail.canAct === true, 'Manager detail should allow action for submitted batches.');

        let returnWithoutCommentBlocked = false;
        try {
            await managerPayrollWorkflowService.returnBatchToFinance({
                companyId,
                batchId: step2.batch.id,
                user: managerUser,
                comments: '',
                connection
            });
        } catch (error) {
            returnWithoutCommentBlocked = /reason for returning/i.test(error.message);
        }
        assert(returnWithoutCommentBlocked, 'Manager return should require comments.');

        await managerPayrollWorkflowService.returnBatchToFinance({
            companyId,
            batchId: step2.batch.id,
            user: managerUser,
            comments: 'Figures need clarification.',
            connection
        });
        const returnedBatch = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(returnedBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.RETURNED_BY_MANAGER, 'Returned payroll should move to RETURNED_BY_MANAGER.');
        assert(String(returnedBatch.ManagerComments || '').includes('Figures need clarification.'), 'Manager return comments should be stored.');

        await payrollWorkflowService.startPayrollCorrection({
            companyId,
            batchId: step2.batch.id,
            user: financeUser,
            comments: 'Applying Manager correction feedback.',
            connection
        });
        const correctionInProgressBatch = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(correctionInProgressBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS, 'Returned payroll should enter correction in progress.');

        await payrollWorkflowService.transitionWorkflow({
            companyId,
            pMonth,
            pYear,
            pType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.PROCESS_PAYROLL,
            user: financeUser,
            comments: 'Reprocessed after manager return',
            connection
        });
        const correctedBatch = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(correctedBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.PROCESSED, 'Corrected payroll should return to PROCESSED.');
        assert(!correctedBatch.SubmittedToManagerBy, 'Correction processing should reset prior active submission fields.');
        assert(!correctedBatch.ManagerEndorsedBy, 'Correction processing should reset prior Manager endorsement fields.');
        assert(!correctedBatch.AuditorEndorsedBy, 'Correction processing should reset prior Auditor endorsement fields.');
        assert(!correctedBatch.FinalApprovedBy, 'Correction processing should reset prior final approval fields.');
        await payrollWorkflowService.transitionWorkflow({
            companyId,
            pMonth,
            pYear,
            pType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER,
            user: financeUser,
            connection
        });

        let nonManagerBlocked = false;
        try {
            await managerPayrollWorkflowService.endorseBatch({
                companyId,
                batchId: step2.batch.id,
                user: auditorUser,
                connection
            });
        } catch (error) {
            nonManagerBlocked = error.statusCode === 403;
        }
        assert(nonManagerBlocked, 'Non-manager users should not be able to endorse payroll.');

        let managerRollbackCaught = false;
        try {
            await managerPayrollWorkflowService.endorseBatch({
                companyId,
                batchId: step2.batch.id,
                user: managerUser,
                connection,
                testHooks: {
                    afterManagerEndorse: async () => {
                        throw new Error('Simulated manager endorsement failure');
                    }
                }
            });
        } catch (error) {
            managerRollbackCaught = /Simulated manager endorsement failure/.test(error.message);
        }
        assert(managerRollbackCaught, 'Forced manager endorsement failure should be thrown.');
        const rollbackManagerBatch = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(rollbackManagerBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER, 'Failed manager endorsement should rollback to submitted state.');

        const [managerProbeRows] = await connection.query(
            `
                SELECT PFNo, COALESCE(Ded1, 0) AS Ded1
                FROM tblpayroll
                WHERE (CompanyID = ? OR CompanyID IS NULL)
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                ORDER BY PFNo ASC
                LIMIT 1
            `,
            [companyId, pMonth, pYear, pType, String(Number(pType))]
        );
        await connection.query(
            `
                UPDATE tblpayroll
                SET Ded1 = COALESCE(Ded1, 0) + 3
                WHERE PFNo = ?
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                  AND (CompanyID = ? OR CompanyID IS NULL)
                LIMIT 1
            `,
            [managerProbeRows[0].PFNo, pMonth, pYear, pType, String(Number(pType)), companyId]
        );

        let checksumBlocked = false;
        try {
            await managerPayrollWorkflowService.endorseBatch({
                companyId,
                batchId: step2.batch.id,
                user: managerUser,
                connection
            });
        } catch (error) {
            checksumBlocked = /changed since submission/i.test(error.message);
        }
        assert(checksumBlocked, 'Changed payroll checksum should block Manager endorsement.');

        await connection.query(
            `
                UPDATE tblpayroll
                SET Ded1 = ?
                WHERE PFNo = ?
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                  AND (CompanyID = ? OR CompanyID IS NULL)
                LIMIT 1
            `,
            [managerProbeRows[0].Ded1, managerProbeRows[0].PFNo, pMonth, pYear, pType, String(Number(pType)), companyId]
        );
        const restoredManagerSnapshot = await payrollWorkflowService.calculatePayrollSnapshot(companyId, pMonth, pYear, pType, connection);
        await payrollWorkflowService.updatePayrollSnapshot({
            batchId: step2.batch.id,
            snapshot: restoredManagerSnapshot,
            connection
        });

        await managerPayrollWorkflowService.endorseBatch({
            companyId,
            batchId: step2.batch.id,
            user: managerUser,
            comments: 'Manager reviewed and endorsed.',
            connection
        });
        const endorsedBatch = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(endorsedBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR, 'Manager endorsement should forward payroll to SUBMITTED_TO_AUDITOR.');

        let duplicateEndorseBlocked = false;
        try {
            await managerPayrollWorkflowService.endorseBatch({
                companyId,
                batchId: step2.batch.id,
                user: managerUser,
                connection
            });
        } catch (error) {
            duplicateEndorseBlocked = /not awaiting Manager endorsement/i.test(error.message);
        }
        assert(duplicateEndorseBlocked, 'Duplicate manager endorsement should be blocked.');

        const auditorQueue = await auditorPayrollWorkflowService.getAuditorQueue(companyId, {
            status: payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR
        }, connection);
        assert(auditorQueue.batches.some((row) => row.id === step2.batch.id), 'Auditor queue should show submitted-to-auditor payroll batches.');

        const auditorDetail = await auditorPayrollWorkflowService.getAuditorBatchDetail(companyId, step2.batch.id, connection);
        assert(auditorDetail.canAct === true, 'Auditor detail should allow action for submitted-to-auditor batches.');
        assert(auditorDetail.sourceReferences.loans !== undefined, 'Auditor detail should include source references.');

        let nonAuditorBlocked = false;
        try {
            await auditorPayrollWorkflowService.endorseBatch({
                companyId,
                batchId: step2.batch.id,
                user: managerUser,
                connection
            });
        } catch (error) {
            nonAuditorBlocked = error.statusCode === 403;
        }
        assert(nonAuditorBlocked, 'Non-auditor users should not be able to perform auditor endorsement.');

        let incompatibleAuditorBlocked = false;
        try {
            await auditorPayrollWorkflowService.endorseBatch({
                companyId,
                batchId: step2.batch.id,
                user: { id: managerUser.id, role: 'auditor', name: 'Auditor Manager Clash', source: 'tblpassword' },
                connection
            });
        } catch (error) {
            incompatibleAuditorBlocked = /incompatible prior action/i.test(error.message);
        }
        assert(incompatibleAuditorBlocked, 'Auditor should be blocked if they performed an incompatible prior action.');

        let auditorReturnWithoutCommentBlocked = false;
        try {
            await auditorPayrollWorkflowService.returnBatchForCorrection({
                companyId,
                batchId: step2.batch.id,
                user: auditorUser,
                comments: '',
                connection
            });
        } catch (error) {
            auditorReturnWithoutCommentBlocked = /audit findings or reason/i.test(error.message);
        }
        assert(auditorReturnWithoutCommentBlocked, 'Auditor return should require comments.');

        let auditorRollbackCaught = false;
        try {
            await auditorPayrollWorkflowService.endorseBatch({
                companyId,
                batchId: step2.batch.id,
                user: auditorUser,
                connection,
                testHooks: {
                    afterAuditorEndorse: async () => {
                        throw new Error('Simulated auditor endorsement failure');
                    }
                }
            });
        } catch (error) {
            auditorRollbackCaught = /Simulated auditor endorsement failure/.test(error.message);
        }
        assert(auditorRollbackCaught, 'Forced auditor endorsement failure should be thrown.');
        const rollbackAuditorBatch = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(rollbackAuditorBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR, 'Failed auditor endorsement should rollback to submitted-to-auditor state.');

        const [auditorProbeRows] = await connection.query(
            `
                SELECT PFNo, COALESCE(Ded1, 0) AS Ded1
                FROM tblpayroll
                WHERE (CompanyID = ? OR CompanyID IS NULL)
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                ORDER BY PFNo ASC
                LIMIT 1
            `,
            [companyId, pMonth, pYear, pType, String(Number(pType))]
        );
        await connection.query(
            `
                UPDATE tblpayroll
                SET Ded1 = COALESCE(Ded1, 0) + 4
                WHERE PFNo = ?
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                  AND (CompanyID = ? OR CompanyID IS NULL)
                LIMIT 1
            `,
            [auditorProbeRows[0].PFNo, pMonth, pYear, pType, String(Number(pType)), companyId]
        );

        let auditorChecksumBlocked = false;
        try {
            await auditorPayrollWorkflowService.endorseBatch({
                companyId,
                batchId: step2.batch.id,
                user: auditorUser,
                connection
            });
        } catch (error) {
            auditorChecksumBlocked = /changed since Manager endorsement/i.test(error.message);
        }
        assert(auditorChecksumBlocked, 'Changed payroll checksum should block Auditor action.');

        await connection.query(
            `
                UPDATE tblpayroll
                SET Ded1 = ?
                WHERE PFNo = ?
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                  AND (CompanyID = ? OR CompanyID IS NULL)
                LIMIT 1
            `,
            [auditorProbeRows[0].Ded1, auditorProbeRows[0].PFNo, pMonth, pYear, pType, String(Number(pType)), companyId]
        );
        const restoredAuditorSnapshot = await payrollWorkflowService.calculatePayrollSnapshot(companyId, pMonth, pYear, pType, connection);
        await payrollWorkflowService.updatePayrollSnapshot({
            batchId: step2.batch.id,
            snapshot: restoredAuditorSnapshot,
            connection
        });

        await auditorPayrollWorkflowService.returnBatchForCorrection({
            companyId,
            batchId: step2.batch.id,
            user: auditorUser,
            comments: 'Audit variance identified.',
            connection
        });
        const returnedByAuditorBatch = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(returnedByAuditorBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.RETURNED_BY_AUDITOR, 'Returned payroll should move to RETURNED_BY_AUDITOR.');
        assert(String(returnedByAuditorBatch.AuditorComments || '').includes('Audit variance identified.'), 'Auditor return comments should be stored.');

        await payrollWorkflowService.startPayrollCorrection({
            companyId,
            batchId: step2.batch.id,
            user: financeUser,
            comments: 'Applying Auditor correction feedback.',
            connection
        });
        const auditorCorrectionBatch = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(auditorCorrectionBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS, 'Auditor-returned payroll should enter correction in progress.');

        await payrollWorkflowService.transitionWorkflow({
            companyId,
            pMonth,
            pYear,
            pType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.PROCESS_PAYROLL,
            user: financeUser,
            comments: 'Reprocessed after audit return',
            connection
        });
        await payrollWorkflowService.transitionWorkflow({
            companyId,
            pMonth,
            pYear,
            pType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER,
            user: financeUser,
            connection
        });
        await managerPayrollWorkflowService.endorseBatch({
            companyId,
            batchId: step2.batch.id,
            user: managerUser,
            comments: 'Re-endorsed after audit return.',
            connection
        });

        await auditorPayrollWorkflowService.endorseBatch({
            companyId,
            batchId: step2.batch.id,
            user: auditorUser,
            comments: 'Auditor reviewed and endorsed.',
            connection
        });
        const step6 = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(step6.Status === payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD, 'Auditor endorsement should forward payroll to SUBMITTED_TO_ENTITY_HEAD.');

        let duplicateAuditorEndorseBlocked = false;
        try {
            await auditorPayrollWorkflowService.endorseBatch({
                companyId,
                batchId: step2.batch.id,
                user: auditorUser,
                connection
            });
        } catch (error) {
            duplicateAuditorEndorseBlocked = /not awaiting Auditor review/i.test(error.message);
        }
        assert(duplicateAuditorEndorseBlocked, 'Duplicate auditor endorsement should be blocked.');

        const entityHeadQueue = await entityHeadPayrollWorkflowService.getApprovalQueue(companyId, {
            status: payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD
        }, connection);
        assert(entityHeadQueue.batches.some((batch) => batch.id === step2.batch.id), 'Entity Head queue should include submitted-to-entity-head batches.');

        const entityHeadDetail = await entityHeadPayrollWorkflowService.getBatchDetail(companyId, step2.batch.id, connection);
        assert(entityHeadDetail.canAct === true, 'Entity Head detail should allow action for submitted-to-entity-head batches.');

        let nonEntityHeadBlocked = false;
        try {
            await entityHeadPayrollWorkflowService.approveBatch({
                companyId,
                batchId: step2.batch.id,
                user: auditorUser,
                connection
            });
        } catch (error) {
            nonEntityHeadBlocked = error.statusCode === 403;
        }
        assert(nonEntityHeadBlocked, 'Non-Entity Head users should not be able to perform final approval actions.');

        let incompatibleEntityHeadBlocked = false;
        try {
            await entityHeadPayrollWorkflowService.approveBatch({
                companyId,
                batchId: step2.batch.id,
                user: { id: auditorUser.id, role: 'entity-head', name: 'Entity Head Auditor Clash', source: 'tblpassword' },
                connection
            });
        } catch (error) {
            incompatibleEntityHeadBlocked = /incompatible prior action/i.test(error.message);
        }
        assert(incompatibleEntityHeadBlocked, 'Entity Head should be blocked if they performed an incompatible prior action.');

        let finalReturnWithoutCommentBlocked = false;
        try {
            await entityHeadPayrollWorkflowService.returnBatchForCorrection({
                companyId,
                batchId: step2.batch.id,
                user: entityHeadUser,
                comments: '',
                connection
            });
        } catch (error) {
            finalReturnWithoutCommentBlocked = /reason for returning/i.test(error.message);
        }
        assert(finalReturnWithoutCommentBlocked, 'Final return should require comments.');

        let finalRejectWithoutCommentBlocked = false;
        try {
            await entityHeadPayrollWorkflowService.rejectBatch({
                companyId,
                batchId: step2.batch.id,
                user: entityHeadUser,
                comments: '',
                connection
            });
        } catch (error) {
            finalRejectWithoutCommentBlocked = /reason for rejecting/i.test(error.message);
        }
        assert(finalRejectWithoutCommentBlocked, 'Final reject should require comments.');

        let finalApprovalRollbackCaught = false;
        try {
            await entityHeadPayrollWorkflowService.approveBatch({
                companyId,
                batchId: step2.batch.id,
                user: entityHeadUser,
                connection,
                testHooks: {
                    afterFinalApprove: async () => {
                        throw new Error('Simulated final approval failure');
                    }
                }
            });
        } catch (error) {
            finalApprovalRollbackCaught = /Simulated final approval failure/.test(error.message);
        }
        assert(finalApprovalRollbackCaught, 'Forced final approval failure should be thrown.');
        const rollbackEntityHeadBatch = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(rollbackEntityHeadBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD, 'Failed final approval should rollback to submitted-to-entity-head state.');

        const [entityHeadProbeRows] = await connection.query(
            `
                SELECT PFNo, COALESCE(Ded1, 0) AS Ded1
                FROM tblpayroll
                WHERE (CompanyID = ? OR CompanyID IS NULL)
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                ORDER BY PFNo ASC
                LIMIT 1
            `,
            [companyId, pMonth, pYear, pType, String(Number(pType))]
        );
        await connection.query(
            `
                UPDATE tblpayroll
                SET Ded1 = COALESCE(Ded1, 0) + 6
                WHERE PFNo = ?
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                  AND (CompanyID = ? OR CompanyID IS NULL)
                LIMIT 1
            `,
            [entityHeadProbeRows[0].PFNo, pMonth, pYear, pType, String(Number(pType)), companyId]
        );

        let entityHeadChecksumBlocked = false;
        try {
            await entityHeadPayrollWorkflowService.approveBatch({
                companyId,
                batchId: step2.batch.id,
                user: entityHeadUser,
                connection
            });
        } catch (error) {
            entityHeadChecksumBlocked = /changed since Auditor endorsement/i.test(error.message);
        }
        assert(entityHeadChecksumBlocked, 'Changed payroll checksum should block final approval action.');

        await connection.query(
            `
                UPDATE tblpayroll
                SET Ded1 = ?
                WHERE PFNo = ?
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                  AND (CompanyID = ? OR CompanyID IS NULL)
                LIMIT 1
            `,
            [entityHeadProbeRows[0].Ded1, entityHeadProbeRows[0].PFNo, pMonth, pYear, pType, String(Number(pType)), companyId]
        );

        await entityHeadPayrollWorkflowService.returnBatchForCorrection({
            companyId,
            batchId: step2.batch.id,
            user: entityHeadUser,
            comments: 'Final review requires finance correction.',
            connection
        });
        const returnedByEntityHeadBatch = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(returnedByEntityHeadBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.FINAL_REJECTED, 'Returned payroll should move to FINAL_REJECTED.');
        assert(String(returnedByEntityHeadBatch.EntityHeadComments || '').includes('Final review requires finance correction.'), 'Entity Head return comments should be stored.');

        await payrollWorkflowService.startPayrollCorrection({
            companyId,
            batchId: step2.batch.id,
            user: financeUser,
            comments: 'Applying Entity Head correction feedback.',
            connection
        });
        const entityHeadCorrectionBatch = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(entityHeadCorrectionBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS, 'Final-rejected payroll should enter correction in progress.');

        await payrollWorkflowService.transitionWorkflow({
            companyId,
            pMonth,
            pYear,
            pType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.PROCESS_PAYROLL,
            user: financeUser,
            comments: 'Reprocessed after final return',
            connection
        });
        await payrollWorkflowService.transitionWorkflow({
            companyId,
            pMonth,
            pYear,
            pType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER,
            user: financeUser,
            connection
        });
        await managerPayrollWorkflowService.endorseBatch({
            companyId,
            batchId: step2.batch.id,
            user: managerUser,
            comments: 'Re-endorsed after final return.',
            connection
        });
        await auditorPayrollWorkflowService.endorseBatch({
            companyId,
            batchId: step2.batch.id,
            user: auditorUser,
            comments: 'Re-endorsed after final return.',
            connection
        });

        await entityHeadPayrollWorkflowService.rejectBatch({
            companyId,
            batchId: step2.batch.id,
            user: entityHeadUser,
            comments: 'Final rejection issued after review.',
            connection
        });
        const rejectedBatch = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(rejectedBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.FINAL_REJECTED, 'Rejected payroll should remain in FINAL_REJECTED state.');
        assert(String(rejectedBatch.EntityHeadComments || '').includes('Final rejection issued after review.'), 'Entity Head rejection comments should be stored.');

        await payrollWorkflowService.startPayrollCorrection({
            companyId,
            batchId: step2.batch.id,
            user: financeUser,
            comments: 'Restarting after final rejection.',
            connection
        });
        const rejectedCorrectionBatch = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(rejectedCorrectionBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS, 'Final rejected payroll should re-enter correction in progress.');

        await payrollWorkflowService.transitionWorkflow({
            companyId,
            pMonth,
            pYear,
            pType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.PROCESS_PAYROLL,
            user: financeUser,
            comments: 'Reprocessed after final rejection',
            connection
        });
        await payrollWorkflowService.transitionWorkflow({
            companyId,
            pMonth,
            pYear,
            pType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER,
            user: financeUser,
            connection
        });
        await managerPayrollWorkflowService.endorseBatch({
            companyId,
            batchId: step2.batch.id,
            user: managerUser,
            comments: 'Re-endorsed after final rejection.',
            connection
        });
        await auditorPayrollWorkflowService.endorseBatch({
            companyId,
            batchId: step2.batch.id,
            user: auditorUser,
            comments: 'Auditor re-endorsed after final rejection.',
            connection
        });

        const step8 = await entityHeadPayrollWorkflowService.approveBatch({
            companyId,
            user: entityHeadUser,
            batchId: step2.batch.id,
            comments: 'Final approval granted after full review.',
            connection
        });
        assert(step8.Status === payrollWorkflowService.WORKFLOW_STATUSES.FINAL_APPROVED, 'Batch should be final-approved.');

        let finalApprovedCorrectionBlocked = false;
        try {
            await payrollWorkflowService.startPayrollCorrection({
                companyId,
                batchId: step2.batch.id,
                user: financeUser,
                comments: 'Should be blocked for final-approved batch.',
                connection
            });
        } catch (error) {
            finalApprovedCorrectionBlocked = /Approved or posted payroll cannot be corrected|not eligible for correction/i.test(error.message);
        }
        assert(finalApprovedCorrectionBlocked, 'Final-approved payroll should be blocked from correction.');

        let duplicateFinalApprovalBlocked = false;
        try {
            await entityHeadPayrollWorkflowService.approveBatch({
                companyId,
                batchId: step2.batch.id,
                user: entityHeadUser,
                connection
            });
        } catch (error) {
            duplicateFinalApprovalBlocked = /not awaiting final approval/i.test(error.message);
        }
        assert(duplicateFinalApprovalBlocked, 'Duplicate final approval should be blocked.');

        const postingResult = await payrollGlPostingService.postMonthlyPayrollToGL({
            companyId,
            activityCode: pType,
            postingDate: new Date(`${pYear}-${String(pMonth).padStart(2, '0')}-28T00:00:00`),
            postedBy: financeUser.id,
            postedByUser: financeUser,
            connection
        });
        assert(Number(postingResult.batchId || 0) > 0, 'GL posting batch should be created.');
        assert(postingResult.workflowStatus === payrollWorkflowService.WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS, 'Workflow should move to posted to accounts after successful GL posting.');

        const step9 = await payrollWorkflowService.getWorkflowBatchById(companyId, step2.batch.id, connection);
        assert(step9.Status === payrollWorkflowService.WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS, 'Batch should be posted to accounts.');

        let postedCorrectionBlocked = false;
        try {
            await payrollWorkflowService.startPayrollCorrection({
                companyId,
                batchId: step2.batch.id,
                user: financeUser,
                comments: 'Should be blocked for posted batch.',
                connection
            });
        } catch (error) {
            postedCorrectionBlocked = /formal reversal|not eligible for correction/i.test(error.message);
        }
        assert(postedCorrectionBlocked, 'Posted payroll should be blocked from correction.');

        const [postedPayrollRows] = await connection.query(
            `
                SELECT COUNT(*) AS count
                FROM tblpayroll
                WHERE (CompanyID = ? OR CompanyID IS NULL)
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                  AND COALESCE(posted_to_gl, 0) <> 0
            `,
            [companyId, pMonth, pYear, pType, String(Number(pType))]
        );
        assert(Number(postedPayrollRows[0]?.count || 0) > 0, 'Payroll rows should be marked as posted to GL.');

        let duplicatePostingBlocked = false;
        try {
            await payrollGlPostingService.postMonthlyPayrollToGL({
                companyId,
                activityCode: pType,
                postingDate: new Date(`${pYear}-${String(pMonth).padStart(2, '0')}-28T00:00:00`),
                postedBy: financeUser.id,
                postedByUser: financeUser,
                connection
            });
        } catch (error) {
            duplicatePostingBlocked = error.statusCode === 409;
        }
        assert(duplicatePostingBlocked, 'Duplicate GL posting should be blocked.');

        const history = await payrollWorkflowService.getWorkflowHistory(step9.id, connection);
        assert(history.length >= 18, 'Workflow history should be written for each transition.');

        const invalidTransitions = [
            [payrollWorkflowService.WORKFLOW_STATUSES.PROCESSED, payrollWorkflowService.WORKFLOW_STATUSES.FINAL_APPROVED],
            [payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER, payrollWorkflowService.WORKFLOW_STATUSES.AUDITOR_ENDORSED],
            [payrollWorkflowService.WORKFLOW_STATUSES.MANAGER_ENDORSED, payrollWorkflowService.WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS],
            [payrollWorkflowService.WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS, payrollWorkflowService.WORKFLOW_STATUSES.PROCESSED]
        ];

        invalidTransitions.forEach(([fromStatus, toStatus]) => {
            let failed = false;
            try {
                payrollWorkflowService.validateTransition(fromStatus, toStatus);
            } catch (error) {
                failed = error.statusCode === 409;
            }
            assert(failed, `Transition ${fromStatus} -> ${toStatus} should be rejected.`);
        });

        const [payrollRows] = await connection.query(
            `
                SELECT PFNo, COALESCE(Ded1, 0) AS Ded1
                FROM tblpayroll
                WHERE (CompanyID = ? OR CompanyID IS NULL)
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                ORDER BY PFNo ASC
                LIMIT 1
            `,
            [companyId, pMonth, pYear, pType, String(Number(pType))]
        );
        assert(payrollRows.length > 0, 'A payroll row should be available for checksum verification.');

        const checksumBefore = await payrollWorkflowService.calculatePayrollSnapshot(companyId, pMonth, pYear, pType, connection);
        await connection.query(
            `
                UPDATE tblpayroll
                SET Ded1 = COALESCE(Ded1, 0) + 1
                WHERE PFNo = ?
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                  AND (CompanyID = ? OR CompanyID IS NULL)
                LIMIT 1
            `,
            [payrollRows[0].PFNo, pMonth, pYear, pType, String(Number(pType)), companyId]
        );
        const checksumAfter = await payrollWorkflowService.calculatePayrollSnapshot(companyId, pMonth, pYear, pType, connection);
        assert(checksumBefore.payrollChecksum !== checksumAfter.payrollChecksum, 'Checksum should change when payroll rows change.');
        await connection.query(
            `
                UPDATE tblpayroll
                SET Ded1 = ?
                WHERE PFNo = ?
                  AND PMonth = ?
                  AND PYear = ?
                  AND (PType = ? OR PType = ?)
                  AND (CompanyID = ? OR CompanyID IS NULL)
                LIMIT 1
            `,
            [payrollRows[0].Ded1, payrollRows[0].PFNo, pMonth, pYear, pType, String(Number(pType)), companyId]
        );

        await connection.rollback();

        const rollbackMonth = 12;
        const rollbackYear = 2099;
        const rollbackType = '99';

        await cleanupCommittedRollbackTest(companyId, rollbackMonth, rollbackYear, rollbackType);

        const rollbackBatch = await payrollWorkflowService.createWorkflowBatch({
            companyId,
            pMonth: rollbackMonth,
            pYear: rollbackYear,
            pType: rollbackType,
            status: payrollWorkflowService.WORKFLOW_STATUSES.DRAFT,
            snapshot: {
                totalStaff: 0,
                totalBasic: 0,
                totalAllowances: 0,
                totalGross: 0,
                totalTaxable: 0,
                totalTax: 0,
                totalNassitEmployee: 0,
                totalNassitEmployer: 0,
                totalDeductions: 0,
                totalNet: 0,
                payrollRowCount: 0,
                payrollChecksum: 'test'
            }
        });

        let rollbackFailureCaught = false;
        try {
            await payrollWorkflowService.transitionWorkflow({
                companyId,
                pMonth: rollbackMonth,
                pYear: rollbackYear,
                pType: rollbackType,
                action: payrollWorkflowService.WORKFLOW_ACTIONS.PROCESS_PAYROLL,
                user: financeUser,
                testHooks: {
                    afterStatusUpdate: async () => {
                        throw new Error('Simulated transition failure');
                    }
                }
            });
        } catch (error) {
            rollbackFailureCaught = true;
        }
        assert(rollbackFailureCaught, 'Simulated transition failure should be thrown.');
        const rollbackVerificationConnection = await pool.getConnection();
        try {
            const rollbackActionCount = await countActions(rollbackVerificationConnection, rollbackBatch.id);
            const rollbackBatchReloaded = await payrollWorkflowService.getWorkflowBatch(companyId, rollbackMonth, rollbackYear, rollbackType, rollbackVerificationConnection);
            assert(rollbackActionCount === 0, 'Failed transition should not leave workflow actions behind.');
            assert(rollbackBatchReloaded.Status === payrollWorkflowService.WORKFLOW_STATUSES.DRAFT, 'Failed transition should rollback batch status.');
        } finally {
            rollbackVerificationConnection.release();
            await cleanupCommittedRollbackTest(companyId, rollbackMonth, rollbackYear, rollbackType);
        }

        console.log('Payroll workflow foundation verification passed.');
        console.log(JSON.stringify({
            candidateBatch: {
                sourceCompanyId: Number(sourceBatch.CompanyID) || 1,
                sourceMonth: Number(sourceBatch.PMonth),
                sourceYear: Number(sourceBatch.PYear),
                sourceType: String(sourceBatch.PType),
                testCompanyId: companyId,
                testMonth: pMonth,
                testYear: pYear,
                testType: pType
            },
            testedTransitions: history.length,
            checksumVerified: true,
            rollbackVerified: true
        }, null, 2));
    } finally {
        if (temporaryBatch) {
            await cleanupTemporaryPayrollBatch(
                connection,
                temporaryBatch.companyId,
                temporaryBatch.pMonth,
                temporaryBatch.pYear,
                temporaryBatch.pType
            );
        }
        connection.release();
    }
}

run()
    .then(async () => {
        await pool.end();
    })
    .catch(async (error) => {
        console.error('Payroll workflow foundation verification failed.');
        console.error(error);
        await pool.end();
        process.exit(1);
    });
