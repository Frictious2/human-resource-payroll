const pool = require('../config/db');
const auditorDashboardService = require('../services/auditorDashboardService');
const auditorPayrollWorkflowService = require('../services/auditorPayrollWorkflowService');
const workflowNotificationService = require('../services/workflowNotificationService');
const workQueueService = require('../services/workQueueService');
const payrollReversalService = require('../services/payrollReversalService');
const payrollReopenService = require('../services/payrollReopenService');

function getCompanyId(req) {
    return req.user?.companyId
        || req.user?.company_id
        || req.session?.companyId
        || req.session?.CompanyID
        || 1;
}

function getAuditorUser(req) {
    return req.session.user || req.user || { name: 'Auditor', role: 'auditor' };
}

const AUDITOR_SCOPE_CLAUSE = `
    (
        UserName IS NULL OR UserName NOT IN (
            SELECT username FROM developer
            UNION
            SELECT email FROM developer
            UNION
            SELECT FullName FROM developer
        )
    )
    AND (
        FormName IS NULL
        OR (
            FormName NOT LIKE 'developer/%'
            AND FormName NOT LIKE '/developer/%'
            AND FormName <> 'developer'
            AND FormName <> '/developer'
        )
    )
`;

function buildAuditFilters(query) {
    const filters = [AUDITOR_SCOPE_CLAUSE];
    const params = [];

    if (query.userName) {
        filters.push('UserName = ?');
        params.push(query.userName);
    }

    if (query.action) {
        filters.push('Action = ?');
        params.push(query.action);
    }

    if (query.formName) {
        filters.push('FormName = ?');
        params.push(query.formName);
    }

    if (query.dateFrom) {
        filters.push('DATE(ChangeDate) >= ?');
        params.push(query.dateFrom);
    }

    if (query.dateTo) {
        filters.push('DATE(ChangeDate) <= ?');
        params.push(query.dateTo);
    }

    return {
        params,
        whereClause: filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    };
}

