const pool = require('../config/db');
const recordWorkflowService = require('../services/recordWorkflowService');
const payrollValidationService = require('../services/payrollValidationService');
const loansMedicalPagesService = require('../services/loansMedicalPagesService');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function buildDateParts() {
    const now = new Date();
    const isoDate = now.toISOString().slice(0, 10);
    const isoDateTime = `${isoDate} 10:15:${String(now.getUTCSeconds()).padStart(2, '0')}`;
    return {
        isoDate,
        isoDateTime,
        month: now.getUTCMonth() + 1,
        year: now.getUTCFullYear()
    };
}

async function findRoleUser(connection, roleLabels) {
    const lowerRoleLabels = roleLabels.map((entry) => entry.toLowerCase());
    const [rows] = await connection.query(
        `
            SELECT PFNo, Username, FullName, Email, Level, CompanyID
            FROM tblpassword
            WHERE LOWER(COALESCE(Level, '')) IN (${lowerRoleLabels.map(() => '?').join(', ')})
            ORDER BY PFNo ASC
            LIMIT 1
        `,
        lowerRoleLabels
    );

    assert(rows.length > 0, `No user found for roles: ${roleLabels.join(', ')}`);
    const row = rows[0];
    return {
        id: Number(row.PFNo),
        pfno: row.PFNo,
        name: row.FullName || row.Username || `User ${row.PFNo}`,
        email: row.Email || '',
        role: lowerRoleLabels[0].includes('entity') ? 'entity-head' : lowerRoleLabels[0].includes('manager') ? 'manager' : lowerRoleLabels[0].includes('finance') ? 'finance-officer' : 'data-entry',
        level: row.Level,
        companyId: Number(row.CompanyID || 1)
    };
}

async function findActiveStaff(connection, companyId) {
    const [rows] = await connection.query(
        `
            SELECT PFNo, SName
            FROM tblstaff
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(EmpStatus, '01') = '01'
            ORDER BY PFNo ASC
            LIMIT 1
        `,
        [companyId]
    );

    assert(rows.length > 0, 'No active staff found for Phase 12 test.');
    return rows[0];
}

async function countNotifications(connection, referenceId) {
    const [rows] = await connection.query(
        'SELECT COUNT(*) AS total FROM workflow_notifications WHERE ReferenceID = ?',
        [referenceId]
    );
    return Number(rows[0]?.total || 0);
}

async function cleanupArtifacts(connection, artifacts) {
    for (const repayId of artifacts.loanRepaymentIds) {
        await connection.query('DELETE FROM record_workflow_actions WHERE RecordReference = ? AND Module = ?', [String(repayId), 'loan-repayment']);
        await connection.query('DELETE FROM record_workflow_items WHERE RecordReference = ? AND Module = ?', [String(repayId), 'loan-repayment']);
        await connection.query('DELETE FROM tblloanrepayment WHERE RepayID = ?', [repayId]);
    }

    for (const transNo of artifacts.medicalTransNos) {
        await connection.query('DELETE FROM record_workflow_actions WHERE RecordReference = ? AND Module = ?', [String(transNo), 'medical']);
        await connection.query('DELETE FROM record_workflow_items WHERE RecordReference = ? AND Module = ?', [String(transNo), 'medical']);
        await connection.query('DELETE FROM tblmedical WHERE TransNo = ?', [transNo]);
    }

    for (const ref of artifacts.surchargeReferences) {
        await connection.query('DELETE FROM record_workflow_actions WHERE RecordReference = ? AND Module = ?', [ref, 'surcharge']);
        await connection.query('DELETE FROM record_workflow_items WHERE RecordReference = ? AND Module = ?', [ref, 'surcharge']);
    }

    for (const surcharge of artifacts.surcharges) {
        await connection.query(
            `
                DELETE FROM tblsurcharge
                WHERE PFNo = ?
                  AND SType = ?
                  AND DATE(COALESCE(EntryDate, '1900-01-01')) = DATE(?)
                  AND DATE(COALESCE(StarDate, '1900-01-01')) = DATE(?)
            `,
            [surcharge.pfNo, surcharge.sType, surcharge.entryDate, surcharge.startDate]
        );
    }

    for (const ref of artifacts.loanReferences) {
        await connection.query('DELETE FROM record_workflow_actions WHERE RecordReference = ? AND Module = ?', [ref, 'loan']);
        await connection.query('DELETE FROM record_workflow_items WHERE RecordReference = ? AND Module = ?', [ref, 'loan']);
    }

    for (const transNo of artifacts.loanTransNos) {
        await connection.query('DELETE FROM tblloan WHERE TransNo = ?', [transNo]);
    }
}

