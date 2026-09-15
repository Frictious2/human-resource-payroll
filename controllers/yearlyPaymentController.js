const yearlyPaymentService = require('../services/yearlyPaymentService');
const journalReportService = require('../services/journalReportService');
const eosBenefitService = require('../services/eosBenefitService');
const { getWorkspaceContext } = require('../utils/workspaceContext');

function getCompanyId(req) {
    return req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1;
}

function getViewUser(req, fallbackName, fallbackRole) {
    return req.session?.user || req.user || { name: fallbackName, role: fallbackRole };
}

function getCommonViewData(req, fallbackRole) {
    const workspace = getWorkspaceContext(req, fallbackRole);
    return {
        user: getViewUser(req, workspace.workspaceLabel, workspace.role),
        partialsBase: workspace.partialsBase,
        dashboardPath: workspace.dashboardPath,
        workspaceLabel: workspace.workspaceLabel,
        workspaceRole: workspace.role
    };
}

function getStatusBadgeClass(status) {
    const badgeMap = {
        DRAFT: 'bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle',
        CALCULATED: 'bg-primary-subtle text-primary-emphasis border border-primary-subtle',
        SUBMITTED_TO_MANAGER: 'bg-info-subtle text-info-emphasis border border-info-subtle',
        SUBMITTED_TO_AUDITOR: 'bg-info-subtle text-info-emphasis border border-info-subtle',
        SUBMITTED_TO_ENTITY_HEAD: 'bg-dark-subtle text-dark-emphasis border border-dark-subtle',
        RETURNED_BY_MANAGER: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        RETURNED_BY_AUDITOR: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        FINAL_REJECTED: 'bg-danger-subtle text-danger-emphasis border border-danger-subtle',
        APPLIED: 'bg-success-subtle text-success-emphasis border border-success-subtle'
    };
    return badgeMap[status] || 'bg-light text-dark border';
}

function renderQueue(res, req, rows, title, path) {
    return res.render('yearly-payments/queue', {
        title,
        path,
        rows,
        getStatusBadgeClass,
        successMessage: String(req.query.success || '').trim(),
        errorMessage: String(req.query.error || '').trim(),
        ...getCommonViewData(req)
    });
}

function renderDetail(res, req, detail, title, path, actionBasePath) {
    return res.render('yearly-payments/detail', {
        title,
        path,
        detail,
        actionBasePath,
        getStatusBadgeClass,
        successMessage: String(req.query.success || '').trim(),
        errorMessage: String(req.query.error || '').trim(),
        ...getCommonViewData(req)
    });
}

async function getFinanceIndex(req, res) {
    try {
        const pageData = await yearlyPaymentService.getFinancePageData({
            companyId: getCompanyId(req),
            filters: req.query
        });

        res.render('yearly-payments/finance_index', {
            title: 'Yearly Payments',
            path: '/finance/payroll/yearly-payments',
            pageData,
            successMessage: String(req.query.success || '').trim(),
            errorMessage: String(req.query.error || '').trim(),
            ...getCommonViewData(req, 'finance-officer')
        });
    } catch (error) {
        console.error('Finance yearly payments page error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load yearly payments.');
    }
}

async function postFinancePreview(req, res) {
    try {
        const detail = await yearlyPaymentService.createOrUpdateDraft({
            companyId: getCompanyId(req),
            user: getViewUser(req, 'Finance Officer', 'finance-officer'),
            payload: req.body
        });
        res.redirect(`/finance/payroll/yearly-payments/${detail.batch.id}?success=${encodeURIComponent('Yearly payment batch calculated and saved as draft.')}`);
    } catch (error) {
        console.error('Finance yearly payments preview error:', error);
        res.redirect(`/finance/payroll/yearly-payments?error=${encodeURIComponent(error.message || 'Failed to calculate yearly payment batch.')}`);
    }
}

