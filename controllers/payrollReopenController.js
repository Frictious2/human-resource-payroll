const payrollReopenService = require('../services/payrollReopenService');

function getCompanyId(req) {
    return Number(
        req.user?.companyId
        || req.user?.company_id
        || req.session?.companyId
        || req.session?.CompanyID
        || req.entityScope?.companyId
        || 1
    ) || 1;
}

function getViewUser(req, fallbackRole, fallbackName) {
    const source = req.session?.user || req.user || {};
    return {
        id: Number(source.id ?? source.PFNo ?? source.pfno ?? 0) || 0,
        role: String(source.role || source.level || fallbackRole || '').trim().toLowerCase(),
        name: String(source.name || source.fullName || source.username || fallbackName || 'User').trim() || fallbackName || 'User'
    };
}

function sanitizeQueryMessage(value) {
    return value ? String(value).trim() : '';
}

function sendRedirect(res, routeBase, messageType, message) {
    const encoded = encodeURIComponent(String(message || '').trim());
    return res.redirect(`${routeBase}?${messageType}=${encoded}`);
}

const controller = {
    getFinanceQueue: async (req, res) => {
        try {
            const companyId = getCompanyId(req);
            const requests = await payrollReopenService.listReopenRequests(companyId, 'finance-officer', req.query);
            res.render('finance/payroll-reopen/index', {
                title: 'Payroll Reopen Requests',
                path: '/finance/payroll/reopen',
                user: getViewUser(req, 'finance-officer', 'Finance Officer'),
                requests,
                filters: req.query,
                statusOptions: Object.values(payrollReopenService.REOPEN_STATUSES),
                getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
                successMessage: sanitizeQueryMessage(req.query.success),
                errorMessage: sanitizeQueryMessage(req.query.error)
            });
        } catch (error) {
            res.status(error.statusCode || 500).render('finance/payroll-reopen/index', {
                title: 'Payroll Reopen Requests',
                path: '/finance/payroll/reopen',
                user: getViewUser(req, 'finance-officer', 'Finance Officer'),
                requests: [],
                filters: req.query,
                statusOptions: Object.values(payrollReopenService.REOPEN_STATUSES),
                getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
                successMessage: '',
                errorMessage: error.message || 'Failed to load payroll reopen requests.'
            });
        }
    },

    getFinanceNewRequest: async (req, res) => {
        try {
            const companyId = getCompanyId(req);
            const eligibility = await payrollReopenService.getReopenEligibilityDetail(companyId, req.params.workflowBatchId);
            res.render('finance/payroll-reopen/new', {
                title: 'Request Payroll Reopen',
                path: '/finance/payroll/reopen',
                user: getViewUser(req, 'finance-officer', 'Finance Officer'),
                eligibility,
                errorMessage: sanitizeQueryMessage(req.query.error)
            });
        } catch (error) {
            res.redirect(`/finance/payroll/reopen?error=${encodeURIComponent(error.message || 'Failed to load payroll reopen eligibility.')}`);
        }
    },

    postFinanceCreate: async (req, res) => {
        try {
            const companyId = getCompanyId(req);
            const result = await payrollReopenService.createReopenRequest({
                companyId,
                workflowBatchId: req.body.workflowBatchId,
                reason: req.body.reason,
                comments: req.body.comments || '',
                user: getViewUser(req, 'finance-officer', 'Finance Officer')
            });
            return res.redirect(`/finance/payroll/reopen/${result.request.id}?success=${encodeURIComponent('Payroll reopen request created successfully.')}`);
        } catch (error) {
            return sendRedirect(res, '/finance/payroll/reopen', 'error', error.message || 'Failed to create payroll reopen request.');
        }
    },

    getFinanceDetail: async (req, res) => {
        try {
            const detail = await payrollReopenService.getReopenRequestDetail({
                companyId: getCompanyId(req),
                requestId: req.params.requestId
            });
            res.render('finance/payroll-reopen/detail', {
                title: 'Payroll Reopen Request',
                path: '/finance/payroll/reopen',
                user: getViewUser(req, 'finance-officer', 'Finance Officer'),
                detail,
                getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
                successMessage: sanitizeQueryMessage(req.query.success),
                errorMessage: sanitizeQueryMessage(req.query.error)
            });
        } catch (error) {
            return sendRedirect(res, '/finance/payroll/reopen', 'error', error.message || 'Failed to load payroll reopen request.');
        }
    },

    postFinanceSubmit: async (req, res) => {
        try {
            await payrollReopenService.submitReopenToManager({
                companyId: getCompanyId(req),
                requestId: req.params.requestId,
                comments: req.body.comments || '',
                user: getViewUser(req, 'finance-officer', 'Finance Officer')
            });
            return res.redirect(`/finance/payroll/reopen/${req.params.requestId}?success=${encodeURIComponent('Payroll reopen request submitted to the Manager successfully.')}`);
        } catch (error) {
            return res.redirect(`/finance/payroll/reopen/${req.params.requestId}?error=${encodeURIComponent(error.message || 'Failed to submit payroll reopen request.')}`);
        }
    },

    postFinanceCancel: async (req, res) => {
        try {
            await payrollReopenService.cancelReopenRequest({
                companyId: getCompanyId(req),
                requestId: req.params.requestId,
                comments: req.body.comments || '',
                user: getViewUser(req, 'finance-officer', 'Finance Officer')
            });
            return res.redirect(`/finance/payroll/reopen/${req.params.requestId}?success=${encodeURIComponent('Payroll reopen request cancelled successfully.')}`);
        } catch (error) {
            return res.redirect(`/finance/payroll/reopen/${req.params.requestId}?error=${encodeURIComponent(error.message || 'Failed to cancel payroll reopen request.')}`);
        }
    },

    postFinanceStartReprocessing: async (req, res) => {
        try {
            const result = await payrollReopenService.startReopenReprocessing({
                companyId: getCompanyId(req),
                requestId: req.params.requestId,
                user: getViewUser(req, 'finance-officer', 'Finance Officer')
            });
            return res.redirect(`${result.processUrl}&success=${encodeURIComponent('Reopened payroll generation created. You can now rerun Process Emoluments for the locked period and activity.')}`);
        } catch (error) {
            return res.redirect(`/finance/payroll/reopen/${req.params.requestId}?error=${encodeURIComponent(error.message || 'Failed to start payroll reprocessing.')}`);
        }
    },

    getManagerQueue: async (req, res) => {
        try {
            const requests = await payrollReopenService.listReopenRequests(getCompanyId(req), 'manager', req.query);
            res.render('manager/payroll/reopen_queue', {
                title: 'Payroll Reopen Queue',
                path: '/manager/payroll/reopen',
                user: getViewUser(req, 'manager', 'Manager'),
                requests,
                filters: req.query,
                statusOptions: Object.values(payrollReopenService.REOPEN_STATUSES),
                getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
                successMessage: sanitizeQueryMessage(req.query.success),
                errorMessage: sanitizeQueryMessage(req.query.error)
            });
        } catch (error) {
            res.status(error.statusCode || 500).render('manager/payroll/reopen_queue', {
                title: 'Payroll Reopen Queue',
                path: '/manager/payroll/reopen',
                user: getViewUser(req, 'manager', 'Manager'),
                requests: [],
                filters: req.query,
                statusOptions: Object.values(payrollReopenService.REOPEN_STATUSES),
                getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
                successMessage: '',
                errorMessage: error.message || 'Failed to load payroll reopen queue.'
            });
        }
    },

    getManagerDetail: async (req, res) => {
        try {
            const detail = await payrollReopenService.getReopenRequestDetail({
                companyId: getCompanyId(req),
                requestId: req.params.requestId
            });
            res.render('manager/payroll/reopen_detail', {
                title: 'Payroll Reopen Review',
                path: '/manager/payroll/reopen',
                user: getViewUser(req, 'manager', 'Manager'),
                detail,
                getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
                successMessage: sanitizeQueryMessage(req.query.success),
                errorMessage: sanitizeQueryMessage(req.query.error)
            });
        } catch (error) {
            return sendRedirect(res, '/manager/payroll/reopen', 'error', error.message || 'Failed to load payroll reopen review.');
        }
    },

    postManagerEndorse: async (req, res) => {
        try {
            await payrollReopenService.managerEndorseReopen({
                companyId: getCompanyId(req),
                requestId: req.params.requestId,
                comments: req.body.comments || '',
                user: getViewUser(req, 'manager', 'Manager')
            });
            return res.redirect(`/manager/payroll/reopen/${req.params.requestId}?success=${encodeURIComponent('Payroll reopen endorsed and forwarded to the Auditor successfully.')}`);
        } catch (error) {
            return res.redirect(`/manager/payroll/reopen/${req.params.requestId}?error=${encodeURIComponent(error.message || 'Failed to endorse payroll reopen request.')}`);
        }
    },

    postManagerReturn: async (req, res) => {
        try {
            await payrollReopenService.managerReturnReopen({
                companyId: getCompanyId(req),
                requestId: req.params.requestId,
                comments: req.body.comments,
                user: getViewUser(req, 'manager', 'Manager')
            });
            return res.redirect(`/manager/payroll/reopen/${req.params.requestId}?success=${encodeURIComponent('Payroll reopen request returned to Finance successfully.')}`);
        } catch (error) {
            return res.redirect(`/manager/payroll/reopen/${req.params.requestId}?error=${encodeURIComponent(error.message || 'Failed to return payroll reopen request.')}`);
        }
    },

    getAuditorQueue: async (req, res) => {
        try {
            const requests = await payrollReopenService.listReopenRequests(getCompanyId(req), 'auditor', req.query);
            res.render('auditor/payroll/reopen_queue', {
                title: 'Payroll Reopen Review Queue',
                path: '/auditor/payroll/reopen',
                user: getViewUser(req, 'auditor', 'Auditor'),
                requests,
                filters: req.query,
                statusOptions: Object.values(payrollReopenService.REOPEN_STATUSES),
                getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
                successMessage: sanitizeQueryMessage(req.query.success),
                errorMessage: sanitizeQueryMessage(req.query.error)
            });
        } catch (error) {
            res.status(error.statusCode || 500).render('auditor/payroll/reopen_queue', {
                title: 'Payroll Reopen Review Queue',
                path: '/auditor/payroll/reopen',
                user: getViewUser(req, 'auditor', 'Auditor'),
                requests: [],
                filters: req.query,
                statusOptions: Object.values(payrollReopenService.REOPEN_STATUSES),
                getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
                successMessage: '',
                errorMessage: error.message || 'Failed to load payroll reopen review queue.'
            });
        }
    },

    getAuditorDetail: async (req, res) => {
        try {
            const detail = await payrollReopenService.getReopenRequestDetail({
                companyId: getCompanyId(req),
                requestId: req.params.requestId
            });
            res.render('auditor/payroll/reopen_detail', {
                title: 'Payroll Reopen Audit Review',
                path: '/auditor/payroll/reopen',
                user: getViewUser(req, 'auditor', 'Auditor'),
                detail,
                getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
                successMessage: sanitizeQueryMessage(req.query.success),
                errorMessage: sanitizeQueryMessage(req.query.error)
            });
        } catch (error) {
            return sendRedirect(res, '/auditor/payroll/reopen', 'error', error.message || 'Failed to load payroll reopen audit review.');
        }
    },

    postAuditorEndorse: async (req, res) => {
        try {
            await payrollReopenService.auditorEndorseReopen({
                companyId: getCompanyId(req),
                requestId: req.params.requestId,
                comments: req.body.comments || '',
                user: getViewUser(req, 'auditor', 'Auditor')
            });
            return res.redirect(`/auditor/payroll/reopen/${req.params.requestId}?success=${encodeURIComponent('Payroll reopen endorsed and forwarded to the Entity Head/HNO successfully.')}`);
        } catch (error) {
            return res.redirect(`/auditor/payroll/reopen/${req.params.requestId}?error=${encodeURIComponent(error.message || 'Failed to endorse payroll reopen request.')}`);
        }
    },

    postAuditorReturn: async (req, res) => {
        try {
            await payrollReopenService.auditorReturnReopen({
                companyId: getCompanyId(req),
                requestId: req.params.requestId,
                comments: req.body.comments,
                user: getViewUser(req, 'auditor', 'Auditor')
            });
            return res.redirect(`/auditor/payroll/reopen/${req.params.requestId}?success=${encodeURIComponent('Payroll reopen request returned to Finance successfully.')}`);
        } catch (error) {
            return res.redirect(`/auditor/payroll/reopen/${req.params.requestId}?error=${encodeURIComponent(error.message || 'Failed to return payroll reopen request.')}`);
        }
    },

    getEntityHeadQueue: async (req, res) => {
        try {
            const requests = await payrollReopenService.listReopenRequests(getCompanyId(req), 'entity-head', req.query);
            res.render('entity_head/payroll/reopen_queue', {
                title: 'Payroll Reopen Final Approval Queue',
                path: '/entity-head/payroll/reopen',
                user: getViewUser(req, 'entity-head', 'Entity Head'),
                requests,
                filters: req.query,
                statusOptions: Object.values(payrollReopenService.REOPEN_STATUSES),
                getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
                successMessage: sanitizeQueryMessage(req.query.success),
                errorMessage: sanitizeQueryMessage(req.query.error)
            });
        } catch (error) {
            res.status(error.statusCode || 500).render('entity_head/payroll/reopen_queue', {
                title: 'Payroll Reopen Final Approval Queue',
                path: '/entity-head/payroll/reopen',
                user: getViewUser(req, 'entity-head', 'Entity Head'),
                requests: [],
                filters: req.query,
                statusOptions: Object.values(payrollReopenService.REOPEN_STATUSES),
                getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
                successMessage: '',
                errorMessage: error.message || 'Failed to load payroll reopen final approval queue.'
            });
        }
    },

    getEntityHeadDetail: async (req, res) => {
        try {
            const detail = await payrollReopenService.getReopenRequestDetail({
                companyId: getCompanyId(req),
                requestId: req.params.requestId
            });
            res.render('entity_head/payroll/reopen_detail', {
                title: 'Payroll Reopen Final Approval',
                path: '/entity-head/payroll/reopen',
                user: getViewUser(req, 'entity-head', 'Entity Head'),
                detail,
                getStatusBadgeClass: payrollReopenService.getReopenStatusBadgeClass,
                successMessage: sanitizeQueryMessage(req.query.success),
                errorMessage: sanitizeQueryMessage(req.query.error)
            });
        } catch (error) {
            return sendRedirect(res, '/entity-head/payroll/reopen', 'error', error.message || 'Failed to load payroll reopen final approval.');
        }
    },

    postEntityHeadApprove: async (req, res) => {
        try {
            await payrollReopenService.entityHeadApproveReopen({
                companyId: getCompanyId(req),
                requestId: req.params.requestId,
                comments: req.body.comments || '',
                user: getViewUser(req, 'entity-head', 'Entity Head')
            });
            return res.redirect(`/entity-head/payroll/reopen/${req.params.requestId}?success=${encodeURIComponent('Payroll reopen approved and marked ready to reopen successfully.')}`);
        } catch (error) {
            return res.redirect(`/entity-head/payroll/reopen/${req.params.requestId}?error=${encodeURIComponent(error.message || 'Failed to approve payroll reopen request.')}`);
        }
    },

    postEntityHeadReturn: async (req, res) => {
        try {
            await payrollReopenService.entityHeadReturnReopen({
                companyId: getCompanyId(req),
                requestId: req.params.requestId,
                comments: req.body.comments,
                user: getViewUser(req, 'entity-head', 'Entity Head')
            });
            return res.redirect(`/entity-head/payroll/reopen/${req.params.requestId}?success=${encodeURIComponent('Payroll reopen request returned successfully.')}`);
        } catch (error) {
            return res.redirect(`/entity-head/payroll/reopen/${req.params.requestId}?error=${encodeURIComponent(error.message || 'Failed to return payroll reopen request.')}`);
        }
    },

    postEntityHeadReject: async (req, res) => {
        try {
            await payrollReopenService.entityHeadRejectReopen({
                companyId: getCompanyId(req),
                requestId: req.params.requestId,
                comments: req.body.comments,
                user: getViewUser(req, 'entity-head', 'Entity Head')
            });
            return res.redirect(`/entity-head/payroll/reopen/${req.params.requestId}?success=${encodeURIComponent('Payroll reopen request rejected successfully.')}`);
        } catch (error) {
            return res.redirect(`/entity-head/payroll/reopen/${req.params.requestId}?error=${encodeURIComponent(error.message || 'Failed to reject payroll reopen request.')}`);
        }
    }
};

module.exports = controller;
