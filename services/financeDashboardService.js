const pool = require('../config/db');
const payrollWorkflowService = require('./payrollWorkflowService');

function resolveCompanyId(companyId) {
    return Number(companyId) || 1;
}

function formatPeriod(month, year, pType) {
    if (!month || !year) {
        return 'No payroll batch yet';
    }

    const monthName = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric'
    });

    return pType ? `${monthName} · ${String(pType).trim()}` : monthName;
}

async function getCompanyInfo(companyId) {
    const [rows] = await pool.query(
        `
            SELECT CompanyID, Com_Name, Address, LogoPath
            FROM tblcominfo
            WHERE (CompanyID = ? OR CompanyID IS NULL)
            LIMIT 1
        `,
        [companyId]
    );

    return rows[0] || { CompanyID: companyId, Com_Name: 'Human Resource Payroll', Address: '', LogoPath: null };
}

async function getStatusCounts(companyId) {
    const [rows] = await pool.query(
        `
            SELECT Status, COUNT(*) AS TotalRows
            FROM payroll_workflow_batches
            WHERE CompanyID = ?
            GROUP BY Status
        `,
        [companyId]
    );

    return rows.reduce((accumulator, row) => {
        accumulator[row.Status] = Number(row.TotalRows || 0);
        return accumulator;
    }, {});
}

async function getLatestWorkflowBatch(companyId) {
    const [rows] = await pool.query(
        `
            SELECT *
            FROM payroll_workflow_batches
            WHERE CompanyID = ?
            ORDER BY PYear DESC, PMonth DESC, PType DESC, UpdatedAt DESC, id DESC
            LIMIT 1
        `,
        [companyId]
    );

    return rows[0] || null;
}

async function getLatestPayrollPeriod(companyId) {
    const [exactRows] = await pool.query(
        `
            SELECT PMonth, PYear, TRIM(PType) AS PType
            FROM tblpayroll
            WHERE CompanyID = ?
            ORDER BY PYear DESC, PMonth DESC, TRIM(PType) DESC
            LIMIT 1
        `,
        [companyId]
    );

    if (exactRows.length) {
        return {
            companyId,
            pMonth: Number(exactRows[0].PMonth),
            pYear: Number(exactRows[0].PYear),
            pType: String(exactRows[0].PType || '').trim()
        };
    }

    const [fallbackRows] = await pool.query(
        `
            SELECT PMonth, PYear, TRIM(PType) AS PType
            FROM tblpayroll
            WHERE CompanyID IS NULL
            ORDER BY PYear DESC, PMonth DESC, TRIM(PType) DESC
            LIMIT 1
        `
    );

    if (!fallbackRows.length) {
        return null;
    }

    return {
        companyId,
        pMonth: Number(fallbackRows[0].PMonth),
        pYear: Number(fallbackRows[0].PYear),
        pType: String(fallbackRows[0].PType || '').trim()
    };
}

async function getLatestPayrollSnapshot(companyId) {
    const latestWorkflowBatch = await getLatestWorkflowBatch(companyId);
    if (latestWorkflowBatch) {
        return {
            source: 'workflow',
            pMonth: Number(latestWorkflowBatch.PMonth),
            pYear: Number(latestWorkflowBatch.PYear),
            pType: String(latestWorkflowBatch.PType || '').trim(),
            totalStaff: Number(latestWorkflowBatch.TotalStaff || 0),
            totalGross: Number(latestWorkflowBatch.TotalGross || 0),
            totalNet: Number(latestWorkflowBatch.TotalNet || 0),
            status: latestWorkflowBatch.Status
        };
    }

    const latestPayrollPeriod = await getLatestPayrollPeriod(companyId);
    if (!latestPayrollPeriod) {
        return null;
    }

    const snapshot = await payrollWorkflowService.calculatePayrollSnapshot(
        latestPayrollPeriod.companyId,
        latestPayrollPeriod.pMonth,
        latestPayrollPeriod.pYear,
        latestPayrollPeriod.pType
    );

    return {
        source: 'tblpayroll',
        pMonth: latestPayrollPeriod.pMonth,
        pYear: latestPayrollPeriod.pYear,
        pType: latestPayrollPeriod.pType,
        totalStaff: snapshot.totalStaff,
        totalGross: snapshot.totalGross,
        totalNet: snapshot.totalNet,
        status: null
    };
}

async function getRecentWorkflowBatches(companyId) {
    const [rows] = await pool.query(
        `
            SELECT
                id,
                PMonth,
                PYear,
                PType,
                Status,
                TotalStaff,
                TotalGross,
                TotalNet,
                UpdatedAt
            FROM payroll_workflow_batches
            WHERE CompanyID = ?
            ORDER BY PYear DESC, PMonth DESC, PType DESC, UpdatedAt DESC, id DESC
            LIMIT 8
        `,
        [companyId]
    );

    return rows;
}

async function getFinanceDashboardData({ companyId }) {
    const resolvedCompanyId = resolveCompanyId(companyId);
    const [company, statusCounts, latestSnapshot, recentBatches] = await Promise.all([
        getCompanyInfo(resolvedCompanyId),
        getStatusCounts(resolvedCompanyId),
        getLatestPayrollSnapshot(resolvedCompanyId),
        getRecentWorkflowBatches(resolvedCompanyId)
    ]);

    const processedCount = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
    const awaitingSubmission = Number(statusCounts.PROCESSED || 0);
    const underManagerReview = Number(statusCounts.SUBMITTED_TO_MANAGER || 0);
    const underAuditorReview = Number(statusCounts.SUBMITTED_TO_AUDITOR || 0);
    const awaitingFinalApproval = Number(statusCounts.SUBMITTED_TO_ENTITY_HEAD || 0);
    const returnedForCorrection = Number(statusCounts.RETURNED_BY_MANAGER || 0);
    const returnedAfterAuditReview = Number(statusCounts.RETURNED_BY_AUDITOR || 0);
    const rejectedCorrectionRequired = Number(statusCounts.FINAL_REJECTED || 0);
    const correctionInProgress = Number(statusCounts.CORRECTION_IN_PROGRESS || 0);
    const returnedCount = returnedForCorrection + returnedAfterAuditReview;
    const readyForPosting = Number(statusCounts.FINAL_APPROVED || 0);
    const alreadyPosted = Number(statusCounts.POSTED_TO_ACCOUNTS || 0);

    return {
        company,
        cards: {
            currentPayrollMonth: formatPeriod(latestSnapshot?.pMonth, latestSnapshot?.pYear, latestSnapshot?.pType),
            processedBatches: processedCount,
            awaitingSubmission,
            underManagerReview,
            underAuditorReview,
            awaitingFinalApproval,
            returnedBatches: returnedCount,
            returnedForCorrection,
            returnedAfterAuditReview,
            rejectedCorrectionRequired,
            correctionInProgress,
            readyForPosting,
            alreadyPosted,
            totalStaffInLatestPayroll: Number(latestSnapshot?.totalStaff || 0),
            latestGrossPayroll: Number(latestSnapshot?.totalGross || 0),
            latestNetPayroll: Number(latestSnapshot?.totalNet || 0)
        },
        latestSnapshot,
        recentBatches
    };
}

module.exports = {
    getFinanceDashboardData
};