async function getFinanceDetail(req, res) {
    try {
        const detail = await yearlyPaymentService.getBatchDetail({
            companyId: getCompanyId(req),
            batchId: req.params.batchId
        });
        if (!detail) {
            return res.redirect(`/finance/payroll/yearly-payments?error=${encodeURIComponent('Yearly payment batch not found.')}`);
        }
        return renderDetail(res, req, detail, 'Yearly Payment Detail', `/finance/payroll/yearly-payments/${detail.batch.id}`, '/finance/payroll/yearly-payments');
    } catch (error) {
        console.error('Finance yearly payment detail error:', error);
        return res.redirect(`/finance/payroll/yearly-payments?error=${encodeURIComponent(error.message || 'Failed to load yearly payment batch.')}`);
    }
}

async function postFinanceSubmit(req, res) {
    try {
        await yearlyPaymentService.submitToManager({
            companyId: getCompanyId(req),
            batchId: req.params.batchId,
            user: getViewUser(req, 'Finance Officer', 'finance-officer'),
            comments: req.body.comments || ''
        });
        res.redirect(`/finance/payroll/yearly-payments/${req.params.batchId}?success=${encodeURIComponent('Yearly payment batch submitted to the Manager.')}`);
    } catch (error) {
        console.error('Finance yearly payment submit error:', error);
        res.redirect(`/finance/payroll/yearly-payments/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to submit yearly payment batch.')}`);
    }
}

async function getManagerQueue(req, res) {
    try {
        const rows = await yearlyPaymentService.getQueueData({ companyId: getCompanyId(req), role: 'manager' });
        return renderQueue(res, req, rows, 'Yearly Payment Endorsement', '/manager/yearly-payments');
    } catch (error) {
        console.error('Manager yearly payment queue error:', error);
        return res.status(error.statusCode || 500).send(error.message || 'Failed to load yearly payment endorsement queue.');
    }
}

async function getManagerDetail(req, res) {
    try {
        const detail = await yearlyPaymentService.getBatchDetail({ companyId: getCompanyId(req), batchId: req.params.batchId });
        if (!detail) {
            return res.redirect(`/manager/yearly-payments?error=${encodeURIComponent('Yearly payment batch not found.')}`);
        }
        return renderDetail(res, req, detail, 'Yearly Payment Endorsement', `/manager/yearly-payments/${detail.batch.id}`, '/manager/yearly-payments');
    } catch (error) {
        console.error('Manager yearly payment detail error:', error);
        return res.redirect(`/manager/yearly-payments?error=${encodeURIComponent(error.message || 'Failed to load yearly payment batch.')}`);
    }
}

async function postManagerEndorse(req, res) {
    try {
        await yearlyPaymentService.managerEndorse({
            companyId: getCompanyId(req),
            batchId: req.params.batchId,
            user: getViewUser(req, 'Manager', 'manager'),
            comments: req.body.comments || ''
        });
        res.redirect(`/manager/yearly-payments/${req.params.batchId}?success=${encodeURIComponent('Yearly payment batch forwarded to the Auditor.')}`);
    } catch (error) {
        console.error('Manager yearly payment endorse error:', error);
        res.redirect(`/manager/yearly-payments/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to endorse yearly payment batch.')}`);
    }
}

async function postManagerReturn(req, res) {
    try {
        await yearlyPaymentService.managerReturn({
            companyId: getCompanyId(req),
            batchId: req.params.batchId,
            user: getViewUser(req, 'Manager', 'manager'),
            comments: req.body.comments || ''
        });
        res.redirect(`/manager/yearly-payments/${req.params.batchId}?success=${encodeURIComponent('Yearly payment batch returned to Finance.')}`);
    } catch (error) {
        console.error('Manager yearly payment return error:', error);
        res.redirect(`/manager/yearly-payments/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to return yearly payment batch.')}`);
    }
}

