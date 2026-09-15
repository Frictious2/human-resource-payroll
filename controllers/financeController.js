const financeDashboardService = require('../services/financeDashboardService');
const loansMedicalPagesService = require('../services/loansMedicalPagesService');
const payrollWorkflowService = require('../services/payrollWorkflowService');
const workflowNotificationService = require('../services/workflowNotificationService');
const workQueueService = require('../services/workQueueService');
const payrollReversalService = require('../services/payrollReversalService');
const payrollReopenService = require('../services/payrollReopenService');
const { getWorkspaceContext } = require('../utils/workspaceContext');

const EMPTY_DASHBOARD_CARDS = Object.freeze({
    currentPayrollMonth: 'No payroll batch yet',
    processedBatches: 0,
    awaitingSubmission: 0,
    underManagerReview: 0,
    underAuditorReview: 0,
    awaitingFinalApproval: 0,
    returnedForCorrection: 0,
    returnedAfterAuditReview: 0,
    rejectedCorrectionRequired: 0,
    correctionInProgress: 0,
    readyForPosting: 0,
    alreadyPosted: 0,
    totalStaffInLatestPayroll: 0,
    latestGrossPayroll: 0,
    latestNetPayroll: 0
});

function getCompanyId(req) {
    return req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1;
}

function getViewUser(req) {
    return req.session?.user || req.user || { name: 'Finance Officer', role: 'finance-officer' };
}

function getWorkflowPath(batchId = null) {
    return batchId ? `/finance/payroll/workflow/${batchId}` : '/finance/payroll/workflow';
}

function getCommonViewData(req) {
    const workspace = getWorkspaceContext(req, 'finance-officer');
    return {
        user: getViewUser(req),
        partialsBase: workspace.partialsBase,
        dashboardPath: workspace.dashboardPath,
        workspaceLabel: workspace.workspaceLabel
    };
}

function getStatusBadgeClass(status) {
    const badgeMap = {
        CORRECTION_IN_PROGRESS: 'bg-warning text-dark',
        PROCESSED: 'bg-primary-subtle text-primary border border-primary-subtle',
        SUBMITTED_TO_MANAGER: 'bg-info-subtle text-info-emphasis border border-info-subtle',
        MANAGER_ENDORSED: 'bg-info-subtle text-info-emphasis border border-info-subtle',
        RETURNED_BY_MANAGER: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        SUBMITTED_TO_AUDITOR: 'bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle',
        AUDITOR_ENDORSED: 'bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle',
        RETURNED_BY_AUDITOR: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        SUBMITTED_TO_ENTITY_HEAD: 'bg-dark-subtle text-dark-emphasis border border-dark-subtle',
        FINAL_APPROVED: 'bg-success-subtle text-success-emphasis border border-success-subtle',
        FINAL_REJECTED: 'bg-danger-subtle text-danger-emphasis border border-danger-subtle',
        POSTED_TO_ACCOUNTS: 'bg-success text-white',
        REVERSED: 'bg-danger text-white'
    };

    return badgeMap[status] || 'bg-light text-dark border';
}

function sanitizeQueryMessage(value) {
    return value ? String(value).trim() : '';
}

async function getDashboard(req, res) {
    try {
        const companyId = getCompanyId(req);
        const viewUser = getViewUser(req);
        const [pageData, unreadNotifications, workQueueData, reversalCounts, reopenCounts] = await Promise.all([
            financeDashboardService.getFinanceDashboardData({ companyId }),
            workflowNotificationService.getUnreadCount(viewUser.id || 0, companyId),
            workQueueService.getRoleWorkQueue({ companyId, user: viewUser, filters: {} }),
            payrollReversalService.getRoleDashboardSummary(companyId),
            payrollReopenService.getRoleDashboardSummary(companyId)
        ]);

        res.render('finance/dashboard', {
            title: 'Finance Dashboard',
            path: '/finance/dashboard',
            error: null,
            company: pageData.company,
            cards: pageData.cards,
            reversalCounts,
            reopenCounts,
            latestSnapshot: pageData.latestSnapshot,
            recentBatches: pageData.recentBatches,
            unreadNotifications,
            workQueueSummary: workQueueData.summary,
            getStatusBadgeClass,
            ...getCommonViewData(req)
        });
    } catch (error) {
        console.error('Finance dashboard error:', error);
        res.render('finance/dashboard', {
            title: 'Finance Dashboard',
            path: '/finance/dashboard',
            error: 'Failed to load finance dashboard data.',
            company: {},
            cards: { ...EMPTY_DASHBOARD_CARDS },
            reversalCounts: {},
            reopenCounts: {},
            latestSnapshot: null,
            recentBatches: [],
            unreadNotifications: 0,
            workQueueSummary: { totalActionable: 0, payroll: 0, reversals: 0, records: 0, byStatus: {} },
            getStatusBadgeClass,
            ...getCommonViewData(req)
        });
    }
}