const auditorController = {
    renderDashboard: async (req, res) => {
        try {
            const companyId = getCompanyId(req);
            const user = getAuditorUser(req);

            const [dashboardData, unreadNotifications, workQueueData, reversalCounts, reopenCounts] = await Promise.all([
                auditorDashboardService.getAuditorDashboardData({ companyId }),
                workflowNotificationService.getUnreadCount(user.id || 0, companyId),
                workQueueService.getRoleWorkQueue({ companyId, user, filters: {} }),
                payrollReversalService.getRoleDashboardSummary(companyId),
                payrollReopenService.getRoleDashboardSummary(companyId)
            ]);

            res.render('auditor/dashboard', {
                title: 'Auditor Dashboard',
                path: '/auditor/dashboard',
                user,
                error: null,
                ...dashboardData,
                reversalCounts,
                reopenCounts,
                unreadNotifications,
                workQueueSummary: workQueueData.summary
            });
        } catch (error) {
            console.error('Auditor dashboard error:', error);
            res.render('auditor/dashboard', {
                title: 'Auditor Dashboard',
                path: '/auditor/dashboard',
                user: getAuditorUser(req),
                error: 'Failed to load dashboard data',
                metrics: {
                    totalCount: 0,
                    todayCount: 0,
                    activeUsers: 0,
                    highRiskEvents30Days: 0,
                    pendingFinancialApprovals: 0,
                    unpostedPayrollPeriods: 0,
                    pendingPostingBatches: 0,
                    payrollExceptions: 0,
                    awaitingAuditReview: 0,
                    endorsedToEntityHead: 0,
                    returnedForCorrection: 0,
                    finalApproved: 0,
                    finalRejected: 0
                },
                actionBreakdown: [],
                recentActivity: [],
                highRiskActivity: [],
                moduleBreakdown: [],
                topUsersToday: [],
                controlChecks: {
                    financialApprovals: [],
                    unpostedPeriods: [],
                    pendingBatches: [],
                    recentWorkflowActions: [],
                    latestAwaitingTotals: null
                },
                reversalCounts: {},
                reopenCounts: {},
                unreadNotifications: 0,
                workQueueSummary: { totalActionable: 0, payroll: 0, reversals: 0, records: 0, byStatus: {} }
            });
        }
    },

    getPayrollReviewQueue: async (req, res) => {
        try {
            const queue = await auditorPayrollWorkflowService.getAuditorQueue(getCompanyId(req), {
                status: req.query.status || '',
                month: req.query.month || '',
                year: req.query.year || '',
                pType: req.query.pType || ''
            });

            res.render('auditor/payroll/review_queue', {
                title: 'Payroll Review Queue',
                path: '/auditor/payroll/review',
                user: getAuditorUser(req),
                batches: queue.batches,
                filters: queue.filters,
                statusOptions: [
                    'SUBMITTED_TO_AUDITOR',
                    'SUBMITTED_TO_ENTITY_HEAD',
                    'RETURNED_BY_AUDITOR',
                    'CORRECTION_IN_PROGRESS',
                    'FINAL_APPROVED',
                    'FINAL_REJECTED',
                    'POSTED_TO_ACCOUNTS'
                ],
                getStatusBadgeClass: auditorPayrollWorkflowService.getStatusBadgeClass,
                successMessage: req.query.success || '',
                errorMessage: req.query.error || ''
            });
        } catch (error) {
            console.error('Auditor payroll queue error:', error);
            res.status(error.statusCode || 500).render('auditor/payroll/review_queue', {
                title: 'Payroll Review Queue',
                path: '/auditor/payroll/review',
                user: getAuditorUser(req),
                batches: [],
                filters: {
                    status: req.query.status || 'SUBMITTED_TO_AUDITOR',
                    month: req.query.month || '',
                    year: req.query.year || '',
                    pType: req.query.pType || ''
                },
                statusOptions: [
                    'SUBMITTED_TO_AUDITOR',
                    'SUBMITTED_TO_ENTITY_HEAD',
                    'RETURNED_BY_AUDITOR',
                    'CORRECTION_IN_PROGRESS',
                    'FINAL_APPROVED',
                    'FINAL_REJECTED',
                    'POSTED_TO_ACCOUNTS'
                ],
                getStatusBadgeClass: auditorPayrollWorkflowService.getStatusBadgeClass,
                successMessage: '',
                errorMessage: error.message || 'Failed to load payroll review queue.'
            });
        }
    },

    getPayrollReviewDetail: async (req, res) => {
        try {
            const detail = await auditorPayrollWorkflowService.getAuditorBatchDetail(getCompanyId(req), req.params.batchId);

            res.render('auditor/payroll/review_detail', {
                title: 'Payroll Review Detail',
                path: `/auditor/payroll/review/${req.params.batchId}`,
                user: getAuditorUser(req),
                batch: detail.batch,
                payrollRows: detail.payrollRows,
                history: detail.history,
                canAct: detail.canAct,
                sourceReferences: detail.sourceReferences,
                summaryBreakdown: detail.summaryBreakdown,
                getStatusBadgeClass: auditorPayrollWorkflowService.getStatusBadgeClass,
                successMessage: req.query.success || '',
                errorMessage: req.query.error || ''
            });
        } catch (error) {
            console.error('Auditor payroll detail error:', error);
            res.status(error.statusCode || 500).send(error.message || 'Failed to load payroll review detail.');
        }
    },

    postPayrollReviewEndorse: async (req, res) => {
        try {
            await auditorPayrollWorkflowService.endorseBatch({
                companyId: getCompanyId(req),
                batchId: req.params.batchId,
                user: getAuditorUser(req),
                comments: req.body.comments || ''
            });

            return res.redirect(`/auditor/payroll/review/${req.params.batchId}?success=${encodeURIComponent('Payroll reviewed, endorsed, and forwarded to the Entity Head/HNO successfully.')}`);
        } catch (error) {
            console.error('Auditor endorsement error:', error);
            return res.redirect(`/auditor/payroll/review/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to endorse payroll batch.')}`);
        }
    },

    postPayrollReviewReturn: async (req, res) => {
        try {
            await auditorPayrollWorkflowService.returnBatchForCorrection({
                companyId: getCompanyId(req),
                batchId: req.params.batchId,
                user: getAuditorUser(req),
                comments: req.body.comments || ''
            });

            return res.redirect(`/auditor/payroll/review/${req.params.batchId}?success=${encodeURIComponent('Payroll returned for correction after audit review.')}`);
        } catch (error) {
            console.error('Auditor return error:', error);
            return res.redirect(`/auditor/payroll/review/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to return payroll batch.')}`);
        }
    },

    auditTrailPage: async (req, res) => {
        try {
            const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
            const pageSize = 50;
            const offset = (page - 1) * pageSize;
            const filters = buildAuditFilters(req.query);

            const [entriesResult, countResult, usersResult, actionsResult, formsResult] = await Promise.all([
                pool.query(
                    `
                    SELECT AuditTrailID, ChangeDate, UserName, FormName, Action, RecordID, FieldName, OldValue, NewValue, Loggedout
                    FROM tblaudittrail
                    ${filters.whereClause}
                    ORDER BY ChangeDate DESC, AuditTrailID DESC
                    LIMIT ${pageSize} OFFSET ${offset}
                    `,
                    filters.params
                ),
                pool.query(
                    `
                    SELECT COUNT(*) AS totalCount
                    FROM tblaudittrail
                    ${filters.whereClause}
                    `,
                    filters.params
                ),
                pool.query(`SELECT DISTINCT UserName FROM tblaudittrail WHERE ${AUDITOR_SCOPE_CLAUSE} AND UserName IS NOT NULL AND UserName <> "" ORDER BY UserName ASC`),
                pool.query(`SELECT DISTINCT Action FROM tblaudittrail WHERE ${AUDITOR_SCOPE_CLAUSE} AND Action IS NOT NULL AND Action <> "" ORDER BY Action ASC`),
                pool.query(`SELECT DISTINCT FormName FROM tblaudittrail WHERE ${AUDITOR_SCOPE_CLAUSE} AND FormName IS NOT NULL AND FormName <> "" ORDER BY FormName ASC`)
            ]);

            const totalCount = countResult[0][0].totalCount || 0;
            const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);

            res.render('auditor/audit-trail', {
                title: 'Audit Trail',
                path: '/auditor/audit-trail',
                user: req.session.user || { name: 'Auditor' },
                entries: entriesResult[0],
                filters: {
                    action: req.query.action || '',
                    dateFrom: req.query.dateFrom || '',
                    dateTo: req.query.dateTo || '',
                    formName: req.query.formName || '',
                    userName: req.query.userName || ''
                },
                options: {
                    actions: actionsResult[0].map((row) => row.Action),
                    forms: formsResult[0].map((row) => row.FormName),
                    users: usersResult[0].map((row) => row.UserName)
                },
                pagination: {
                    page,
                    pageSize,
                    totalCount,
                    totalPages
                }
            });
        } catch (error) {
            console.error('Audit trail page error:', error);
            res.status(500).send('Server Error');
        }
    }
};

module.exports = auditorController;
