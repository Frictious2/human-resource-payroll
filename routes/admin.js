const express = require('express');
const router = express.Router();
const admin = require('../controllers/adminController');

// Redirect /admin → /admin/dashboard
router.get('/', (req, res) => res.redirect('/admin/dashboard'));

// Dashboard
router.get('/dashboard', admin.renderDashboard);

// Admin subnav routes
router.get('/admins', admin.comingSoon('Admins', 'Admin'));
router.get('/admins/new', admin.comingSoon('Add Admin', 'Admin'));

router.get('/managers', admin.comingSoon('Managers', 'Manager'));
router.get('/managers/new', admin.comingSoon('Add Manager', 'Manager'));

router.get('/data-entry-officers', admin.comingSoon('Data Entry Officers', 'Data Entry'));
router.get('/data-entry-officers/new', admin.comingSoon('Add Data Entry Officer', 'Data Entry'));

router.get('/parameters/payroll-items', admin.comingSoon('Payroll Items', 'Parameters'));
router.get('/parameters/departments', admin.comingSoon('Department', 'Parameters'));
router.get('/parameters/job-titles', admin.comingSoon('Job Title', 'Parameters'));
router.get('/parameters/grades', admin.comingSoon('Grade', 'Parameters'));
router.get('/parameters/banks', admin.comingSoon('Banks', 'Parameters'));
router.get('/parameters/company-bban', admin.comingSoon('Company BBAN', 'Parameters'));
router.get('/parameters/gl-accounts', admin.comingSoon('GL Accounts', 'Parameters'));
router.get('/parameters/discipline-outcomes', admin.comingSoon('Discipline Outcomes', 'Parameters'));
router.get('/parameters/discipline-reasons', admin.comingSoon('Discipline Reasons', 'Parameters'));
router.get('/parameters/queries', admin.comingSoon('Queries', 'Parameters'));
router.get('/parameters/courses', admin.comingSoon('Courses', 'Parameters'));
router.get('/parameters/emp-status', admin.comingSoon('EMP Status', 'Parameters'));
router.get('/parameters/service-benefit', admin.comingSoon('Service Benefit', 'Parameters'));
router.get('/parameters/global-params', admin.comingSoon('Global Params', 'Parameters'));
router.get('/parameters/work-days', admin.comingSoon('Work Days', 'Parameters'));
router.get('/parameters/public-holidays', admin.comingSoon('Public Holidays', 'Parameters'));
router.get('/parameters/tax-table', admin.comingSoon('Tax Table', 'Parameters'));
router.get('/parameters/sponsors', admin.comingSoon('Sponsors', 'Parameters'));

router.get('/activities/enquiry', admin.comingSoon('Enquiry', 'Activities'));
router.get('/activities/staff-file', admin.comingSoon('Staff File', 'Activities'));
router.get('/activities/import', admin.comingSoon('Import', 'Activities'));
router.get('/activities/discipline', admin.comingSoon('Discipline', 'Activities'));

router.get('/reports/voucher', admin.comingSoon('Voucher', 'Reports'));
router.get('/reports/payslip', admin.comingSoon('Pay slip', 'Reports'));
router.get('/reports/end-of-service', admin.comingSoon('End of Service', 'Reports'));

router.get('/company-info', admin.comingSoon('Company Info', 'Company Info'));

module.exports = router;