async function getWorkflowList(req, res) {
    try {
        const companyId = getCompanyId(req);
        const filters = {
            status: req.query.status || '',
            month: req.query.month || '',
            year: req.query.year || '',
            pType: req.query.pType || ''
        };

        const batches = await payrollWorkflowService.listWorkflowBatches(companyId, filters);

        res.render('finance/payroll-workflow/index', {
            title: 'Payroll Workflow',
            path: '/finance/payroll/workflow',
            batches,
            filters,
            statusOptions: Object.values(payrollWorkflowService.WORKFLOW_STATUSES),
            successMessage: sanitizeQueryMessage(req.query.success),
            errorMessage: sanitizeQueryMessage(req.query.error),
            getStatusBadgeClass,
            ...getCommonViewData(req)
        });
    } catch (error) {
        console.error('Finance workflow list error:', error);
        res.status(error.statusCode || 500).render('finance/payroll-workflow/index', {
            title: 'Payroll Workflow',
            path: '/finance/payroll/workflow',
            batches: [],
            filters: {
                status: req.query.status || '',
                month: req.query.month || '',
                year: req.query.year || '',
                pType: req.query.pType || ''
            },
            statusOptions: Object.values(payrollWorkflowService.WORKFLOW_STATUSES),
            successMessage: '',
            errorMessage: error.message || 'Failed to load payroll workflow batches.',
            getStatusBadgeClass,
            ...getCommonViewData(req)
        });
    }
}

async function getWorkflowDetail(req, res) {
    try {
        const detail = await payrollWorkflowService.getWorkflowBatchDetail(getCompanyId(req), req.params.batchId);
        const canSubmitToManager = detail.batch.Status === payrollWorkflowService.WORKFLOW_STATUSES.PROCESSED;
        const correctionStatuses = new Set([
            payrollWorkflowService.WORKFLOW_STATUSES.RETURNED_BY_MANAGER,
            payrollWorkflowService.WORKFLOW_STATUSES.RETURNED_BY_AUDITOR,
            payrollWorkflowService.WORKFLOW_STATUSES.FINAL_REJECTED
        ]);
        const canStartCorrection = correctionStatuses.has(detail.batch.Status);
        const correctionProcessUrl = `/finance/payroll/process-emoluments?activityCode=${encodeURIComponent(detail.batch.PType)}&payrollDate=${detail.batch.PYear}-${String(detail.batch.PMonth).padStart(2, '0')}-01&batchId=${detail.batch.id}&correction=1`;

        res.render('finance/payroll-workflow/detail', {
            title: 'Payroll Workflow Detail',
            path: getWorkflowPath(req.params.batchId),
            batch: detail.batch,
            payrollRows: detail.payrollRows,
            history: detail.history,
            canSubmitToManager,
            canStartCorrection,
            correctionProcessUrl,
            successMessage: sanitizeQueryMessage(req.query.success),
            errorMessage: sanitizeQueryMessage(req.query.error),
            getStatusBadgeClass,
            ...getCommonViewData(req)
        });
    } catch (error) {
        console.error('Finance workflow detail error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load payroll workflow detail.');
    }
}

async function submitToManager(req, res) {
    const companyId = getCompanyId(req);
    const user = getViewUser(req);

    try {
        const batch = await payrollWorkflowService.getWorkflowBatchById(companyId, req.params.batchId);
        if (!batch) {
            return res.redirect(`${getWorkflowPath()}?error=${encodeURIComponent('No workflow batch was found for the selected payroll period.')}`);
        }

        await payrollWorkflowService.transitionWorkflow({
            companyId,
            pMonth: batch.PMonth,
            pYear: batch.PYear,
            pType: batch.PType,
            action: payrollWorkflowService.WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER,
            user,
            comments: 'Submitted to Manager for review.'
        });

        return res.redirect(`${getWorkflowPath(batch.id)}?success=${encodeURIComponent('Payroll submitted to the Manager successfully.')}`);
    } catch (error) {
        console.error('Submit payroll to manager error:', error);
        const targetPath = req.params.batchId ? getWorkflowPath(req.params.batchId) : getWorkflowPath();
        return res.redirect(`${targetPath}?error=${encodeURIComponent(error.message || 'Failed to submit payroll to the Manager.')}`);
    }
}

async function startCorrection(req, res) {
    const companyId = getCompanyId(req);
    const user = getViewUser(req);
    const targetPath = req.params.batchId ? getWorkflowPath(req.params.batchId) : getWorkflowPath();

    try {
        const batch = await payrollWorkflowService.getWorkflowBatchById(companyId, req.params.batchId);
        if (!batch) {
            return res.redirect(`${getWorkflowPath()}?error=${encodeURIComponent('No workflow batch was found for the selected payroll period.')}`);
        }

        const comments = String(req.body.comments || '').trim();
        if (!comments) {
            return res.redirect(`${targetPath}?error=${encodeURIComponent('Please provide a reason for starting payroll correction.')}`);
        }

        await payrollWorkflowService.startPayrollCorrection({
            companyId,
            batchId: batch.id,
            user,
            comments,
            metadata: {
                source: 'finance-workflow-detail'
            }
        });

        return res.redirect(`${getWorkflowPath(batch.id)}?success=${encodeURIComponent('Payroll correction has started.')}`);
    } catch (error) {
        console.error('Start payroll correction error:', error);
        return res.redirect(`${targetPath}?error=${encodeURIComponent(error.message || 'Failed to start payroll correction.')}`);
    }
}

async function getFinancialDeductions(req, res) {
    try {
        const companyId = getCompanyId(req);
        const pageData = await loansMedicalPagesService.getFinanceFinancialDeductionsData({
            companyId,
            payrollDate: req.query.payrollDate || ''
        });

        res.render('finance/reports/financial_deductions', {
            title: 'Financial Deductions',
            path: '/finance/reports/financial-deductions',
            pageData,
            filters: {
                payrollDate: req.query.payrollDate || pageData.payrollDate
            },
            ...getCommonViewData(req)
        });
    } catch (error) {
        console.error('Finance financial deductions report error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load financial deduction visibility.');
    }
}

module.exports = {
    getDashboard,
    getFinancialDeductions,
    getWorkflowDetail,
    getWorkflowList,
    submitToManager,
    startCorrection
};
