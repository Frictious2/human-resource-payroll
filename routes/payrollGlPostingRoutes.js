const express = require('express');
const payrollGlPostingController = require('../controllers/payrollGlPostingController');

const router = express.Router();

router.get('/', payrollGlPostingController.renderPostingForm);
router.post('/', payrollGlPostingController.postPayrollToGl);
router.get('/history', payrollGlPostingController.getPostingHistory);
router.get('/history/:id', payrollGlPostingController.getPostingBatchDetail);
router.post('/:id/reverse', payrollGlPostingController.reversePostingBatch);

module.exports = router;
