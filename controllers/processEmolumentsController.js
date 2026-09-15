const ProcessEmolumentsService = require('../services/processEmolumentsService');
const { validateProcessEmoluments } = require('../validations/processEmolumentsValidation');
const { getWorkspaceContext } = require('../utils/workspaceContext');

function getCompanyId(req) {
    return req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1;
}

function getUser(req) {
    return req.user || req.session?.user || { id: 0, role: 'finance-officer', name: 'Finance Officer' };
}

function getWorkspaceUrls(req) {
    const workspace = getWorkspaceContext(req, 'data-entry');
    const routeBase = workspace.isFinance ? '/finance' : '/data-entry';

    return {
        ...workspace,
        routeBase,
        processUrl: `${routeBase}/payroll/process-emoluments`,
        historyUrl: `${routeBase}/payroll/process-emoluments/history`,
        homePath: workspace.dashboardPath
    };
}

class ProcessEmolumentsController {
    static showProcessForm(req, res) {
        const workspace = getWorkspaceUrls(req);
        res.render('payroll/process-emoluments/index', {
            title: 'Process Emoluments',
            group: 'Payroll',
            path: workspace.processUrl,
            user: getUser(req),
            partialsBase: workspace.partialsBase,
            workspaceLabel: workspace.workspaceLabel,
            activities: ProcessEmolumentsService.getActivities(),
            defaultActivityCode: req.query.activityCode || '01',
            defaultPayrollDate: req.query.payrollDate || new Date().toISOString().split('T')[0],
            correctionBatchId: req.query.batchId || '',
            correctionMode: String(req.query.correction || '').trim() === '1',
            postUrl: workspace.processUrl,
            historyUrl: workspace.historyUrl,
            historyDetailsBaseUrl: workspace.historyUrl,
            closeUrl: workspace.homePath,
            homePath: workspace.homePath
        });
    }

    static async process(req, res) {
        try {
            const user = getUser(req);
            const validatedPayload = validateProcessEmoluments({
                companyId: getCompanyId(req),
                activityCode: req.body.activityCode,
                payrollDate: req.body.payrollDate
            });
            const result = await ProcessEmolumentsService.processEmoluments({
                companyId: validatedPayload.companyId,
                activityCode: validatedPayload.activityCode,
                payrollDate: validatedPayload.payrollDate,
                processedByName: user.name || user.fullName || user.username || 'System',
                processedByUser: user,
                userRole: user.role
            });

            res.json({
                success: true,
                message: result.isCorrectionRun
                    ? 'Corrected payroll processed successfully and is ready for submission to the Manager.'
                    : 'Payroll processed successfully and is ready for review.',
                data: result
            });
        } catch (error) {
            console.error('Process Emoluments Error:', error);
            res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Failed to process emoluments.'
            });
        }
    }

    static async history(req, res) {
        try {
            const workspace = getWorkspaceUrls(req);
            const rows = await ProcessEmolumentsService.getHistory({
                companyId: getCompanyId(req),
                filters: {
                    activityCode: req.query.activityCode || '',
                    month: req.query.month || '',
                    year: req.query.year || '',
                    status: req.query.status || ''
                }
            });

            res.render('payroll/process-emoluments/history', {
                title: 'Processing History',
                group: 'Payroll',
                path: workspace.historyUrl,
                user: getUser(req),
                partialsBase: workspace.partialsBase,
                workspaceLabel: workspace.workspaceLabel,
                activities: ProcessEmolumentsService.getActivities(),
                detailsBaseUrl: workspace.historyUrl,
                formUrl: workspace.processUrl,
                historyUrl: workspace.historyUrl,
                homePath: workspace.homePath,
                filters: {
                    activityCode: req.query.activityCode || '',
                    month: req.query.month || '',
                    year: req.query.year || '',
                    status: req.query.status || ''
                },
                batches: rows
            });
        } catch (error) {
            console.error('Process Emoluments History Error:', error);
            res.status(error.statusCode || 500).send(error.message || 'Failed to load processing history.');
        }
    }

    static async viewBatchDetails(req, res) {
        try {
            const workspace = getWorkspaceUrls(req);
            const details = await ProcessEmolumentsService.getBatchDetails({
                companyId: getCompanyId(req),
                batchId: req.params.batchId
            });

            res.render('payroll/process-emoluments/details', {
                title: 'Processing Batch Details',
                group: 'Payroll',
                path: `${workspace.historyUrl}/${req.params.batchId}`,
                user: getUser(req),
                partialsBase: workspace.partialsBase,
                workspaceLabel: workspace.workspaceLabel,
                batch: details.batch,
                items: details.items,
                totals: details.totals,
                historyUrl: workspace.historyUrl,
                processUrl: workspace.processUrl,
                homePath: workspace.homePath
            });
        } catch (error) {
            console.error('Process Emoluments Details Error:', error);
            res.status(error.statusCode || 500).send(error.message || 'Failed to load batch details.');
        }
    }

    static async reverse(req, res) {
        try {
            await ProcessEmolumentsService.reverseBatch({
                companyId: getCompanyId(req),
                batchId: req.params.batchId
            });

            res.json({
                success: true,
                message: 'Batch reversal completed.'
            });
        } catch (error) {
            res.status(error.statusCode || 500).json({
                success: false,
                message: error.message || 'Failed to reverse processing batch.'
            });
        }
    }
}

module.exports = ProcessEmolumentsController;
