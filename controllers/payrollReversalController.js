const payrollReversalService = require('../services/payrollReversalService');

function getCompanyId(req) {
    return Number(
        req.user?.companyId ||
        req.user?.company_id ||
        req.user?.CompanyID ||
        req.session?.companyId ||
        req.session?.CompanyID ||
        1
    ) || 1;
}

function getViewUser(req, fallbackRole, fallbackName) {
    return req.session?.user || req.user || { role: fallbackRole, name: fallbackName };
}

function encodeMessage(message) {
    return encodeURIComponent(String(message || '').trim());
}

function getStatusOptions() {
    return Object.values(payrollReversalService.REVERSAL_STATUSES);
}

function getFilters(req) {
    return {
        status: req.query.status || '',
        month: req.query.month || '',
        year: req.query.year || '',
        pType: req.query.pType || ''
    };
}

function getFinanceBasePath() {
    return '/finance/payroll/reversals';
}

function getManagerBasePath() {
    return '/manager/payroll/reversals';
}

function getAuditorBasePath() {
    return '/auditor/payroll/reversals';
}

function getEntityHeadBasePath() {
    return '/entity-head/payroll/reversals';
}

const getFinanceQueue = async (req, res) => {
    try {
        const rows = await payrollReversalService.listReversalRequests({
            companyId: getCompanyId(req),
            role: 'finance-officer',
            filters: getFilters(req)
        });

        res.render('finance/payroll-reversals/index', {
            title: 'Payroll Reversal Requests',
            path: getFinanceBasePath(),
            user: getViewUser(req, 'finance-officer', 'Finance Officer'),
            rows,
            filters: getFilters(req),
            statusOptions: getStatusOptions(),
            successMessage: req.query.success || '',
            errorMessage: req.query.error || '',
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass
        });
    } catch (error) {
        console.error('Finance reversal queue error:', error);
        res.status(error.statusCode || 500).render('finance/payroll-reversals/index', {
            title: 'Payroll Reversal Requests',
            path: getFinanceBasePath(),
            user: getViewUser(req, 'finance-officer', 'Finance Officer'),
            rows: [],
            filters: getFilters(req),
            statusOptions: getStatusOptions(),
            successMessage: '',
            errorMessage: error.message || 'Failed to load payroll reversal requests.',
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass
        });
    }
};

const getFinanceNewRequest = async (req, res) => {
    try {
        const detail = await payrollReversalService.getReversalEligibilityDetail({
            companyId: getCompanyId(req),
            workflowBatchId: req.params.workflowBatchId
        });
        res.render('finance/payroll-reversals/new', {
            title: 'Request Payroll Reversal',
            path: getFinanceBasePath(),
            user: getViewUser(req, 'finance-officer', 'Finance Officer'),
            detail,
            errorMessage: req.query.error || ''
        });
    } catch (error) {
        console.error('Finance reversal request page error:', error);
        return res.redirect(`${getFinanceBasePath()}?error=${encodeMessage(error.message || 'Failed to load reversal request form.')}`);
    }
};

const postFinanceCreate = async (req, res) => {
    try {
        const detail = await payrollReversalService.createReversalRequest({
            companyId: getCompanyId(req),
            workflowBatchId: req.body.workflowBatchId,
            reason: req.body.reason,
            comments: req.body.comments,
            user: getViewUser(req, 'finance-officer', 'Finance Officer')
        });
        return res.redirect(`${getFinanceBasePath()}/${detail.request.id}?success=${encodeMessage('Payroll reversal request created successfully.')}`);
    } catch (error) {
        console.error('Finance reversal create error:', error);
        const fallbackWorkflowBatchId = req.body.workflowBatchId || '';
        if (fallbackWorkflowBatchId) {
            return res.redirect(`${getFinanceBasePath()}/new/${fallbackWorkflowBatchId}?error=${encodeMessage(error.message || 'Failed to create reversal request.')}`);
        }
        return res.redirect(`${getFinanceBasePath()}?error=${encodeMessage(error.message || 'Failed to create reversal request.')}`);
    }
};

const getFinanceDetail = async (req, res) => {
    try {
        const detail = await payrollReversalService.getReversalRequestDetail({
            companyId: getCompanyId(req),
            requestId: req.params.requestId
        });
        res.render('finance/payroll-reversals/detail', {
            title: 'Payroll Reversal Detail',
            path: `${getFinanceBasePath()}/${req.params.requestId}`,
            user: getViewUser(req, 'finance-officer', 'Finance Officer'),
            detail,
            successMessage: req.query.success || '',
            errorMessage: req.query.error || '',
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass
        });
    } catch (error) {
        console.error('Finance reversal detail error:', error);
        return res.redirect(`${getFinanceBasePath()}?error=${encodeMessage(error.message || 'Failed to load reversal request detail.')}`);
    }
};