async function run() {
    await recordWorkflowService.ensureWorkflowTables();
    const connection = await pool.getConnection();
    const artifacts = {
        loanTransNos: [],
        loanReferences: [],
        loanRepaymentIds: [],
        medicalTransNos: [],
        surchargeReferences: [],
        surcharges: []
    };

    try {
        const companyId = 1;
        const dataEntryUser = await findRoleUser(connection, ['data entry', 'user', 'finance officer']);
        const managerUser = await findRoleUser(connection, ['manager']);
        const entityHeadUser = await findRoleUser(connection, ['entity head']);
        const staff = await findActiveStaff(connection, companyId);
        const { isoDate, isoDateTime, month, year } = buildDateParts();

        await cleanupArtifacts(connection, artifacts);

        const loanResult = await loansMedicalPagesService.saveLoanDraft({
            companyId,
            user: dataEntryUser,
            payload: {
                entryDate: isoDateTime,
                pfno: staff.PFNo,
                lTypeCode: '01',
                lTrans: '01',
                amount: 2400,
                duration: 6,
                monthlyRepayment: 400,
                interest: 96,
                monthlyInt: 16,
                startDate: isoDate,
                surcharge: 'No'
            }
        });
        artifacts.loanTransNos.push(loanResult.transNo);
        artifacts.loanReferences.push(loanResult.workflowReference);

        let loanItem = await recordWorkflowService.getWorkflowItemByReference(companyId, 'loan', loanResult.workflowReference, connection);
        assert(loanItem?.Status === 'DRAFT', 'Loan draft should start in DRAFT.');

        let activeLoans = await payrollValidationService.getActiveLoanDeductions(connection, { companyId, payrollDate: isoDate });
        assert(!activeLoans.some((row) => row.PFNo === staff.PFNo && Number(row.loan_deduction || 0) > 0), 'Unapproved loan should not be payroll-eligible.');

        await recordWorkflowService.submitRecord({ companyId, module: 'loan', workflowItemId: loanItem.id, user: dataEntryUser, connection });
        loanItem = await recordWorkflowService.getWorkflowItemById(companyId, loanItem.id, connection);
        assert(loanItem.Status === 'SUBMITTED_TO_MANAGER', 'Loan draft should submit to Manager.');

        await recordWorkflowService.managerEndorseRecord({ companyId, workflowItemId: loanItem.id, user: managerUser, comments: 'Loan reviewed.', connection });
        loanItem = await recordWorkflowService.getWorkflowItemById(companyId, loanItem.id, connection);
        assert(loanItem.Status === 'SUBMITTED_TO_ENTITY_HEAD', 'Loan should forward to Entity Head after Manager endorsement.');

        await recordWorkflowService.entityHeadApproveRecord({ companyId, workflowItemId: loanItem.id, user: entityHeadUser, comments: 'Approved for payroll.', connection });
        loanItem = await recordWorkflowService.getWorkflowItemById(companyId, loanItem.id, connection);
        assert(loanItem.Status === 'FINAL_APPROVED', 'Loan should reach FINAL_APPROVED.');

        activeLoans = await payrollValidationService.getActiveLoanDeductions(connection, { companyId, payrollDate: isoDate });
        assert(activeLoans.some((row) => row.PFNo === staff.PFNo && Number(row.loan_deduction || 0) >= 400), 'Final-approved loan should be payroll-eligible.');

        const loanNotificationCount = await countNotifications(connection, loanResult.workflowReference);
        assert(loanNotificationCount > 0, 'Loan workflow should create notifications.');

        const repaymentResult = await loansMedicalPagesService.saveLoanRepaymentDraft({
            companyId,
            user: dataEntryUser,
            payload: {
                transNo: loanResult.transNo,
                pfno: staff.PFNo,
                repaymentAmount: 150,
                repaymentDate: isoDate
            }
        });
        artifacts.loanRepaymentIds.push(repaymentResult.repayId);
        const repaymentReference = repaymentResult.workflowReference;
        let repaymentItem = await recordWorkflowService.getWorkflowItemByReference(companyId, 'loan-repayment', repaymentReference, connection);
        assert(repaymentItem?.Status === 'DRAFT', 'Loan repayment adjustment should start in DRAFT.');

        const [loanBeforeRepaymentRows] = await connection.query('SELECT LoanBal, RepaidAmount FROM tblloan WHERE TransNo = ?', [loanResult.transNo]);
        const loanBeforeRepayment = loanBeforeRepaymentRows[0];

        await recordWorkflowService.submitRecord({ companyId, module: 'loan-repayment', workflowItemId: repaymentItem.id, user: dataEntryUser, connection });
        await recordWorkflowService.managerEndorseRecord({ companyId, workflowItemId: repaymentItem.id, user: managerUser, comments: 'Repayment adjustment ok.', connection });
        await recordWorkflowService.entityHeadApproveRecord({ companyId, workflowItemId: repaymentItem.id, user: entityHeadUser, comments: 'Repayment approved.', connection });

        const [loanAfterRepaymentRows] = await connection.query('SELECT LoanBal, RepaidAmount FROM tblloan WHERE TransNo = ?', [loanResult.transNo]);
        const loanAfterRepayment = loanAfterRepaymentRows[0];
        assert(Number(loanAfterRepayment.RepaidAmount || 0) > Number(loanBeforeRepayment.RepaidAmount || 0), 'Final-approved repayment adjustment should increase repaid amount.');
        assert(Number(loanAfterRepayment.LoanBal || 0) < Number(loanBeforeRepayment.LoanBal || 0), 'Final-approved repayment adjustment should reduce loan balance.');

        const medicalResult = await loansMedicalPagesService.saveMedicalDraft({
            companyId,
            user: dataEntryUser,
            payload: {
                entryDate: isoDate,
                pfno: staff.PFNo,
                mCode: '01',
                amount: 125,
                dependant: 'Self',
                picturePath: null
            }
        });
        artifacts.medicalTransNos.push(medicalResult.transNo);
        let medicalItem = await recordWorkflowService.getWorkflowItemByReference(companyId, 'medical', medicalResult.workflowReference, connection);
        assert(medicalItem?.Status === 'DRAFT', 'Medical recovery should start in DRAFT.');

        let activeMedical = await payrollValidationService.getActiveMedicalDeductions(connection, {
            companyId,
            payrollDate: isoDate,
            payrollMonth: month,
            payrollYear: year
        });
        assert(!activeMedical.some((row) => row.PFNo === staff.PFNo && Number(row.medical_deduction || 0) >= 125), 'Draft medical recovery should not be payroll-eligible.');

        await recordWorkflowService.submitRecord({ companyId, module: 'medical', workflowItemId: medicalItem.id, user: dataEntryUser, connection });
        await recordWorkflowService.managerEndorseRecord({ companyId, workflowItemId: medicalItem.id, user: managerUser, comments: 'Medical checked.', connection });
        await recordWorkflowService.entityHeadApproveRecord({ companyId, workflowItemId: medicalItem.id, user: entityHeadUser, comments: 'Medical approved.', connection });

        activeMedical = await payrollValidationService.getActiveMedicalDeductions(connection, {
            companyId,
            payrollDate: isoDate,
            payrollMonth: month,
            payrollYear: year
        });
        assert(activeMedical.some((row) => row.PFNo === staff.PFNo && Number(row.medical_deduction || 0) >= 125), 'Final-approved medical recovery should be payroll-eligible.');

        const surchargePayload = {
            pfNo: staff.PFNo,
            entryDate: isoDateTime,
            sType: '02',
            amountCode: '01',
            sAmount: 75,
            duration: 2,
            startDate: isoDate,
            expDate: `${year}-${String(month).padStart(2, '0')}-28`,
            bank: 'TEST'
        };
        const surchargeResult = await loansMedicalPagesService.saveSurchargeDraft({
            companyId,
            user: dataEntryUser,
            payload: surchargePayload
        });
        artifacts.surchargeReferences.push(surchargeResult.workflowReference);
        artifacts.surcharges.push({ pfNo: surchargePayload.pfNo, sType: surchargePayload.sType, entryDate: surchargePayload.entryDate, startDate: surchargePayload.startDate });

        let surchargeItem = await recordWorkflowService.getWorkflowItemByReference(companyId, 'surcharge', surchargeResult.workflowReference, connection);
        assert(surchargeItem?.Status === 'DRAFT', 'Surcharge should start in DRAFT.');

        let activeSurcharges = await payrollValidationService.getActiveSurchargeDeductions(connection, { companyId, payrollDate: isoDate });
        assert(!activeSurcharges.some((row) => row.PFNo === staff.PFNo && Number(row.surcharge_deduction || 0) >= 75), 'Draft surcharge should not be payroll-eligible.');

        await recordWorkflowService.submitRecord({ companyId, module: 'surcharge', workflowItemId: surchargeItem.id, user: dataEntryUser, connection });
        surchargeItem = await recordWorkflowService.getWorkflowItemById(companyId, surchargeItem.id, connection);
        await recordWorkflowService.managerReturnRecord({ companyId, workflowItemId: surchargeItem.id, user: managerUser, comments: 'Adjust the surcharge reason.', connection });
        surchargeItem = await recordWorkflowService.getWorkflowItemById(companyId, surchargeItem.id, connection);
        assert(surchargeItem.Status === 'RETURNED_BY_MANAGER', 'Manager return should move surcharge to RETURNED_BY_MANAGER.');

        await loansMedicalPagesService.saveSurchargeDraft({
            companyId,
            user: dataEntryUser,
            payload: {
                ...surchargePayload,
                previousReference: surchargeResult.workflowReference,
                bank: 'TEST-UPDATED'
            }
        });
        surchargeItem = await recordWorkflowService.getWorkflowItemByReference(companyId, 'surcharge', surchargeResult.workflowReference, connection);
        assert(surchargeItem?.Status === 'DRAFT', 'Returned surcharge should go back to DRAFT after correction.');

        await recordWorkflowService.submitRecord({ companyId, module: 'surcharge', workflowItemId: surchargeItem.id, user: dataEntryUser, connection });
        await recordWorkflowService.managerEndorseRecord({ companyId, workflowItemId: surchargeItem.id, user: managerUser, comments: 'Surcharge reviewed.', connection });
        await recordWorkflowService.entityHeadApproveRecord({ companyId, workflowItemId: surchargeItem.id, user: entityHeadUser, comments: 'Surcharge approved.', connection });

        activeSurcharges = await payrollValidationService.getActiveSurchargeDeductions(connection, { companyId, payrollDate: isoDate });
        assert(activeSurcharges.some((row) => row.PFNo === staff.PFNo && Number(row.surcharge_deduction || 0) >= 75), 'Final-approved in-range surcharge should be payroll-eligible.');

        const futureYear = year + 1;
        const inactiveSurcharges = await payrollValidationService.getActiveSurchargeDeductions(connection, { companyId, payrollDate: `${futureYear}-01-01` });
        assert(!inactiveSurcharges.some((row) => row.PFNo === staff.PFNo && Number(row.surcharge_deduction || 0) >= 75), 'Expired or out-of-range surcharge should not remain payroll-eligible.');

        const financeVisibility = await loansMedicalPagesService.getFinanceFinancialDeductionsData({ companyId, payrollDate: isoDate });
        assert(financeVisibility.loans.some((row) => row.TransNo === loanResult.transNo), 'Finance visibility should include final-approved loan.');
        assert(financeVisibility.medical.some((row) => row.TransNo === medicalResult.transNo), 'Finance visibility should include final-approved medical recovery.');
        assert(financeVisibility.surcharges.some((row) => row.WorkflowRecordReference === surchargeResult.workflowReference), 'Finance visibility should include final-approved surcharge.');

        console.log('Phase 12 financial workflow verification passed.');
    } finally {
        try {
            await cleanupArtifacts(connection, artifacts);
        } finally {
            connection.release();
        }
    }
}

run().catch((error) => {
    console.error('Phase 12 financial workflow verification failed:', error);
    process.exit(1);
}).finally(async () => {
    try {
        await pool.end();
    } catch (error) {
        console.error('Pool shutdown warning:', error.message);
    }
});
