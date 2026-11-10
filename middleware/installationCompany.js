const pool = require('../config/db');
const { getInstallationCompanyId, assertInstallationUser, assertCompanyInput } = require('../services/installationCompanyService');
const { logSecurityEvent } = require('../services/securityEventService');

module.exports = async function installationCompany(req, res, next) {
    try {
        req.installationCompanyId = getInstallationCompanyId();
        assertCompanyInput(req.query);
        assertCompanyInput(req.body);
        if (!req.user) return next();
        assertInstallationUser(req.user);
        // Legacy PF-only handlers must not touch foreign or ambiguous staff identities.
        const identifiers = [req.body, req.query].flatMap(input => Object.entries(input || {})
            .filter(([key]) => /^pf_?no$/i.test(key)).map(([, value]) => value));
        const pathMatch = req.path.match(/\/api\/(?:staff|leave\/staff|staff-leave-data|payroll\/entitle|payroll\/payroll-setup|welfare\/medical)\/([^/]+)(?:\/|$)/);
        if (pathMatch) identifiers.push(pathMatch[1]);
        for (const identifier of identifiers.filter(value => value !== undefined && value !== '')) {
            if (typeof identifier !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(identifier)) {
                throw Object.assign(new Error('Invalid employee identifier.'), { status: 400 });
            }
            const [rows] = await pool.execute('SELECT CompanyID FROM tblstaff WHERE PFNo = ?', [identifier]);
            if (rows.some(row => Number(row.CompanyID) !== req.installationCompanyId)) {
                throw Object.assign(new Error('Record not found.'), { status: 404 });
            }
        }
        next();
    } catch (error) {
        logSecurityEvent('INSTALLATION_SCOPE_DENIED', req, { outcome: 'blocked', reason: 'installation-company-mismatch' });
        next(error.status ? error : Object.assign(new Error('Unable to verify installation access.'), { status: 503 }));
    }
};
