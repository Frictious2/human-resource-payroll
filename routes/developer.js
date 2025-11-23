const express = require('express');
const router = express.Router();
const developer = require('../controllers/developerController');

// Redirect /developer → /developer/dashboard
router.get('/', (req, res) => res.redirect('/developer/dashboard'));

// Dashboard
router.get('/dashboard', developer.renderDashboard);

// Developers list page
router.get('/developers', developer.listPage);

// Developers data API (DataTables)
router.get('/api/developers', developer.listJson);

// Add developer page
router.get('/developers/new', developer.newPage);
router.post('/developers', developer.createDeveloper);

// Edit developer page and update
router.get('/developers/:id/edit', developer.editPage);
router.post('/developers/:id', developer.updateDeveloper);

// Delete developer (AJAX)
router.delete('/api/developers/:id', developer.deleteDeveloper);

// Other subnav routes remain
router.get('/companies', developer.comingSoon('Companies', 'Company'));
router.get('/companies/new', developer.comingSoon('Add Company', 'Company'));
router.get('/admins', developer.comingSoon('Admins', 'Admin'));
router.get('/admins/new', developer.comingSoon('Add Admin', 'Admin'));
router.get('/licenses', developer.comingSoon('Licenses', 'License'));
router.get('/licenses/new', developer.comingSoon('Add License', 'License'));

module.exports = router;