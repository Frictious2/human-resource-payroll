const express = require('express');
const router = express.Router();
const workQueueController = require('../controllers/workQueueController');

router.get('/', workQueueController.getWorkQueue);

module.exports = router;
