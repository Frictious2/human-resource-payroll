const pool = require('../config/db');

function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

async function getEffectiveTaxConfig({ companyId, payrollDate = new Date(), connection = pool } = {}) {
    const effectiveDate = payrollDate instanceof Date
        ? payrollDate.toISOString().slice(0, 10)
        : String(payrollDate || new Date().toISOString().slice(0, 10)).slice(0, 10);

    const [rows] = await connection.query(
        `
            SELECT *
            FROM tbltax
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND (TaxDate IS NULL OR DATE(TaxDate) <= DATE(?))
            ORDER BY CASE WHEN CompanyID = ? THEN 0 ELSE 1 END,
                     TaxDate DESC
            LIMIT 1
        `,
        [Number(companyId) || 1, effectiveDate, Number(companyId) || 1]
    );

    if (!rows.length) {
        const error = new Error('No effective PAYE tax table configuration was found.');
        error.statusCode = 400;
        throw error;
    }

    return rows[0];
}

function calculateProgressivePaye(chargeableIncome, taxConfig) {
    const chargeable = Math.max(0, Number(chargeableIncome) || 0);
    const limits = [
        Number(taxConfig.R1) || 0,
        Number(taxConfig.R2) || 0,
        Number(taxConfig.R3) || 0,
        Number(taxConfig.R4) || 0
    ];
    const rates = [
        Number(taxConfig.R1Tax) || 0,
        Number(taxConfig.R2Tax) || 0,
        Number(taxConfig.R3Tax) || 0,
        Number(taxConfig.R4Tax) || 0,
        Number(taxConfig.R5Tax) || 0
    ];

    let previousLimit = 0;
    let tax = 0;

    for (let i = 0; i < limits.length; i += 1) {
        const limit = limits[i];
        if (limit <= previousLimit) {
            continue;
        }

        const taxableInBand = Math.max(0, Math.min(chargeable, limit) - previousLimit);
        tax += taxableInBand * (rates[i] / 100);
        previousLimit = limit;

        if (chargeable <= limit) {
            return roundMoney(tax);
        }
    }

    if (chargeable > previousLimit) {
        tax += (chargeable - previousLimit) * (rates[4] / 100);
    }

    return roundMoney(tax);
}

async function calculateMonthlyPaye({
    companyId,
    payrollDate = new Date(),
    taxableEarnings,
    employeeNassit,
    connection = pool
}) {
    const taxConfig = await getEffectiveTaxConfig({ companyId, payrollDate, connection });
    const chargeableIncome = roundMoney(Math.max(0, (Number(taxableEarnings) || 0) - (Number(employeeNassit) || 0)));
    const tax = calculateProgressivePaye(chargeableIncome, taxConfig);

    return {
        taxConfig,
        taxableEarnings: roundMoney(taxableEarnings),
        employeeNassit: roundMoney(employeeNassit),
        chargeableIncome,
        tax
    };
}

module.exports = {
    getEffectiveTaxConfig,
    calculateProgressivePaye,
    calculateMonthlyPaye,
    roundMoney
};