async function getAuditorQueue(req, res) {
    try {
        const rows = await yearlyPaymentService.getQueueData({ companyId: getCompanyId(req), role: 'auditor' });
        return renderQueue(res, req, rows, 'Yearly Payment Audit Review', '/auditor/yearly-payments');
    } catch (error) {
        console.error('Auditor yearly payment queue error:', error);
        return res.status(error.statusCode || 500).send(error.message || 'Failed to load yearly payment audit queue.');
    }
}

async function getAuditorDetail(req, res) {
    try {
        const detail = await yearlyPaymentService.getBatchDetail({ companyId: getCompanyId(req), batchId: req.params.batchId });
        if (!detail) {
            return res.redirect(`/auditor/yearly-payments?error=${encodeURIComponent('Yearly payment batch not found.')}`);
        }
        return renderDetail(res, req, detail, 'Yearly Payment Audit Review', `/auditor/yearly-payments/${detail.batch.id}`, '/auditor/yearly-payments');
    } catch (error) {
        console.error('Auditor yearly payment detail error:', error);
        return res.redirect(`/auditor/yearly-payments?error=${encodeURIComponent(error.message || 'Failed to load yearly payment batch.')}`);
    }
}

async function postAuditorEndorse(req, res) {
    try {
        await yearlyPaymentService.auditorEndorse({
            companyId: getCompanyId(req),
            batchId: req.params.batchId,
            user: getViewUser(req, 'Auditor', 'auditor'),
            comments: req.body.comments || ''
        });
        res.redirect(`/auditor/yearly-payments/${req.params.batchId}?success=${encodeURIComponent('Yearly payment batch forwarded to the Entity Head.')}`);
    } catch (error) {
        console.error('Auditor yearly payment endorse error:', error);
        res.redirect(`/auditor/yearly-payments/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to endorse yearly payment batch.')}`);
    }
}

async function postAuditorReturn(req, res) {
    try {
        await yearlyPaymentService.auditorReturn({
            companyId: getCompanyId(req),
            batchId: req.params.batchId,
            user: getViewUser(req, 'Auditor', 'auditor'),
            comments: req.body.comments || ''
        });
        res.redirect(`/auditor/yearly-payments/${req.params.batchId}?success=${encodeURIComponent('Yearly payment batch returned to Finance.')}`);
    } catch (error) {
        console.error('Auditor yearly payment return error:', error);
        res.redirect(`/auditor/yearly-payments/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to return yearly payment batch.')}`);
    }
}

async function getEntityHeadQueue(req, res) {
    try {
        const rows = await yearlyPaymentService.getQueueData({ companyId: getCompanyId(req), role: 'entity-head' });
        return renderQueue(res, req, rows, 'Yearly Payment Final Approval', '/entity-head/yearly-payments');
    } catch (error) {
        console.error('Entity Head yearly payment queue error:', error);
        return res.status(error.statusCode || 500).send(error.message || 'Failed to load yearly payment approval queue.');
    }
}

async function getEntityHeadDetail(req, res) {
    try {
        const detail = await yearlyPaymentService.getBatchDetail({ companyId: getCompanyId(req), batchId: req.params.batchId });
        if (!detail) {
            return res.redirect(`/entity-head/yearly-payments?error=${encodeURIComponent('Yearly payment batch not found.')}`);
        }
        return renderDetail(res, req, detail, 'Yearly Payment Final Approval', `/entity-head/yearly-payments/${detail.batch.id}`, '/entity-head/yearly-payments');
    } catch (error) {
        console.error('Entity Head yearly payment detail error:', error);
        return res.redirect(`/entity-head/yearly-payments?error=${encodeURIComponent(error.message || 'Failed to load yearly payment batch.')}`);
    }
}

