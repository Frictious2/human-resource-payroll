const brandingService = require('../services/brandingService');

async function attachBranding(req, res, next) {
    res.locals.branding = await brandingService.getBranding();
    next();
}

module.exports = {
    attachBranding
};
