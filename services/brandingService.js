const pool = require('../config/db');
const { getInstallationCompanyId } = require('./installationCompanyService');

function normalizeLogoPath(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return null;
    }

    const normalized = raw.replace(/\\/g, '/');
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

async function getBranding() {
    try {
        const [rows] = await pool.query(
            `SELECT CompanyID, Com_Name, LogoPath, Logopath
             FROM tblcominfo
             WHERE CompanyID = ?
             LIMIT 1`, [getInstallationCompanyId()]
        );

        const company = rows[0] || {};
        const logoPath = normalizeLogoPath(company.LogoPath || company.Logopath);

        return {
            companyId: getInstallationCompanyId(),
            companyName: company.Com_Name || 'HR & Payroll',
            logoPath
        };
    } catch (error) {
        console.error('Branding lookup failed:', error.message);
        return {
            companyId: getInstallationCompanyId(),
            companyName: 'HR & Payroll',
            logoPath: null
        };
    }
}

module.exports = {
    getBranding,
    normalizeLogoPath
};
