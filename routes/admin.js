const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// Redirect /admin → /admin/dashboard
router.get('/', (req, res) => res.redirect('/admin/dashboard'));

// Dashboard
router.get('/dashboard', adminController.renderDashboard);

// Admin subnav routes
router.get('/admins', adminController.adminsListPage);
router.get('/api/admins', adminController.adminsListJson);
router.get('/admins/new', adminController.adminsNewPage);
router.post('/admins', adminController.createAdmin);
router.get('/admins/set-password', adminController.setPasswordPage);
router.post('/admins/set-password', adminController.setPasswordSubmit);

// Action APIs
router.post('/api/admins/:pfno/resend-link', adminController.resendLink);
router.delete('/api/admins/:pfno', adminController.deleteAdmin);

router.get('/managers', adminController.managersListPage);
router.get('/api/managers', adminController.managersListJson);
router.get('/managers/new', adminController.managersNewPage);
router.post('/managers', adminController.createManager);
router.post('/api/managers/:pfno/resend-link', adminController.resendLink);
router.delete('/api/managers/:pfno', adminController.deleteManager);

router.get('/data-entry-officers', adminController.dataEntryListPage);
router.get('/api/data-entry-officers', adminController.dataEntryListJson);
router.get('/data-entry-officers/new', adminController.dataEntryNewPage);
router.post('/data-entry-officers', adminController.createDataEntry);
router.post('/api/data-entry-officers/:pfno/resend-link', adminController.resendLink);
router.delete('/api/data-entry-officers/:pfno', adminController.deleteDataEntry);

router.get('/parameters/payroll-items', adminController.payrollItemsPage);
router.get('/api/parameters/payroll-items', adminController.payrollItemsListJson);
router.post('/api/parameters/payroll-items', adminController.createPayrollItem);
router.patch('/api/parameters/payroll-items/:code', adminController.updatePayrollItem);
router.delete('/api/parameters/payroll-items/:code', adminController.deletePayrollItem);
router.get('/parameters/departments', adminController.departmentsPage);
router.get('/api/parameters/departments', adminController.departmentsListJson);
router.post('/api/parameters/departments', adminController.createDepartment);
router.patch('/api/parameters/departments/:code', adminController.updateDepartment);
router.delete('/api/parameters/departments/:code', adminController.deleteDepartment);
router.get('/parameters/job-titles', adminController.jobTitlesPage);
router.get('/api/parameters/job-titles', adminController.jobTitlesListJson);
router.post('/api/parameters/job-titles', adminController.createJobTitle);
router.patch('/api/parameters/job-titles/:code', adminController.updateJobTitle);
router.delete('/api/parameters/job-titles/:code', adminController.deleteJobTitle);
router.get('/parameters/grades', adminController.comingSoon('Grade', 'Parameters'));
router.get('/parameters/banks', adminController.comingSoon('Banks', 'Parameters'));
router.get('/parameters/company-bban', adminController.comingSoon('Company BBAN', 'Parameters'));
router.get('/parameters/gl-accounts', adminController.comingSoon('GL Accounts', 'Parameters'));
router.get('/parameters/discipline-outcomes', adminController.comingSoon('Discipline Outcomes', 'Parameters'));
router.get('/parameters/discipline-reasons', adminController.comingSoon('Discipline Reasons', 'Parameters'));
router.get('/parameters/queries', adminController.comingSoon('Queries', 'Parameters'));
router.get('/parameters/courses', adminController.comingSoon('Courses', 'Parameters'));
router.get('/parameters/emp-status', adminController.comingSoon('EMP Status', 'Parameters'));
router.get('/parameters/service-benefit', adminController.comingSoon('Service Benefit', 'Parameters'));
router.get('/parameters/global-params', adminController.comingSoon('Global Params', 'Parameters'));
router.get('/parameters/work-days', adminController.comingSoon('Work Days', 'Parameters'));
router.get('/parameters/public-holidays', adminController.comingSoon('Public Holidays', 'Parameters'));
router.get('/parameters/tax-table', adminController.comingSoon('Tax Table', 'Parameters'));
router.get('/parameters/sponsors', adminController.comingSoon('Sponsors', 'Parameters'));

router.get('/activities/enquiry', adminController.comingSoon('Enquiry', 'Activities'));
router.get('/activities/staff-file', adminController.comingSoon('Staff File', 'Activities'));
router.get('/activities/import', adminController.comingSoon('Import', 'Activities'));
router.get('/activities/discipline', adminController.comingSoon('Discipline', 'Activities'));

router.get('/reports/voucher', adminController.comingSoon('Voucher', 'Reports'));
router.get('/reports/payslip', adminController.comingSoon('Pay slip', 'Reports'));
router.get('/reports/end-of-service', adminController.comingSoon('End of Service', 'Reports'));

router.get('/company-info', adminController.comingSoon('Company Info', 'Company Info'));

module.exports = router;