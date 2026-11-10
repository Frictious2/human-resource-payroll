function normalize(value, maxLength = 160) {
    if (value === null || value === undefined) {
        return null;
    }

    return String(value).replace(/[\r\n\t]/g, ' ').trim().slice(0, maxLength) || null;
}

function logSecurityEvent(event, req, details = {}) {
    const user = req && req.user ? req.user : null;
    const payload = {
        timestamp: new Date().toISOString(),
        event: normalize(event, 80),
        method: normalize(req && req.method, 12),
        path: normalize(req && String(req.originalUrl || req.path || '').split('?')[0], 240),
        ip: normalize(req && req.ip, 80),
        role: normalize(user && user.role, 80),
        userId: normalize(user && (user.id || user.PFNo || user.pfno), 80),
        companyId: user ? (user.companyId || user.CompanyID || null) : null,
        outcome: normalize(details.outcome, 40),
        reason: normalize(details.reason, 160)
    };

    // Deliberately omit request bodies, cookies, tokens, credentials and session IDs.
    console.warn(`[security] ${JSON.stringify(payload)}`);
}

module.exports = {
    logSecurityEvent
};
