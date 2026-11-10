function getInstallationCompanyId(env = process.env) {
    const raw = env.INSTALLATION_COMPANY_ID ?? '1';
    if (!/^[1-9]\d*$/.test(String(raw)) || !Number.isSafeInteger(Number(raw))) {
        throw new Error('INSTALLATION_COMPANY_ID must be a positive integer.');
    }
    return Number(raw);
}

function assertInstallationUser(user) {
    if (!user || !user.id || Number(user.companyId) !== getInstallationCompanyId()) {
        throw Object.assign(new Error('Not authorized for this installation.'), { status: 403 });
    }
    return getInstallationCompanyId();
}

function assertCompanyInput(input, depth = 0) {
    if (!input || typeof input !== 'object') return;
    if (depth > 8) throw Object.assign(new Error('Invalid request.'), { status: 400 });
    for (const [key, value] of Object.entries(input)) {
        if (/^company_?id$/i.test(key) && (typeof value === 'object' || String(value) !== String(getInstallationCompanyId()))) {
            throw Object.assign(new Error('Company selection is not permitted.'), { status: 403 });
        }
        if (value && typeof value === 'object') assertCompanyInput(value, depth + 1);
    }
}

module.exports = { getInstallationCompanyId, assertInstallationUser, assertCompanyInput };
