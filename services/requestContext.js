const { AsyncLocalStorage } = require('async_hooks');

const requestStorage = new AsyncLocalStorage();

function runWithRequestContext(req, res, next) {
    requestStorage.run({ req, res }, next);
}

function getRequestContext() {
    return requestStorage.getStore();
}

module.exports = {
    getRequestContext,
    runWithRequestContext
};
