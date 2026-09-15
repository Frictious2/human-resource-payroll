const express = require('express');
const router = express.Router();
const auditorController = require('../controllers/auditorController');
const payrollReversalController = require('../controllers/payrollReversalController');
const payrollReopenController = require('../controllers/payrollReopenController');
const yearlyPaymentController = require('../controllers/yearlyPaymentController');

router.get('/', (req, res) => res.redirect('/auditor/dashboard'));
router.get('/dashboard', auditorController.renderDashboard);
router.get('/payroll/review', auditorController.getPayrollReviewQueue);
router.get('/payroll/review/:batchId', auditorController.getPayrollReviewDetail);
router.post('/payroll/review/:batchId/endorse', auditorController.postPayrollReviewEndorse);
router.post('/payroll/review/:batchId/return', auditorController.postPayrollReviewReturn);
router.get('/payroll/reversals', payrollReversalController.getAuditorQueue);
router.get('/payroll/reversals/:requestId', payrollReversalController.getAuditorDetail);
router.post('/payroll/reversals/:requestId/endorse', payrollReversalController.postAuditorEndorse);
router.post('/payroll/reversals/:requestId/return', payrollReversalController.postAuditorReturn);
router.get('/payroll/reopen', payrollReopenController.getAuditorQueue);
router.get('/payroll/reopen/:requestId', payrollReopenController.getAuditorDetail);
router.post('/payroll/reopen/:requestId/endorse', payrollReopenController.postAuditorEndorse);
router.post('/payroll/reopen/:requestId/return', payrollReopenController.postAuditorReturn);
router.get('/yearly-payments', yearlyPaymentController.getAuditorQueue);
router.get('/yearly-payments/:batchId', yearlyPaymentController.getAuditorDetail);
router.post('/yearly-payments/:batchId/endorse', yearlyPaymentController.postAuditorEndorse);
router.post('/yearly-payments/:batchId/return', yearlyPaymentController.postAuditorReturn);
router.get('/audit-trail', auditorController.auditTrailPage);

module.exports = router;
