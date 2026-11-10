require('./requireDisposableDatabase')();
const pool = require('../config/db');
const yearlyPaymentService = require('../services/yearlyPaymentService');

const TEST_USER_ID = 999999;
const TEST_USER_NAME = 'Yearly Workflow Test';
let cleanupContext = null;

async function cleanupTestBatches(companyId, paymentYear) {
    const [rows] = await pool.query(
        `SELECT id
         FROM yearly_payment_batches
         WHERE CompanyID = ?
           AND PaymentYear = ?
           AND PreparedByUserID = ?
           AND PreparedBy = ?
           AND Status IN ('DRAFT', 'CALCULATED')`,
        [companyId, paymentYear, TEST_USER_ID, TEST_USER_NAME]
    );
    const ids = rows.map((row) => Number(row.id)).filter(Boolean);
    if (!ids.length) return;

    const placeholders = ids.map(() => '?').join(', ');
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query(`DELETE FROM yearly_payment_batch_actions WHERE BatchID IN (${placeholders})`, ids);
        await connection.query(`DELETE FROM yearly_payment_batch_rows WHERE BatchID IN (${placeholders})`, ids);
        await connection.query(
            `DELETE FROM yearly_payment_batches
             WHERE id IN (${placeholders})
               AND PreparedByUserID = ?
               AND PreparedBy = ?
               AND Status IN ('DRAFT', 'CALCULATED')`,
            [...ids, TEST_USER_ID, TEST_USER_NAME]
        );
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function main() {
    const companyId = Number(process.env.YEARLY_TEST_COMPANY_ID || 1);
    const paymentYear = Number(process.env.YEARLY_TEST_YEAR || new Date().getFullYear());
    cleanupContext = { companyId, paymentYear };

    await cleanupTestBatches(companyId, paymentYear);

    const summary = {
        companyId,
        paymentYear,
        checks: []
    };

    await yearlyPaymentService.ensureYearlyPaymentTables();

    const [tables] = await pool.query(
        `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
              AND table_name IN ('yearly_payment_batches', 'yearly_payment_batch_actions', 'yearly_payment_batch_rows')
            ORDER BY table_name
        `
    );
    summary.checks.push({
        name: 'helper_tables_exist',
        pass: tables.length === 3,
        detail: tables.map((row) => row.table_name)
    });

    const supportedTypes = await yearlyPaymentService.getSupportedYearlyTypes(companyId);
    summary.checks.push({
        name: 'supported_yearly_types',
        pass: supportedTypes.map((item) => item.code).join(',') === '02,05,13',
        detail: supportedTypes
    });

    const pageData = await yearlyPaymentService.getFinancePageData({
        companyId,
        filters: { paymentYear }
    });
    summary.checks.push({
        name: 'finance_page_loads',
        pass: Array.isArray(pageData.supportedTypes) && pageData.supportedTypes.length === 3,
        detail: {
            supportedTypeCount: pageData.supportedTypes.length,
            loanParams: pageData.loanParams
        }
    });

    for (const type of supportedTypes) {
        const detail = await yearlyPaymentService.createOrUpdateDraft({
            companyId,
            user: { id: TEST_USER_ID, name: TEST_USER_NAME, role: 'finance-officer' },
            payload: {
                paymentYear,
                paymentType: type.code,
                paymentDate: `${paymentYear}-12-31`,
                reason: `Automated preview test for ${type.label}`
            }
        });

        summary.checks.push({
            name: `preview_${type.code}`,
            pass: detail && detail.batch && detail.batch.SnapshotChecksum && Array.isArray(detail.rows),
            detail: {
                batchId: detail?.batch?.id || null,
                status: detail?.batch?.Status || null,
                rowCount: detail?.rows?.length || 0,
                totalStaff: detail?.batch?.TotalStaff || 0,
                totalAmount: detail?.batch?.TotalAmount || 0
            }
        });
    }

    console.log(JSON.stringify(summary, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            if (cleanupContext) {
                await cleanupTestBatches(cleanupContext.companyId, cleanupContext.paymentYear);
            }
            await pool.end();
        } catch (error) {
            console.error(error);
        }
    });
