const financeManagerDashboardService = require('../services/financeManagerDashboardService');
const payrollGlPostingService = require('../services/payrollGlPostingService');
const payrollWorkflowService = require('../services/payrollWorkflowService');
const payrollReversalService = require('../services/payrollReversalService');
const payrollReopenService = require('../services/payrollReopenService');
const { getWorkspaceContext } = require('../utils/workspaceContext');

function getCompanyId(req) {
    const companyId = Number(req.user?.companyId);
    if (!Number.isSafeInteger(companyId) || companyId < 1) throw Object.assign(new Error('Company scope is required.'), { status: 403 });
    return companyId;
}

function getViewUser(req) {
    return req.session?.user || req.user || { name: 'Finance Manager', role: 'finance-manager' };
}

function getCommonViewData(req) {
    const workspace = getWorkspaceContext(req, 'finance-manager');
    return {
        user: getViewUser(req),
        partialsBase: workspace.partialsBase,
        dashboardPath: workspace.dashboardPath,
        workspaceLabel: workspace.workspaceLabel
    };
}

function sanitizeQueryMessage(value) {
    return value ? String(value).trim() : '';
}

function getStatusBadgeClass(status) {
    const badgeMap = {
        CORRECTION_IN_PROGRESS: 'bg-warning text-dark',
        PROCESSED: 'bg-primary-subtle text-primary-emphasis border border-primary-subtle',
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

function buildWorkflowTracker(status) {
    const stages = [
        { key: 'PROCESSED', label: 'Processed' },
        { key: 'SUBMITTED_TO_MANAGER', label: 'Manager Review' },
        { key: 'SUBMITTED_TO_AUDITOR', label: 'Auditor Review' },
        { key: 'SUBMITTED_TO_ENTITY_HEAD', label: 'Entity Head Approval' },
        { key: 'FINAL_APPROVED', label: 'Approved' },
        { key: 'POSTED_TO_ACCOUNTS', label: 'Posted' }
    ];

    const currentIndex = stages.findIndex((item) => item.key === status);
    return stages.map((stage, index) => ({
        ...stage,
        current: currentIndex === index,
        completed: currentIndex > index || status === 'REVERSED',
        pending: currentIndex !== -1 ? currentIndex < index : true
    }));
}

function getWorkflowStatusBadgeClass(status) {
    const badgeMap = {
        CORRECTION_IN_PROGRESS: 'bg-warning text-dark',
        PROCESSED: 'bg-primary-subtle text-primary-emphasis border border-primary-subtle',
        SUBMITTED_TO_MANAGER: 'bg-info-subtle text-info-emphasis border border-info-subtle',
        SUBMITTED_TO_AUDITOR: 'bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle',
        SUBMITTED_TO_ENTITY_HEAD: 'bg-dark-subtle text-dark-emphasis border border-dark-subtle',
        FINAL_APPROVED: 'bg-success-subtle text-success-emphasis border border-success-subtle',
        FINAL_REJECTED: 'bg-danger-subtle text-danger-emphasis border border-danger-subtle',
        RETURNED_BY_MANAGER: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        RETURNED_BY_AUDITOR: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        POSTED_TO_ACCOUNTS: 'bg-success text-white',
        REVERSED: 'bg-danger text-white'
    };

    return badgeMap[status] || 'bg-light text-dark border';
}

async function getDashboard(req, res) {
    try {
        const pageData = await financeManagerDashboardService.getFinanceManagerDashboardData({
            companyId: getCompanyId(req)
        });

        res.render('finance_manager/dashboard', {
            title: 'Finance Manager Dashboard',
            path: '/finance-manager/dashboard',
            pageData,
            getStatusBadgeClass,
            ...getCommonViewData(req)
        });
    } catch (error) {
        console.error('Finance Manager dashboard error:', error);
        res.status(error.statusCode || 500).render('finance_manager/dashboard', {
            title: 'Finance Manager Dashboard',
            path: '/finance-manager/dashboard',
            pageData: {
                company: {},
                cards: {},
                latestSnapshot: null,
                latestBatch: null,
                latestActiveBatch: null,
                recentBatches: [],
                yearlyOverview: [],
                yearlyPaymentYear: new Date().getFullYear(),
                reversalCounts: {},
                reopenCounts: {}
            },
            errorMessage: error.message || 'Failed to load Finance Manager dashboard data.',
            getStatusBadgeClass,
            ...getCommonViewData(req)
        });
    }
}

async function getPayrollWorkflowList(req, res) {
    try {
        const filters = {
            status: req.query.status || '',
            month: req.query.month || '',
            year: req.query.year || '',
            pType: req.query.pType || ''
        };
        const batches = await payrollWorkflowService.listWorkflowBatches(getCompanyId(req), filters);

        res.render('finance_manager/payroll_workflow_index', {
            title: 'Payroll Batches',
            path: '/finance-manager/payroll/workflow',
            batches,
            filters,
            statusOptions: Object.values(payrollWorkflowService.WORKFLOW_STATUSES),
            getStatusBadgeClass,
            ...getCommonViewData(req)
        });
    } catch (error) {
        console.error('Finance Manager payroll workflow list error:', error);
        res.status(error.statusCode || 500).render('finance_manager/payroll_workflow_index', {
            title: 'Payroll Batches',
            path: '/finance-manager/payroll/workflow',
            batches: [],
            filters: {
                status: req.query.status || '',
                month: req.query.month || '',
                year: req.query.year || '',
                pType: req.query.pType || ''
            },
            statusOptions: Object.values(payrollWorkflowService.WORKFLOW_STATUSES),
            errorMessage: error.message || 'Failed to load payroll batches.',
            getStatusBadgeClass,
            ...getCommonViewData(req)
        });
    }
}

async function getPayrollWorkflowDetail(req, res) {
    try {
        const companyId = getCompanyId(req);
        const detail = await payrollWorkflowService.getWorkflowBatchDetail(companyId, req.params.batchId);
        const generationHistory = await payrollWorkflowService.listWorkflowBatches(companyId, {
            month: detail.batch.PMonth,
            year: detail.batch.PYear,
            pType: detail.batch.PType
        });
        const relatedReversals = await payrollReversalService.listReversalRequests({
            companyId,
            role: 'finance-officer',
            filters: {
                month: detail.batch.PMonth,
                year: detail.batch.PYear,
                pType: detail.batch.PType
            }
        });
        const relatedReopens = await payrollReopenService.listReopenRequests(companyId, 'finance-officer', {
            month: detail.batch.PMonth,
            year: detail.batch.PYear,
            pType: detail.batch.PType
        });

        res.render('finance_manager/payroll_workflow_detail', {
            title: 'Payroll Batch Detail',
            path: `/finance-manager/payroll/workflow/${req.params.batchId}`,
            batch: detail.batch,
            payrollRows: detail.payrollRows,
            history: detail.history,
            generationHistory,
            relatedReversals,
            relatedReopens,
            workflowTracker: buildWorkflowTracker(detail.batch.Status),
            successMessage: sanitizeQueryMessage(req.query.success),
            errorMessage: sanitizeQueryMessage(req.query.error),
            getStatusBadgeClass,
            ...getCommonViewData(req)
        });
    } catch (error) {
        console.error('Finance Manager payroll workflow detail error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load payroll batch detail.');
    }
}

async function getReversalList(req, res) {
    try {
        const rows = await payrollReversalService.listReversalRequests({
            companyId: getCompanyId(req),
            role: 'finance-officer',
            filters: {
                status: req.query.status || '',
                month: req.query.month || '',
                year: req.query.year || '',
                pType: req.query.pType || ''
            }
        });

        res.render('finance_manager/payroll_reversals_index', {
            title: 'Payroll Reversals',
            path: '/finance-manager/payroll/reversals',
            rows,
            filters: {
                status: req.query.status || '',
                month: req.query.month || '',
                year: req.query.year || '',
                pType: req.query.pType || ''
            },
            statusOptions: Object.values(payrollReversalService.REVERSAL_STATUSES),
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass,
            ...getCommonViewData(req)
        });
    } catch (error) {
        console.error('Finance Manager reversal list error:', error);
        res.status(error.statusCode || 500).render('finance_manager/payroll_reversals_index', {
            title: 'Payroll Reversals',
            path: '/finance-manager/payroll/reversals',
            rows: [],
            filters: {
                status: req.query.status || '',
                month: req.query.month || '',
                year: req.query.year || '',
                pType: req.query.pType || ''
            },
            statusOptions: Object.values(payrollReversalService.REVERSAL_STATUSES),
            errorMessage: error.message || 'Failed to load reversal requests.',
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass,
            ...getCommonViewData(req)
        });
    }
}

async function getReversalDetail(req, res) {
    try {
        const detail = await payrollReversalService.getReversalRequestDetail({
            companyId: getCompanyId(req),
            requestId: req.params.requestId
        });

        res.render('finance_manager/payroll_reversals_detail', {
            title: 'Payroll Reversal Detail',
            path: `/finance-manager/payroll/reversals/${req.params.requestId}`,
            detail,
            successMessage: sanitizeQueryMessage(req.query.success),
            errorMessage: sanitizeQueryMessage(req.query.error),
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass,
            ...getCommonViewData(req)
        });
    } catch (error) {
        console.error('Finance Manager reversal detail error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load reversal detail.');
    }
}

async function getReopenList(req, res) {
    try {
        const requests = await payrollReopenService.listReopenRequests(getCompanyId(req), 'finance-officer', req.query);
        res.render('finance_manager/payroll_reopen_index', {
            title: 'Reopened / Corrected Payroll',
            path: '/finance-manager/payroll/reopen',
            requests,
            filters: req.query,
            statusOptions: Object.values(payrollReopenService.REOPEN_STATUSES),
            getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
            ...getCommonViewData(req)
        });
    } catch (error) {
        console.error('Finance Manager reopen list error:', error);
        res.status(error.statusCode || 500).render('finance_manager/payroll_reopen_index', {
            title: 'Reopened / Corrected Payroll',
            path: '/finance-manager/payroll/reopen',
            requests: [],
            filters: req.query,
            statusOptions: Object.values(payrollReopenService.REOPEN_STATUSES),
            errorMessage: error.message || 'Failed to load reopen requests.',
            getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
            ...getCommonViewData(req)
        });
    }
}

async function getReopenDetail(req, res) {
    try {
        const detail = await payrollReopenService.getReopenRequestDetail({
            companyId: getCompanyId(req),
            requestId: req.params.requestId
        });

        res.render('finance_manager/payroll_reopen_detail', {
            title: 'Payroll Reopen Detail',
            path: `/finance-manager/payroll/reopen/${req.params.requestId}`,
            detail,
            successMessage: sanitizeQueryMessage(req.query.success),
            errorMessage: sanitizeQueryMessage(req.query.error),
            getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
            ...getCommonViewData(req)
        });
    } catch (error) {
        console.error('Finance Manager reopen detail error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load reopen detail.');
    }
}

async function getGeneralLedgerHistory(req, res) {
    try {
        const companyId = getCompanyId(req);
        const filters = {
            companyId,
            activityCode: req.query.activityCode ? String(req.query.activityCode).trim() : null,
            month: req.query.month ? Number(req.query.month) : null,
            year: req.query.year ? Number(req.query.year) : null,
            status: req.query.status ? String(req.query.status).trim() : null,
            page: req.query.page ? Number(req.query.page) : 1,
            pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20
        };

        if (req.query.batchId) {
            const batchId = Number(req.query.batchId);
            const printSuffix = req.query.print ? '?print=1' : '';
            return res.redirect(`/finance-manager/reports/general-ledger/${batchId}${printSuffix}`);
        }

        const history = await payrollGlPostingService.getPostingHistory(filters);
        res.render('payroll/gl-posting/history', {
            title: 'General Ledger History',
            subtitle: 'Read-only payroll posting history',
            breadcrumbCurrent: 'GL Posting History',
            user: getViewUser(req),
            role: 'finance-manager',
            partialsBase: getWorkspaceContext(req, 'finance-manager').partialsBase,
            workspaceLabel: getWorkspaceContext(req, 'finance-manager').workspaceLabel,
            homePath: getWorkspaceContext(req, 'finance-manager').dashboardPath,
            batches: history.rows,
            pagination: history.pagination,
            selectedBatch: null,
            selectedLines: [],
            historyBaseUrl: '/finance-manager/reports/general-ledger',
            formUrl: '/finance-manager/reports/general-ledger',
            processUrl: '/finance-manager/dashboard',
            getWorkflowStatusBadgeClass
        });
    } catch (error) {
        console.error('Finance Manager GL history error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load General Ledger history.');
    }
}

async function getGeneralLedgerBatchDetail(req, res) {
    try {
        const companyId = getCompanyId(req);
        const detail = await payrollGlPostingService.getPostingBatchDetail({
            companyId,
            batchId: Number(req.params.id)
        });
        const history = await payrollGlPostingService.getPostingHistory({
            companyId,
            activityCode: null,
            month: null,
            year: null,
            status: null,
            page: 1,
            pageSize: 20
        });

        const workspace = getWorkspaceContext(req, 'finance-manager');
        res.render('payroll/gl-posting/history', {
            title: 'General Ledger History',
            subtitle: 'Read-only payroll posting history',
            breadcrumbCurrent: 'GL Posting Detail',
            user: getViewUser(req),
            role: 'finance-manager',
            partialsBase: workspace.partialsBase,
            workspaceLabel: workspace.workspaceLabel,
            homePath: workspace.dashboardPath,
            batches: history.rows,
            pagination: history.pagination,
            selectedBatch: detail.batch,
            selectedLines: detail.lines,
            debitTotal: detail.debitTotal,
            creditTotal: detail.creditTotal,
            historyBaseUrl: '/finance-manager/reports/general-ledger',
            formUrl: '/finance-manager/reports/general-ledger',
            processUrl: '/finance-manager/dashboard',
            getWorkflowStatusBadgeClass,
            printMode: String(req.query.print || '') === '1'
        });
    } catch (error) {
        console.error('Finance Manager GL batch detail error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load General Ledger posting detail.');
    }
}

module.exports = {
    getDashboard,
    getGeneralLedgerBatchDetail,
    getGeneralLedgerHistory,
    getPayrollWorkflowList,
    getPayrollWorkflowDetail,
    getReversalList,
    getReversalDetail,
    getReopenList,
    getReopenDetail
};
