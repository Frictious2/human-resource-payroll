const express = require('express');
const router = express.Router();
const auditorController = require('../controllers/auditorController');

router.get('/', (req, res) => res.redirect('/auditor/dashboard'));
router.get('/dashboard', auditorController.renderDashboard);
router.get('/audit-trail', auditorController.auditTrailPage);

module.exports = router;
