const entityHeadService = require('../services/entityHeadService');
const entityHeadPayrollWorkflowService = require('../services/entityHeadPayrollWorkflowService');
const recordWorkflowService = require('../services/recordWorkflowService');
const workflowNotificationService = require('../services/workflowNotificationService');
const workQueueService = require('../services/workQueueService');
const parameterChangeService = require('../services/parameterChangeService');
const payrollReversalService = require('../services/payrollReversalService');
const payrollReopenService = require('../services/payrollReopenService');

function getCommonViewData(req) {
    return {
        user: req.session.user || { name: 'Entity Head' },
        entityScope: req.entityScope
    };
}

function getCompanyId(req) {
    return req.entityScope?.companyId
        || req.user?.companyId
        || req.session?.companyId
        || req.session?.CompanyID
        || 1;
}

function getEntityHeadUser(req) {
    return req.session.user || req.user || { name: 'Entity Head', role: 'entity-head' };
}

async function getRecordWorkflowDashboard(companyId) {
    await recordWorkflowService.ensureWorkflowTables();
    await recordWorkflowService.syncAllDraftModules(companyId);

    return {
        counts: await recordWorkflowService.getWorkflowCountsByStatus(companyId),
        recent: (await recordWorkflowService.listWorkflowItems(companyId, {})).slice(0, 6)
    };
}

