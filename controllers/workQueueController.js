const workQueueService = require('../services/workQueueService');
const workflowNotificationService = require('../services/workflowNotificationService');
const { getWorkspaceContext } = require('../utils/workspaceContext');

function getUser(req) {
    return req.user || req.session?.user || { name: 'User', role: 'data-entry' };
}

function getCompanyId(req) {
    return req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1;
}

function getViewData(req) {
    const workspace = getWorkspaceContext(req, getUser(req).role || 'data-entry');
    return {
        user: getUser(req),
        partialsBase: workspace.partialsBase,
        dashboardPath: workspace.dashboardPath,
        workspaceLabel: workspace.workspaceLabel,
        entityScope: req.entityScope
    };
}

async function getWorkQueue(req, res) {
    try {
        const user = getUser(req);
        const companyId = getCompanyId(req);
        const filters = {
            module: req.query.module || '',
            status: req.query.status || ''
        };

        const [queue, unreadCount] = await Promise.all([
            workQueueService.getRoleWorkQueue({ companyId, user, filters }),
            workflowNotificationService.getUnreadCount(user.id, companyId)
        ]);

        res.render('shared/work_queue/index', {
            title: 'My Work Queue',
            path: '/work-queue',
            rows: queue.rows,
            summary: queue.summary,
            unreadCount,
            filters,
            ...getViewData(req)
        });
    } catch (error) {
        console.error('Work queue error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load work queue.');
    }
}

module.exports = {
    getWorkQueue
};