async function postEntityHeadApprove(req, res) {
    try {
        await yearlyPaymentService.entityApprove({
            companyId: getCompanyId(req),
            batchId: req.params.batchId,
            user: getViewUser(req, 'Entity Head', 'entity-head'),
            comments: req.body.comments || ''
        });
        res.redirect(`/entity-head/yearly-payments/${req.params.batchId}?success=${encodeURIComponent('Yearly payment batch approved and applied.')}`);
    } catch (error) {
        console.error('Entity Head yearly payment approve error:', error);
        res.redirect(`/entity-head/yearly-payments/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to approve yearly payment batch.')}`);
    }
}

async function postEntityHeadReturn(req, res) {
    try {
        await yearlyPaymentService.entityReturn({
            companyId: getCompanyId(req),
            batchId: req.params.batchId,
            user: getViewUser(req, 'Entity Head', 'entity-head'),
            comments: req.body.comments || ''
        });
        res.redirect(`/entity-head/yearly-payments/${req.params.batchId}?success=${encodeURIComponent('Yearly payment batch returned to Finance.')}`);
    } catch (error) {
        console.error('Entity Head yearly payment return error:', error);
        res.redirect(`/entity-head/yearly-payments/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to return yearly payment batch.')}`);
    }
}

async function postEntityHeadReject(req, res) {
    try {
        await yearlyPaymentService.entityReject({
            companyId: getCompanyId(req),
            batchId: req.params.batchId,
            user: getViewUser(req, 'Entity Head', 'entity-head'),
            comments: req.body.comments || ''
        });
        res.redirect(`/entity-head/yearly-payments/${req.params.batchId}?success=${encodeURIComponent('Yearly payment batch rejected.')}`);
    } catch (error) {
        console.error('Entity Head yearly payment reject error:', error);
        res.redirect(`/entity-head/yearly-payments/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to reject yearly payment batch.')}`);
    }
}

async function getFinanceJournalReport(req, res) {
    try {
        const dates = await journalReportService.getJournalDates();
        res.render('reports/journal_index', {
            title: 'Journal Report',
            role: 'finance',
            dates,
            previewPath: '/finance/reports/journal/preview',
            closePath: '/finance/dashboard',
            user: getViewUser(req, 'Finance Officer', 'finance-officer'),
            ...getCommonViewData(req, 'finance-officer')
        });
    } catch (error) {
        console.error('Finance journal report error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load journal report.');
    }
}

async function getFinanceJournalPreview(req, res) {
    try {
        const report = await journalReportService.getJournalPreviewData({
            companyId: getCompanyId(req),
            glDate: req.query.glDate
        });
        res.render('reports/journal_preview', {
            title: 'Journal Preview',
            ...report
        });
    } catch (error) {
        console.error('Finance journal preview error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to preview journal report.');
    }
}

async function getFinanceBenefitStatus(req, res) {
    try {
        const pageData = await eosBenefitService.getBenefitStatusPageData({
            companyId: getCompanyId(req),
            filters: req.query
        });
        res.render('finance/reports/benefit_status', {
            user: getViewUser(req, 'Finance Officer', 'finance-officer'),
            title: 'End Of Service Benefits',
            departments: pageData.departments,
            filters: pageData.filters,
            company: pageData.company,
            results: [],
            benefitApiPath: '/finance/api/reports/benefit-status/calculate',
            ...getCommonViewData(req, 'finance-officer')
        });
    } catch (error) {
        console.error('Finance EOS report page error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load End of Service report.');
    }
}

async function getFinancePayslipPage(req, res) {
    try {
        res.render('finance/reports/payslip', {
            title: 'Payslip Report',
            path: '/finance/reports/payslip',
            payslipApiPath: '/finance/api/reports/payslip',
            ...getCommonViewData(req, 'finance-officer')
        });
    } catch (error) {
        console.error('Finance payslip report page error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load payslip report.');
    }
}

async function getFinanceManagerIndex(req, res) {
    try {
        const pageData = await yearlyPaymentService.getFinancePageData({
            companyId: getCompanyId(req),
            filters: req.query
        });

        res.render('yearly-payments/finance_index', {
            title: 'Yearly Payments Oversight',
            path: '/finance-manager/payroll/yearly-payments',
            pageData,
            successMessage: String(req.query.success || '').trim(),
            errorMessage: String(req.query.error || '').trim(),
            ...getCommonViewData(req, 'finance-manager')
        });
    } catch (error) {
        console.error('Finance Manager yearly payments page error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load yearly payments.');
    }
}