const entityHeadController = {
    getDashboard: async (req, res) => {
        try {
            const companyId = getCompanyId(req);
            const user = getEntityHeadUser(req);
            const [pageData, workflowWidgets, recordWorkflow, unreadNotifications, workQueueData, reversalCounts, reopenCounts] = await Promise.all([
                entityHeadService.getDashboardData({
                    companyId,
                    entityScope: req.entityScope
                }),
                entityHeadPayrollWorkflowService.getEntityHeadDashboardWidgets(companyId),
                getRecordWorkflowDashboard(companyId),
                workflowNotificationService.getUnreadCount(user.id || 0, companyId),
                workQueueService.getRoleWorkQueue({ companyId, user, filters: {} }),
                payrollReversalService.getRoleDashboardSummary(companyId),
                payrollReopenService.getRoleDashboardSummary(companyId)
            ]);
            const parameterChangeCounts = await parameterChangeService.getCountsByStatus(companyId);

            res.render('entity_head/dashboard', {
                title: 'Entity Head Dashboard',
                path: '/entity-head/dashboard',
                error: null,
                company: pageData.company,
                cards: pageData.cards,
                payrollCards: workflowWidgets.cards,
                payrollRecentActions: workflowWidgets.recentActions,
                latestAwaitingPayroll: workflowWidgets.latestAwaitingTotals,
                reversalCounts,
                reopenCounts,
                recordWorkflow,
                parameterChangeCounts,
                unreadNotifications,
                workQueueSummary: workQueueData.summary,
                recentTransferRows: pageData.recentTransferRows,
                currentLeaveRows: pageData.currentLeaveRows,
                recentTrainingRows: pageData.recentTrainingRows,
                ...getCommonViewData(req)
            });
        } catch (error) {
            console.error('Entity Head dashboard error:', error);
            res.render('entity_head/dashboard', {
                title: 'Entity Head Dashboard',
                path: '/entity-head/dashboard',
                error: 'Failed to load dashboard data.',
                company: {},
                cards: {
                    activeStaff: 0,
                    onLeaveNow: 0,
                    attendanceLast30Days: 0,
                    trainingLast12Months: 0
                },
                payrollCards: {
                    awaitingFinalApproval: 0,
                    finalApproved: 0,
                    finalRejected: 0
                },
                payrollRecentActions: [],
                latestAwaitingPayroll: null,
                reversalCounts: {},
                reopenCounts: {},
                recordWorkflow: {
                    counts: {},
                    recent: []
                },
                parameterChangeCounts: {},
                unreadNotifications: 0,
                workQueueSummary: { totalActionable: 0, payroll: 0, reversals: 0, records: 0, byStatus: {} },
                recentTransferRows: [],
                currentLeaveRows: [],
                recentTrainingRows: [],
                ...getCommonViewData(req)
            });
        }
    },

    getPayrollApprovalQueue: async (req, res) => {
        try {
            const queue = await entityHeadPayrollWorkflowService.getApprovalQueue(getCompanyId(req), {
                status: req.query.status || '',
                month: req.query.month || '',
                year: req.query.year || '',
                pType: req.query.pType || ''
            });

            res.render('entity_head/payroll/approvals_queue', {
                title: 'Final Payroll Approval Queue',
                path: '/entity-head/payroll/approvals',
                user: getEntityHeadUser(req),
                entityScope: req.entityScope,
                batches: queue.batches,
                filters: queue.filters,
                statusOptions: [
                    'SUBMITTED_TO_ENTITY_HEAD',
                    'CORRECTION_IN_PROGRESS',
                    'FINAL_APPROVED',
                    'FINAL_REJECTED',
                    'POSTED_TO_ACCOUNTS'
                ],
                getStatusBadgeClass: entityHeadPayrollWorkflowService.getStatusBadgeClass,
                successMessage: req.query.success || '',
                errorMessage: req.query.error || ''
            });
        } catch (error) {
            console.error('Entity Head payroll queue error:', error);
            res.status(error.statusCode || 500).render('entity_head/payroll/approvals_queue', {
                title: 'Final Payroll Approval Queue',
                path: '/entity-head/payroll/approvals',
                user: getEntityHeadUser(req),
                entityScope: req.entityScope
                ,
                batches: [],
                filters: {
                    status: req.query.status || 'SUBMITTED_TO_ENTITY_HEAD',
                    month: req.query.month || '',
                    year: req.query.year || '',
                    pType: req.query.pType || ''
                },
                statusOptions: [
                    'SUBMITTED_TO_ENTITY_HEAD',
                    'CORRECTION_IN_PROGRESS',
                    'FINAL_APPROVED',
                    'FINAL_REJECTED',
                    'POSTED_TO_ACCOUNTS'
                ],
                getStatusBadgeClass: entityHeadPayrollWorkflowService.getStatusBadgeClass,
                successMessage: '',
                errorMessage: error.message || 'Failed to load final approval queue.'
            });
        }
    },

    getPayrollApprovalDetail: async (req, res) => {
        try {
            const detail = await entityHeadPayrollWorkflowService.getBatchDetail(getCompanyId(req), req.params.batchId);

            res.render('entity_head/payroll/approval_detail', {
                title: 'Final Payroll Approval Detail',
                path: `/entity-head/payroll/approvals/${req.params.batchId}`,
                user: getEntityHeadUser(req),
                entityScope: req.entityScope,
                batch: detail.batch,
                payrollRows: detail.payrollRows,
                history: detail.history,
                canAct: detail.canAct,
                summaryBreakdown: detail.summaryBreakdown,
                getStatusBadgeClass: entityHeadPayrollWorkflowService.getStatusBadgeClass,
                successMessage: req.query.success || '',
                errorMessage: req.query.error || ''
            });
        } catch (error) {
            console.error('Entity Head payroll detail error:', error);
            res.status(error.statusCode || 500).send(error.message || 'Failed to load final approval detail.');
        }
    },

    postPayrollApprove: async (req, res) => {
        try {
            await entityHeadPayrollWorkflowService.approveBatch({
                companyId: getCompanyId(req),
                batchId: req.params.batchId,
                user: getEntityHeadUser(req),
                comments: req.body.comments || ''
            });

            return res.redirect(`/entity-head/payroll/approvals/${req.params.batchId}?success=${encodeURIComponent('Monthly payroll has received final approval successfully.')}`);
        } catch (error) {
            console.error('Entity Head payroll approve error:', error);
            return res.redirect(`/entity-head/payroll/approvals/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to approve payroll batch.')}`);
        }
    },

    postPayrollReturn: async (req, res) => {
        try {
            await entityHeadPayrollWorkflowService.returnBatchForCorrection({
                companyId: getCompanyId(req),
                batchId: req.params.batchId,
                user: getEntityHeadUser(req),
                comments: req.body.comments || ''
            });

            return res.redirect(`/entity-head/payroll/approvals/${req.params.batchId}?success=${encodeURIComponent('Payroll returned for correction by the Entity Head/HNO.')}`);
        } catch (error) {
            console.error('Entity Head payroll return error:', error);
            return res.redirect(`/entity-head/payroll/approvals/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to return payroll batch.')}`);
        }
    },

    postPayrollReject: async (req, res) => {
        try {
            await entityHeadPayrollWorkflowService.rejectBatch({
                companyId: getCompanyId(req),
                batchId: req.params.batchId,
                user: getEntityHeadUser(req),
                comments: req.body.comments || ''
            });

            return res.redirect(`/entity-head/payroll/approvals/${req.params.batchId}?success=${encodeURIComponent('Monthly payroll has been rejected by the Entity Head/HNO.')}`);
        } catch (error) {
            console.error('Entity Head payroll reject error:', error);
            return res.redirect(`/entity-head/payroll/approvals/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to reject payroll batch.')}`);
        }
    },

    getStaffOverview: async (req, res) => {
        try {
            const pageData = await entityHeadService.getStaffOverviewData({
                companyId: req.entityScope.companyId,
                entityScope: req.entityScope,
                filters: req.query
            });

            res.render('entity_head/staff', {
                title: 'Entity Staff Overview',
                path: '/entity-head/staff',
                company: pageData.company,
                rows: pageData.rows,
                filters: pageData.filters,
                pagination: pageData.pagination,
                ...getCommonViewData(req)
            });
        } catch (error) {
            console.error('Entity Head staff overview error:', error);
            res.status(500).send('Server Error');
        }
    },

    getAttendanceSummary: async (req, res) => {
        try {
            const pageData = await entityHeadService.getAttendanceSummaryData({
                companyId: req.entityScope.companyId,
                entityScope: req.entityScope,
                filters: req.query
            });

            res.render('entity_head/attendance', {
                title: 'Entity Attendance Summary',
                path: '/entity-head/attendance',
                company: pageData.company,
                rows: pageData.rows,
                totals: pageData.totals,
                statuses: pageData.statuses,
                filters: pageData.filters,
                pagination: pageData.pagination,
                ...getCommonViewData(req)
            });
        } catch (error) {
            console.error('Entity Head attendance summary error:', error);
            res.status(500).send('Server Error');
        }
    },

    getLeaveSummary: async (req, res) => {
        try {
            const pageData = await entityHeadService.getLeaveSummaryData({
                companyId: req.entityScope.companyId,
                entityScope: req.entityScope,
                filters: req.query
            });

            res.render('entity_head/leave', {
                title: 'Entity Leave Summary',
                path: '/entity-head/leave',
                company: pageData.company,
                rows: pageData.rows,
                totals: pageData.totals,
                filters: pageData.filters,
                pagination: pageData.pagination,
                ...getCommonViewData(req)
            });
        } catch (error) {
            console.error('Entity Head leave summary error:', error);
            res.status(500).send('Server Error');
        }
    },

    getTransferPromotionSummary: async (req, res) => {
        try {
            const pageData = await entityHeadService.getTransferPromotionSummaryData({
                companyId: req.entityScope.companyId,
                entityScope: req.entityScope,
                filters: req.query
            });

            res.render('entity_head/transfers', {
                title: 'Entity Transfer / Promotion Summary',
                path: '/entity-head/transfers',
                company: pageData.company,
                rows: pageData.rows,
                filters: pageData.filters,
                pagination: pageData.pagination,
                ...getCommonViewData(req)
            });
        } catch (error) {
            console.error('Entity Head transfer / promotion summary error:', error);
            res.status(500).send('Server Error');
        }
    },

    getTrainingSummary: async (req, res) => {
        try {
            const pageData = await entityHeadService.getTrainingSummaryData({
                companyId: req.entityScope.companyId,
                entityScope: req.entityScope,
                filters: req.query
            });

            res.render('entity_head/training', {
                title: 'Entity Training Summary',
                path: '/entity-head/training',
                company: pageData.company,
                rows: pageData.rows,
                totals: pageData.totals,
                trainingTotals: pageData.totals,
                filters: pageData.filters,
                pagination: pageData.pagination,
                ...getCommonViewData(req)
            });
        } catch (error) {
            console.error('Entity Head training summary error:', error);
            res.status(500).send('Server Error');
        }
    },

    getReports: async (req, res) => {
        try {
            const pageData = await entityHeadService.getReportsData({
                companyId: req.entityScope.companyId,
                entityScope: req.entityScope
            });

            res.render('entity_head/reports', {
                title: 'Entity Reports',
                path: '/entity-head/reports',
                company: pageData.company,
                cards: pageData.cards,
                staffCount: pageData.staffCount,
                attendanceTotals: pageData.attendanceTotals,
                leaveTotals: pageData.leaveTotals,
                trainingTotals: pageData.trainingTotals,
                staffRows: pageData.staffRows,
                attendanceRows: pageData.attendanceRows,
                leaveRows: pageData.leaveRows,
                transferRows: pageData.transferRows,
                trainingRows: pageData.trainingRows,
                ...getCommonViewData(req)
            });
        } catch (error) {
            console.error('Entity Head reports error:', error);
            res.status(500).send('Server Error');
        }
    }
};

module.exports = entityHeadController;
