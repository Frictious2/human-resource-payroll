const express = require('express');
const router = express.Router();
const developer = require('../controllers/developerController');

// Redirect /developer → /developer/dashboard
router.get('/', (req, res) => res.redirect('/developer/dashboard'));

// Dashboard
router.get('/dashboard', developer.renderDashboard);

// Developer subnav routes
router.get('/developers', developer.comingSoon('Developers', 'Developers'));
router.get('/developers/new', developer.comingSoon('Add Developer', 'Developers'));

router.get('/companies', developer.comingSoon('Companies', 'Company'));
router.get('/companies/new', developer.comingSoon('Add Company', 'Company'));

router.get('/admins', developer.comingSoon('Admins', 'Admin'));
router.get('/admins/new', developer.comingSoon('Add Admin', 'Admin'));

router.get('/licenses', developer.comingSoon('Licenses', 'License'));
router.get('/licenses/new', developer.comingSoon('Add License', 'License'));

module.exports = router;