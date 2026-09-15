const workflowNotificationService = require('../services/workflowNotificationService');

async function attachNotificationSummary(req, res, next) {
    if (!req.user) {
        res.locals.notificationSummary = { unreadCount: 0, recent: [] };
        return next();
    }

    try {
        const companyId = req.user.companyId || req.session?.companyId || req.session?.CompanyID || 1;
        res.locals.notificationSummary = await workflowNotificationService.getNotificationSummary(req.user, companyId);
    } catch (error) {
        console.error('Notification summary middleware error:', error.message);
        res.locals.notificationSummary = { unreadCount: 0, recent: [] };
    }

    return next();
}

module.exports = {
    attachNotificationSummary
};
