const pool = require('../config/db');
const auditTrailService = require('./auditTrailService');

async function fetchSingleRow(query, params) {
    const [rows] = await pool.query(query, params);
    return rows[0] || null;
}

function getChangedFields(previousRow, nextRow) {
    const fieldNames = new Set([
        ...Object.keys(previousRow || {}),
        ...Object.keys(nextRow || {})
    ]);

    return Array.from(fieldNames).filter((fieldName) => {
        const beforeValue = previousRow ? previousRow[fieldName] : undefined;
        const afterValue = nextRow ? nextRow[fieldName] : undefined;
        return String(beforeValue) !== String(afterValue);
    });
}

async function auditCreate({ table, recordId, fetchQuery, fetchParams, formName, applyChange }) {
    await applyChange();

    const row = fetchQuery ? await fetchSingleRow(fetchQuery, fetchParams) : null;
    await auditTrailService.logCreate({
        table,
        formName,
        recordId,
        row
    });
}

async function auditUpdate({ table, recordId, fetchQuery, fetchParams, formName, applyChange }) {
    const previousRow = await fetchSingleRow(fetchQuery, fetchParams);

    await applyChange(previousRow);

    const nextRow = await fetchSingleRow(fetchQuery, fetchParams);
    const changedFields = getChangedFields(previousRow, nextRow);

    if (changedFields.length > 0) {
        await auditTrailService.logUpdate({
            table,
            formName,
            recordId,
            previousRow,
            nextRow,
            changedFields
        });
    }
}

async function auditDelete({ table, recordId, fetchQuery, fetchParams, formName, applyChange }) {
    const row = await fetchSingleRow(fetchQuery, fetchParams);

    await applyChange(row);

    await auditTrailService.logDelete({
        table,
        formName,
        recordId,
        row
    });
}

module.exports = {
    auditCreate,
    auditDelete,
    fetchSingleRow,
    auditUpdate,
    getChangedFields
};