const postFinanceSubmit = async (req, res) => {
    try {
        await payrollReversalService.submitRequestToManager({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            user: getViewUser(req, 'finance-officer', 'Finance Officer'),
            comments: req.body.comments || req.body.reason || ''
        });
        return res.redirect(`${getFinanceBasePath()}/${req.params.requestId}?success=${encodeMessage('Payroll reversal submitted to the Manager successfully.')}`);
    } catch (error) {
        console.error('Finance reversal submit error:', error);
        return res.redirect(`${getFinanceBasePath()}/${req.params.requestId}?error=${encodeMessage(error.message || 'Failed to submit payroll reversal.')}`);
    }
};

const postFinanceExecute = async (req, res) => {
    try {
        await payrollReversalService.executeApprovedReversal({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            user: getViewUser(req, 'finance-officer', 'Finance Officer')
        });
        return res.redirect(`${getFinanceBasePath()}/${req.params.requestId}?success=${encodeMessage('Payroll reversal completed successfully.')}`);
    } catch (error) {
        console.error('Finance reversal execute error:', error);
        return res.redirect(`${getFinanceBasePath()}/${req.params.requestId}?error=${encodeMessage(error.message || 'Payroll reversal failed. No changes were committed.')}`);
    }
};

const postFinanceCancel = async (req, res) => {
    try {
        await payrollReversalService.cancelRequest({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            user: getViewUser(req, 'finance-officer', 'Finance Officer'),
            comments: req.body.comments || ''
        });
        return res.redirect(`${getFinanceBasePath()}?success=${encodeMessage('Payroll reversal request cancelled.')}`);
    } catch (error) {
        console.error('Finance reversal cancel error:', error);
        return res.redirect(`${getFinanceBasePath()}/${req.params.requestId}?error=${encodeMessage(error.message || 'Failed to cancel reversal request.')}`);
    }
};

const getManagerQueue = async (req, res) => {
    try {
        const rows = await payrollReversalService.listReversalRequests({
            companyId: getCompanyId(req),
            role: 'manager',
            filters: getFilters(req)
        });
        res.render('manager/payroll/reversals_queue', {
            title: 'Payroll Reversal Endorsement',
            path: getManagerBasePath(),
            user: getViewUser(req, 'manager', 'Manager'),
            rows,
            filters: getFilters(req),
            statusOptions: getStatusOptions(),
            successMessage: req.query.success || '',
            errorMessage: req.query.error || '',
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass
        });
    } catch (error) {
        console.error('Manager reversal queue error:', error);
        res.status(error.statusCode || 500).render('manager/payroll/reversals_queue', {
            title: 'Payroll Reversal Endorsement',
            path: getManagerBasePath(),
            user: getViewUser(req, 'manager', 'Manager'),
            rows: [],
            filters: getFilters(req),
            statusOptions: getStatusOptions(),
            successMessage: '',
            errorMessage: error.message || 'Failed to load reversal queue.',
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass
        });
    }
};

const getManagerDetail = async (req, res) => {
    try {
        const detail = await payrollReversalService.getReversalRequestDetail({
            companyId: getCompanyId(req),
            requestId: req.params.requestId
        });
        res.render('manager/payroll/reversals_detail', {
            title: 'Payroll Reversal Review',
            path: `${getManagerBasePath()}/${req.params.requestId}`,
            user: getViewUser(req, 'manager', 'Manager'),
            detail,
            successMessage: req.query.success || '',
            errorMessage: req.query.error || '',
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass
        });
    } catch (error) {
        console.error('Manager reversal detail error:', error);
        return res.redirect(`${getManagerBasePath()}?error=${encodeMessage(error.message || 'Failed to load reversal request.')}`);
    }
};

const postManagerEndorse = async (req, res) => {
    try {
        await payrollReversalService.managerEndorseRequest({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            user: getViewUser(req, 'manager', 'Manager'),
            comments: req.body.comments || ''
        });
        return res.redirect(`${getManagerBasePath()}/${req.params.requestId}?success=${encodeMessage('Payroll reversal endorsed and forwarded to the Auditor successfully.')}`);
    } catch (error) {
        console.error('Manager reversal endorse error:', error);
        return res.redirect(`${getManagerBasePath()}/${req.params.requestId}?error=${encodeMessage(error.message || 'Failed to endorse reversal request.')}`);
    }
};

