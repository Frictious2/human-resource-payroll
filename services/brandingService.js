const pool = require('../config/db');

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
             ORDER BY CompanyID ASC
             LIMIT 1`
        );

        const company = rows[0] || {};
        const logoPath = normalizeLogoPath(company.LogoPath || company.Logopath);

        return {
            companyId: company.CompanyID || 1,
            companyName: company.Com_Name || 'HR & Payroll',
            logoPath
        };
    } catch (error) {
        console.error('Branding lookup failed:', error.message);
        return {
            companyId: 1,
            companyName: 'HR & Payroll',
            logoPath: null
        };
    }
}

module.exports = {
    getBranding,
    normalizeLogoPath
};
