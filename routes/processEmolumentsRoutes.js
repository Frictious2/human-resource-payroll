const express = require('express');
const ProcessEmolumentsController = require('../controllers/processEmolumentsController');

const router = express.Router();

router.get('/', ProcessEmolumentsController.showProcessForm);
router.post('/', ProcessEmolumentsController.process);
router.get('/history', ProcessEmolumentsController.history);
router.get('/history/:batchId', ProcessEmolumentsController.viewBatchDetails);
router.post('/:batchId/reverse', ProcessEmolumentsController.reverse);

module.exports = router;
