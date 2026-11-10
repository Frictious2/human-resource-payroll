const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const audit = require('./auditTrailService');
const roles = new Set(['Admin','Manager','Data Entry','Finance Officer','Finance Manager','Auditor','Entity Head']);
const { assertInstallationUser, assertCompanyInput, getInstallationCompanyId } = require('./installationCompanyService');

function secret() {
    const value = String(process.env.RESET_TOKEN_SECRET || process.env.JWT_SECRET || '').trim();
    if (value.length < 32 || /reset_secret|replace-with|your-secret/i.test(value)) throw new Error('Account setup is unavailable: configure a strong reset-token secret.');
    return value;
}

function passwordIsValid(value) {
    return typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value, 'utf8') <= 72
        && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^a-zA-Z0-9]/.test(value);
}

function actorScope(req, targetCompany) {
    const actor = req.user || req.session?.user;
    if (!actor || !['admin','developer'].includes(actor.role)) throw Object.assign(new Error('Not authorized.'), { status: 403 });
    const companyId = Number(actor.role === 'developer' ? targetCompany : actor.companyId);
    if (!Number.isSafeInteger(companyId) || companyId < 1) throw Object.assign(new Error('Company scope is required.'), { status: 403 });
    if (actor.role !== 'developer' && targetCompany != null && Number(targetCompany) !== companyId) {
        throw Object.assign(new Error('Not authorized.'), { status: 403 });
    }
    assertInstallationUser(actor);
    assertCompanyInput({ CompanyID: targetCompany ?? actor.companyId });
    return { actor, companyId };
}

function fingerprint(row) {
    return crypto.createHmac('sha256', secret()).update(JSON.stringify([
        String(row.PFNo), row.Email, row.Level, Number(row.CompanyID), row.Pword || null
    ])).digest('hex');
}

async function issueSetupToken(pfno, companyId, executor = pool) {
    const [rows] = await executor.execute('SELECT PFNo, Email, Level, CompanyID, Pword FROM tblpassword WHERE PFNo = ? AND CompanyID = ? LIMIT 1', [pfno, companyId]);
    if (!rows.length) throw new Error('Account not found.');
    const row = rows[0];
    return jwt.sign({ pfno: String(row.PFNo), companyId: Number(row.CompanyID), state: fingerprint(row) }, secret(), {
        algorithm: 'HS256', expiresIn: '30m', audience: 'hrpayroll-account-setup', issuer: 'hrpayroll', subject: 'password-setup'
    });
}

async function verifySetupToken(token, executor = pool) {
    const payload = jwt.verify(token, secret(), { algorithms: ['HS256'], audience: 'hrpayroll-account-setup', issuer: 'hrpayroll', subject: 'password-setup' });
    if (Number(payload.companyId) !== getInstallationCompanyId()) throw new Error('Invalid or expired account link.');
    const [rows] = await executor.execute('SELECT PFNo, Email, Level, CompanyID, Pword FROM tblpassword WHERE PFNo = ? AND CompanyID = ? LIMIT 1', [payload.pfno, payload.companyId]);
    if (!rows.length || payload.state !== fingerprint(rows[0])) throw new Error('Invalid or expired account link.');
    return rows[0];
}

async function transaction(work) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally { connection.release(); }
}

async function auditAction(connection, { action, actor, companyId, pfno }) {
    await audit.writeAuditEntryWithExecutor(connection, { action, recordId: pfno, fieldName: 'PortalAccount',
        oldValue: null, newValue: 'Success', formName: 'account-provisioning', companyId,
        userName: String(actor.name || actor.username || actor.id || 'Account holder') });
}

async function createAccount(req, level, data, targetCompany) {
    const { actor, companyId } = actorScope(req, targetCompany ?? data.CompanyID);
    secret();
    if (!roles.has(level) || (actor.role === 'developer' && level !== 'Admin')) throw Object.assign(new Error('Role assignment is not authorized.'), { status: 403 });
    const username = String(data.Username || '').trim();
    const email = String(data.Email || '').trim();
    const fullName = String(data.FullName || '').trim();
    if (!username || username.length > 50 || !fullName || fullName.length > 50 || /[<>]/.test(username + fullName)
        || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.length > 100) throw new Error('Enter a valid name, username and email.');
    return transaction(async connection => {
        const [companies] = await connection.execute('SELECT CompanyID FROM tblcominfo WHERE CompanyID = ?', [companyId]);
        if (!companies.length) throw new Error('Company not found.');
        const [duplicates] = await connection.execute('SELECT PFNo FROM tblpassword WHERE LOWER(Username) = LOWER(?) OR LOWER(Email) = LOWER(?) LIMIT 1', [username, email]);
        if (duplicates.length) throw new Error('That username or email is already in use.');
        const [result] = await connection.execute(`INSERT INTO tblpassword (DateCreated, Level, Username, FullName, Pword, Email, CompanyID)
            VALUES (NOW(), ?, ?, ?, NULL, ?, ?)`, [level, username, fullName, email, companyId]);
        await auditAction(connection, { action: 'Account Created', actor, companyId, pfno: result.insertId });
        return result.insertId;
    });
}

