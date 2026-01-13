const express = require('express');
const router = express.Router();
const managerController = require('../controllers/managerController');

// Dashboard
router.get('/', (req, res) => res.redirect('/manager/dashboard'));
router.get('/dashboard', managerController.getDashboard);

// Enquiry
router.get('/enquiry/staff', managerController.getComingSoon);
router.get('/enquiry/transfer-prom', managerController.getComingSoon);
router.get('/enquiry/warning', managerController.getComingSoon);
router.get('/enquiry/training', managerController.getComingSoon);
router.get('/enquiry/on-leave', managerController.getComingSoon);
router.get('/enquiry/medical', managerController.getComingSoon);

// Activity
router.get('/activity/run-salary-review', managerController.getComingSoon);
router.get('/activity/medical-limits', managerController.getComingSoon);

// Approve
router.get('/approve/new-staff', managerController.getComingSoon);
router.get('/approve/dependants', managerController.getComingSoon);
router.get('/approve/income-setup', managerController.getComingSoon);
router.get('/approve/travel', managerController.getComingSoon);
router.get('/approve/salary', managerController.getComingSoon);
router.get('/approve/edited-payroll', managerController.getComingSoon);
router.get('/approve/leave', managerController.getComingSoon);
router.get('/approve/interview', managerController.getComingSoon);
router.get('/approve/promotion-demotion', managerController.getComingSoon);
router.get('/approve/transfer', managerController.getComingSoon);
router.get('/approve/training', managerController.getComingSoon);
router.get('/approve/query', managerController.getComingSoon);
router.get('/approve/acting-allowance', managerController.getComingSoon);
router.get('/approve/yearly', managerController.getComingSoon);
router.get('/approve/exit', managerController.getComingSoon);
router.get('/approve/appraisals', managerController.getComingSoon);
router.get('/approve/attendance', managerController.getComingSoon);
router.get('/approve/loan', managerController.getComingSoon);
router.get('/approve/guarantee', managerController.getComingSoon);
router.get('/approve/salary-review', managerController.getComingSoon);
router.get('/approve/increment', managerController.getComingSoon);
router.get('/approve/bonus', managerController.getComingSoon);
router.get('/approve/end-of-service', managerController.getComingSoon);
router.get('/approve/redundancy', managerController.getComingSoon);
router.get('/approve/entitlement', managerController.getComingSoon);

// Reports
router.get('/reports/payroll', managerController.getComingSoon);
router.get('/reports/journal', managerController.getComingSoon);
router.get('/reports/vehicle-insurance', managerController.getComingSoon);
router.get('/reports/medical', managerController.getComingSoon);
router.get('/reports/bio-data', managerController.getComingSoon);
router.get('/reports/loan', managerController.getComingSoon);
router.get('/reports/long-service', managerController.getComingSoon);
router.get('/reports/leave', managerController.getComingSoon);
router.get('/reports/guarantees', managerController.getComingSoon);
router.get('/reports/acting-allowance', managerController.getComingSoon);
router.get('/reports/attendance', managerController.getComingSoon);
router.get('/reports/nassit-grats', managerController.getComingSoon);
router.get('/reports/payroll-liabilities', managerController.getComingSoon);
router.get('/reports/com-org-liabilities', managerController.getComingSoon);
router.get('/reports/yearly-payments', managerController.getComingSoon);
router.get('/reports/benefit-status', managerController.getComingSoon);
router.get('/reports/travel', managerController.getComingSoon);
router.get('/reports/redundancy', managerController.getComingSoon);
router.get('/reports/master-pay-sheet', managerController.getComingSoon);

module.exports = router;
