const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');

router.get('/', profileController.renderProfile);
router.post('/', profileController.updateProfile);
router.post('/password', profileController.updatePassword);

module.exports = router;
