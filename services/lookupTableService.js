const pool = require('../config/db');
const auditTrailService = require('./auditTrailService');

async function listRows(table, { orderBy = 'Code ASC' } = {}) {
    const [rows] = await pool.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
    return rows;
}

async function getNextCode(table, { codeColumn = 'Code', startCode, padLength } = {}) {
    const [rows] = await pool.query(
        `SELECT ${codeColumn} FROM ${table} ORDER BY ${codeColumn} DESC LIMIT 1`
    );

    let nextCode = startCode;

    if (rows.length > 0) {
        const lastCodeInt = parseInt(rows[0][codeColumn], 10);
        if (!Number.isNaN(lastCodeInt)) {
            nextCode = String(lastCodeInt + 1).padStart(padLength, '0');
        }
    }

    return nextCode;
}

async function insertRow(table, data, options = {}) {
    const columns = Object.keys(data);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map((column) => data[column]);

    await pool.query(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
        values
    );

    const idColumn = options.idColumn || Object.keys(data)[0];
    const recordId = data[idColumn];
    const insertedRow = recordId
        ? await getRowById(table, idColumn, recordId)
        : data;

    await auditTrailService.logCreate({
        table,
        formName: options.formName,
        recordId,
        row: insertedRow || data
    });
}

async function getRowById(table, idColumn, idValue) {
    const [rows] = await pool.query(
        `SELECT * FROM ${table} WHERE ${idColumn} = ?`,
        [idValue]
    );

    return rows[0] || null;
}

async function updateRow(table, idColumn, idValue, data, options = {}) {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
        return false;
    }

    const previousRow = await getRowById(table, idColumn, idValue);

    const setClause = entries.map(([column]) => `${column} = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    values.push(idValue);

    await pool.query(
        `UPDATE ${table} SET ${setClause} WHERE ${idColumn} = ?`,
        values
    );

    const nextRow = await getRowById(table, idColumn, idValue);
    const changedFields = entries
        .map(([column]) => column)
        .filter((column) => {
            const beforeValue = previousRow ? previousRow[column] : undefined;
            const afterValue = nextRow ? nextRow[column] : undefined;
            return String(beforeValue) !== String(afterValue);
        });

    if (changedFields.length > 0) {
        await auditTrailService.logUpdate({
            table,
            formName: options.formName,
            recordId: idValue,
            previousRow,
            nextRow,
            changedFields
        });
    }

    return true;
}

async function deleteRow(table, idColumn, idValue, options = {}) {
    const existingRow = await getRowById(table, idColumn, idValue);
    await pool.query(`DELETE FROM ${table} WHERE ${idColumn} = ?`, [idValue]);

    await auditTrailService.logDelete({
        table,
        formName: options.formName,
        recordId: idValue,
        row: existingRow
    });
}

module.exports = {
    deleteRow,
    getNextCode,
    getRowById,
    insertRow,
    listRows,
    updateRow
};
