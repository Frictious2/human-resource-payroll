const express = require('express');
const router = express.Router();
const financeManagerController = require('../controllers/financeManagerController');
const yearlyPaymentController = require('../controllers/yearlyPaymentController');
const payrollLiabilityReportController = require('../controllers/payrollLiabilityReportController');
const dataEntryController = require('../controllers/dataEntryController');
const benefitController = require('../controllers/benefitController');

router.get('/', (req, res) => res.redirect('/finance-manager/dashboard'));
router.get('/dashboard', financeManagerController.getDashboard);

router.get('/payroll/workflow', financeManagerController.getPayrollWorkflowList);
router.get('/payroll/workflow/:batchId', financeManagerController.getPayrollWorkflowDetail);

router.get('/payroll/yearly-payments', yearlyPaymentController.getFinanceManagerIndex);
router.get('/payroll/yearly-payments/:batchId', yearlyPaymentController.getFinanceManagerDetail);

router.get('/payroll/reversals', financeManagerController.getReversalList);
router.get('/payroll/reversals/:requestId', financeManagerController.getReversalDetail);

router.get('/payroll/reopen', financeManagerController.getReopenList);
router.get('/payroll/reopen/:requestId', financeManagerController.getReopenDetail);

router.get('/reports/journal', yearlyPaymentController.getFinanceManagerJournalReport);
router.get('/reports/journal/preview', yearlyPaymentController.getFinanceManagerJournalPreview);
router.get('/reports/end-of-service', yearlyPaymentController.getFinanceManagerBenefitStatus);
router.post('/api/reports/benefit-status/calculate', benefitController.calculateBenefits);
router.get('/reports/payslip', yearlyPaymentController.getFinanceManagerPayslipPage);
router.get('/api/reports/payslip', dataEntryController.getPayslipData);

router.get('/reports/general-ledger', financeManagerController.getGeneralLedgerHistory);
router.get('/reports/general-ledger/:id', financeManagerController.getGeneralLedgerBatchDetail);

router.get('/reports/payroll-liabilities', payrollLiabilityReportController.getFinanceManagerIndex);
router.get('/reports/payroll-liabilities/preview', payrollLiabilityReportController.getFinanceManagerPreview);
router.get('/reports/payroll-liabilities/pdf', payrollLiabilityReportController.getFinanceManagerPdf);
router.get('/reports/payroll-liabilities/excel', payrollLiabilityReportController.getFinanceManagerExcel);
router.get('/reports/payroll-liabilities/staff-preview', payrollLiabilityReportController.getFinanceManagerStaffPreview);
router.get('/reports/payroll-liabilities/staff-pdf', payrollLiabilityReportController.getFinanceManagerStaffPdf);

module.exports = router;