async function setPassword(token, password, expectedPfno) {
    if (!passwordIsValid(password)) throw new Error('Use 12 or more characters with upper/lower case, number and symbol (maximum 72 UTF-8 bytes).');
    const initial = await verifySetupToken(token);
    if (expectedPfno != null && String(expectedPfno) !== String(initial.PFNo)) throw new Error('Invalid account link.');
    const hash = await bcrypt.hash(password, 12);
    return transaction(async connection => {
        const row = await verifySetupToken(token, connection);
        if (expectedPfno != null && String(expectedPfno) !== String(row.PFNo)) throw new Error('Invalid account link.');
        // Compare-and-set also prevents concurrent replay of the same valid token.
        const [result] = await connection.execute('UPDATE tblpassword SET Pword = ? WHERE PFNo = ? AND CompanyID = ? AND Pword <=> ?', [hash, row.PFNo, row.CompanyID, row.Pword]);
        if (result.affectedRows !== 1) throw new Error('Account link has already been used.');
        await auditAction(connection, { action: 'Password Set', actor: { id: row.PFNo }, companyId: row.CompanyID, pfno: row.PFNo });
    });
}

async function deleteAccount(req, level, pfno) {
    let targetCompany;
    if ((req.user || req.session?.user)?.role === 'developer') {
        if (level !== 'Admin') throw Object.assign(new Error('Not authorized.'), { status: 403 });
        const [accounts] = await pool.execute('SELECT CompanyID FROM tblpassword WHERE PFNo = ? AND Level = ?', [pfno, level]);
        if (!accounts.length) return 0;
        targetCompany = accounts[0].CompanyID;
    }
    const { actor, companyId } = actorScope(req, targetCompany);
    if (String(actor.id) === String(pfno)) throw Object.assign(new Error('Cannot delete your own account.'), { status: 403 });
    return transaction(async connection => {
        const [result] = await connection.execute('DELETE FROM tblpassword WHERE PFNo = ? AND Level = ? AND CompanyID = ?', [pfno, level, companyId]);
        if (result.affectedRows) await auditAction(connection, { action: 'Account Deleted', actor, companyId, pfno });
        return result.affectedRows;
    });
}

async function recordInvitation(req, pfno, companyId) {
    const { actor } = actorScope(req, companyId);
    return transaction(connection => auditAction(connection, { action: 'Account Link Issued', actor, companyId, pfno }));
}

async function manageDeveloper(req, action) {
    const actor = req.user || req.session?.user;
    if (actor?.role !== 'developer') throw Object.assign(new Error('Not authorized.'), { status: 403 });
    const data = req.body || {};
    if (action !== 'delete' && (!data.FullName || !data.username || /[<>]/.test(data.FullName + data.username)
        || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(data.email || ''))) throw new Error('Valid name, username and email are required.');
    if ((action === 'create' || data.password) && !passwordIsValid(data.password)) throw new Error('A strong password of 12+ characters is required.');
    if (action === 'delete' && String(actor.id) === String(req.params.id)) throw new Error('Cannot delete your own account.');
    const hash = data.password ? await bcrypt.hash(data.password, 12) : null;
    return transaction(async connection => {
        let id = req.params?.id;
        if (action === 'create') {
            const [result] = await connection.execute('INSERT INTO developer (FullName, username, email, password, createdBy) VALUES (?, ?, ?, ?, ?)', [data.FullName, data.username, data.email, hash, String(actor.id)]);
            id = result.insertId;
        } else if (action === 'update') {
            if (hash) await connection.execute('UPDATE developer SET FullName=?, username=?, email=?, password=? WHERE ID=?', [data.FullName, data.username, data.email, hash, id]);
            else await connection.execute('UPDATE developer SET FullName=?, username=?, email=? WHERE ID=?', [data.FullName, data.username, data.email, id]);
        } else if (action === 'delete') await connection.execute('DELETE FROM developer WHERE ID=?', [id]);
        else throw new Error('Invalid account operation.');
        await auditAction(connection, { action: `Developer ${action}`, actor, companyId: 0, pfno: id });
        return id;
    });
}

async function changeOwnPassword(user, current, next) {
    if (!passwordIsValid(next)) throw Object.assign(new Error('Use 12+ characters with upper/lower case, number and symbol (maximum 72 UTF-8 bytes).'), { expose: true });
    const developer = user?.source === 'developer' && user?.role === 'developer';
    const companyId = developer ? 0 : Number(user?.companyId);
    if (!user?.id || (!developer && (!Number.isSafeInteger(companyId) || companyId < 1))) throw new Error('Invalid account scope.');
    const hash = await bcrypt.hash(next, 12);
    return transaction(async connection => {
        const [rows] = developer
            ? await connection.execute('SELECT password AS storedPassword FROM developer WHERE ID = ? FOR UPDATE', [user.id])
            : await connection.execute('SELECT Pword AS storedPassword FROM tblpassword WHERE PFNo = ? AND CompanyID = ? FOR UPDATE', [user.id, companyId]);
        const stored = rows[0]?.storedPassword;
        const valid = stored && await require('./authService').verifyPassword({ storedPassword: stored, password: current });
        if (!valid) throw Object.assign(new Error('Current password is incorrect.'), { expose: true });
        if (developer) await connection.execute('UPDATE developer SET password = ? WHERE ID = ?', [hash, user.id]);
        else {
            const [result] = await connection.execute('UPDATE tblpassword SET Pword = ? WHERE PFNo = ? AND CompanyID = ? AND Pword <=> ?', [hash, user.id, companyId, stored]);
            if (result.affectedRows !== 1) throw new Error('Account state changed; retry securely.');
        }
        await auditAction(connection, { action: 'Password Changed', actor: user, companyId, pfno: user.id });
    });
}

module.exports = { actorScope, passwordIsValid, issueSetupToken, verifySetupToken, createAccount, setPassword, deleteAccount, recordInvitation, manageDeveloper, changeOwnPassword };
