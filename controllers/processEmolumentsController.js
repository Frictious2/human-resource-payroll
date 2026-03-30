const ProcessEmolumentsService = require('../services/processEmolumentsService');

function getCompanyId(req) {
    return req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1;
}

function getUser(req) {
    return req.user || req.session?.user || { id: 0, role: 'data-entry', name: 'Data Entry Officer' };
}

class ProcessEmolumentsController {
    static showProcessForm(req, res) {
        res.render('payroll/process-emoluments/index', {
            title: 'Process Emoluments',
            group: 'Payroll',
            path: '/data-entry/payroll/process-emoluments',
            user: getUser(req),
            activities: ProcessEmolumentsService.getActivities(),
            defaultActivityCode: '01',
            postUrl: '/data-entry/payroll/process-emoluments',
            historyUrl: '/data-entry/payroll/process-emoluments/history',
            closeUrl: '/data-entry/dashboard'
        });
    }

    static async process(req, res) {
        try {
            const user = getUser(req);
            const result = await ProcessEmolumentsService.processEmoluments({
                companyId: getCompanyId(req),
                activityCode: req.body.activityCode,
                payrollDate: req.body.payrollDate,
                processedByName: user.name || user.fullName || user.username || 'System',
                userRole: user.role
            });

            res.json({
                success: true,
                message: 'Emoluments processed successfully.',
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
                path: '/data-entry/payroll/process-emoluments/history',
                user: getUser(req),
                activities: ProcessEmolumentsService.getActivities(),
                detailsBaseUrl: '/data-entry/payroll/process-emoluments/history',
                formUrl: '/data-entry/payroll/process-emoluments',
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
            const details = await ProcessEmolumentsService.getBatchDetails({
                companyId: getCompanyId(req),
                batchId: req.params.batchId
            });

            res.render('payroll/process-emoluments/details', {
                title: 'Processing Batch Details',
                group: 'Payroll',
                path: `/data-entry/payroll/process-emoluments/history/${req.params.batchId}`,
                user: getUser(req),
                batch: details.batch,
                items: details.items,
                totals: details.totals,
                historyUrl: '/data-entry/payroll/process-emoluments/history'
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
