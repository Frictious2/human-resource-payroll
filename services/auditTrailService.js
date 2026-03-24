const pool = require('../config/db');
const { getRequestContext } = require('./requestContext');

const SENSITIVE_FIELD_PATTERNS = [
    /salary/i,
    /amount/i,
    /bank/i,
    /account/i,
    /bban/i,
    /tin/i,
    /email/i,
    /phone/i,
    /address/i,
    /name/i,
    /dob/i,
    /birth/i,
    /passport/i,
    /nassit/i
];

function normalizeValue(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    }

    return String(value);
}

function truncateValue(value, maxLength = 255) {
    if (value === null) {
        return null;
    }

    return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function shouldMaskField(fieldName = '') {
    return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName));
}

function maskAuditValue(fieldName, value) {
    const normalized = normalizeValue(value);
    if (normalized === null) {
        return null;
    }

    if (!shouldMaskField(fieldName)) {
        return truncateValue(normalized);
    }

    return '[MASKED]';
}

function resolveRecordId(recordId) {
    if (recordId === undefined || recordId === null) {
        return null;
    }

    return String(recordId).slice(0, 6);
}

function getAuditMetadata(overrides = {}) {
    const context = getRequestContext();
    const req = context && context.req;

    return {
        userName:
            overrides.userName ||
            (req && req.session && req.session.user && (req.session.user.name || req.session.user.email)) ||
            'System',
        formName:
            overrides.formName ||
            (req && (req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`)) ||
            overrides.table ||
            'System',
        companyId: overrides.companyId || 1
    };
}

async function getNextAuditTrailId() {
    const [rows] = await pool.query(
        'SELECT COALESCE(MAX(AuditTrailID), 0) + 1 AS nextId FROM tblaudittrail'
    );

    return rows[0] && rows[0].nextId ? rows[0].nextId : 1;
}

async function writeAuditEntry(entry) {
    try {
        const metadata = getAuditMetadata(entry);
        const auditTrailId = await getNextAuditTrailId();

        await pool.query(
            `INSERT INTO tblaudittrail
            (AuditTrailID, ChangeDate, UserName, FormName, Action, RecordID, FieldName, OldValue, NewValue, Loggedout, CompanyID)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                auditTrailId,
                new Date(),
                metadata.userName,
                truncateValue(metadata.formName),
                entry.action,
                resolveRecordId(entry.recordId),
                truncateValue(entry.fieldName || null),
                maskAuditValue(entry.fieldName, entry.oldValue),
                maskAuditValue(entry.fieldName, entry.newValue),
                entry.loggedout || 0,
                metadata.companyId
            ]
        );
    } catch (error) {
        console.error('Audit trail logging failed:', error.message);
    }
}

async function logCreate({ table, recordId, row, formName }) {
    await writeAuditEntry({
        action: 'New',
        table,
        formName,
        recordId,
        fieldName: null,
        oldValue: null,
        newValue: `Created record in ${table}`,
        companyId: row && row.CompanyID
    });
}

async function logDelete({ table, recordId, row, formName }) {
    await writeAuditEntry({
        action: 'Delete',
        table,
        formName,
        recordId,
        fieldName: null,
        oldValue: `Deleted record from ${table}`,
        newValue: null,
        companyId: row && row.CompanyID
    });
}

async function logUpdate({ table, recordId, previousRow, nextRow, changedFields, formName }) {
    const fields = changedFields && changedFields.length
        ? changedFields
        : Object.keys(nextRow || {});

    for (const fieldName of fields) {
        await writeAuditEntry({
            action: 'Edit',
            table,
            formName,
            recordId,
            fieldName,
            oldValue: previousRow ? previousRow[fieldName] : null,
            newValue: nextRow ? nextRow[fieldName] : null,
            companyId:
                (nextRow && nextRow.CompanyID) ||
                (previousRow && previousRow.CompanyID)
        });
    }
}

async function logAuthEvent({ action, userName, loggedout = 0, companyId = 1 }) {
    await writeAuditEntry({
        action,
        userName,
        formName: 'auth',
        recordId: null,
        fieldName: null,
        oldValue: null,
        newValue: null,
        loggedout,
        companyId
    });
}

module.exports = {
    logAuthEvent,
    logCreate,
    logDelete,
    logUpdate
};
