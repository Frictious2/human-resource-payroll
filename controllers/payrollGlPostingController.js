const payrollGlPostingService = require('../services/payrollGlPostingService');
const payrollGlPostingValidation = require('../validations/payrollGlPostingValidation');

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
    const fallback = {
        '01': 'Salary',
        '02': 'Rent Allowance',
        '05': 'Inducement',
        '08': 'EOS Benefits',
        '09': 'Bonus',
        '13': 'Leave Allowance',
        '15': 'Long Service'
    };

    if (!rows || rows.length === 0) {
        return Object.entries(fallback).map(([code, name]) => ({ code, name }));
    }

    return rows.map((row) => ({
        code: row.Code || row.code,
        name: row.PayType || row.name || fallback[row.Code || row.code] || row.Code || row.code
    }));
}

module.exports = {
    renderPostingForm: async (req, res) => {
        try {
            const user = payrollGlPostingValidation.resolveAuthenticatedUser(req) || { name: 'Data Entry Officer', role: 'payroll admin' };
            const companyId = resolveCompanyIdFromUser(user);
            const [activityRows, company] = await Promise.all([
                payrollGlPostingService.getSupportedActivities(companyId),
                payrollGlPostingService.getCompanySummary(companyId)
            ]);

            return res.render('payroll/gl-posting/index', {
                title: 'Post Payroll Items to GL Accounts',
                subtitle: 'Monthly Payroll Accounts',
                breadcrumbCurrent: 'Post to Accounts',
                user,
                role: user.role || 'data_entry',
                company,
                companyId,
                postUrl: '/data-entry/payroll/gl-posting',
                historyUrl: '/data-entry/payroll/post-to-accounts/history',
                closeUrl: '/data-entry/payroll/process-emoluments',
                activities: normalizeActivities(activityRows),
                defaultActivityCode: '01'
            });
        } catch (error) {
            console.error(error);
            return res.status(500).send('Server Error');
        }
    },

    postPayrollToGl: async (req, res) => {
        try {
            const user = payrollGlPostingValidation.resolveAuthenticatedUser(req);
            const payload = payrollGlPostingValidation.validatePostingPayload(req.body);
            payrollGlPostingValidation.assertAuthorizedUser(user, payload.companyId);
            const postedBy = payrollGlPostingValidation.resolveUserId(user);

            const result = await payrollGlPostingService.postMonthlyPayrollToGL({
                companyId: payload.companyId,
                activityCode: payload.activityCode,
                postingDate: payload.postingDate,
                postedBy
            });

            return sendSuccess(
                res,
                'Payroll GL posting completed successfully.',
                result
            );
        } catch (error) {
            return sendFailure(res, error);
        }
    },

    getPostingHistory: async (req, res) => {
        try {
            const user = payrollGlPostingValidation.resolveAuthenticatedUser(req);
            const filters = payrollGlPostingValidation.validateHistoryQuery(req.query);

            if (req.query.batchId) {
                const batchId = payrollGlPostingValidation.validateBatchId(req.query.batchId);
                const printSuffix = req.query.print ? '?print=1' : '';
                return res.redirect(`/data-entry/payroll/post-to-accounts/history/${batchId}${printSuffix}`);
            }

            if (!filters.companyId) {
                const companyId = Number(user && (user.company_id || user.companyId || user.CompanyID));
                filters.companyId = companyId;
            }

            requireCompanyId(filters.companyId);
            payrollGlPostingValidation.assertAuthorizedUser(user, filters.companyId);

            const history = await payrollGlPostingService.getPostingHistory(filters);

            if (req.accepts('html') && !req.xhr && req.query.format !== 'json') {
                return res.render('payroll/gl-posting/history', {
                    title: 'GL Posting History',
                    subtitle: 'Monthly Payroll Accounts',
                    breadcrumbCurrent: 'Posting History',
                    user,
                    role: user.role || 'data_entry',
                    batches: history.rows,
                    pagination: history.pagination,
                    selectedBatch: null,
                    selectedLines: [],
                    historyBaseUrl: '/data-entry/payroll/post-to-accounts/history',
                    formUrl: '/data-entry/payroll/post-to-accounts'
                });
            }

            return sendSuccess(res, 'Payroll GL posting history retrieved successfully.', history);
        } catch (error) {
            return sendFailure(res, error);
        }
    },

    getPostingBatchDetail: async (req, res) => {
        try {
            const user = payrollGlPostingValidation.resolveAuthenticatedUser(req);
            const filters = payrollGlPostingValidation.validateHistoryQuery(req.query);
            const companyId = requireCompanyId(filters.companyId || Number(user && (user.company_id || user.companyId || user.CompanyID)));
            payrollGlPostingValidation.assertAuthorizedUser(user, companyId);

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
                    batches: history.rows,
                    pagination: history.pagination,
                    selectedBatch: detail.batch,
                    selectedLines: detail.lines,
                    debitTotal: detail.debitTotal,
                    creditTotal: detail.creditTotal,
                    printMode: req.query.print === '1',
                    historyBaseUrl: '/data-entry/payroll/post-to-accounts/history',
                    formUrl: '/data-entry/payroll/post-to-accounts'
                });
            }

            return sendSuccess(res, 'Payroll GL posting batch retrieved successfully.', detail);
        } catch (error) {
            return sendFailure(res, error);
        }
    },

    reversePostingBatch: async (req, res) => {
        try {
            const user = payrollGlPostingValidation.resolveAuthenticatedUser(req);
            const filters = payrollGlPostingValidation.validateHistoryQuery(req.query);
            const companyId = requireCompanyId(filters.companyId || Number(user && (user.company_id || user.companyId || user.CompanyID)));
            payrollGlPostingValidation.assertAuthorizedUser(user, companyId);
            payrollGlPostingValidation.resolveUserId(user);

            const batchId = payrollGlPostingValidation.validateBatchId(req.params.id);
            await payrollGlPostingService.reversePostingBatch({
                companyId,
                batchId,
                reversedBy: payrollGlPostingValidation.resolveUserId(user)
            });

            return sendSuccess(res, 'Payroll GL posting reversal completed successfully.', { batchId });
        } catch (error) {
            return sendFailure(res, error);
        }
    }
};
