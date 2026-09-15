const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const authService = require('./authService');
const workflowNotificationService = require('./workflowNotificationService');

const PARAMETER_CHANGE_STATUSES = Object.freeze({
    DRAFT: 'DRAFT',
    SUBMITTED_TO_ENTITY_HEAD: 'SUBMITTED_TO_ENTITY_HEAD',
    RETURNED_BY_ENTITY_HEAD: 'RETURNED_BY_ENTITY_HEAD',
    FINAL_APPROVED: 'FINAL_APPROVED',
    FINAL_REJECTED: 'FINAL_REJECTED',
    APPLIED: 'APPLIED',
    APPLY_FAILED: 'APPLY_FAILED',
    CANCELLED: 'CANCELLED'
});

const PARAMETER_CHANGE_TYPES = Object.freeze({
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
    ACTIVATE: 'ACTIVATE',
    DEACTIVATE: 'DEACTIVATE'
});

const PARAMETER_CHANGE_ACTIONS = Object.freeze({
    SAVE_DRAFT: 'SAVE_DRAFT',
    SUBMIT: 'SUBMIT',
    RETURN: 'RETURN',
    REJECT: 'REJECT',
    APPROVE: 'APPROVE',
    APPLY: 'APPLY',
    CANCEL: 'CANCEL'
});

const CLASSIFICATIONS = Object.freeze({
    CRITICAL: 'Critical - approval required',
    OPERATIONAL: 'Operational - approval recommended',
    ADMINISTRATIVE: 'Administrative - immediate update allowed'
});

const EDITABLE_STATUSES = new Set([
    PARAMETER_CHANGE_STATUSES.DRAFT,
    PARAMETER_CHANGE_STATUSES.RETURNED_BY_ENTITY_HEAD
]);

const SUBMITTABLE_STATUSES = new Set([
    PARAMETER_CHANGE_STATUSES.DRAFT,
    PARAMETER_CHANGE_STATUSES.RETURNED_BY_ENTITY_HEAD
]);

let parameterChangeTablesReadyPromise = null;

function createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function normalizeText(value) {
    return String(value ?? '').trim();
}

function normalizeRole(role) {
    return authService.normalizeRole(role) || normalizeText(role).toLowerCase();
}

function normalizeUser(user = {}) {
    const id = Number(user.id ?? user.pfno ?? user.PFNo ?? 0);
    return {
        id: Number.isFinite(id) && id > 0 ? id : 0,
        role: normalizeRole(user.role || user.level),
        name: user.name || user.fullName || user.username || user.email || 'System'
    };
}

function stableSerialize(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        return value.map((entry) => stableSerialize(entry));
    }
    if (typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
                result[key] = stableSerialize(value[key]);
                return result;
            }, {});
    }
    return value;
}

function buildChecksum(value) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(stableSerialize(value)))
        .digest('hex');
}

function normalizeDateValue(value) {
    if (!value) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return normalizeText(value).slice(0, 10);
    }
    return date.toISOString().slice(0, 10);
}

function normalizeDateTimeValue(value) {
    if (!value) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return normalizeText(value).replace('T', ' ').replace('Z', '').slice(0, 19);
    }
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

function mapStatusBadge(status) {
    switch (status) {
        case PARAMETER_CHANGE_STATUSES.DRAFT:
            return 'bg-secondary-subtle text-secondary-emphasis';
        case PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD:
            return 'bg-warning-subtle text-warning-emphasis';
        case PARAMETER_CHANGE_STATUSES.RETURNED_BY_ENTITY_HEAD:
            return 'bg-info-subtle text-info-emphasis';
        case PARAMETER_CHANGE_STATUSES.FINAL_APPROVED:
        case PARAMETER_CHANGE_STATUSES.APPLIED:
            return 'bg-success-subtle text-success-emphasis';
        case PARAMETER_CHANGE_STATUSES.FINAL_REJECTED:
        case PARAMETER_CHANGE_STATUSES.APPLY_FAILED:
        case PARAMETER_CHANGE_STATUSES.CANCELLED:
            return 'bg-danger-subtle text-danger-emphasis';
        default:
            return 'bg-light text-dark';
    }
}

function assertAdminActor(user) {
    const actor = normalizeUser(user);
    if (actor.role !== 'admin') {
        throw createError('Only the Administrator can propose controlled parameter changes.', 403);
    }
    return actor;
}

function assertEntityHeadActor(user) {
    const actor = normalizeUser(user);
    if (actor.role !== 'entity-head') {
        throw createError('Only the Entity Head/HNO can approve controlled parameter changes.', 403);
    }
    return actor;
}

function toBooleanFlag(value) {
    if (value === true || value === 1 || value === '1' || value === '-1' || value === '-1.00' || value === 'true' || value === 'on') {
        return 1;
    }
    return 0;
}

function makeLookupModule({
    module,
    label,
    sourceTable,
    keyColumn = 'Code',
    displayField = null,
    pageRoute,
    classification,
    codePadLength = 2,
    codeStart = '01',
    allowedFields = [],
    referenceUsageChecks = []
}) {
    return {
        module,
        label,
        sourceTable,
        keyColumn,
        displayField,
        pageRoute,
        classification,
        changeTypes: [PARAMETER_CHANGE_TYPES.CREATE, PARAMETER_CHANGE_TYPES.UPDATE, PARAMETER_CHANGE_TYPES.DELETE],
        getNextCodeQuery: `SELECT ${keyColumn} AS code FROM ${sourceTable}`,
        codePadLength,
        codeStart,
        allowedFields,
        referenceUsageChecks,
        buildReferenceFromRow: (row) => normalizeText(row[keyColumn]),
        buildReferenceFromInput: (input) => normalizeText(input[keyColumn] ?? input.code ?? input.recordReference),
        normalizeProposedValues: (payload) => {
            const values = {};
            for (const field of allowedFields) {
                if (payload[field] !== undefined) {
                    values[field] = payload[field];
                }
            }
            return values;
        },
        fetchSource: async (companyId, recordReference, connection) => {
            const [rows] = await connection.query(
                `SELECT * FROM ${sourceTable} WHERE ${keyColumn} = ? AND (CompanyID = ? OR CompanyID IS NULL) LIMIT 1`,
                [normalizeText(recordReference), Number(companyId) || 1]
            );
            return rows[0] || null;
        },
        applyCreate: async (companyId, proposedValues, connection) => {
            const columns = [keyColumn, ...allowedFields, 'CompanyID'].filter((value, index, array) => array.indexOf(value) === index);
            const data = {
                [keyColumn]: normalizeText(proposedValues[keyColumn]),
                CompanyID: Number(companyId) || 1
            };
            for (const field of allowedFields) {
                data[field] = proposedValues[field] ?? null;
            }
            const placeholders = columns.map(() => '?').join(', ');
            await connection.query(
                `INSERT INTO ${sourceTable} (${columns.join(', ')}) VALUES (${placeholders})`,
                columns.map((column) => data[column] ?? null)
            );
        },
        applyUpdate: async (companyId, recordReference, proposedValues, connection) => {
            const entries = Object.entries(proposedValues).filter(([field]) => field !== keyColumn && allowedFields.includes(field));
            if (!entries.length) {
                throw createError('There are no approved fields to apply for this parameter change.');
            }
            const setClause = entries.map(([field]) => `${field} = ?`).join(', ');
            await connection.query(
                `UPDATE ${sourceTable} SET ${setClause} WHERE ${keyColumn} = ? AND (CompanyID = ? OR CompanyID IS NULL)`,
                [...entries.map(([, value]) => value ?? null), normalizeText(recordReference), Number(companyId) || 1]
            );
        },
        applyDelete: async (companyId, recordReference, connection) => {
            await connection.query(
                `DELETE FROM ${sourceTable} WHERE ${keyColumn} = ? AND (CompanyID = ? OR CompanyID IS NULL)`,
                [normalizeText(recordReference), Number(companyId) || 1]
            );
        }
    };
}

