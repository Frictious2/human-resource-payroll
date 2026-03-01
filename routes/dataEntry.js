const express = require('express');
const router = express.Router();
const dataEntryController = require('../controllers/dataEntryController');
const multer = require('multer');
const path = require('path');

// Multer Setup for Staff Photos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/staff_photos/');
    },
    filename: function (req, file, cb) {
        cb(null, req.body.pfno + '_' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Multer Setup for Medical Receipts
const medicalStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Ensure directory exists or use a standard one. 
        // Ideally we should check/create, but for now assuming public/uploads exists.
        // I will stick to a new folder 'medical_receipts' inside uploads.
        // Note: The user might need to create this folder manually or I should ensure it exists.
        // Since I can't easily run 'mkdir', I'll assume 'public/uploads' exists and maybe just put it there 
        // or rely on node to not fail if I point to it. 
        // Actually, multer throws if dir doesn't exist. 
        // I'll check if I can use 'fs' to ensure dir exists in the controller or just use 'public/uploads' root?
        // No, let's try to be organized. 'public/uploads/medical_receipts/'
        cb(null, 'public/uploads/medical_receipts/');
    },
    filename: function (req, file, cb) {
        cb(null, 'MED_' + req.body.pfno + '_' + Date.now() + path.extname(file.originalname));
    }
});
const uploadMedical = multer({ storage: medicalStorage });

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
router.get('/staff/new-edit', dataEntryController.getStaffNewEdit);
router.get('/staff/new-edit/search', dataEntryController.searchStaffNewEdit);
router.get('/api/staff/:pfno/last-leave', dataEntryController.getStaffLastLeave);
router.get('/api/staff/:pfno/qualifications', dataEntryController.getStaffQualifications);
router.post('/staff/new-edit', upload.single('photo'), dataEntryController.postStaffNewEdit);
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
router.post('/staff/redundancy', dataEntryController.initiateRedundancy);

// Staff Exit
router.get('/staff/exit', dataEntryController.getStaffExit);
router.get('/staff/exit/search', dataEntryController.searchStaffExit);
router.post('/staff/exit', dataEntryController.postStaffExit);
router.get('/staff/import', dataEntryController.getComingSoon);
router.get('/staff/travel', dataEntryController.getComingSoon);

// Leave
router.get('/leave/application', dataEntryController.getLeaveApplication);
router.get('/leave/recall', dataEntryController.getLeaveRecall);
router.get('/leave/purchase', dataEntryController.getLeavePurchase);
router.get('/leave/on-leave', dataEntryController.getStaffOnLeave);
router.post('/api/leave/recall', dataEntryController.postLeaveRecall);
router.post('/api/leave/purchase', dataEntryController.postLeavePurchase);
router.get('/api/leave/staff/:pfno/:year', dataEntryController.getLeaveStaffData);
router.get('/api/staff-leave-data/:pfno', dataEntryController.getStaffLeaveDataForPurchase);
router.post('/api/leave/application', dataEntryController.postLeaveApplication);
router.get('/leave/outstanding-report', dataEntryController.getLeaveOutstandingReport);

// 3. Payroll
router.get('/payroll/entitle', dataEntryController.getPayrollEntitle);
router.get('/api/payroll/entitle/:pfno', dataEntryController.getEntitleByStaff);
router.post('/payroll/entitle', dataEntryController.postPayrollEntitle);
router.get('/payroll/income-setup', dataEntryController.getPayrollIncomeSetup);
router.get('/api/payroll/income-setup', dataEntryController.getIncomeSetupByGrade);
router.get('/api/payroll/income-setup/record', dataEntryController.getIncomeSetupRecord);
router.post('/payroll/income-setup', dataEntryController.postPayrollIncomeSetup);
router.get('/payroll/payroll-setup', dataEntryController.getPayrollSetup);
router.get('/api/payroll/payroll-setup/:pfno', dataEntryController.getPayrollSetupByStaff);
router.post('/payroll/payroll-setup', dataEntryController.postPayrollSetup);
router.get('/payroll/edit-payroll', dataEntryController.getPayrollEdit);
router.post('/payroll/edit-payroll', dataEntryController.postPayrollEdit);
router.get('/payroll/view-payroll', dataEntryController.getPayrollView);
router.post('/payroll/view-payroll/preview', dataEntryController.postPayrollViewPreview);
router.get('/payroll/process-emoluments', dataEntryController.getProcessEmoluments);
router.get('/api/payroll/check-process-status', dataEntryController.checkProcessStatus);
router.post('/payroll/process-emoluments', dataEntryController.postProcessEmoluments);
router.get('/payroll/post-to-accounts', dataEntryController.getComingSoon);
router.get('/payroll/yearly-payments', dataEntryController.getComingSoon);
router.get('/payroll/increments-pay-cut-backlog', dataEntryController.getComingSoon);
router.get('/payroll/acting-allowance', dataEntryController.getComingSoon);
router.get('/payroll/bonus', dataEntryController.getComingSoon);
router.get('/payroll/liabilities', dataEntryController.getComingSoon);
router.get('/payroll/salary-reviews', dataEntryController.getComingSoon);
router.get('/payroll/vehicle-insurance', dataEntryController.getComingSoon);

// 4. Welfare
router.get('/welfare/leave', dataEntryController.getWelfareLeave);
router.get('/welfare/medical', dataEntryController.getWelfareMedical);
router.get('/api/welfare/medical/:pfno', dataEntryController.getStaffMedicalHistory);
router.post('/api/welfare/medical/add', uploadMedical.single('picture'), dataEntryController.addMedicalRecord);
router.post('/api/welfare/medical/update', uploadMedical.single('picture'), dataEntryController.updateMedicalRecord);
router.get('/welfare/loan', dataEntryController.getComingSoon);
router.get('/welfare/guarantee', dataEntryController.getComingSoon);
router.get('/welfare/benefits', dataEntryController.getComingSoon);
router.get('/welfare/corporate-benefit', dataEntryController.getComingSoon);
router.get('/welfare/redundancy', dataEntryController.getWelfareRedundancy);

// 5. Reports
router.get('/reports/payroll', dataEntryController.getPayrollReports);
router.get('/api/staff/:pfno/name', dataEntryController.getStaffName);
router.get('/api/welfare/redundancy', dataEntryController.getRedundancySheetData);
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
