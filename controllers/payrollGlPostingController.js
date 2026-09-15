const payrollGlPostingService = require('../services/payrollGlPostingService');
const payrollGlPostingValidation = require('../validations/payrollGlPostingValidation');
const { getWorkspaceContext } = require('../utils/workspaceContext');

function sendSuccess(res, message, data, statusCode = 200) {
    return res.status(statusCode).json({
        success: true,
        message,
        data
    });
}

function sendFailure(res, error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
        console.error(error);
    }

    return res.status(statusCode).json({
        success: false,
        message: error.message || 'An unexpected error occurred.'
    });
}

function requireCompanyId(companyId) {
    if (!companyId) {
        const error = new Error('companyId is required.');
        error.statusCode = 400;
        throw error;
    }

    return companyId;
}

function resolveCompanyIdFromUser(user) {
    return Number(user && (user.company_id || user.companyId || user.CompanyID)) || 1;
}

function normalizeActivities(rows) {
    if (!rows || rows.length === 0) {
        return [];
    }

    return rows.map((row) => ({
        code: row.Code || row.code,
        name: row.PayType || row.payType || row.name || row.Code || row.code,
        supported: Boolean(row.supported),
        state: row.state || 'NEEDS_CONFIRMATION',
        reason: row.reason || '',
        detailedReason: row.detailedReason || '',
        implementationType: row.implementationType || '',
        usage: row.usage || {}
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

function getReadinessBadgeClass(tone) {
    const badgeMap = {
        success: 'bg-success-subtle text-success-emphasis border border-success-subtle',
        danger: 'bg-danger-subtle text-danger-emphasis border border-danger-subtle',
        warning: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        info: 'bg-info-subtle text-info-emphasis border border-info-subtle',
        secondary: 'bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle',
        dark: 'bg-dark-subtle text-dark-emphasis border border-dark-subtle',
        primary: 'bg-primary-subtle text-primary-emphasis border border-primary-subtle'
    };

    return badgeMap[tone] || 'bg-light text-dark border';
}

function getWorkspaceUrls(req) {
    const workspace = getWorkspaceContext(req, 'data-entry');
    const routeBase = workspace.role === 'finance-manager'
        ? '/finance-manager'
        : workspace.isFinance
            ? '/finance'
            : '/data-entry';

    return {
        ...workspace,
        routeBase,
        postingFormUrl: workspace.role === 'finance-manager' ? `${routeBase}/reports/general-ledger` : `${routeBase}/payroll/gl-posting`,
        postingHistoryUrl: workspace.role === 'finance-manager' ? `${routeBase}/reports/general-ledger` : `${routeBase}/payroll/post-to-accounts/history`,
        processUrl: workspace.role === 'finance-manager' ? workspace.dashboardPath : `${routeBase}/payroll/process-emoluments`
    };
}

module.exports = {
    renderPostingForm: async (req, res) => {
        try {
            const workspace = getWorkspaceUrls(req);
            const user = payrollGlPostingValidation.resolveAuthenticatedUser(req) || { name: workspace.workspaceLabel, role: workspace.role };
            const companyId = resolveCompanyIdFromUser(user);
            const [activityRows, company] = await Promise.all([
                payrollGlPostingService.getActivityGlPostingCatalog(companyId),
                payrollGlPostingService.getCompanySummary(companyId)
            ]);
            const readinessRows = await payrollGlPostingService.getPostingReadinessRows(companyId);

            return res.render('payroll/gl-posting/index', {
                title: 'Post Payroll Items to GL Accounts',
                subtitle: 'Monthly Payroll Accounts',
                breadcrumbCurrent: 'Post to Accounts',
                user,
                role: user.role || 'data_entry',
                partialsBase: workspace.partialsBase,
                workspaceLabel: workspace.workspaceLabel,
                homePath: workspace.dashboardPath,
                company,
                companyId,
                postUrl: workspace.postingFormUrl,
                historyUrl: workspace.postingHistoryUrl,
                closeUrl: workspace.processUrl,
                activities: normalizeActivities(activityRows),
                defaultActivityCode: '01',
                readinessRows,
                getWorkflowStatusBadgeClass,
                getReadinessBadgeClass
            });
        } catch (error) {
            console.error(error);
            return res.status(500).send('Server Error');
        }
    },

    postPayrollToGl: async (req, res) => {
        try {
            const user = payrollGlPostingValidation.resolveAuthenticatedUser(req);
            const payload = payrollGlPostingValidation.validatePayrollBeforePosting(req.body);
            payrollGlPostingValidation.assertAuthorizedUser(user, payload.companyId);
            const postedBy = payrollGlPostingValidation.resolveUserId(user);

            const result = await payrollGlPostingService.postMonthlyPayrollToGL({
                companyId: payload.companyId,
                activityCode: payload.activityCode,
                postingDate: payload.postingDate,
                postedBy,
                postedByUser: user
            });

            return sendSuccess(
                res,
                'Payroll posted to accounts successfully.',
                result
            );
        } catch (error) {
            return sendFailure(res, error);
        }
    },

    getPostingHistory: async (req, res) => {
        try {
            const workspace = getWorkspaceUrls(req);
            const user = payrollGlPostingValidation.resolveAuthenticatedUser(req);
            const filters = payrollGlPostingValidation.validateHistoryQuery(req.query);

            if (req.query.batchId) {
                const batchId = payrollGlPostingValidation.validateBatchId(req.query.batchId);
                const printSuffix = req.query.print ? '?print=1' : '';
                return res.redirect(`${workspace.postingHistoryUrl}/${batchId}${printSuffix}`);
            }

            if (!filters.companyId) {
                const companyId = Number(user && (user.company_id || user.companyId || user.CompanyID));
                filters.companyId = companyId;
            }

            requireCompanyId(filters.companyId);
            payrollGlPostingValidation.assertHistoryAuthorizedUser(user, filters.companyId);

            const history = await payrollGlPostingService.getPostingHistory(filters);

            if (req.accepts('html') && !req.xhr && req.query.format !== 'json') {
                return res.render('payroll/gl-posting/history', {
                    title: 'GL Posting History',
                    subtitle: 'Monthly Payroll Accounts',
                    breadcrumbCurrent: 'Posting History',
                    user,
                    role: user.role || 'data_entry',
                    partialsBase: workspace.partialsBase,
                    workspaceLabel: workspace.workspaceLabel,
                    homePath: workspace.dashboardPath,
                    batches: history.rows,
                    pagination: history.pagination,
                    selectedBatch: null,
                    selectedLines: [],
                    historyBaseUrl: workspace.postingHistoryUrl,
                    formUrl: workspace.postingFormUrl,
                    processUrl: workspace.processUrl,
                    getWorkflowStatusBadgeClass
                });
            }

            return sendSuccess(res, 'Payroll GL posting history retrieved successfully.', history);
        } catch (error) {
            return sendFailure(res, error);
        }
    },

    getPostingBatchDetail: async (req, res) => {
        try {
            const workspace = getWorkspaceUrls(req);
            const user = payrollGlPostingValidation.resolveAuthenticatedUser(req);
            const filters = payrollGlPostingValidation.validateHistoryQuery(req.query);
            const companyId = requireCompanyId(filters.companyId || Number(user && (user.company_id || user.companyId || user.CompanyID)));
            payrollGlPostingValidation.assertHistoryAuthorizedUser(user, companyId);

            const batchId = payrollGlPostingValidation.validateBatchId(req.params.id);
            const detail = await payrollGlPostingService.getPostingBatchDetail({
                companyId,
                batchId
            });

            if (req.accepts('html') && !req.xhr && req.query.format !== 'json') {
                const history = await payrollGlPostingService.getPostingHistory({
                    companyId,
                    activityCode: null,
                    month: null,
                    year: null,
                    status: null,
                    page: 1,
                    pageSize: 20
                });

                return res.render('payroll/gl-posting/history', {
                    title: 'GL Posting History',
                    subtitle: 'Monthly Payroll Accounts',
                    breadcrumbCurrent: 'Posting History',
                    user,
                    role: user.role || 'data_entry',
                    partialsBase: workspace.partialsBase,
                    workspaceLabel: workspace.workspaceLabel,
                    homePath: workspace.dashboardPath,
                    batches: history.rows,
                    pagination: history.pagination,
                    selectedBatch: detail.batch,
                    selectedLines: detail.lines,
                    debitTotal: detail.debitTotal,
                    creditTotal: detail.creditTotal,
                    printMode: req.query.print === '1',
                    historyBaseUrl: workspace.postingHistoryUrl,
                    formUrl: workspace.postingFormUrl,
                    processUrl: workspace.processUrl,
                    getWorkflowStatusBadgeClass
                });
            }

            return sendSuccess(res, 'Payroll GL posting batch retrieved successfully.', detail);
        } catch (error) {
            return sendFailure(res, error);
        }
    },

    reversePostingBatch: async (req, res) => {
        try {
            const error = new Error('Direct GL reversal is disabled. Use the payroll reversal approval workflow instead.');
            error.statusCode = 409;
            throw error;
        } catch (error) {
            return sendFailure(res, error);
        }
    }
};
