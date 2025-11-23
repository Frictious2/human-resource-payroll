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

router.get('/managers', adminController.comingSoon('Managers', 'Manager'));
router.get('/managers/new', adminController.comingSoon('Add Manager', 'Manager'));

router.get('/data-entry-officers', adminController.comingSoon('Data Entry Officers', 'Data Entry'));
router.get('/data-entry-officers/new', adminController.comingSoon('Add Data Entry Officer', 'Data Entry'));

router.get('/parameters/payroll-items', adminController.comingSoon('Payroll Items', 'Parameters'));
router.get('/parameters/departments', adminController.comingSoon('Department', 'Parameters'));
router.get('/parameters/job-titles', adminController.comingSoon('Job Title', 'Parameters'));
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