const PARAMETER_MODULE_CONFIG = Object.freeze({
    'pay-types': makeLookupModule({
        module: 'pay-types',
        label: 'Payroll Activities / Pay Types',
        sourceTable: 'tblpaytype',
        pageRoute: '/admin/parameters/pay-types',
        classification: CLASSIFICATIONS.CRITICAL,
        allowedFields: ['Code', 'PayType'],
        referenceUsageChecks: [
            {
                sql: `SELECT COUNT(*) AS total FROM tblpayroll WHERE (PType = ? OR TRIM(PType) = ?)`,
                params: (reference) => [reference, reference],
                message: 'This payroll activity has historical transaction records and cannot be deleted.'
            },
            {
                sql: `SELECT COUNT(*) AS total FROM tblyearlypayments WHERE (PType = ? OR TRIM(PType) = ?)`,
                params: (reference) => [reference, reference],
                message: 'This payroll activity is referenced by yearly payments and cannot be deleted.'
            },
            {
                sql: `SELECT COUNT(*) AS total FROM tblincrement WHERE (PType = ? OR TRIM(PType) = ?)`,
                params: (reference) => [reference, reference],
                message: 'This payroll activity is referenced by increment records and cannot be deleted.'
            },
            {
                sql: `SELECT COUNT(*) AS total FROM payroll_workflow_batches WHERE (PType = ? OR TRIM(PType) = ?)`,
                params: (reference) => [reference, reference],
                message: 'This payroll activity is referenced by payroll workflow batches and cannot be deleted.'
            },
            {
                sql: `SELECT COUNT(*) AS total FROM payroll_gl_posting_batches WHERE (activity_code = ? OR TRIM(activity_code) = ?)`,
                params: (reference) => [reference, reference],
                message: 'This payroll activity is referenced by GL posting batches and cannot be deleted.'
            },
            {
                sql: `SELECT COUNT(*) AS total FROM tblexport WHERE (PType = ? OR TRIM(PType) = ?)`,
                params: (reference) => [reference, reference],
                message: 'This payroll activity is referenced by export history and cannot be deleted.'
            }
        ]
    }),
    'payroll-items': makeLookupModule({
        module: 'payroll-items',
        label: 'Payroll Items',
        sourceTable: 'tblpayrollitems',
        pageRoute: '/admin/parameters/payroll-items',
        classification: CLASSIFICATIONS.CRITICAL,
        allowedFields: ['Code', 'Income', 'Taxable', 'Threshhold', 'TPercent', 'TPercentage', 'TAmount', 'Mode', 'Fixed', 'Percent', 'Freq'],
        referenceUsageChecks: [
            {
                sql: `SELECT COUNT(*) AS total FROM tblpayroll WHERE (PType = ? OR TRIM(PType) = ?)`,
                message: 'This payroll item code is already used in payroll history and cannot be deleted safely.'
            }
        ]
    }),
    departments: makeLookupModule({
        module: 'departments',
        label: 'Departments',
        sourceTable: 'tbldept',
        pageRoute: '/admin/parameters/departments',
        classification: CLASSIFICATIONS.OPERATIONAL,
        codePadLength: 3,
        codeStart: '001',
        allowedFields: ['Code', 'Dept'],
        referenceUsageChecks: [
            {
                sql: `SELECT COUNT(*) AS total FROM tblstaff WHERE CDept = ?`,
                message: 'This department is assigned to staff records and cannot be deleted.'
            }
        ]
    }),
    'job-titles': makeLookupModule({
        module: 'job-titles',
        label: 'Job Titles',
        sourceTable: 'tbljobtitle',
        pageRoute: '/admin/parameters/job-titles',
        classification: CLASSIFICATIONS.OPERATIONAL,
        codePadLength: 4,
        codeStart: '0001',
        allowedFields: ['Code', 'JobTitle', 'Field1'],
        referenceUsageChecks: [
            {
                sql: `SELECT COUNT(*) AS total FROM tblstaff WHERE JobTitle = ?`,
                message: 'This job title is assigned to staff records and cannot be deleted.'
            }
        ]
    }),
    grades: makeLookupModule({
        module: 'grades',
        label: 'Salary Grades',
        sourceTable: 'tblgrade',
        keyColumn: 'GradeCode',
        pageRoute: '/admin/parameters/grades',
        classification: CLASSIFICATIONS.CRITICAL,
        codePadLength: 4,
        codeStart: '0001',
        allowedFields: ['GradeCode', 'Grade', 'JobTitle', 'WDays', 'Medical', 'LDays', 'Confirm', 'Notice', 'NotchIncr', 'PromPeriod'],
        referenceUsageChecks: [
            {
                sql: `SELECT COUNT(*) AS total FROM tblstaff WHERE CGrade = ? OR GradeCode = ?`,
                params: (reference) => [reference, reference],
                message: 'This grade is already assigned to staff records and cannot be deleted.'
            }
        ]
    }),
    banks: makeLookupModule({
        module: 'banks',
        label: 'Banks',
        sourceTable: 'tblbanks',
        pageRoute: '/admin/parameters/banks',
        classification: CLASSIFICATIONS.OPERATIONAL,
        allowedFields: ['Code', 'Bank', 'Short', 'Street_Address', 'Town_Address', 'BankCode'],
        referenceUsageChecks: [
            {
                sql: `SELECT COUNT(*) AS total FROM tblstaff WHERE Bank = ?`,
                message: 'This bank is referenced by staff payment details and cannot be deleted.'
            }
        ]
    }),
    'company-bban': makeLookupModule({
        module: 'company-bban',
        label: 'Company BBAN',
        sourceTable: 'tblpayingbank',
        pageRoute: '/admin/parameters/company-bban',
        classification: CLASSIFICATIONS.OPERATIONAL,
        allowedFields: ['Code', 'BBAN', 'Bank', 'Short']
    }),
    'gl-accounts': makeLookupModule({
        module: 'gl-accounts',
        label: 'GL Accounts',
        sourceTable: 'tblglaccounts',
        keyColumn: 'GLNo',
        pageRoute: '/admin/parameters/gl-accounts',
        classification: CLASSIFICATIONS.CRITICAL,
        allowedFields: ['GLNo', 'AccountsHead', 'Code'],
        referenceUsageChecks: [
            {
                sql: `SELECT COUNT(*) AS total FROM payroll_gl_account_mappings WHERE gl_account_no = ? OR contra_gl_account_no = ?`,
                params: (reference) => [reference, reference],
                message: 'This GL account is used by payroll posting mappings and cannot be deleted.'
            }
        ]
    }),
    'discipline-outcomes': makeLookupModule({
        module: 'discipline-outcomes',
        label: 'Discipline Outcomes',
        sourceTable: 'tblmreaction',
        pageRoute: '/admin/parameters/discipline-outcomes',
        classification: CLASSIFICATIONS.OPERATIONAL,
        allowedFields: ['Code', 'Reaction']
    }),
    'discipline-reasons': makeLookupModule({
        module: 'discipline-reasons',
        label: 'Discipline Reasons',
        sourceTable: 'tblreason',
        keyColumn: 'ReasonCode',
        pageRoute: '/admin/parameters/discipline-reasons',
        classification: CLASSIFICATIONS.OPERATIONAL,
        allowedFields: ['ReasonCode', 'Reason']
    }),
    queries: makeLookupModule({
        module: 'queries',
        label: 'Query Types',
        sourceTable: 'tblqtype',
        pageRoute: '/admin/parameters/queries',
        classification: CLASSIFICATIONS.CRITICAL,
        allowedFields: ['Code', 'QType'],
        referenceUsageChecks: [
            {
                sql: `SELECT COUNT(*) AS total FROM tblquery WHERE QType = ? OR QCode = ?`,
                params: (reference) => [reference, reference],
                message: 'This query type is already used by salary queries and cannot be deleted.'
            }
        ]
    }),
    courses: makeLookupModule({
        module: 'courses',
        label: 'Course Types',
        sourceTable: 'tblcoursetype',
        keyColumn: 'CourseCode',
        pageRoute: '/admin/parameters/courses',
        classification: CLASSIFICATIONS.OPERATIONAL,
        allowedFields: ['CourseCode', 'CType']
    }),
    'emp-status': makeLookupModule({
        module: 'emp-status',
        label: 'Employee Statuses',
        sourceTable: 'tblempstatus',
        pageRoute: '/admin/parameters/emp-status',
        classification: CLASSIFICATIONS.CRITICAL,
        allowedFields: ['Code', 'EmpStatus'],
        referenceUsageChecks: [
            {
                sql: `SELECT COUNT(*) AS total FROM tblstaff WHERE EmpStatus = ?`,
                message: 'This employee status is assigned to staff records and cannot be deleted.'
            }
        ]
    }),
    sponsors: makeLookupModule({
        module: 'sponsors',
        label: 'Training Sponsors',
        sourceTable: 'tblCourseSponsor',
        keyColumn: 'SCode',
        pageRoute: '/admin/parameters/sponsors',
        classification: CLASSIFICATIONS.OPERATIONAL,
        allowedFields: ['SCode', 'Sponsor']
    }),
    'public-holidays': {
        module: 'public-holidays',
        label: 'Public Holidays',
        sourceTable: 'tblpublic_holidays',
        pageRoute: '/admin/parameters/public-holidays',
        classification: CLASSIFICATIONS.CRITICAL,
        changeTypes: [PARAMETER_CHANGE_TYPES.CREATE, PARAMETER_CHANGE_TYPES.UPDATE, PARAMETER_CHANGE_TYPES.DELETE],
        buildReferenceFromRow: (row) => `${normalizeText(row.Pub_Year)}|${normalizeText(row.Pub_Name)}`,
        buildReferenceFromInput: (input) => `${normalizeText(input.Pub_Year ?? input.year)}|${normalizeText(input.Pub_Name ?? input.name)}`,
        normalizeProposedValues: (payload) => ({
            Pub_Year: normalizeText(payload.Pub_Year),
            Pub_Name: normalizeText(payload.Pub_Name),
            Pub_Date: payload.Pub_Date || null,
            HDate: payload.HDate || null,
            Approved: payload.Approved ?? 0
        }),
        fetchSource: async (companyId, recordReference, connection) => {
            const [year, name] = normalizeText(recordReference).split('|');
            const [rows] = await connection.query(
                `SELECT * FROM tblpublic_holidays WHERE Pub_Year = ? AND Pub_Name = ? AND (CompanyID = ? OR CompanyID IS NULL) LIMIT 1`,
                [year, name, Number(companyId) || 1]
            );
            return rows[0] || null;
        },
        applyCreate: async (companyId, proposedValues, connection) => {
            await connection.query(
                `INSERT INTO tblpublic_holidays (Pub_Date, Pub_Year, Pub_Name, HDate, Approved, CompanyID, DateKeyedIn)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [proposedValues.Pub_Date || null, proposedValues.Pub_Year, proposedValues.Pub_Name, proposedValues.HDate || null, proposedValues.Approved ?? 0, Number(companyId) || 1]
            );
        },
        applyUpdate: async (companyId, recordReference, proposedValues, connection) => {
            const [year, name] = normalizeText(recordReference).split('|');
            await connection.query(
                `UPDATE tblpublic_holidays
                 SET Pub_Date = ?, Pub_Year = ?, Pub_Name = ?, HDate = ?, Approved = ?
                 WHERE Pub_Year = ? AND Pub_Name = ? AND (CompanyID = ? OR CompanyID IS NULL)`,
                [proposedValues.Pub_Date || null, proposedValues.Pub_Year, proposedValues.Pub_Name, proposedValues.HDate || null, proposedValues.Approved ?? 0, year, name, Number(companyId) || 1]
            );
        },
        applyDelete: async (companyId, recordReference, connection) => {
            const [year, name] = normalizeText(recordReference).split('|');
            await connection.query(
                `DELETE FROM tblpublic_holidays WHERE Pub_Year = ? AND Pub_Name = ? AND (CompanyID = ? OR CompanyID IS NULL)`,
                [year, name, Number(companyId) || 1]
            );
        }
    },
    'global-params': {
        module: 'global-params',
        label: 'Global Parameters',
        sourceTable: 'tblparams1',
        pageRoute: '/admin/parameters/global-params',
        classification: CLASSIFICATIONS.CRITICAL,
        changeTypes: [PARAMETER_CHANGE_TYPES.UPDATE],
        buildReferenceFromRow: () => 'GLOBAL',
        buildReferenceFromInput: () => 'GLOBAL',
        normalizeProposedValues: (payload) => ({
            SeqNo: payload.SeqNo || null,
            RegNo: payload.RegNo || null,
            NDate: payload.NDate || null,
            NRate: payload.NRate || null,
            NORate: payload.NORate || null,
            GDate: payload.GDate || null,
            GRate: payload.GRate || null,
            GORate: payload.GORate || null,
            RetireAge: payload.RetireAge || null,
            ConfirmDays: payload.ConfirmDays || null,
            ChildAge: payload.ChildAge || null,
            EmpAge: payload.EmpAge || null,
            Management: payload.Management || null,
            UnionDues: payload.UnionDues || null,
            Max_Dependants: payload.Max_Dependants || null,
            RetireNotice: payload.RetireNotice || null,
            AdvanceInt: payload.AdvanceInt || null,
            QueryLimit: payload.QueryLimit || null,
            ClockIn: payload.ClockIn || null,
            LoanDuration: payload.LoanDuration || null,
            HOD: payload.HOD || null,
            Dept: payload.Dept || null,
            DeptName: payload.DeptName || null,
            VPolicy: payload.VPolicy || '0'
        }),
        fetchSource: async (companyId, recordReference, connection) => {
            const [rows] = await connection.query(
                `SELECT * FROM tblparams1 WHERE CompanyID = ? OR CompanyID IS NULL LIMIT 1`,
                [Number(companyId) || 1]
            );
            return rows[0] || null;
        },
        applyCreate: async (companyId, proposedValues, connection) => {
            const data = { ...proposedValues, CompanyID: Number(companyId) || 1 };
            const columns = Object.keys(data);
            await connection.query(
                `INSERT INTO tblparams1 (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
                columns.map((column) => data[column] ?? null)
            );
        },
        applyUpdate: async (companyId, recordReference, proposedValues, connection) => {
            const source = await PARAMETER_MODULE_CONFIG['global-params'].fetchSource(companyId, recordReference, connection);
            if (!source) {
                return PARAMETER_MODULE_CONFIG['global-params'].applyCreate(companyId, proposedValues, connection);
            }
            const entries = Object.entries(proposedValues);
            await connection.query(
                `UPDATE tblparams1 SET ${entries.map(([field]) => `${field} = ?`).join(', ')} WHERE CompanyID = ? OR CompanyID IS NULL`,
                [...entries.map(([, value]) => value ?? null), Number(companyId) || 1]
            );
        }
    },
    'end-of-service-benefit': {
        module: 'end-of-service-benefit',
        label: 'End of Service Benefit',
        sourceTable: 'tbleoscalc',
        pageRoute: '/admin/parameters/end-of-service-benefit',
        classification: CLASSIFICATIONS.CRITICAL,
        changeTypes: [PARAMETER_CHANGE_TYPES.UPDATE],
        buildReferenceFromRow: () => 'EOS',
        buildReferenceFromInput: () => 'EOS',
        normalizeProposedValues: (payload) => ({
            EOSDate: payload.EOSDate || null,
            Y1: payload.Y1 || null, D1: payload.D1 || null, R1: payload.R1 || null,
            Y2: payload.Y2 || null, D2: payload.D2 || null, R2: payload.R2 || null,
            Y3: payload.Y3 || null, D3: payload.D3 || null, R3: payload.R3 || null,
            Y4: payload.Y4 || null, D4: payload.D4 || null, R4: payload.R4 || null,
            Y5: payload.Y5 || null, D5: payload.D5 || null, R5: payload.R5 || null,
            E1: payload.E1 || null, E2: payload.E2 || null, B1: payload.B1 || null,
            E3: payload.E3 || null, E4: payload.E4 || null, B2: payload.B2 || null,
            MinAge: payload.MinAge || null,
            Exemption: payload.Exemption || null, EOSTax: payload.EOSTax || null,
            LS1: payload.LS1 || null, L1Percent: payload.L1Percent || null, L1_USD: payload.L1_USD || null,
            LS2: payload.LS2 || null, L2ercent: payload.L2ercent || null, L2_USD: payload.L2_USD || null,
            LS3: payload.LS3 || null, L3Percent: payload.L3Percent || null, L3_USD: payload.L3_USD || null
        }),
        fetchSource: async (companyId, recordReference, connection) => {
            const [rows] = await connection.query(
                `SELECT * FROM tbleoscalc WHERE CompanyID = ? OR CompanyID IS NULL ORDER BY EOSDate DESC LIMIT 1`,
                [Number(companyId) || 1]
            );
            return rows[0] || null;
        },
        applyCreate: async (companyId, proposedValues, connection) => {
            const data = { BankID: '0001', ...proposedValues, CompanyID: Number(companyId) || 1 };
            const columns = Object.keys(data);
            await connection.query(
                `INSERT INTO tbleoscalc (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
                columns.map((column) => data[column] ?? null)
            );
        },
        applyUpdate: async (companyId, recordReference, proposedValues, connection) => {
            const source = await PARAMETER_MODULE_CONFIG['end-of-service-benefit'].fetchSource(companyId, recordReference, connection);
            if (!source) {
                return PARAMETER_MODULE_CONFIG['end-of-service-benefit'].applyCreate(companyId, proposedValues, connection);
            }
            const entries = Object.entries(proposedValues);
            await connection.query(
                `UPDATE tbleoscalc SET ${entries.map(([field]) => `${field} = ?`).join(', ')} WHERE EOSDate = ?`,
                [...entries.map(([, value]) => value ?? null), source.EOSDate]
            );
        }
    },
    'work-days': {
        module: 'work-days',
        label: 'Work Days',
        sourceTable: 'tblweek',
        pageRoute: '/admin/parameters/work-days',
        classification: CLASSIFICATIONS.CRITICAL,
        changeTypes: [PARAMETER_CHANGE_TYPES.UPDATE],
        buildReferenceFromRow: () => 'WORK_WEEK',
        buildReferenceFromInput: () => 'WORK_WEEK',
        normalizeProposedValues: (payload) => (Array.isArray(payload) ? payload.map((row) => ({
            DayNo: row.DayNo,
            WDayNo: row.WDayNo,
            WorkDay: row.WorkDay
        })) : []),
        fetchSource: async (companyId, recordReference, connection) => {
            const [rows] = await connection.query(
                `SELECT * FROM tblweek ORDER BY DayNo ASC`
            );
            return rows;
        },
        applyUpdate: async (companyId, recordReference, proposedValues, connection) => {
            for (const row of proposedValues) {
                await connection.query(
                    `UPDATE tblweek SET WDayNo = ?, WorkDay = ? WHERE DayNo = ?`,
                    [row.WDayNo ?? null, row.WorkDay ?? 0, row.DayNo]
                );
            }
        }
    },
    'tax-table': {
        module: 'tax-table',
        label: 'Tax Table',
        sourceTable: 'tbltax',
        pageRoute: '/admin/parameters/tax-table',
        classification: CLASSIFICATIONS.CRITICAL,
        changeTypes: [PARAMETER_CHANGE_TYPES.UPDATE],
        buildReferenceFromRow: () => 'TAX',
        buildReferenceFromInput: () => 'TAX',
        normalizeProposedValues: (payload) => ({
            TaxDate: payload.TaxDate || null,
            R1: payload.R1 || null, R1Tax: payload.R1Tax || null,
            R2: payload.R2 || null, R2Tax: payload.R2Tax || null,
            R3: payload.R3 || null, R3Tax: payload.R3Tax || null,
            R4: payload.R4 || null, R4Tax: payload.R4Tax || null,
            R5: payload.R5 || null, R5Tax: payload.R5Tax || null,
            R6: payload.R6 || null, R6Tax: payload.R6Tax || null,
            R7: payload.R7 || null, R7Tax: payload.R7Tax || null,
            RentThreshold: payload.RentThreshold || null,
            AllwThreshold: payload.AllwThreshold || null,
            Withholding_Tax: payload.Withholding_Tax || null
        }),
        fetchSource: async (companyId, recordReference, connection) => {
            const [rows] = await connection.query(
                `SELECT * FROM tbltax WHERE CompanyID = ? OR CompanyID IS NULL ORDER BY TaxDate DESC LIMIT 1`,
                [Number(companyId) || 1]
            );
            return rows[0] || null;
        },
        applyCreate: async (companyId, proposedValues, connection) => {
            const data = { BankID: '0001', ...proposedValues, CompanyID: Number(companyId) || 1 };
            const columns = Object.keys(data);
            await connection.query(
                `INSERT INTO tbltax (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
                columns.map((column) => data[column] ?? null)
            );
        },
        applyUpdate: async (companyId, recordReference, proposedValues, connection) => {
            const source = await PARAMETER_MODULE_CONFIG['tax-table'].fetchSource(companyId, recordReference, connection);
            if (!source) {
                return PARAMETER_MODULE_CONFIG['tax-table'].applyCreate(companyId, proposedValues, connection);
            }
            const entries = Object.entries(proposedValues);
            await connection.query(
                `UPDATE tbltax SET ${entries.map(([field]) => `${field} = ?`).join(', ')} WHERE TaxDate = ?`,
                [...entries.map(([, value]) => value ?? null), source.TaxDate]
            );
        }
    }
});

function getModuleConfig(module) {
    const config = PARAMETER_MODULE_CONFIG[normalizeText(module)];
    if (!config) {
        throw createError('Unsupported parameter module.', 404);
    }
    return config;
}

async function ensureParameterChangeTables(connection = null) {
    if (!parameterChangeTablesReadyPromise) {
        parameterChangeTablesReadyPromise = (async () => {
            const migrationPath = path.join(__dirname, '..', 'database', 'migrations', '20260714-parameter-change-workflow.sql');
            const sql = fs.readFileSync(migrationPath, 'utf8').trim();
            if (!sql) {
                return;
            }

            const statements = sql
                .split(/;\s*\n/)
                .map((statement) => statement.trim())
                .filter(Boolean);

            for (const statement of statements) {
                await pool.query(statement);
            }
        })().catch((error) => {
            parameterChangeTablesReadyPromise = null;
            throw error;
        });
    }

    await parameterChangeTablesReadyPromise;
}

async function getNextCode(sourceTable, keyColumn, startCode, padLength, connection) {
    const [rows] = await connection.query(`SELECT ${keyColumn} AS code FROM ${sourceTable}`);
    let nextCode = startCode;
    const numericCodes = rows
        .map((row) => parseInt(row.code, 10))
        .filter((value) => !Number.isNaN(value));
    if (numericCodes.length) {
        nextCode = String(Math.max(...numericCodes) + 1).padStart(padLength, '0');
    }
    return nextCode;
}

function buildProposalPayload(config, payload) {
    return stableSerialize(config.normalizeProposedValues ? config.normalizeProposedValues(payload) : payload);
}

async function getActiveDraftRequest(companyId, module, recordReference, connection) {
    const [rows] = await connection.query(
        `SELECT * FROM parameter_change_requests
         WHERE CompanyID = ?
           AND ParameterModule = ?
           AND RecordReference = ?
           AND Status IN (?, ?, ?)
         ORDER BY id DESC
         LIMIT 1`,
        [
            Number(companyId) || 1,
            module,
            normalizeText(recordReference),
            PARAMETER_CHANGE_STATUSES.DRAFT,
            PARAMETER_CHANGE_STATUSES.RETURNED_BY_ENTITY_HEAD,
            PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD
        ]
    );
    return rows[0] || null;
}

async function getRequestById(companyId, requestId, connection) {
    const [rows] = await connection.query(
        `SELECT *
         FROM parameter_change_requests
         WHERE CompanyID = ?
           AND id = ?
         LIMIT 1`,
        [Number(companyId) || 1, Number(requestId) || 0]
    );
    return rows[0] || null;
}

async function updateRequest(connection, requestId, data) {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    if (!entries.length) {
        return;
    }
    await connection.query(
        `UPDATE parameter_change_requests
         SET ${entries.map(([field]) => `${field} = ?`).join(', ')}
         WHERE id = ?`,
        [...entries.map(([, value]) => value), Number(requestId)]
    );
}

async function logAction(connection, payload) {
    const [result] = await connection.query(
        `INSERT INTO parameter_change_actions
        (ChangeRequestID, CompanyID, Action, FromStatus, ToStatus, ActionBy, ActionAt, Comments, Metadata, Result)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
        [
            Number(payload.changeRequestId),
            Number(payload.companyId) || 1,
            payload.action,
            payload.fromStatus || null,
            payload.toStatus,
            Number(payload.actionBy) || 0,
            payload.comments || null,
            payload.metadata ? JSON.stringify(payload.metadata) : null,
            payload.result || 'SUCCESS'
        ]
    );
    return Number(result.insertId || 0);
}

async function logAudit(connection, { companyId, userName, action, recordId, message }) {
    const [rows] = await connection.query('SELECT COALESCE(MAX(AuditTrailID), 0) + 1 AS nextId FROM tblaudittrail');
    const nextId = Number(rows[0]?.nextId || 1);
    await connection.query(
        `INSERT INTO tblaudittrail
         (AuditTrailID, ChangeDate, UserName, FormName, Action, RecordID, FieldName, OldValue, NewValue, Loggedout, CompanyID)
         VALUES (?, NOW(), ?, 'admin/parameter-change', ?, ?, 'Status', NULL, ?, 0, ?)`,
        [nextId, userName || 'System', action, String(recordId || '').slice(0, 6), message || null, Number(companyId) || 1]
    );
}

async function validateDeleteUsage(config, recordReference, connection) {
    for (const check of config.referenceUsageChecks || []) {
        const params = typeof check.params === 'function'
            ? check.params(recordReference)
            : [recordReference];
        const [rows] = await connection.query(check.sql, params);
        if (Number(rows[0]?.total || 0) > 0) {
            throw createError(check.message, 409);
        }
    }
}

async function fetchLiveSource(config, companyId, recordReference, connection) {
    const source = await config.fetchSource(companyId, recordReference, connection);
    return source === undefined ? null : source;
}

function parseJsonField(value, fallback = null) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }
    if (typeof value === 'object') {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

async function createOrUpdateProposal({
    companyId,
    module,
    changeType,
    recordReference,
    oldValues,
    proposedValues,
    reason,
    user,
    sourceChecksum,
    connection
}) {
    const actor = assertAdminActor(user);
    const executor = connection || pool;
    const existing = await getActiveDraftRequest(companyId, module, recordReference, executor);
    const now = new Date();

    if (existing && existing.Status === PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD) {
        throw createError('This proposed change has already been submitted to the Entity Head/HNO and is locked.', 409);
    }

    if (existing) {
        await updateRequest(executor, existing.id, {
            ChangeType: changeType,
            OldValues: oldValues ? JSON.stringify(stableSerialize(oldValues)) : null,
            ProposedValues: JSON.stringify(stableSerialize(proposedValues)),
            Reason: normalizeText(reason),
            SourceChecksum: sourceChecksum || null,
            Status: PARAMETER_CHANGE_STATUSES.DRAFT,
            RejectedBy: null,
            RejectedAt: null,
            RejectionReason: null,
            EntityHeadComments: null,
            UpdatedAt: now
        });
        await logAction(executor, {
            changeRequestId: existing.id,
            companyId,
            action: PARAMETER_CHANGE_ACTIONS.SAVE_DRAFT,
            fromStatus: existing.Status,
            toStatus: PARAMETER_CHANGE_STATUSES.DRAFT,
            actionBy: actor.id,
            comments: normalizeText(reason),
            metadata: { module, changeType, recordReference }
        });
        return existing.id;
    }

    const [result] = await executor.query(
        `INSERT INTO parameter_change_requests
        (CompanyID, ParameterModule, SourceTable, RecordReference, ChangeType, Status, OldValues, ProposedValues, Reason, SubmittedBy, SourceChecksum, CreatedAt, UpdatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
            Number(companyId) || 1,
            module,
            getModuleConfig(module).sourceTable,
            normalizeText(recordReference),
            changeType,
            PARAMETER_CHANGE_STATUSES.DRAFT,
            oldValues ? JSON.stringify(stableSerialize(oldValues)) : null,
            JSON.stringify(stableSerialize(proposedValues)),
            normalizeText(reason),
            actor.id,
            sourceChecksum || null
        ]
    );

    const requestId = Number(result.insertId || 0);
    await logAction(executor, {
        changeRequestId: requestId,
        companyId,
        action: PARAMETER_CHANGE_ACTIONS.SAVE_DRAFT,
        fromStatus: null,
        toStatus: PARAMETER_CHANGE_STATUSES.DRAFT,
        actionBy: actor.id,
        comments: normalizeText(reason),
        metadata: { module, changeType, recordReference }
    });
    return requestId;
}

async function createParameterChangeDraft({ companyId, module, changeType, payload, reason, user, connection = null }) {
    const actor = assertAdminActor(user);
    const config = getModuleConfig(module);
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        await ensureParameterChangeTables(executor);

        let sourceRow = null;
        let recordReference = null;
        let proposedValues = buildProposalPayload(config, payload);

        if (changeType === PARAMETER_CHANGE_TYPES.CREATE) {
            if (config.keyColumn && !proposedValues[config.keyColumn]) {
                proposedValues[config.keyColumn] = await getNextCode(config.sourceTable, config.keyColumn, config.codeStart || '01', config.codePadLength || 2, executor);
            }
            recordReference = config.buildReferenceFromInput(proposedValues);
            const liveRow = await fetchLiveSource(config, companyId, recordReference, executor);
            if (liveRow) {
                throw createError('A live parameter record with the same reference already exists.', 409);
            }
        } else {
            recordReference = config.buildReferenceFromInput(payload);
            sourceRow = await fetchLiveSource(config, companyId, recordReference, executor);
            if (!sourceRow) {
                throw createError('The live parameter record was not found.', 404);
            }
            if (changeType === PARAMETER_CHANGE_TYPES.DELETE) {
                await validateDeleteUsage(config, recordReference, executor);
                proposedValues = {};
            }
        }

        const requestId = await createOrUpdateProposal({
            companyId,
            module,
            changeType,
            recordReference,
            oldValues: sourceRow,
            proposedValues,
            reason,
            user: actor,
            sourceChecksum: sourceRow ? buildChecksum(sourceRow) : null,
            connection: executor
        });

        await logAudit(executor, {
            companyId,
            userName: actor.name,
            action: 'PARAMETER_DRAFT',
            recordId: requestId,
            message: `${config.label} proposal saved as draft.`
        });

        if (managedConnection) {
            await executor.commit();
        }

        return getParameterChangeDetail(companyId, requestId, actor, executor);
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function submitParameterChange({ companyId, requestId, reason = '', user, connection = null }) {
    const actor = assertAdminActor(user);
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        await ensureParameterChangeTables(executor);
        const request = await getRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Parameter change request not found.', 404);
        }
        if (!SUBMITTABLE_STATUSES.has(request.Status)) {
            throw createError('Only draft or returned parameter changes can be submitted.', 409);
        }
        if (Number(request.SubmittedBy || 0) !== actor.id) {
            throw createError('You can only submit your own parameter change requests.', 403);
        }

        await updateRequest(executor, request.id, {
            Status: PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD,
            SubmittedAt: new Date(),
            Reason: normalizeText(reason) || request.Reason
        });

        const actionId = await logAction(executor, {
            changeRequestId: request.id,
            companyId,
            action: PARAMETER_CHANGE_ACTIONS.SUBMIT,
            fromStatus: request.Status,
            toStatus: PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD,
            actionBy: actor.id,
            comments: normalizeText(reason) || request.Reason,
            metadata: { module: request.ParameterModule }
        });

        await workflowNotificationService.ensureNotificationTable(executor);
        await workflowNotificationService.notifyParameterChangeAction({
            companyId,
            request: { ...request, Status: PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD },
            action: PARAMETER_CHANGE_ACTIONS.SUBMIT,
            actionId,
            actor,
            comments: normalizeText(reason) || request.Reason,
            connection: executor
        });

        await logAudit(executor, {
            companyId,
            userName: actor.name,
            action: 'PARAMETER_SUBMIT',
            recordId: request.id,
            message: `${request.ParameterModule} proposal submitted to Entity Head/HNO.`
        });

        if (managedConnection) {
            await executor.commit();
        }

        return request.id;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function cancelParameterChange({ companyId, requestId, user, connection = null }) {
    const actor = assertAdminActor(user);
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        const request = await getRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Parameter change request not found.', 404);
        }
        if (Number(request.SubmittedBy || 0) !== actor.id) {
            throw createError('You can only cancel your own parameter change requests.', 403);
        }
        if (request.Status !== PARAMETER_CHANGE_STATUSES.DRAFT) {
            throw createError('Only draft parameter changes can be cancelled.', 409);
        }
        await updateRequest(executor, request.id, { Status: PARAMETER_CHANGE_STATUSES.CANCELLED });
        await logAction(executor, {
            changeRequestId: request.id,
            companyId,
            action: PARAMETER_CHANGE_ACTIONS.CANCEL,
            fromStatus: request.Status,
            toStatus: PARAMETER_CHANGE_STATUSES.CANCELLED,
            actionBy: actor.id,
            comments: 'Cancelled by Administrator.',
            metadata: { module: request.ParameterModule }
        });
        if (managedConnection) {
            await executor.commit();
        }
        return true;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function applyApprovedChange({ companyId, request, actor, connection }) {
    const config = getModuleConfig(request.ParameterModule);
    const oldValues = parseJsonField(request.OldValues, null);
    const proposedValues = parseJsonField(request.ProposedValues, {});
    const liveSource = await fetchLiveSource(config, companyId, request.RecordReference, connection);

    if (request.ChangeType === PARAMETER_CHANGE_TYPES.CREATE) {
        if (liveSource) {
            throw createError('The live parameter record now exists already. Please create a fresh proposal.', 409);
        }
        await config.applyCreate(companyId, proposedValues, connection);
        return { oldValues, proposedValues };
    }

    if (!liveSource) {
        throw createError('The live parameter record no longer exists. Please return the proposal for resubmission.', 409);
    }

    if (request.SourceChecksum && buildChecksum(liveSource) !== request.SourceChecksum) {
        throw createError('The live parameter record changed after submission. Please return this proposal for resubmission.', 409);
    }

    if (request.ChangeType === PARAMETER_CHANGE_TYPES.UPDATE) {
        await config.applyUpdate(companyId, request.RecordReference, proposedValues, connection);
        return { oldValues: liveSource, proposedValues };
    }

    if (request.ChangeType === PARAMETER_CHANGE_TYPES.DELETE) {
        await validateDeleteUsage(config, request.RecordReference, connection);
        await config.applyDelete(companyId, request.RecordReference, connection);
        return { oldValues: liveSource, proposedValues: null };
    }

    if (request.ChangeType === PARAMETER_CHANGE_TYPES.ACTIVATE || request.ChangeType === PARAMETER_CHANGE_TYPES.DEACTIVATE) {
        await config.applyUpdate(companyId, request.RecordReference, proposedValues, connection);
        return { oldValues: liveSource, proposedValues };
    }

    throw createError('Unsupported change type.', 400);
}

async function entityHeadApproveParameterChange({ companyId, requestId, comments = '', user, connection = null }) {
    const actor = assertEntityHeadActor(user);
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        await ensureParameterChangeTables(executor);
        await workflowNotificationService.ensureNotificationTable(executor);
        const request = await getRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Parameter change request not found.', 404);
        }
        if (request.Status !== PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD) {
            throw createError('This parameter change is not awaiting Entity Head/HNO approval.', 409);
        }
        if (Number(request.SubmittedBy || 0) === actor.id) {
            throw createError('You cannot approve your own proposed parameter change.', 403);
        }

        await updateRequest(executor, request.id, {
            Status: PARAMETER_CHANGE_STATUSES.FINAL_APPROVED,
            FinalApprovedBy: actor.id,
            FinalApprovedAt: new Date(),
            EntityHeadComments: normalizeText(comments) || null
        });

        const approveActionId = await logAction(executor, {
            changeRequestId: request.id,
            companyId,
            action: PARAMETER_CHANGE_ACTIONS.APPROVE,
            fromStatus: request.Status,
            toStatus: PARAMETER_CHANGE_STATUSES.FINAL_APPROVED,
            actionBy: actor.id,
            comments: normalizeText(comments) || 'Approved by Entity Head/HNO.',
            metadata: { module: request.ParameterModule }
        });

        const applyResult = await applyApprovedChange({ companyId, request, actor, connection: executor });

        await updateRequest(executor, request.id, {
            Status: PARAMETER_CHANGE_STATUSES.APPLIED,
            AppliedAt: new Date(),
            AppliedBy: actor.id
        });

        const applyActionId = await logAction(executor, {
            changeRequestId: request.id,
            companyId,
            action: PARAMETER_CHANGE_ACTIONS.APPLY,
            fromStatus: PARAMETER_CHANGE_STATUSES.FINAL_APPROVED,
            toStatus: PARAMETER_CHANGE_STATUSES.APPLIED,
            actionBy: actor.id,
            comments: 'Approved change applied to the live source table.',
            metadata: {
                module: request.ParameterModule,
                oldValues: applyResult.oldValues,
                proposedValues: applyResult.proposedValues
            }
        });

        await workflowNotificationService.notifyParameterChangeAction({
            companyId,
            request: { ...request, Status: PARAMETER_CHANGE_STATUSES.APPLIED },
            action: PARAMETER_CHANGE_ACTIONS.APPLY,
            actionId: applyActionId || approveActionId,
            actor,
            comments: normalizeText(comments),
            connection: executor
        });

        await logAudit(executor, {
            companyId,
            userName: actor.name,
            action: 'PARAMETER_APPLY',
            recordId: request.id,
            message: `${request.ParameterModule} proposal approved and applied.`
        });

        if (managedConnection) {
            await executor.commit();
        }
        return request.id;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function entityHeadReturnParameterChange({ companyId, requestId, comments = '', user, connection = null }) {
    const actor = assertEntityHeadActor(user);
    if (!normalizeText(comments)) {
        throw createError('Please provide a reason for returning the parameter change.', 400);
    }
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        await ensureParameterChangeTables(executor);
        await workflowNotificationService.ensureNotificationTable(executor);
        const request = await getRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Parameter change request not found.', 404);
        }
        if (request.Status !== PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD) {
            throw createError('This parameter change is not awaiting Entity Head/HNO action.', 409);
        }
        await updateRequest(executor, request.id, {
            Status: PARAMETER_CHANGE_STATUSES.RETURNED_BY_ENTITY_HEAD,
            EntityHeadComments: normalizeText(comments)
        });
        const actionId = await logAction(executor, {
            changeRequestId: request.id,
            companyId,
            action: PARAMETER_CHANGE_ACTIONS.RETURN,
            fromStatus: request.Status,
            toStatus: PARAMETER_CHANGE_STATUSES.RETURNED_BY_ENTITY_HEAD,
            actionBy: actor.id,
            comments: normalizeText(comments),
            metadata: { module: request.ParameterModule }
        });
        await workflowNotificationService.notifyParameterChangeAction({
            companyId,
            request: { ...request, Status: PARAMETER_CHANGE_STATUSES.RETURNED_BY_ENTITY_HEAD },
            action: PARAMETER_CHANGE_ACTIONS.RETURN,
            actionId,
            actor,
            comments: normalizeText(comments),
            connection: executor
        });
        if (managedConnection) {
            await executor.commit();
        }
        return request.id;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function entityHeadRejectParameterChange({ companyId, requestId, comments = '', user, connection = null }) {
    const actor = assertEntityHeadActor(user);
    if (!normalizeText(comments)) {
        throw createError('Please provide a reason for rejecting the parameter change.', 400);
    }
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }
        await ensureParameterChangeTables(executor);
        await workflowNotificationService.ensureNotificationTable(executor);
        const request = await getRequestById(companyId, requestId, executor);
        if (!request) {
            throw createError('Parameter change request not found.', 404);
        }
        if (request.Status !== PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD) {
            throw createError('This parameter change is not awaiting Entity Head/HNO action.', 409);
        }
        await updateRequest(executor, request.id, {
            Status: PARAMETER_CHANGE_STATUSES.FINAL_REJECTED,
            RejectedBy: actor.id,
            RejectedAt: new Date(),
            RejectionReason: normalizeText(comments),
            EntityHeadComments: normalizeText(comments)
        });
        const actionId = await logAction(executor, {
            changeRequestId: request.id,
            companyId,
            action: PARAMETER_CHANGE_ACTIONS.REJECT,
            fromStatus: request.Status,
            toStatus: PARAMETER_CHANGE_STATUSES.FINAL_REJECTED,
            actionBy: actor.id,
            comments: normalizeText(comments),
            metadata: { module: request.ParameterModule }
        });
        await workflowNotificationService.notifyParameterChangeAction({
            companyId,
            request: { ...request, Status: PARAMETER_CHANGE_STATUSES.FINAL_REJECTED },
            action: PARAMETER_CHANGE_ACTIONS.REJECT,
            actionId,
            actor,
            comments: normalizeText(comments),
            connection: executor
        });
        if (managedConnection) {
            await executor.commit();
        }
        return request.id;
    } catch (error) {
        if (managedConnection) {
            await executor.rollback();
        }
        throw error;
    } finally {
        if (managedConnection) {
            executor.release();
        }
    }
}

async function listParameterChanges(companyId, filters = {}, connection = null) {
    const executor = connection || pool;
    await ensureParameterChangeTables(executor);
    const conditions = ['CompanyID = ?'];
    const params = [Number(companyId) || 1];

    if (filters.module) {
        conditions.push('ParameterModule = ?');
        params.push(normalizeText(filters.module));
    }
    if (filters.status) {
        conditions.push('Status = ?');
        params.push(normalizeText(filters.status));
    }
    if (filters.submittedBy) {
        conditions.push('SubmittedBy = ?');
        params.push(Number(filters.submittedBy) || 0);
    }

    const [rows] = await executor.query(
        `SELECT * FROM parameter_change_requests
         WHERE ${conditions.join(' AND ')}
         ORDER BY UpdatedAt DESC, id DESC`,
        params
    );

    return rows.map((row) => {
        const config = PARAMETER_MODULE_CONFIG[row.ParameterModule];
        return {
            ...row,
            moduleLabel: config?.label || row.ParameterModule,
            classification: config?.classification || '',
            pageRoute: config?.pageRoute || '',
            badgeClass: mapStatusBadge(row.Status)
        };
    });
}

async function getParameterChangeDetail(companyId, requestId, user = null, connection = null) {
    const executor = connection || pool;
    await ensureParameterChangeTables(executor);
    const request = await getRequestById(companyId, requestId, executor);
    if (!request) {
        throw createError('Parameter change request not found.', 404);
    }
    const config = getModuleConfig(request.ParameterModule);
    const oldValues = parseJsonField(request.OldValues, null);
    const proposedValues = parseJsonField(request.ProposedValues, {});
    const [actions] = await executor.query(
        `SELECT * FROM parameter_change_actions WHERE ChangeRequestID = ? ORDER BY ActionAt ASC, id ASC`,
        [request.id]
    );
    const liveSource = await fetchLiveSource(config, companyId, request.RecordReference, executor);
    const fieldNames = Array.from(new Set([
        ...Object.keys(oldValues || {}),
        ...Object.keys(proposedValues || {})
    ])).sort();
    const usageSummary = request.ParameterModule === 'pay-types'
        ? await getPayTypeUsageSummary(companyId, request.RecordReference, executor)
        : null;

    return {
        request: {
            ...request,
            moduleLabel: config.label,
            classification: config.classification,
            pageRoute: config.pageRoute,
            badgeClass: mapStatusBadge(request.Status)
        },
        oldValues,
        proposedValues,
        comparisonRows: fieldNames.map((field) => ({
            field,
            oldValue: oldValues ? oldValues[field] : null,
            proposedValue: request.ChangeType === PARAMETER_CHANGE_TYPES.DELETE
                ? null
                : proposedValues && Object.prototype.hasOwnProperty.call(proposedValues, field)
                ? proposedValues[field]
                : (oldValues ? oldValues[field] : null)
        })),
        liveSource,
        usageSummary,
        actions,
        editable: user ? (normalizeRole(user.role || user.level) === 'admin' && Number(request.SubmittedBy || 0) === Number(user.id || 0) && EDITABLE_STATUSES.has(request.Status)) : false
    };
}

function getDiscoveryMatrix() {
    return Object.values(PARAMETER_MODULE_CONFIG).map((config) => ({
        module: config.label,
        sourceTable: config.sourceTable,
        adminRoute: config.pageRoute,
        sourceKey: config.keyColumn || 'Custom/singleton reference',
        classification: config.classification,
        workflow: 'Administrator proposal -> Entity Head/HNO final approval -> transactional apply'
    }));
}

async function getCountsByStatus(companyId, connection = null) {
    const executor = connection || pool;
    await ensureParameterChangeTables(executor);
    const [rows] = await executor.query(
        `SELECT Status, COUNT(*) AS total
         FROM parameter_change_requests
         WHERE CompanyID = ?
         GROUP BY Status`,
        [Number(companyId) || 1]
    );
    return rows.reduce((result, row) => {
        result[row.Status] = Number(row.total || 0);
        return result;
    }, {});
}

async function getPayTypeUsageSummary(companyId, code, connection = null) {
    const executor = connection || pool;
    const normalizedCode = normalizeText(code);
    const checks = [
        { key: 'tblPayroll', sql: `SELECT COUNT(*) AS total FROM tblpayroll WHERE (PType = ? OR TRIM(PType) = ?)`, params: [normalizedCode, normalizedCode] },
        { key: 'tblyearlypayments', sql: `SELECT COUNT(*) AS total FROM tblyearlypayments WHERE (PType = ? OR TRIM(PType) = ?)`, params: [normalizedCode, normalizedCode] },
        { key: 'tblincrement', sql: `SELECT COUNT(*) AS total FROM tblincrement WHERE (PType = ? OR TRIM(PType) = ?)`, params: [normalizedCode, normalizedCode] },
        { key: 'payroll_workflow_batches', sql: `SELECT COUNT(*) AS total FROM payroll_workflow_batches WHERE CompanyID = ? AND (PType = ? OR TRIM(PType) = ?)`, params: [Number(companyId) || 1, normalizedCode, normalizedCode] },
        { key: 'payroll_gl_posting_batches', sql: `SELECT COUNT(*) AS total FROM payroll_gl_posting_batches WHERE company_id = ? AND (activity_code = ? OR TRIM(activity_code) = ?)`, params: [Number(companyId) || 1, normalizedCode, normalizedCode] },
        { key: 'tblexport', sql: `SELECT COUNT(*) AS total FROM tblexport WHERE (PType = ? OR TRIM(PType) = ?)`, params: [normalizedCode, normalizedCode] }
    ];

    const summary = {};
    for (const check of checks) {
        try {
            const [rows] = await executor.query(check.sql, check.params);
            summary[check.key] = Number(rows[0]?.total || 0);
        } catch (error) {
            summary[check.key] = 0;
        }
    }

    summary.total = Object.values(summary).reduce((sum, value) => sum + Number(value || 0), 0);
    summary.hasHistoricalUsage = summary.total > 0;
    return summary;
}

async function getLookupModuleUsageSummary(config, recordReference, connection = null) {
    const executor = connection || pool;
    const normalizedReference = normalizeText(recordReference);
    const summary = {};

    for (const check of config.referenceUsageChecks || []) {
        const params = typeof check.params === 'function'
            ? check.params(normalizedReference)
            : [normalizedReference];

        try {
            const [rows] = await executor.query(check.sql, params);
            summary[check.sql] = Number(rows[0]?.total || 0);
        } catch (error) {
            summary[check.sql] = 0;
        }
    }

    summary.total = Object.values(summary).reduce((sum, value) => sum + Number(value || 0), 0);
    summary.hasHistoricalUsage = summary.total > 0;
    return summary;
}

async function listLookupModuleRows(companyId, module, connection = null) {
    const executor = connection || pool;
    await ensureParameterChangeTables(executor);

    const config = getModuleConfig(module);
    const [rows] = await executor.query(
        `SELECT * FROM ${config.sourceTable} WHERE (CompanyID = ? OR CompanyID IS NULL) ORDER BY ${config.keyColumn} ASC`,
        [Number(companyId) || 1]
    );

    const [pendingRows] = await executor.query(
        `SELECT r.*
         FROM parameter_change_requests r
         INNER JOIN (
             SELECT ParameterModule, RecordReference, MAX(id) AS latestId
             FROM parameter_change_requests
             WHERE CompanyID = ?
               AND ParameterModule = ?
               AND Status IN (?, ?, ?)
             GROUP BY ParameterModule, RecordReference
         ) latest
           ON latest.latestId = r.id
         ORDER BY r.RecordReference ASC`,
        [
            Number(companyId) || 1,
            config.module,
            PARAMETER_CHANGE_STATUSES.DRAFT,
            PARAMETER_CHANGE_STATUSES.RETURNED_BY_ENTITY_HEAD,
            PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD
        ]
    );

    const pendingByReference = new Map(pendingRows.map((row) => [normalizeText(row.RecordReference), row]));
    const liveRows = [];

    for (const row of rows) {
        const reference = normalizeText(row[config.keyColumn]);
        const usage = await getLookupModuleUsageSummary(config, reference, executor);
        const pending = pendingByReference.get(reference) || null;
        liveRows.push({
            ...row,
            usage,
            latestPendingRequest: pending,
            latestPendingStatus: pending ? pending.Status : '',
            canDelete: !usage.hasHistoricalUsage
        });
    }

    const pendingCreates = pendingRows
        .filter((row) => row.ChangeType === PARAMETER_CHANGE_TYPES.CREATE && !rows.some((liveRow) => normalizeText(liveRow[config.keyColumn]) === normalizeText(row.RecordReference)))
        .map((row) => {
            const proposed = parseJsonField(row.ProposedValues, {});
            return {
                ...row,
                proposedCode: proposed[config.keyColumn] || row.RecordReference,
                proposedLabel: proposed[config.displayField || config.allowedFields.find((field) => field !== config.keyColumn)] || '',
                usage: { total: 0, hasHistoricalUsage: false }
            };
        });

    return { liveRows, pendingCreates };
}

async function listPayTypeRows(companyId, connection = null) {
    const executor = connection || pool;
    await ensureParameterChangeTables(executor);

    const [rows] = await executor.query(
        `SELECT * FROM tblpaytype WHERE (CompanyID = ? OR CompanyID IS NULL) ORDER BY Code ASC`,
        [Number(companyId) || 1]
    );

    const [pendingRows] = await executor.query(
        `SELECT r.*
         FROM parameter_change_requests r
         INNER JOIN (
             SELECT ParameterModule, RecordReference, MAX(id) AS latestId
             FROM parameter_change_requests
             WHERE CompanyID = ?
               AND ParameterModule = 'pay-types'
               AND Status IN (?, ?, ?)
             GROUP BY ParameterModule, RecordReference
         ) latest
           ON latest.latestId = r.id
         ORDER BY r.RecordReference ASC`,
        [
            Number(companyId) || 1,
            PARAMETER_CHANGE_STATUSES.DRAFT,
            PARAMETER_CHANGE_STATUSES.RETURNED_BY_ENTITY_HEAD,
            PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD
        ]
    );

    const pendingByReference = new Map(pendingRows.map((row) => [row.RecordReference, row]));
    const liveRows = [];
    for (const row of rows) {
        const usage = await getPayTypeUsageSummary(companyId, row.Code, executor);
        const pending = pendingByReference.get(normalizeText(row.Code)) || null;
        liveRows.push({
            ...row,
            usage,
            latestPendingRequest: pending,
            latestPendingStatus: pending ? pending.Status : '',
            canDelete: !usage.hasHistoricalUsage
        });
    }

    const pendingCreates = pendingRows
        .filter((row) => row.ChangeType === PARAMETER_CHANGE_TYPES.CREATE && !rows.some((liveRow) => normalizeText(liveRow.Code) === normalizeText(row.RecordReference)))
        .map((row) => {
            const proposed = parseJsonField(row.ProposedValues, {});
            return {
                ...row,
                proposedCode: proposed.Code || row.RecordReference,
                proposedName: proposed.PayType || '',
                usage: { total: 0, hasHistoricalUsage: false }
            };
        });

    return { liveRows, pendingCreates };
}

module.exports = {
    CLASSIFICATIONS,
    PARAMETER_CHANGE_ACTIONS,
    PARAMETER_CHANGE_STATUSES,
    PARAMETER_CHANGE_TYPES,
    PARAMETER_MODULE_CONFIG,
    assertAdminActor,
    assertEntityHeadActor,
    buildChecksum,
    cancelParameterChange,
    createError,
    createParameterChangeDraft,
    ensureParameterChangeTables,
    entityHeadApproveParameterChange,
    entityHeadRejectParameterChange,
    entityHeadReturnParameterChange,
    getCountsByStatus,
    getDiscoveryMatrix,
    getModuleConfig,
    getParameterChangeDetail,
    getLookupModuleUsageSummary,
    getPayTypeUsageSummary,
    listLookupModuleRows,
    listPayTypeRows,
    listParameterChanges,
    mapStatusBadge,
    normalizeDateTimeValue,
    normalizeDateValue,
    normalizeUser,
    submitParameterChange,
    toBooleanFlag
};
