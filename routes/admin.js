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
router.get('/parameters/grades', adminController.gradesPage);
router.get('/api/parameters/grades', adminController.gradesListJson);
router.post('/api/parameters/grades', adminController.createGrade);
router.patch('/api/parameters/grades/:code', adminController.updateGrade);
router.delete('/api/parameters/grades/:code', adminController.deleteGrade);
router.get('/parameters/banks', adminController.banksPage);
router.get('/api/parameters/banks', adminController.banksListJson);
router.post('/api/parameters/banks', adminController.createBank);
router.patch('/api/parameters/banks/:code', adminController.updateBank);
router.delete('/api/parameters/banks/:code', adminController.deleteBank);
router.get('/parameters/company-bban', adminController.companyBBANPage);
router.get('/api/parameters/company-bban', adminController.companyBBANListJson);
router.post('/api/parameters/company-bban', adminController.createCompanyBBAN);
router.patch('/api/parameters/company-bban/:code', adminController.updateCompanyBBAN);
router.delete('/api/parameters/company-bban/:code', adminController.deleteCompanyBBAN);
router.get('/parameters/gl-accounts', adminController.glAccountsPage);
router.get('/api/parameters/gl-accounts', adminController.glAccountsListJson);
router.post('/api/parameters/gl-accounts', adminController.createGLAccount);
router.patch('/api/parameters/gl-accounts/:glNo', adminController.updateGLAccount);
router.delete('/api/parameters/gl-accounts/:glNo', adminController.deleteGLAccount);
router.get('/parameters/discipline-outcomes', adminController.disciplineOutcomesPage);
router.get('/api/parameters/discipline-outcomes', adminController.disciplineOutcomesListJson);
router.post('/api/parameters/discipline-outcomes', adminController.createDisciplineOutcome);
router.patch('/api/parameters/discipline-outcomes/:code', adminController.updateDisciplineOutcome);
router.delete('/api/parameters/discipline-outcomes/:code', adminController.deleteDisciplineOutcome);
router.get('/parameters/discipline-reasons', adminController.disciplineReasonsPage);
router.get('/api/parameters/discipline-reasons', adminController.disciplineReasonsListJson);
router.post('/api/parameters/discipline-reasons', adminController.createDisciplineReason);
router.patch('/api/parameters/discipline-reasons/:code', adminController.updateDisciplineReason);
router.delete('/api/parameters/discipline-reasons/:code', adminController.deleteDisciplineReason);

router.get('/parameters/queries', adminController.queriesPage);
router.get('/api/parameters/queries', adminController.queriesListJson);
router.post('/api/parameters/queries', adminController.createQuery);
router.patch('/api/parameters/queries/:code', adminController.updateQuery);
router.delete('/api/parameters/queries/:code', adminController.deleteQuery);

// Courses
router.get('/parameters/courses', adminController.coursesPage);
router.get('/api/parameters/courses', adminController.coursesListJson);
router.post('/api/parameters/courses', adminController.createCourse);
router.patch('/api/parameters/courses/:code', adminController.updateCourse);
router.delete('/api/parameters/courses/:code', adminController.deleteCourse);

// EMP Status
router.get('/parameters/emp-status', adminController.empStatusPage);
router.get('/api/parameters/emp-status', adminController.empStatusListJson);
router.post('/api/parameters/emp-status', adminController.createEmpStatus);
router.patch('/api/parameters/emp-status/:code', adminController.updateEmpStatus);
router.delete('/api/parameters/emp-status/:code', adminController.deleteEmpStatus);

router.get('/parameters/end-of-service-benefit', adminController.eosBenefitPage);
router.get('/api/parameters/end-of-service-benefit', adminController.getEOSBenefit);
router.post('/api/parameters/end-of-service-benefit', adminController.saveEOSBenefit);
// Global Params
router.get('/parameters/global-params', adminController.globalParamsPage);
router.get('/api/parameters/global-params', adminController.getGlobalParams);
router.post('/api/parameters/global-params', adminController.saveGlobalParams);

// Work Days
router.get('/parameters/work-days', adminController.workDaysPage);
router.get('/api/parameters/work-days', adminController.getWorkDays);
router.post('/api/parameters/work-days', adminController.saveWorkDays);
// Public Holidays
router.get('/parameters/public-holidays', adminController.publicHolidaysPage);
router.get('/api/parameters/public-holidays', adminController.getPublicHolidays);
router.post('/api/parameters/public-holidays', adminController.savePublicHoliday);
router.patch('/api/parameters/public-holidays/:year/:name', adminController.updatePublicHoliday);
router.delete('/api/parameters/public-holidays/:year/:name', adminController.deletePublicHoliday);
// Tax Table
router.get('/parameters/tax-table', adminController.taxTablePage);
router.get('/api/parameters/tax-table', adminController.getTaxTable);
router.post('/api/parameters/tax-table', adminController.saveTaxTable);
// Sponsors
router.get('/parameters/sponsors', adminController.sponsorsPage);
router.get('/api/parameters/sponsors', adminController.getSponsors);
router.post('/api/parameters/sponsors', adminController.addSponsor);
router.put('/api/parameters/sponsors/:SCode', adminController.updateSponsor);
router.delete('/api/parameters/sponsors/:SCode', adminController.deleteSponsor);

// Activities
router.get('/activity/enquiry', adminController.enquiryPage);
router.get('/api/activity/enquiry', adminController.getEnquiryData);
router.get('/activity/import', adminController.comingSoon('Import', 'Activities'));
router.get('/activity/discipline', adminController.comingSoon('Discipline', 'Activities'));

router.get('/reports/voucher', adminController.comingSoon('Voucher', 'Reports'));
router.get('/reports/payslip', adminController.comingSoon('Pay slip', 'Reports'));
router.get('/reports/end-of-service', adminController.comingSoon('End of Service', 'Reports'));

router.get('/company-info', adminController.getCompanyInfo);
router.post('/company-info', adminController.upload.single('logo'), adminController.updateCompanyInfo);

// Staff File
router.get('/activity/staff-file', adminController.staffFilePage);
router.get('/api/activity/staff-file', adminController.getStaffFileData);

module.exports = router;
