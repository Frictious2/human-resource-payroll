const express = require('express');
const router = express.Router();
const developerController = require('../controllers/developerController');

// Redirect /developer → /developer/dashboard
router.get('/', (req, res) => res.redirect('/developer/dashboard'));

// Dashboard
router.get('/dashboard', developerController.renderDashboard);

// Developers list page
router.get('/developers', developerController.listPage);

// Developers data API (DataTables)
router.get('/api/developers', developerController.listJson);

// Add developer page
router.get('/developers/new', developerController.newPage);
router.post('/developers', developerController.createDeveloper);

// Edit developer page and update
router.get('/developers/:id/edit', developerController.editPage);
router.post('/developers/:id', developerController.updateDeveloper);

// Delete developer (AJAX)
router.delete('/api/developers/:id', developerController.deleteDeveloper);

// Companies list page
router.get('/companies', developerController.companiesListPage);

// Companies data API (DataTables)
router.get('/api/companies', developerController.companiesListJson);

// Add company page
router.get('/companies/new', developerController.companiesNewPage);
router.post('/companies', developerController.createCompany);

// Optional subnav placeholders
// Admins list and add (developer dashboard)
router.get('/admins', developerController.adminsListPage);
router.get('/api/admins', developerController.adminsListJson);
router.get('/admins/new', developerController.adminsNewPage);
router.post('/admins', developerController.createAdmin);

// Admin password setup
router.get('/admins/:pfno/set-password', developerController.setAdminPasswordPage);
router.post('/admins/:pfno/set-password', developerController.setAdminPasswordUpdate);

// Admin delete (AJAX)
router.delete('/api/admins/:pfno', developerController.deleteAdmin);

// Licenses
router.get('/licenses', developerController.licensesListPage);
router.get('/api/licenses', developerController.licensesListJson);
router.get('/licenses/new', developerController.licensesNewPage);
router.post('/licenses', developerController.createLicense);
router.get('/licenses/:id/edit', developerController.licensesEditPage);
router.post('/licenses/:id', developerController.updateLicense);
router.delete('/api/licenses/:id', developerController.deleteLicense);

module.exports = router;