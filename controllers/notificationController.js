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

async function getNotificationCenter(req, res) {
    try {
        const companyId = getCompanyId(req);
        const user = getUser(req);
        const filters = {
            status: req.query.status || '',
            module: req.query.module || '',
            notificationType: req.query.notificationType || '',
            dateFrom: req.query.dateFrom || '',
            dateTo: req.query.dateTo || '',
            page: req.query.page || 1
        };

        const result = await workflowNotificationService.getNotifications(user.id, companyId, filters);
        res.render('shared/notifications/index', {
            title: 'Notifications',
            path: '/notifications',
            notifications: result.rows,
            pagination: result.pagination,
            filters,
            success: req.query.success || '',
            error: req.query.error || '',
            ...getViewData(req)
        });
    } catch (error) {
        console.error('Notification center error:', error);
        res.status(error.statusCode || 500).send(error.message || 'Failed to load notifications.');
    }
}

async function getRecentNotifications(req, res) {
    try {
        const recent = await workflowNotificationService.getRecentNotifications(getUser(req).id, getCompanyId(req), 8);
        const unreadCount = await workflowNotificationService.getUnreadCount(getUser(req).id, getCompanyId(req));
        return res.json({ success: true, unreadCount, notifications: recent });
    } catch (error) {
        console.error('Recent notifications error:', error);
        return res.status(500).json({ success: false, message: 'Failed to load notifications.' });
    }
}

async function markNotificationRead(req, res) {
    try {
        await workflowNotificationService.markAsRead(req.params.id, getUser(req).id, getCompanyId(req));
        return res.redirect(req.get('referer') || '/notifications');
    } catch (error) {
        console.error('Mark notification read error:', error);
        return res.redirect('/notifications?error=' + encodeURIComponent('Failed to mark notification as read.'));
    }
}

async function markAllNotificationsRead(req, res) {
    try {
        await workflowNotificationService.markAllAsRead(getUser(req).id, getCompanyId(req));
        return res.redirect(req.get('referer') || '/notifications?success=' + encodeURIComponent('All notifications marked as read.'));
    } catch (error) {
        console.error('Mark all notifications read error:', error);
        return res.redirect('/notifications?error=' + encodeURIComponent('Failed to mark notifications as read.'));
    }
}

async function openNotification(req, res) {
    try {
        const notification = await workflowNotificationService.getNotificationById(req.params.id, getUser(req).id, getCompanyId(req));
        if (!notification) {
            return res.redirect('/notifications?error=' + encodeURIComponent('Notification not found.'));
        }

        return res.redirect(notification.ActionURL || '/notifications');
    } catch (error) {
        console.error('Open notification error:', error);
        return res.redirect('/notifications?error=' + encodeURIComponent('Failed to open notification.'));
    }
}

module.exports = {
    getNotificationCenter,
    getRecentNotifications,
    markAllNotificationsRead,
    markNotificationRead,
    openNotification
};
