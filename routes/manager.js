const express = require('express');
const router = express.Router();
const managerController = require('../controllers/managerController');
const dataEntryController = require('../controllers/dataEntryController');
const benefitController = require('../controllers/benefitController');

// Dashboard
router.get('/', (req, res) => res.redirect('/manager/dashboard'));
router.get('/dashboard', managerController.getDashboard);

// Enquiry
router.get('/enquiry/staff', managerController.getStaffEnquiry);
router.get('/enquiry/staff/general-info', managerController.getStaffGeneralInfo);
router.get('/enquiry/transfer-prom', managerController.getComingSoon);
router.get('/enquiry/warning', managerController.getComingSoon);
router.get('/enquiry/training', managerController.getTransferApprovals);
router.get('/enquiry/on-leave', managerController.getComingSoon);
router.get('/enquiry/medical', managerController.getComingSoon);

// Activity
router.get('/activity/run-salary-review', managerController.getComingSoon);
router.get('/activity/medical-limits', managerController.getComingSoon);

// Approve
router.get('/approve/new-staff', managerController.getApproveNewStaff);
router.post('/approve/new-staff', managerController.postApproveNewStaff);
router.get('/approve/new-staff/view', managerController.getApproveNewStaffView);
router.get('/approve/dependants', managerController.getApproveDependants);
router.post('/approve/dependants', managerController.postApproveDependants);
router.get('/approve/income-setup', managerController.getApproveIncomeSetup);
router.get('/approve/income-setup/view', managerController.getApproveIncomeSetupView);
router.post('/approve/income-setup', managerController.postApproveIncomeSetup);
router.get('/approve/travel', managerController.getComingSoon);
router.get('/approve/salary', managerController.getApproveSalary);
router.get('/approve/salary/view', managerController.getApproveSalaryView);
router.post('/approve/salary', managerController.postApproveSalary);
router.get('/approve/edited-payroll', managerController.getApproveEditedPayroll);
router.get('/approve/edited-payroll/view', managerController.getApproveEditedPayrollView);
router.post('/approve/edited-payroll', managerController.postApproveEditedPayroll);
router.get('/approve/leave', managerController.getApproveLeave);
router.get('/approve/leave-application', managerController.getLeaveApplicationApproval);
router.post('/api/approve/leave', managerController.postLeaveApproval);
router.get('/approve/leave-recall', managerController.getLeaveRecallApproval);
router.post('/api/approve/leave-recall', managerController.postLeaveRecallApproval);
router.get('/approve/leave-purchase', managerController.getApproveLeavePurchase);
router.post('/api/approve/leave-purchase', managerController.postApproveLeavePurchase);
router.get('/approve/on-leave', managerController.getStaffOnLeave);
router.get('/leave/outstanding-report', dataEntryController.getLeaveOutstandingReport);
router.get('/approve/interview', managerController.getApproveInterview);
router.post('/approve/interview', managerController.postApproveInterview);
router.post('/reject/interview', managerController.postRejectInterview);
router.get('/approve/promotion-demotion', managerController.getApprovePromotionDemotion);
router.post('/approve/promotion-demotion', managerController.postApprovePromotion);
router.get('/approve/transfer', managerController.getTransferApprovals);
router.post('/approve/transfer', managerController.postTransferApproval);
router.get('/approve/training', managerController.getApproveTraining);
router.get('/approve/training/view', managerController.getApproveTrainingView);
router.post('/api/approve/training', managerController.postApproveTraining);
router.get('/approve/query', managerController.getApproveQuery);
router.post('/approve/query', managerController.postApproveQuery);
router.get('/approve/acting-allowance', managerController.getComingSoon);
router.get('/approve/yearly', managerController.getComingSoon);
// Staff Exit Approval
router.get('/approve/exit', managerController.getApproveExit);
router.post('/approve/exit', managerController.postApproveExit);
router.get('/approve/appraisals', managerController.getApproveAppraisals);
router.get('/approve/appraisals/view', managerController.getApproveAppraisalView);
router.post('/approve/appraisals', managerController.postApproveAppraisal);
router.get('/approve/entitlement', managerController.getApproveEntitlement);
router.get('/approve/entitlement/view', managerController.getApproveEntitlementView);
router.post('/approve/entitlement', managerController.postApproveEntitlement);

router.get('/approve/attendance', managerController.getComingSoon);
router.get('/approve/loan', managerController.getApproveLoan);
router.post('/approve/loan', managerController.postApproveLoan);
router.post('/api/approve/loan-repayment', managerController.postApproveLoanRepayment);
router.get('/approve/guarantee', managerController.getApproveGuarantee);
router.post('/api/approve/guarantee', managerController.postApproveGuarantee);
router.get('/approve/salary-review', managerController.getComingSoon);
router.get('/approve/increment', managerController.getComingSoon);
router.get('/approve/bonus', managerController.getComingSoon);
router.get('/approve/end-of-service', managerController.getComingSoon);
router.get('/approve/redundancy', managerController.getApproveRedundancy);
router.post('/approve/redundancy', managerController.approveRedundancy);
router.get('/approve/entitlement', managerController.getComingSoon);

// Reports
router.get('/reports/payroll', managerController.getPayrollReports);
router.get('/reports/journal', managerController.getJournalReport);
router.get('/reports/journal/preview', managerController.getJournalReportPreview);
router.get('/reports/vehicle-insurance', managerController.getComingSoon);
router.get('/reports/medical', dataEntryController.getMedicalReports);
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
router.get('/reports/benefit-status', benefitController.getBenefitStatusManager);
router.post('/api/reports/benefit-status/calculate', benefitController.calculateBenefits);
router.get('/reports/travel', managerController.getComingSoon);
router.get('/reports/redundancy', managerController.getComingSoon);
router.get('/reports/master-pay-sheet', managerController.getComingSoon);

module.exports = router;
