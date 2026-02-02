const express = require('express');
const router = express.Router();
const dataEntryController = require('../controllers/dataEntryController');

// Dashboard
router.get('/', (req, res) => res.redirect('/data-entry/dashboard'));
router.get('/dashboard', dataEntryController.getDashboard);

// 1. Enquiry
router.get('/enquiry/staff', dataEntryController.getStaffEnquiry);
router.get('/enquiry/staff/birthdays', dataEntryController.getStaffBirthdays);
router.get('/enquiry/staff/general-info', dataEntryController.getStaffGeneralInfo);
router.get('/enquiry/transfer-promotion', dataEntryController.getComingSoon);
router.get('/enquiry/training', dataEntryController.getTrainingEnquiry);
router.get('/enquiry/discipline', dataEntryController.getDisciplineEnquiry);
router.get('/enquiry/loan-balance', dataEntryController.getComingSoon);
router.get('/enquiry/medical', dataEntryController.getComingSoon);
router.get('/enquiry/applications', dataEntryController.getApplicationsEnquiry);

// 2. Staff
router.get('/staff/applications', dataEntryController.getApplications);
router.post('/staff/applications', dataEntryController.postApplications);
router.get('/staff/interview', dataEntryController.getInterview);
router.post('/staff/invite', dataEntryController.postInvite);
router.get('/api/applicant/:refno', dataEntryController.getApplicantDetails);
router.get('/staff/new-edit', dataEntryController.getComingSoon);
router.get('/staff/dependants', dataEntryController.getDependants);
router.get('/api/staff/:pfno/dependants', dataEntryController.searchDependants);
router.post('/api/staff/dependants', dataEntryController.addDependant);
router.put('/api/staff/dependants', dataEntryController.editDependant);
router.post('/api/staff/dependants/check-over-18', dataEntryController.checkOver18Dependants);
router.get('/staff/attendance', dataEntryController.getComingSoon);
router.get('/staff/transfer', dataEntryController.getTransfer);
router.get('/api/staff/transfer/search', dataEntryController.searchStaffForTransfer);
router.post('/staff/transfer', dataEntryController.postTransfer);
router.get('/staff/training', dataEntryController.getTraining);
router.get('/api/staff/training/search', dataEntryController.searchStaffTraining);
router.post('/api/staff/training', dataEntryController.addTraining);
router.put('/api/staff/training', dataEntryController.updateTraining);
router.get('/staff/queries', dataEntryController.getQueries);
router.get('/api/staff/:pfno/queries', dataEntryController.searchQueries);
router.post('/api/staff/queries', dataEntryController.addQuery);
router.put('/api/staff/queries', dataEntryController.editQuery);
router.get('/staff/appraisal', dataEntryController.getAppraisal);
router.get('/api/staff/:pfno/appraisals', dataEntryController.searchAppraisals);
router.post('/api/staff/appraisals', dataEntryController.addAppraisal);
router.put('/api/staff/appraisals', dataEntryController.editAppraisal);
router.get('/staff/promotion-demotion', dataEntryController.getPromotionDemotion);
router.get('/api/staff/:pfno/promotion-details', dataEntryController.searchStaffPromotionDetails);
router.post('/staff/promotion-demotion', dataEntryController.addPromotion);
router.get('/staff/redundancy', dataEntryController.getStaffRedundancy);
router.post('/staff/redundancy/initiate', dataEntryController.initiateRedundancy);
router.get('/staff/exit', dataEntryController.getComingSoon);
router.get('/staff/import', dataEntryController.getComingSoon);
router.get('/staff/travel', dataEntryController.getComingSoon);

// 3. Payroll
router.get('/payroll/entitle', dataEntryController.getComingSoon);
router.get('/payroll/income-setup', dataEntryController.getComingSoon);
router.get('/payroll/payroll-setup', dataEntryController.getComingSoon);
router.get('/payroll/edit-payroll', dataEntryController.getComingSoon);
router.get('/payroll/view-payroll', dataEntryController.getComingSoon);
router.get('/payroll/process-emoluments', dataEntryController.getComingSoon);
router.get('/payroll/post-to-accounts', dataEntryController.getComingSoon);
router.get('/payroll/yearly-payments', dataEntryController.getComingSoon);
router.get('/payroll/increments-pay-cut-backlog', dataEntryController.getComingSoon);
router.get('/payroll/acting-allowance', dataEntryController.getComingSoon);
router.get('/payroll/bonus', dataEntryController.getComingSoon);
router.get('/payroll/liabilities', dataEntryController.getComingSoon);
router.get('/payroll/salary-reviews', dataEntryController.getComingSoon);
router.get('/payroll/vehicle-insurance', dataEntryController.getComingSoon);

// 4. Welfare
router.get('/welfare/leave', dataEntryController.getComingSoon);
router.get('/welfare/medical', dataEntryController.getComingSoon);
router.get('/welfare/loan', dataEntryController.getComingSoon);
router.get('/welfare/guarantee', dataEntryController.getComingSoon);
router.get('/welfare/benefits', dataEntryController.getComingSoon);
router.get('/welfare/corporate-benefit', dataEntryController.getComingSoon);
router.get('/welfare/redundancy', dataEntryController.getComingSoon);

// 5. Reports
router.get('/reports/payroll', dataEntryController.getPayrollReports);
router.get('/api/staff/:pfno/name', dataEntryController.getStaffName);
router.get('/api/reports/payslip', dataEntryController.getPayslipData);
router.get('/reports/journal', dataEntryController.getComingSoon);
router.get('/reports/vehicle-insurance-status', dataEntryController.getComingSoon);
router.get('/reports/medical', dataEntryController.getComingSoon);
router.get('/reports/bio-data', dataEntryController.getComingSoon);
router.get('/reports/loan', dataEntryController.getComingSoon);
router.get('/reports/long-service', dataEntryController.getComingSoon);
router.get('/reports/leave', dataEntryController.getComingSoon);
router.get('/reports/guarantees', dataEntryController.getComingSoon);
router.get('/reports/acting-allowance', dataEntryController.getComingSoon);
router.get('/reports/attendance', dataEntryController.getComingSoon);
router.get('/reports/nassit-grats-statement', dataEntryController.getComingSoon);
router.get('/reports/payroll-liabilities', dataEntryController.getComingSoon);
router.get('/reports/com-org-liabilities', dataEntryController.getComingSoon);
router.get('/reports/yearly-payments', dataEntryController.getComingSoon);
router.get('/reports/benefit-status', dataEntryController.getComingSoon);
router.get('/reports/travel', dataEntryController.getComingSoon);
router.get('/reports/redundancy', dataEntryController.getComingSoon);
router.get('/reports/master-pay-sheet', dataEntryController.getComingSoon);

module.exports = router;