const postManagerReturn = async (req, res) => {
    try {
        await payrollReversalService.managerReturnRequest({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            user: getViewUser(req, 'manager', 'Manager'),
            comments: req.body.comments || ''
        });
        return res.redirect(`${getManagerBasePath()}/${req.params.requestId}?success=${encodeMessage('Payroll reversal returned to Finance successfully.')}`);
    } catch (error) {
        console.error('Manager reversal return error:', error);
        return res.redirect(`${getManagerBasePath()}/${req.params.requestId}?error=${encodeMessage(error.message || 'Failed to return reversal request.')}`);
    }
};

const getAuditorQueue = async (req, res) => {
    try {
        const rows = await payrollReversalService.listReversalRequests({
            companyId: getCompanyId(req),
            role: 'auditor',
            filters: getFilters(req)
        });
        res.render('auditor/payroll/reversals_queue', {
            title: 'Payroll Reversal Review',
            path: getAuditorBasePath(),
            user: getViewUser(req, 'auditor', 'Auditor'),
            rows,
            filters: getFilters(req),
            statusOptions: getStatusOptions(),
            successMessage: req.query.success || '',
            errorMessage: req.query.error || '',
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass
        });
    } catch (error) {
        console.error('Auditor reversal queue error:', error);
        res.status(error.statusCode || 500).render('auditor/payroll/reversals_queue', {
            title: 'Payroll Reversal Review',
            path: getAuditorBasePath(),
            user: getViewUser(req, 'auditor', 'Auditor'),
            rows: [],
            filters: getFilters(req),
            statusOptions: getStatusOptions(),
            successMessage: '',
            errorMessage: error.message || 'Failed to load reversal review queue.',
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass
        });
    }
};

const getAuditorDetail = async (req, res) => {
    try {
        const detail = await payrollReversalService.getReversalRequestDetail({
            companyId: getCompanyId(req),
            requestId: req.params.requestId
        });
        res.render('auditor/payroll/reversals_detail', {
            title: 'Payroll Reversal Audit Review',
            path: `${getAuditorBasePath()}/${req.params.requestId}`,
            user: getViewUser(req, 'auditor', 'Auditor'),
            detail,
            successMessage: req.query.success || '',
            errorMessage: req.query.error || '',
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass
        });
    } catch (error) {
        console.error('Auditor reversal detail error:', error);
        return res.redirect(`${getAuditorBasePath()}?error=${encodeMessage(error.message || 'Failed to load reversal request detail.')}`);
    }
};

const postAuditorEndorse = async (req, res) => {
    try {
        await payrollReversalService.auditorEndorseRequest({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            user: getViewUser(req, 'auditor', 'Auditor'),
            comments: req.body.comments || ''
        });
        return res.redirect(`${getAuditorBasePath()}/${req.params.requestId}?success=${encodeMessage('Payroll reversal reviewed, endorsed, and forwarded successfully.')}`);
    } catch (error) {
        console.error('Auditor reversal endorse error:', error);
        return res.redirect(`${getAuditorBasePath()}/${req.params.requestId}?error=${encodeMessage(error.message || 'Failed to endorse reversal request.')}`);
    }
};

const postAuditorReturn = async (req, res) => {
    try {
        await payrollReversalService.auditorReturnRequest({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            user: getViewUser(req, 'auditor', 'Auditor'),
            comments: req.body.comments || ''
        });
        return res.redirect(`${getAuditorBasePath()}/${req.params.requestId}?success=${encodeMessage('Payroll reversal returned for correction after audit review.')}`);
    } catch (error) {
        console.error('Auditor reversal return error:', error);
        return res.redirect(`${getAuditorBasePath()}/${req.params.requestId}?error=${encodeMessage(error.message || 'Failed to return reversal request.')}`);
    }
};

