const financeDashboardService = require('./financeDashboardService');
const yearlyPaymentService = require('./yearlyPaymentService');
const payrollReversalService = require('./payrollReversalService');
const payrollReopenService = require('./payrollReopenService');

const YEARLY_PAYMENT_TYPE_CODES = ['02', '05', '13'];

function resolveCompanyId(companyId) {
    return Number(companyId) || 1;
}

function mapYearlyStatusLabel(status) {
    const value = String(status || '').trim().toUpperCase();
    if (!value) return 'Not Prepared';
    if (value === 'DRAFT' || value === 'CALCULATED') return 'Draft';
    if (value === 'SUBMITTED_TO_MANAGER' || value === 'SUBMITTED_TO_AUDITOR' || value === 'SUBMITTED_TO_ENTITY_HEAD') return 'Under Review';
    if (value === 'RETURNED_BY_MANAGER' || value === 'RETURNED_BY_AUDITOR') return 'Returned';
    if (value === 'FINAL_REJECTED') return 'Rejected';
    if (value === 'FINAL_APPROVED' || value === 'APPLIED') return 'Approved';
    return value;
}

function buildYearlyOverviewRows(batches, supportedTypes, paymentYear) {
    return YEARLY_PAYMENT_TYPE_CODES.map((code) => {
        const typeMeta = supportedTypes.find((item) => item.code === code) || { code, label: code };
        const batch = batches.find((item) => String(item.PaymentType || '').trim() === code && Number(item.PaymentYear) === Number(paymentYear)) || null;

        return {
            code,
            label: typeMeta.label,
            batchId: batch ? batch.id : null,
            status: batch ? batch.Status : 'NOT_PREPARED',
            displayStatus: batch ? mapYearlyStatusLabel(batch.Status) : 'Not Prepared',
            totalStaff: Number(batch?.TotalStaff || 0),
            totalAmount: Number(batch?.TotalAmount || 0),
            submittedBy: batch?.PreparedBy || '-',
            updatedAt: batch?.UpdatedAt || null
        };
    });
}

async function getFinanceManagerDashboardData({ companyId }) {
    const resolvedCompanyId = resolveCompanyId(companyId);
    const paymentYear = new Date().getFullYear();

    const [financeData, yearlyPageData, reversalCounts, reopenCounts] = await Promise.all([
        financeDashboardService.getFinanceDashboardData({ companyId: resolvedCompanyId }),
        yearlyPaymentService.getFinancePageData({
            companyId: resolvedCompanyId,
            filters: { paymentYear }
        }),
        payrollReversalService.getRoleDashboardSummary(resolvedCompanyId),
        payrollReopenService.getRoleDashboardSummary(resolvedCompanyId)
    ]);

    const latestBatch = financeData.recentBatches[0] || null;
    const latestActiveBatch = financeData.recentBatches.find((row) => row.Status !== 'REVERSED') || latestBatch;

    return {
        company: financeData.company,
        cards: financeData.cards,
        latestSnapshot: financeData.latestSnapshot,
        latestBatch,
        latestActiveBatch,
        recentBatches: financeData.recentBatches,
        yearlyOverview: buildYearlyOverviewRows(yearlyPageData.batches || [], yearlyPageData.supportedTypes || [], paymentYear),
        yearlyPaymentYear: paymentYear,
        reversalCounts,
        reopenCounts
    };
}

module.exports = {
    getFinanceManagerDashboardData
};
