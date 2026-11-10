const path = require('node:path');

function validateStagingTarget(env = process.env) {
    for (const [standard, legacy] of [['DB_NAME','DBNAME'],['DB_HOST','DBHOST'],['DB_PORT','DBPORT'],['DB_USER','DBUSER'],['DB_PASSWORD','DBPASS']]) {
        if (env[standard] && env[legacy] && env[standard] !== env[legacy]) throw new Error('Conflicting database aliases are not permitted.');
    }
    const database = env.DB_NAME || env.DBNAME || '';
    if (env.STAGING_SETUP_ENABLED !== 'true' || env.STAGING_DB_NAME !== database
        || !/^[a-zA-Z0-9_]{1,64}$/.test(database)
        || !/(?:^|_)waec_staging(?:_|$)|^waec_acceptance_\d{8}_[a-f0-9]{8}$/.test(database)
        || /personnel_master/i.test(database)
        || (env.DBNAME && env.DB_NAME && env.DBNAME !== env.DB_NAME)
        || env.INSTALLATION_COMPANY_ID !== '1') {
        throw new Error('Refusing setup: explicitly enable staging setup, match STAGING_DB_NAME to a dedicated waec_staging database, and use CompanyID 1. Live database names are forbidden.');
    }
    const user = env.DB_USER || env.DBUSER || '';
    if (!user || user.toLowerCase() === 'root') throw new Error('Use a dedicated staging database user, not root.');
    return { host: env.DB_HOST || env.DBHOST || '127.0.0.1', port: Number(env.DB_PORT || env.DBPORT || 3306),
        user, password: env.DB_PASSWORD || env.DBPASS || '', database };
}

function validatePrivateRoot(directory, root = path.resolve(__dirname, '..')) {
    if (!directory || !path.isAbsolute(directory)) throw new Error('Set an absolute PRIVATE_UPLOAD_DIR outside all web roots.');
    const resolved = path.resolve(directory);
    if (path.basename(resolved).toLowerCase() !== 'uploads' || resolved === root || resolved.startsWith(path.join(root, 'public') + path.sep)
        || resolved === path.join(root, 'public') || /(?:^|[\\/])public_html(?:[\\/]|$)/i.test(resolved)) {
        throw new Error('Private storage must not be in a document root.');
    }
    return resolved;
}

module.exports = { validateStagingTarget, validatePrivateRoot };
