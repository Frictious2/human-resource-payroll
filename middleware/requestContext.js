const { runWithRequestContext } = require('../services/requestContext');

module.exports = (req, res, next) => {
    runWithRequestContext(req, res, next);
};