const getEntityHeadQueue = async (req, res) => {
    try {
        const rows = await payrollReversalService.listReversalRequests({
            companyId: getCompanyId(req),
            role: 'entity-head',
            filters: getFilters(req)
        });
        res.render('entity_head/payroll/reversals_queue', {
            title: 'Payroll Reversal Final Approval',
            path: getEntityHeadBasePath(),
            user: getViewUser(req, 'entity-head', 'Entity Head'),
            entityScope: req.entityScope || null,
            rows,
            filters: getFilters(req),
            statusOptions: getStatusOptions(),
            successMessage: req.query.success || '',
            errorMessage: req.query.error || '',
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass
        });
    } catch (error) {
        console.error('Entity Head reversal queue error:', error);
        res.status(error.statusCode || 500).render('entity_head/payroll/reversals_queue', {
            title: 'Payroll Reversal Final Approval',
            path: getEntityHeadBasePath(),
            user: getViewUser(req, 'entity-head', 'Entity Head'),
            entityScope: req.entityScope || null,
            rows: [],
            filters: getFilters(req),
            statusOptions: getStatusOptions(),
            successMessage: '',
            errorMessage: error.message || 'Failed to load reversal final approval queue.',
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass
        });
    }
};

const getEntityHeadDetail = async (req, res) => {
    try {
        const detail = await payrollReversalService.getReversalRequestDetail({
            companyId: getCompanyId(req),
            requestId: req.params.requestId
        });
        res.render('entity_head/payroll/reversals_detail', {
            title: 'Payroll Reversal Final Approval',
            path: `${getEntityHeadBasePath()}/${req.params.requestId}`,
            user: getViewUser(req, 'entity-head', 'Entity Head'),
            entityScope: req.entityScope || null,
            detail,
            successMessage: req.query.success || '',
            errorMessage: req.query.error || '',
            getStatusBadgeClass: payrollReversalService.getReversalStatusBadgeClass
        });
    } catch (error) {
        console.error('Entity Head reversal detail error:', error);
        return res.redirect(`${getEntityHeadBasePath()}?error=${encodeMessage(error.message || 'Failed to load reversal request detail.')}`);
    }
};

const postEntityHeadApprove = async (req, res) => {
    try {
        await payrollReversalService.entityHeadApproveRequest({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            user: getViewUser(req, 'entity-head', 'Entity Head'),
            comments: req.body.comments || ''
        });
        return res.redirect(`${getEntityHeadBasePath()}/${req.params.requestId}?success=${encodeMessage('Payroll reversal received final approval successfully.')}`);
    } catch (error) {
        console.error('Entity Head reversal approve error:', error);
        return res.redirect(`${getEntityHeadBasePath()}/${req.params.requestId}?error=${encodeMessage(error.message || 'Failed to approve reversal request.')}`);
    }
};

const postEntityHeadReturn = async (req, res) => {
    try {
        await payrollReversalService.entityHeadReturnRequest({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            user: getViewUser(req, 'entity-head', 'Entity Head'),
            comments: req.body.comments || ''
        });
        return res.redirect(`${getEntityHeadBasePath()}/${req.params.requestId}?success=${encodeMessage('Payroll reversal returned for correction by the Entity Head/HNO.')}`);
    } catch (error) {
        console.error('Entity Head reversal return error:', error);
        return res.redirect(`${getEntityHeadBasePath()}/${req.params.requestId}?error=${encodeMessage(error.message || 'Failed to return reversal request.')}`);
    }
};

const postEntityHeadReject = async (req, res) => {
    try {
        await payrollReversalService.entityHeadRejectRequest({
            companyId: getCompanyId(req),
            requestId: req.params.requestId,
            user: getViewUser(req, 'entity-head', 'Entity Head'),
            comments: req.body.comments || ''
        });
        return res.redirect(`${getEntityHeadBasePath()}/${req.params.requestId}?success=${encodeMessage('Payroll reversal request rejected by the Entity Head/HNO.')}`);
    } catch (error) {
        console.error('Entity Head reversal reject error:', error);
        return res.redirect(`${getEntityHeadBasePath()}/${req.params.requestId}?error=${encodeMessage(error.message || 'Failed to reject reversal request.')}`);
    }
};

module.exports = {
    getAuditorDetail,
    getAuditorQueue,
    getEntityHeadDetail,
    getEntityHeadQueue,
    getFinanceDetail,
    getFinanceNewRequest,
    getFinanceQueue,
    getManagerDetail,
    getManagerQueue,
    postAuditorEndorse,
    postAuditorReturn,
    postEntityHeadApprove,
    postEntityHeadReject,
    postEntityHeadReturn,
    postFinanceCancel,
    postFinanceCreate,
    postFinanceExecute,
    postFinanceSubmit,
    postManagerEndorse,
    postManagerReturn
};
