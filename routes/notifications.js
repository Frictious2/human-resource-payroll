const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');

router.get('/', notificationController.getNotificationCenter);
router.get('/recent', notificationController.getRecentNotifications);
router.post('/:id/read', notificationController.markNotificationRead);
router.post('/read-all', notificationController.markAllNotificationsRead);
router.get('/:id/open', notificationController.openNotification);

module.exports = router;