async function getFinanceManagerDetail(req, res) {
    try {
        const detail = await yearlyPaymentService.getBatchDetail({
            companyId: getCompanyId(req),
            batchId: req.params.batchId
        });
        if (!detail) {
            return res.redirect(`/finance-manager/payroll/yearly-payments?error=${encodeURIComponent('Yearly payment batch not found.')}`);
        }
        return renderDetail(
            res,
            req,
            detail,
            'Yearly Payment Oversight Detail',
            `/finance-manager/payroll/yearly-payments/${detail.batch.id}`,
            '/finance-manager/payroll/yearly-payments'
        );
    } catch (error) {
        console.error('Finance Manager yearly payment detail error:', error);
        return res.redirect(`/finance-manager/payroll/yearly-payments?error=${encodeURIComponent(error.message || 'Failed to load yearly payment batch.')}`);
    }
}

async function getFinanceManagerJournalReport(req, res) {
    try {
        const dates = await journalReportService.getJournalDates();
        res.render('reports/journal_index', {
            title: 'Journal Report',
            role: 'finance-manager',
            dates,
            previewPath: '/finance-manager/reports/journal/preview',
            closePath: '/finance-manager/dashboard',
            user: getViewUser(req, 'Finance Manager', 'finance-manager'),
            ...getCommonViewData(req, 'finance-manager')
        });
    } catch (error) {
        console.error('Finance Manager journal report error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load journal report.');
    }
}

async function getFinanceManagerJournalPreview(req, res) {
    return getFinanceJournalPreview(req, res);
}

async function getFinanceManagerBenefitStatus(req, res) {
    try {
        const pageData = await eosBenefitService.getBenefitStatusPageData({
            companyId: getCompanyId(req),
            filters: req.query
        });
        res.render('finance_manager/reports/benefit_status', {
            user: getViewUser(req, 'Finance Manager', 'finance-manager'),
            title: 'End Of Service Benefits',
            departments: pageData.departments,
            filters: pageData.filters,
            company: pageData.company,
            results: [],
            benefitApiPath: '/finance-manager/api/reports/benefit-status/calculate',
            ...getCommonViewData(req, 'finance-manager')
        });
    } catch (error) {
        console.error('Finance Manager EOS report page error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load End of Service report.');
    }
}

async function getFinanceManagerPayslipPage(req, res) {
    try {
        res.render('finance_manager/reports/payslip', {
            title: 'Payslip Report',
            path: '/finance-manager/reports/payslip',
            payslipApiPath: '/finance-manager/api/reports/payslip',
            ...getCommonViewData(req, 'finance-manager')
        });
    } catch (error) {
        console.error('Finance Manager payslip report page error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load payslip report.');
    }
}

module.exports = {
    getAuditorDetail,
    getAuditorQueue,
    getEntityHeadDetail,
    getEntityHeadQueue,
    getFinanceBenefitStatus,
    getFinanceDetail,
    getFinanceManagerBenefitStatus,
    getFinanceManagerDetail,
    getFinanceManagerIndex,
    getFinanceManagerJournalPreview,
    getFinanceManagerJournalReport,
    getFinanceManagerPayslipPage,
    getFinanceIndex,
    getFinanceJournalPreview,
    getFinanceJournalReport,
    getFinancePayslipPage,
    getManagerDetail,
    getManagerQueue,
    postAuditorEndorse,
    postAuditorReturn,
    postEntityHeadApprove,
    postEntityHeadReject,
    postEntityHeadReturn,
    postFinancePreview,
    postFinanceSubmit,
    postManagerEndorse,
    postManagerReturn
};
