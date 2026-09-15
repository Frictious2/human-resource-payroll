const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const workflowNotificationService = require('./workflowNotificationService');

const RECORD_WORKFLOW_STATUSES = Object.freeze({
    DRAFT: 'DRAFT',
    SUBMITTED_TO_MANAGER: 'SUBMITTED_TO_MANAGER',
    MANAGER_ENDORSED: 'MANAGER_ENDORSED',
    RETURNED_BY_MANAGER: 'RETURNED_BY_MANAGER',
    SUBMITTED_TO_ENTITY_HEAD: 'SUBMITTED_TO_ENTITY_HEAD',
    FINAL_APPROVED: 'FINAL_APPROVED',
    RETURNED_BY_ENTITY_HEAD: 'RETURNED_BY_ENTITY_HEAD',
    FINAL_REJECTED: 'FINAL_REJECTED'
});

const RECORD_WORKFLOW_ACTIONS = Object.freeze({
    SAVE_DRAFT: 'SAVE_DRAFT',
    SUBMIT_TO_MANAGER: 'SUBMIT_TO_MANAGER',
    MANAGER_ENDORSE: 'MANAGER_ENDORSE',
    SUBMIT_TO_ENTITY_HEAD: 'SUBMIT_TO_ENTITY_HEAD',
    MANAGER_RETURN: 'MANAGER_RETURN',
    ENTITY_HEAD_APPROVE: 'ENTITY_HEAD_APPROVE',
    ENTITY_HEAD_RETURN: 'ENTITY_HEAD_RETURN',
    ENTITY_HEAD_REJECT: 'ENTITY_HEAD_REJECT'
});

const ROLE_GROUPS = Object.freeze({
    DATA_ENTRY: 'data-entry',
    MANAGER: 'manager',
    ENTITY_HEAD: 'entity-head'
});

const ROLE_GROUP_MAP = Object.freeze({
    'data-entry': ROLE_GROUPS.DATA_ENTRY,
    'data entry': ROLE_GROUPS.DATA_ENTRY,
    'data_entry': ROLE_GROUPS.DATA_ENTRY,
    'data entry officer': ROLE_GROUPS.DATA_ENTRY,
    'finance-officer': ROLE_GROUPS.DATA_ENTRY,
    manager: ROLE_GROUPS.MANAGER,
    'entity-head': ROLE_GROUPS.ENTITY_HEAD,
    'entity head': ROLE_GROUPS.ENTITY_HEAD,
    hno: ROLE_GROUPS.ENTITY_HEAD
});

const VALID_RECORD_TRANSITIONS = Object.freeze({
    [RECORD_WORKFLOW_STATUSES.DRAFT]: [RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER],
    [RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER]: [
        RECORD_WORKFLOW_STATUSES.MANAGER_ENDORSED,
        RECORD_WORKFLOW_STATUSES.RETURNED_BY_MANAGER
    ],
    [RECORD_WORKFLOW_STATUSES.RETURNED_BY_MANAGER]: [RECORD_WORKFLOW_STATUSES.DRAFT],
    [RECORD_WORKFLOW_STATUSES.MANAGER_ENDORSED]: [RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD],
    [RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD]: [
        RECORD_WORKFLOW_STATUSES.FINAL_APPROVED,
        RECORD_WORKFLOW_STATUSES.RETURNED_BY_ENTITY_HEAD,
        RECORD_WORKFLOW_STATUSES.FINAL_REJECTED
    ],
    [RECORD_WORKFLOW_STATUSES.RETURNED_BY_ENTITY_HEAD]: [RECORD_WORKFLOW_STATUSES.DRAFT],
    [RECORD_WORKFLOW_STATUSES.FINAL_APPROVED]: [],
    [RECORD_WORKFLOW_STATUSES.FINAL_REJECTED]: []
});

const LEGACY_FINAL_APPROVED_VALUE = -1;
const HISTORICAL_APPROVED_VALUES = new Set([-1, 1]);
const EDITABLE_RECORD_STATUSES = new Set([
    RECORD_WORKFLOW_STATUSES.DRAFT,
    RECORD_WORKFLOW_STATUSES.RETURNED_BY_MANAGER,
    RECORD_WORKFLOW_STATUSES.RETURNED_BY_ENTITY_HEAD,
    RECORD_WORKFLOW_STATUSES.FINAL_REJECTED
]);

function createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeDateTimeValue(value) {
    if (!value) {
        return '';
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return normalizeText(value);
    }

    return date.toISOString();
}

function normalizeSqlDateTimeValue(value) {
    if (!value) {
        return '';
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return normalizeText(value).replace('T', ' ').replace('Z', '').slice(0, 19);
    }

    return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeSqlDateValue(value) {
    if (!value) {
        return '';
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return normalizeText(value).slice(0, 10);
    }

    return date.toISOString().slice(0, 10);
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

function buildChecksum(record) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(stableSerialize(record)))
        .digest('hex');
}

function normalizeUser(user = {}) {
    const id = Number(user.id ?? user.pfno ?? user.PFNo ?? 0);
    return {
        id: Number.isFinite(id) && id > 0 ? id : 0,
        role: normalizeText(user.role || user.level),
        name: user.name || user.fullName || user.username || user.email || 'System',
        source: user.source || 'tblpassword'
    };
}

function getRoleGroup(role) {
    return ROLE_GROUP_MAP[normalizeText(role).toLowerCase()] || null;
}

function parseReference(reference) {
    return normalizeText(reference)
        .split('|')
        .map((entry) => decodeURIComponent(entry));
}

function buildReference(...parts) {
    return parts.map((part) => encodeURIComponent(normalizeText(part))).join('|');
}

function mapWorkflowStatusBadge(status) {
    return {
        [RECORD_WORKFLOW_STATUSES.DRAFT]: 'bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle',
        [RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER]: 'bg-info-subtle text-info-emphasis border border-info-subtle',
        [RECORD_WORKFLOW_STATUSES.MANAGER_ENDORSED]: 'bg-primary-subtle text-primary-emphasis border border-primary-subtle',
        [RECORD_WORKFLOW_STATUSES.RETURNED_BY_MANAGER]: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
        [RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD]: 'bg-dark-subtle text-dark-emphasis border border-dark-subtle',
        [RECORD_WORKFLOW_STATUSES.FINAL_APPROVED]: 'bg-success-subtle text-success-emphasis border border-success-subtle',
        [RECORD_WORKFLOW_STATUSES.RETURNED_BY_ENTITY_HEAD]: 'bg-warning text-dark',
        [RECORD_WORKFLOW_STATUSES.FINAL_REJECTED]: 'bg-danger-subtle text-danger-emphasis border border-danger-subtle'
    }[status] || 'bg-light text-dark border';
}

function validateTransition(fromStatus, toStatus) {
    const allowed = VALID_RECORD_TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
        throw createError(`Invalid record workflow transition: ${fromStatus} -> ${toStatus}.`, 409);
    }
    return true;
}

function getConnectionExecutor(connection = null) {
    return connection || pool;
}

async function ensureWorkflowTables(connection = null) {
    const executor = getConnectionExecutor(connection);
    const migrationPath = path.join(__dirname, '..', 'database', 'migrations', '20260714-record-workflow.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const statements = sql
        .split(/;\s*\n/)
        .map((statement) => statement.trim())
        .filter(Boolean);

    for (const statement of statements) {
        await executor.query(statement);
    }
}

const MODULE_CONFIG = Object.freeze({
    'salary-review': {
        module: 'salary-review',
        label: 'Salary Reviews',
        sourceTable: 'tblsalreview',
        referenceLabel: 'Review Rule',
        listDraftSql: `
            SELECT *
            FROM tblsalreview
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(Approved, 0) = 0
        `,
        buildReferenceFromRow: (row) => buildReference(
            normalizeDateTimeValue(row.RevDate).slice(0, 10),
            row.RevCode,
            row.SGrade,
            row.EGrade
        ),
        buildReferenceFromInput: ({ reviewDate, revCode, startGrade, endGrade }) => buildReference(reviewDate, revCode, startGrade, endGrade),
        fetchSql: `
            SELECT
                sr.*,
                rt.RevName,
                sg.Grade AS StartGradeName,
                eg.Grade AS EndGradeName
            FROM tblsalreview sr
            LEFT JOIN tblrevtype rt
                ON rt.RevCode = sr.RevCode
            LEFT JOIN tblgrade sg
                ON sg.GradeCode = sr.SGrade
            LEFT JOIN tblgrade eg
                ON eg.GradeCode = sr.EGrade
            WHERE (sr.CompanyID = ? OR sr.CompanyID IS NULL)
              AND DATE(sr.RevDate) = ?
              AND sr.RevCode = ?
              AND sr.SGrade = ?
              AND sr.EGrade = ?
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [reviewDate, revCode, startGrade, endGrade] = parseReference(reference);
            return [Number(companyId) || 1, reviewDate, revCode, startGrade, endGrade];
        },
        displayFields: ['RevDate', 'RevCode', 'RevName', 'Percentage', 'SGrade', 'StartGradeName', 'EGrade', 'EndGradeName', 'Operator', 'Approved']
    },
    'salary-query': {
        module: 'salary-query',
        label: 'Salary Queries',
        sourceTable: 'tblquery',
        referenceLabel: 'Staff Query',
        listDraftSql: `
            SELECT *
            FROM tblquery
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(Approved, 0) = 0
        `,
        buildReferenceFromRow: (row) => buildReference(row.PFNO, normalizeDateTimeValue(row.QDate)),
        buildReferenceFromInput: ({ pfno, qDate }) => buildReference(pfno, qDate),
        fetchSql: `
            SELECT
                q.*,
                s.SName,
                qt.QType AS QueryTypeName,
                mr.Reaction AS ReactionName
            FROM tblquery q
            LEFT JOIN tblstaff s
                ON s.PFNo = q.PFNO
            LEFT JOIN tblqtype qt
                ON qt.Code = q.QType
            LEFT JOIN tblmreaction mr
                ON mr.Code = q.MResponse
            WHERE (q.CompanyID = ? OR q.CompanyID IS NULL)
              AND q.PFNO = ?
              AND q.QDate = ?
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [pfno, qDate] = parseReference(reference);
            return [Number(companyId) || 1, pfno, qDate];
        },
        displayFields: ['PFNO', 'SName', 'QDate', 'QType', 'QueryTypeName', 'QDetails', 'MResponse', 'ReactionName', 'SDate', 'EDate', 'Percent', 'Approved']
    },
    'yearly-payment': {
        module: 'yearly-payment',
        label: 'Yearly Payments',
        sourceTable: 'tblyearlypayments',
        referenceLabel: 'Yearly Payment',
        listDraftSql: `
            SELECT *
            FROM tblyearlypayments
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(Approved, 0) = 0
        `,
        buildReferenceFromRow: (row) => buildReference(row.PFNo, row.PMonth, row.PYear, row.PType),
        buildReferenceFromInput: ({ pfNo, pMonth, pYear, payType }) => buildReference(pfNo, pMonth, pYear, payType),
        fetchSql: `
            SELECT
                y.*,
                p.PayType AS PayTypeName,
                d.Dept AS DeptName,
                g.Grade AS GradeName
            FROM tblyearlypayments y
            LEFT JOIN tblpaytype p
                ON p.Code = y.PType
            LEFT JOIN tbldept d
                ON d.Code = y.Dept
            LEFT JOIN tblgrade g
                ON g.GradeCode = y.Grade
            WHERE (y.CompanyID = ? OR y.CompanyID IS NULL)
              AND y.PFNo = ?
              AND y.PMonth = ?
              AND y.PYear = ?
              AND y.PType = ?
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [pfNo, pMonth, pYear, payType] = parseReference(reference);
            return [Number(companyId) || 1, pfNo, Number(pMonth), Number(pYear), payType];
        },
        displayFields: ['PDate', 'PFNo', 'SName', 'Dept', 'DeptName', 'Grade', 'GradeName', 'PType', 'PayTypeName', 'TotalIncome', 'Taxable', 'Tax', 'NetIncome', 'Fixed', 'Monthly', 'Served', 'Selected', 'Approved']
    },
    'end-of-service': {
        module: 'end-of-service',
        label: 'End of Service',
        sourceTable: 'tbleos',
        referenceLabel: 'EOS Record',
        listDraftSql: `
            SELECT *
            FROM tbleos
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(Approved, 0) = 0
        `,
        buildReferenceFromRow: (row) => buildReference(row.PFNo, normalizeDateTimeValue(row.DateKeyed || row.DateLeft || row.RetirementDate)),
        buildReferenceFromInput: ({ pfNo, dateKeyed }) => buildReference(pfNo, dateKeyed),
        fetchSql: `
            SELECT
                e.*,
                d.Dept AS DeptName,
                g.Grade AS GradeName
            FROM tbleos e
            LEFT JOIN tbldept d
                ON d.Code = e.Dept
            LEFT JOIN tblgrade g
                ON g.GradeCode = e.Grade
            WHERE (e.CompanyID = ? OR e.CompanyID IS NULL)
              AND e.PFNo = ?
              AND COALESCE(e.DateKeyed, e.DateLeft, e.RetirementDate, '1900-01-01') = COALESCE(?, COALESCE(e.DateKeyed, e.DateLeft, e.RetirementDate, '1900-01-01'))
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [pfNo, dateKeyed] = parseReference(reference);
            return [Number(companyId) || 1, pfNo, dateKeyed || null];
        },
        displayFields: ['PFNo', 'SName', 'Dept', 'DeptName', 'Grade', 'GradeName', 'Benefit', 'NetBenefit', 'Tax', 'Salary', 'DateLeft', 'RetirementDate', 'DateKeyed', 'Approved']
    },
    increment: {
        module: 'increment',
        label: 'Increment Records',
        sourceTable: 'tblincrement',
        referenceLabel: 'Increment Record',
        listDraftSql: `
            SELECT *
            FROM tblincrement
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(Approved, 0) = 0
        `,
        buildReferenceFromRow: (row) => buildReference(
            row.PFNo,
            normalizeDateTimeValue(row.IncDate),
            row.Type,
            row.Grade,
            row.IncNo
        ),
        buildReferenceFromInput: ({ pfNo, incDate, type, grade, incNo }) => buildReference(pfNo, incDate, type, grade, incNo),
        fetchSql: `
            SELECT
                i.*,
                s.SName,
                t.InsType
            FROM tblincrement i
            LEFT JOIN tblstaff s
                ON s.PFNo = i.PFNo
            LEFT JOIN tblinstype t
                ON t.InsCode = i.Type
            WHERE (i.CompanyID = ? OR i.CompanyID IS NULL)
              AND i.PFNo = ?
              AND i.IncDate = ?
              AND i.Type = ?
              AND COALESCE(i.Grade, '') = COALESCE(?, COALESCE(i.Grade, ''))
              AND COALESCE(i.IncNo, 0) = COALESCE(?, COALESCE(i.IncNo, 0))
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [pfNo, incDate, type, grade, incNo] = parseReference(reference);
            return [Number(companyId) || 1, pfNo, incDate, type, grade || null, Number(incNo || 0)];
        },
        displayFields: ['PFNo', 'SName', 'IncDate', 'Type', 'InsType', 'Grade', 'IncNo', 'Days', 'FPay', 'PPay', 'WPay', 'Category', 'Approved']
    },
    loan: {
        module: 'loan',
        label: 'Staff Loans',
        sourceTable: 'tblloan',
        referenceLabel: 'Loan Record',
        listDraftSql: `
            SELECT *
            FROM tblloan
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(Approved, 0) = 0
        `,
        buildReferenceFromRow: (row) => buildReference(
            row.TransNo,
            normalizeDateTimeValue(row.EntryDate),
            row.LTypeCode,
            row.LTrans
        ),
        buildReferenceFromInput: ({ transNo, entryDate, lTypeCode, lTrans }) => buildReference(
            transNo,
            normalizeDateTimeValue(entryDate),
            lTypeCode,
            lTrans
        ),
        fetchSql: `
            SELECT
                l.*,
                s.SName,
                d.Dept AS DeptName,
                lc.TransName AS LoanTypeName,
                lt.LoanType
            FROM tblloan l
            LEFT JOIN tblstaff s
                ON s.PFNo = l.PFNo
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            LEFT JOIN tblloancode lc
                ON lc.TCode = l.LTrans
            LEFT JOIN tblloantype lt
                ON lt.LTypeCode = l.LTypeCode
            WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
              AND l.TransNo = ?
              AND (l.EntryDate = ? OR l.EntryDate = ? OR DATE(l.EntryDate) = DATE(?))
              AND l.LTypeCode = ?
              AND l.LTrans = ?
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [transNo, entryDate, lTypeCode, lTrans] = parseReference(reference);
            const sqlEntryDate = normalizeSqlDateTimeValue(entryDate);
            return [Number(companyId) || 1, Number(transNo), sqlEntryDate, entryDate, sqlEntryDate, lTypeCode, lTrans];
        },
        displayFields: ['TransNo', 'EntryDate', 'PFNo', 'SName', 'DeptName', 'LTypeCode', 'LoanType', 'LTrans', 'LoanTypeName', 'Amount', 'Interest', 'MonthlyInt', 'MonthlyRepayment', 'Duration', 'LoanBal', 'StartDate', 'ExpDate', 'Surcharge', 'Approved']
    },
    'loan-repayment': {
        module: 'loan-repayment',
        label: 'Loan Repayment Adjustments',
        sourceTable: 'tblloanrepayment',
        referenceLabel: 'Loan Repayment Record',
        listDraftSql: `
            SELECT *
            FROM tblloanrepayment
            WHERE COALESCE(Approved, 0) = 0
        `,
        buildReferenceFromRow: (row) => buildReference(row.RepayID),
        buildReferenceFromInput: ({ repayId }) => buildReference(repayId),
        fetchSql: `
            SELECT
                r.*,
                l.EntryDate AS LoanEntryDate,
                l.Amount AS LoanAmount,
                l.LoanBal,
                l.RepaidAmount,
                l.StartDate,
                l.ExpDate,
                l.MonthlyRepayment,
                s.SName,
                d.Dept AS DeptName
            FROM tblloanrepayment r
            LEFT JOIN tblloan l
                ON l.TransNo = r.LoanTransNo
            LEFT JOIN tblstaff s
                ON s.PFNo = r.PFNo
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            WHERE r.RepayID = ?
            LIMIT 1
        `,
        fetchParams: (_companyId, reference) => {
            const [repayId] = parseReference(reference);
            return [Number(repayId)];
        },
        displayFields: ['RepayID', 'LoanTransNo', 'PFNo', 'SName', 'DeptName', 'Amount', 'DatePaid', 'Approved', 'ApprovedBy', 'DateApproved', 'LoanAmount', 'LoanBal', 'RepaidAmount', 'MonthlyRepayment', 'StartDate', 'ExpDate']
    },
    medical: {
        module: 'medical',
        label: 'Medical Recoveries',
        sourceTable: 'tblmedical',
        referenceLabel: 'Medical Record',
        listDraftSql: `
            SELECT *
            FROM tblmedical
            WHERE 1 = 0
        `,
        buildReferenceFromRow: (row) => buildReference(row.TransNo),
        buildReferenceFromInput: ({ transNo }) => buildReference(transNo),
        fetchSql: `
            SELECT
                m.*,
                s.SName,
                d.Dept AS DeptName,
                mc.TransName AS MedicalDescription
            FROM tblmedical m
            LEFT JOIN tblstaff s
                ON s.PFNo = m.PFNo
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            LEFT JOIN tblmcode mc
                ON mc.TCode = m.MCode
            WHERE (m.CompanyID = ? OR m.CompanyID IS NULL)
              AND m.TransNo = ?
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [transNo] = parseReference(reference);
            return [Number(companyId) || 1, Number(transNo)];
        },
        displayFields: ['TransNo', 'EntryDate', 'PFNo', 'SName', 'DeptName', 'Dependant', 'MCode', 'MedicalDescription', 'Amount', 'PicturePath']
    },
    surcharge: {
        module: 'surcharge',
        label: 'Surcharge Records',
        sourceTable: 'tblsurcharge',
        referenceLabel: 'Surcharge Record',
        listDraftSql: `
            SELECT *
            FROM tblsurcharge
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(Approved, 0) = 0
        `,
        buildReferenceFromRow: (row) => buildReference(
            row.PFNo,
            normalizeDateTimeValue(row.EntryDate),
            row.SType,
            normalizeDateTimeValue(row.StarDate)
        ),
        buildReferenceFromInput: ({ pfNo, entryDate, sType, startDate }) => buildReference(
            pfNo,
            normalizeDateTimeValue(entryDate),
            sType,
            normalizeDateTimeValue(startDate)
        ),
        fetchSql: `
            SELECT
                s.*,
                st.SName,
                d.Dept AS DeptName,
                ty.Surcharge AS SurchargeTypeName
            FROM tblsurcharge s
            LEFT JOIN tblstaff st
                ON st.PFNo = s.PFNo
            LEFT JOIN tbldept d
                ON d.Code = st.CDept
            LEFT JOIN tblsurchargetype ty
                ON ty.Code = s.SType
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND s.PFNo = ?
              AND (COALESCE(s.EntryDate, '1900-01-01') = COALESCE(?, COALESCE(s.EntryDate, '1900-01-01'))
                   OR COALESCE(s.EntryDate, '1900-01-01') = COALESCE(?, COALESCE(s.EntryDate, '1900-01-01'))
                   OR DATE(COALESCE(s.EntryDate, '1900-01-01')) = DATE(COALESCE(?, COALESCE(s.EntryDate, '1900-01-01'))))
              AND s.SType = ?
              AND (COALESCE(s.StarDate, '1900-01-01') = COALESCE(?, COALESCE(s.StarDate, '1900-01-01'))
                   OR COALESCE(s.StarDate, '1900-01-01') = COALESCE(?, COALESCE(s.StarDate, '1900-01-01'))
                   OR DATE(COALESCE(s.StarDate, '1900-01-01')) = DATE(COALESCE(?, COALESCE(s.StarDate, '1900-01-01'))))
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [pfNo, entryDate, sType, startDate] = parseReference(reference);
            const sqlEntryDate = normalizeSqlDateTimeValue(entryDate);
            const sqlStartDate = normalizeSqlDateTimeValue(startDate);
            return [
                Number(companyId) || 1,
                pfNo,
                sqlEntryDate || null,
                entryDate || null,
                sqlEntryDate || null,
                sType,
                sqlStartDate || null,
                startDate || null,
                sqlStartDate || null
            ];
        },
        displayFields: ['PFNo', 'SName', 'DeptName', 'EntryDate', 'SType', 'SurchargeTypeName', 'Amount', 'SAmount', 'Duration', 'StarDate', 'ExpDate', 'Approved', 'Expired']
    },
    transfer: {
        module: 'transfer',
        label: 'Transfers',
        sourceTable: 'tbltransfer',
        referenceLabel: 'Transfer Record',
        listDraftSql: `
            SELECT *
            FROM tbltransfer
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(approved, 0) = 0
        `,
        buildReferenceFromRow: (row) => buildReference(
            row.PFNO,
            normalizeDateTimeValue(row.TDate),
            row.PrevDept
        ),
        buildReferenceFromInput: ({ pfno, transferDate, prevDept }) => buildReference(
            pfno,
            normalizeDateTimeValue(transferDate),
            prevDept
        ),
        fetchSql: `
            SELECT
                t.*,
                s.SName AS StaffName,
                prev.Dept AS PrevDeptName,
                target.Dept AS TargetDeptName
            FROM tbltransfer t
            LEFT JOIN tblstaff s
                ON s.PFNo = t.PFNO
            LEFT JOIN tbldept prev
                ON prev.Code = t.PrevDept
            LEFT JOIN tbldept target
                ON target.Code = t.TDept
            WHERE (t.CompanyID = ? OR t.CompanyID IS NULL)
              AND t.PFNO = ?
              AND (t.TDate = ? OR t.TDate = ? OR DATE(t.TDate) = DATE(?))
              AND t.PrevDept = ?
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [pfno, transferDate, prevDept] = parseReference(reference);
            const sqlTransferDate = normalizeSqlDateTimeValue(transferDate);
            return [Number(companyId) || 1, pfno, sqlTransferDate, transferDate, sqlTransferDate, prevDept];
        },
        displayFields: ['PFNO', 'StaffName', 'TDate', 'PrevDept', 'PrevDeptName', 'TDept', 'TargetDeptName', 'Activity', 'approved']
    },
    promotion: {
        module: 'promotion',
        label: 'Promotions / Demotions',
        sourceTable: 'tblpromotions',
        referenceLabel: 'Promotion Record',
        listDraftSql: `
            SELECT *
            FROM tblpromotions
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(Approved, 0) = 0
        `,
        buildReferenceFromRow: (row) => buildReference(
            row.PFNO,
            row.Activity,
            normalizeDateTimeValue(row.PDate)
        ),
        buildReferenceFromInput: ({ pfno, activity, promotionDate }) => buildReference(
            pfno,
            activity,
            normalizeDateTimeValue(promotionDate)
        ),
        fetchSql: `
            SELECT
                p.*,
                s.SName,
                prev.Grade AS PrevGradeName,
                currentGrade.Grade AS NewGradeName,
                j.JobTitle AS JobTitleName
            FROM tblpromotions p
            LEFT JOIN tblstaff s
                ON s.PFNo = p.PFNO
            LEFT JOIN tblgrade prev
                ON prev.GradeCode = p.PrevGrade
            LEFT JOIN tblgrade currentGrade
                ON currentGrade.GradeCode = p.CGrade
            LEFT JOIN tbljobtitle j
                ON j.Code = p.JobTitle
            WHERE (p.CompanyID = ? OR p.CompanyID IS NULL)
              AND p.PFNO = ?
              AND p.Activity = ?
              AND DATE(p.PDate) = DATE(?)
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [pfno, activity, promotionDate] = parseReference(reference);
            return [Number(companyId) || 1, pfno, Number(activity), normalizeSqlDateValue(promotionDate)];
        },
        displayFields: ['PFNO', 'SName', 'PDate', 'Mode', 'PrevGrade', 'PrevGradeName', 'CGrade', 'NewGradeName', 'JobTitle', 'JobTitleName', 'Approved']
    },
    acting: {
        module: 'acting',
        label: 'Acting Appointments',
        sourceTable: 'tblacting',
        referenceLabel: 'Acting Record',
        listDraftSql: `
            SELECT *
            FROM tblacting
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(Approved, 0) = 0
        `,
        buildReferenceFromRow: (row) => buildReference(
            row.PFNO,
            normalizeDateTimeValue(row.SDate)
        ),
        buildReferenceFromInput: ({ pfno, sDate }) => buildReference(pfno, normalizeDateTimeValue(sDate)),
        fetchSql: `
            SELECT
                a.*,
                s.SName,
                cg.Grade AS CurrentGradeName,
                ag.Grade AS ActingGradeName,
                currentTitle.JobTitle AS CurrentJobTitleName,
                actingTitle.JobTitle AS ActingJobTitleName,
                d.Dept AS ActingDeptName
            FROM tblacting a
            LEFT JOIN tblstaff s
                ON s.PFNo = a.PFNO
            LEFT JOIN tblgrade cg
                ON cg.GradeCode = a.C_Grade
            LEFT JOIN tblgrade ag
                ON ag.GradeCode = a.A_Grade
            LEFT JOIN tbljobtitle currentTitle
                ON currentTitle.Code = a.JobTitle
            LEFT JOIN tbljobtitle actingTitle
                ON actingTitle.Code = a.A_JobTitle
            LEFT JOIN tbldept d
                ON d.Code = a.A_Dept
            WHERE (a.CompanyID = ? OR a.CompanyID IS NULL)
              AND a.PFNO = ?
              AND (a.SDate = ? OR a.SDate = ? OR DATE(a.SDate) = DATE(?))
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [pfno, sDate] = parseReference(reference);
            const sqlStartDate = normalizeSqlDateTimeValue(sDate);
            return [Number(companyId) || 1, pfno, sqlStartDate, sDate, sqlStartDate];
        },
        displayFields: ['PFNO', 'SName', 'EntryDate', 'SDate', 'EDate', 'C_Grade', 'CurrentGradeName', 'A_Grade', 'ActingGradeName', 'A_Dept', 'ActingDeptName', 'A_Salary', 'Approved']
    },
    leave: {
        module: 'leave',
        label: 'Leave Applications',
        sourceTable: 'tblleave',
        referenceLabel: 'Leave Record',
        listDraftSql: `
            SELECT *
            FROM tblleave
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(Approved, 0) = 0
        `,
        buildReferenceFromRow: (row) => buildReference(row.ID || row.LCount),
        buildReferenceFromInput: ({ id, lCount }) => buildReference(id || lCount),
        fetchSql: `
            SELECT
                l.*,
                s.SName,
                d.Dept AS DeptName,
                lt.LeaveType
            FROM tblleave l
            LEFT JOIN tblstaff s
                ON s.PFNo = l.PFNO
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            LEFT JOIN tblleavetype lt
                ON lt.Code = l.LType
            WHERE (l.CompanyID = ? OR l.CompanyID IS NULL)
              AND l.ID = ?
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [id] = parseReference(reference);
            return [Number(companyId) || 1, Number(id)];
        },
        displayFields: ['ID', 'LCount', 'PFNO', 'SName', 'DeptName', 'LType', 'LeaveType', 'LYear', 'StartDate', 'LDays', 'ResumptionDate', 'WithPay', 'Allowance', 'Resumed', 'Approved']
    },
    training: {
        module: 'training',
        label: 'Training Records',
        sourceTable: 'tblcourse',
        referenceLabel: 'Training Record',
        listDraftSql: `
            SELECT *
            FROM tblcourse
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(approved, 0) = 0
        `,
        buildReferenceFromRow: (row) => buildReference(
            row.PFNo,
            row.Course,
            normalizeDateTimeValue(row.StartDate)
        ),
        buildReferenceFromInput: ({ pfno, course, startDate }) => buildReference(
            pfno,
            course,
            normalizeDateTimeValue(startDate)
        ),
        fetchSql: `
            SELECT
                c.*,
                s.SName,
                d.Dept AS DeptName,
                j.JobTitle AS JobTitleName,
                sp.Sponsor AS SponsorName,
                cl.CLevel AS LevelName,
                ct.CType AS TypeName
            FROM tblcourse c
            LEFT JOIN tblstaff s
                ON s.PFNo = c.PFNo
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            LEFT JOIN tbljobtitle j
                ON j.Code = s.JobTitle
            LEFT JOIN tblcoursesponsor sp
                ON sp.SCode = c.SponsoredBy
            LEFT JOIN tblcourselevel cl
                ON cl.CLCode = c.Level
            LEFT JOIN tblcoursetype ct
                ON ct.CourseCode = c.Type
            WHERE (c.CompanyID = ? OR c.CompanyID IS NULL)
              AND c.PFNo = ?
              AND c.Course = ?
              AND (c.StartDate = ? OR c.StartDate = ? OR DATE(c.StartDate) = DATE(?))
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [pfno, course, startDate] = parseReference(reference);
            const sqlStartDate = normalizeSqlDateTimeValue(startDate);
            return [Number(companyId) || 1, pfno, course, sqlStartDate, startDate, sqlStartDate];
        },
        displayFields: ['PFNo', 'SName', 'Course', 'Level', 'LevelName', 'Type', 'TypeName', 'OrganisedBy', 'Duration', 'Country', 'StartDate', 'Cost', 'SponsoredBy', 'SponsorName', 'Completed', 'approved']
    },
    'staff-exit': {
        module: 'staff-exit',
        label: 'Staff Status Changes',
        sourceTable: 'tblformer',
        referenceLabel: 'Exit Record',
        listDraftSql: `
            SELECT *
            FROM tblformer
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(Approved, 0) = 0
        `,
        buildReferenceFromRow: (row) => buildReference(row.PFNo),
        buildReferenceFromInput: ({ pfno }) => buildReference(pfno),
        fetchSql: `
            SELECT
                f.*,
                s.SName,
                s.EmpStatus,
                d.Dept AS DeptName,
                r.Reason AS ReasonName
            FROM tblformer f
            LEFT JOIN tblstaff s
                ON s.PFNo = f.PFNo
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            LEFT JOIN tblreason r
                ON r.ReasonCode = f.Reason
            WHERE (f.CompanyID = ? OR f.CompanyID IS NULL)
              AND f.PFNo = ?
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [pfno] = parseReference(reference);
            return [Number(companyId) || 1, pfno];
        },
        displayFields: ['PFNo', 'SName', 'DeptName', 'Reason', 'ReasonName', 'DateResigned', 'NoticeDate', 'ExpDate', 'DateLeft', 'DateAccepted', 'Approved']
    },
    redundancy: {
        module: 'redundancy',
        label: 'Redundancy Status Changes',
        sourceTable: 'tblstaff',
        referenceLabel: 'Redundancy Record',
        listDraftSql: `
            SELECT *
            FROM tblstaff
            WHERE (CompanyID = ? OR CompanyID IS NULL)
              AND COALESCE(Redundant, 0) = 2
        `,
        buildReferenceFromRow: (row) => buildReference(row.PFNo, 'REDUNDANCY'),
        buildReferenceFromInput: ({ pfno }) => buildReference(pfno, 'REDUNDANCY'),
        fetchSql: `
            SELECT
                s.*,
                d.Dept AS DeptName,
                r.Reason AS ReasonName
            FROM tblstaff s
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            LEFT JOIN tblreason r
                ON r.ReasonCode = s.ReasonCode
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND s.PFNo = ?
            LIMIT 1
        `,
        fetchParams: (companyId, reference) => {
            const [pfno] = parseReference(reference);
            return [Number(companyId) || 1, pfno];
        },
        displayFields: ['PFNo', 'SName', 'DeptName', 'DOE', 'Redundant', 'DateRedundant', 'ReasonCode', 'ReasonName']
    }
});

function getModuleConfig(module) {
    const config = MODULE_CONFIG[normalizeText(module)];
    if (!config) {
        throw createError(`Unsupported record workflow module: ${module}.`, 400);
    }
    return config;
}

async function logAudit(connection, { companyId, userName, action, recordId, message }) {
    const [rows] = await connection.query('SELECT COALESCE(MAX(AuditTrailID), 0) + 1 AS nextId FROM tblaudittrail');
    const nextId = Number(rows[0]?.nextId || 1);

    await connection.query(
        `INSERT INTO tblaudittrail
        (AuditTrailID, ChangeDate, UserName, FormName, Action, RecordID, FieldName, OldValue, NewValue, Loggedout, CompanyID)
        VALUES (?, NOW(), ?, 'record/workflow', ?, ?, 'Status', NULL, ?, 0, ?)`,
        [nextId, userName || 'System', action, String(recordId || '').slice(0, 6), message || null, Number(companyId) || 1]
    );
}

async function getWorkflowItemByReference(companyId, module, recordReference, connection = null) {
    const executor = getConnectionExecutor(connection);
    const config = getModuleConfig(module);
    const [rows] = await executor.query(
        `
            SELECT *
            FROM record_workflow_items
            WHERE CompanyID = ?
              AND Module = ?
              AND SourceTable = ?
              AND RecordReference = ?
            LIMIT 1
        `,
        [Number(companyId) || 1, config.module, config.sourceTable, normalizeText(recordReference)]
    );
    return rows[0] || null;
}

async function getWorkflowItemById(companyId, workflowItemId, connection = null) {
    const executor = getConnectionExecutor(connection);
    const [rows] = await executor.query(
        `
            SELECT *
            FROM record_workflow_items
            WHERE CompanyID = ?
              AND id = ?
            LIMIT 1
        `,
        [Number(companyId) || 1, Number(workflowItemId)]
    );
    return rows[0] || null;
}

async function getWorkflowActions(workflowItemId, connection = null) {
    const executor = getConnectionExecutor(connection);
    const [rows] = await executor.query(
        `
            SELECT a.*, COALESCE(u.FullName, u.Username, CONCAT('User ', u.PFNo)) AS actorName
            FROM record_workflow_actions a
            LEFT JOIN tblpassword u
                ON u.PFNo = a.ActionBy
            WHERE a.WorkflowItemID = ?
            ORDER BY a.ActionAt ASC, a.id ASC
        `,
        [Number(workflowItemId)]
    );
    return rows;
}

async function fetchModuleRecord(companyId, module, recordReference, connection = null) {
    const executor = getConnectionExecutor(connection);
    const config = getModuleConfig(module);
    const [rows] = await executor.query(config.fetchSql, config.fetchParams(companyId, recordReference));
    return rows[0] || null;
}

function buildRecordSnapshot(record) {
    const snapshot = {};
    Object.keys(record || {})
        .sort()
        .forEach((key) => {
            snapshot[key] = stableSerialize(record[key]);
        });
    return snapshot;
}

async function insertWorkflowItem(connection, {
    companyId,
    module,
    sourceTable,
    recordReference,
    status,
    snapshot,
    checksum
}) {
    const [result] = await connection.query(
        `
            INSERT INTO record_workflow_items (
                CompanyID, Module, SourceTable, RecordReference, Status,
                RecordSnapshot, RecordChecksum, CreatedAt, UpdatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [
            Number(companyId) || 1,
            module,
            sourceTable,
            recordReference,
            status,
            JSON.stringify(snapshot),
            checksum
        ]
    );
    return Number(result.insertId);
}

async function updateWorkflowItem(connection, workflowItemId, fields) {
    const assignments = [];
    const params = [];

    Object.entries(fields).forEach(([key, value]) => {
        assignments.push(`${key} = ?`);
        params.push(value);
    });
    assignments.push('UpdatedAt = NOW()');
    params.push(Number(workflowItemId));

    await connection.query(
        `UPDATE record_workflow_items SET ${assignments.join(', ')} WHERE id = ?`,
        params
    );
}

async function logWorkflowAction(connection, {
    workflowItemId,
    companyId,
    module,
    sourceTable,
    recordReference,
    action,
    fromStatus,
    toStatus,
    actionBy,
    comments = null,
    metadata = null
}) {
    const [result] = await connection.query(
        `
            INSERT INTO record_workflow_actions (
                WorkflowItemID, CompanyID, Module, SourceTable, RecordReference,
                Action, FromStatus, ToStatus, ActionBy, ActionAt,
                Comments, Metadata, Result
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, 'SUCCESS')
        `,
        [
            Number(workflowItemId),
            Number(companyId) || 1,
            module,
            sourceTable,
            recordReference,
            action,
            fromStatus,
            toStatus,
            Number(actionBy) || 0,
            comments,
            metadata ? JSON.stringify(metadata) : null
        ]
    );

    return Number(result?.insertId || 0);
}

async function ensureDraftItemForExistingRecord({
    companyId,
    module,
    recordReference,
    record,
    previousReference = null,
    user,
    connection = null
}) {
    const config = getModuleConfig(module);
    const actor = normalizeUser(user);
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }

        let item = null;
        if (previousReference && normalizeText(previousReference) !== normalizeText(recordReference)) {
            item = await getWorkflowItemByReference(companyId, module, previousReference, executor);
        }
        if (!item) {
            item = await getWorkflowItemByReference(companyId, module, recordReference, executor);
        }

        const snapshot = buildRecordSnapshot(record);
        const checksum = buildChecksum(snapshot);

        if (!item) {
            const workflowItemId = await insertWorkflowItem(executor, {
                companyId,
                module: config.module,
                sourceTable: config.sourceTable,
                recordReference,
                status: RECORD_WORKFLOW_STATUSES.DRAFT,
                snapshot,
                checksum
            });

            item = await getWorkflowItemById(companyId, workflowItemId, executor);
        } else {
            if (!EDITABLE_RECORD_STATUSES.has(item.Status)) {
                throw createError('This record has already been submitted and cannot be edited until it is returned.', 409);
            }

            const fields = {
                RecordReference: recordReference,
                Status: RECORD_WORKFLOW_STATUSES.DRAFT,
                RecordSnapshot: JSON.stringify(snapshot),
                RecordChecksum: checksum
            };

            await updateWorkflowItem(executor, item.id, fields);
            item = await getWorkflowItemById(companyId, item.id, executor);
        }

        if (managedConnection) {
            await executor.commit();
        }

        return item;
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

async function assertRecordEditableByReference(companyId, module, recordReference, connection = null) {
    const existing = await getWorkflowItemByReference(companyId, module, recordReference, connection);
    if (existing && !EDITABLE_RECORD_STATUSES.has(existing.Status)) {
        throw createError('This record has already been submitted and cannot be edited until it is returned.', 409);
    }
    return existing;
}

async function bootstrapDraftItemsForModule(companyId, module, connection = null) {
    const executor = getConnectionExecutor(connection);
    const config = getModuleConfig(module);
    const [rows] = await executor.query(config.listDraftSql, [Number(companyId) || 1]);

    for (const row of rows) {
        const recordReference = config.buildReferenceFromRow(row);
        const existing = await getWorkflowItemByReference(companyId, module, recordReference, executor);
        if (existing) {
            continue;
        }

        const snapshot = buildRecordSnapshot(row);
        const checksum = buildChecksum(snapshot);
        await insertWorkflowItem(executor, {
            companyId,
            module: config.module,
            sourceTable: config.sourceTable,
            recordReference,
            status: RECORD_WORKFLOW_STATUSES.DRAFT,
            snapshot,
            checksum
        });
    }
}

async function syncAllDraftModules(companyId, connection = null) {
    for (const module of Object.keys(MODULE_CONFIG)) {
        await bootstrapDraftItemsForModule(companyId, module, connection);
    }
}

function verifySourceRecordUnchanged(item, currentRecord) {
    const currentSnapshot = buildRecordSnapshot(currentRecord);
    const currentChecksum = buildChecksum(currentSnapshot);
    return {
        matches: currentChecksum === String(item.RecordChecksum || ''),
        currentSnapshot,
        currentChecksum
    };
}

async function getPerformedRoleGroups(workflowItemId, user, connection = null) {
    const executor = getConnectionExecutor(connection);
    const actor = normalizeUser(user);
    const [rows] = await executor.query(
        `
            SELECT Action, Metadata
            FROM record_workflow_actions
            WHERE WorkflowItemID = ?
              AND ActionBy = ?
        `,
        [Number(workflowItemId), actor.id]
    );

    const groups = new Set();
    for (const row of rows) {
        try {
            const metadata = row.Metadata ? JSON.parse(row.Metadata) : {};
            const roleGroup = getRoleGroup(metadata.actorRole);
            if (roleGroup) {
                groups.add(roleGroup);
            }
        } catch (error) {
            // Ignore malformed metadata and fall back to action mapping.
        }
    }

    return groups;
}

async function assertRoleCanAct(workflowItem, user, requiredGroup, connection = null) {
    const actor = normalizeUser(user);
    if (getRoleGroup(actor.role) !== requiredGroup) {
        throw createError('You are not authorized to perform this record workflow action.', 403);
    }

    const priorGroups = await getPerformedRoleGroups(workflowItem.id, actor, connection);
    const incompatibleGroups = new Set(
        Object.values(ROLE_GROUPS).filter((entry) => entry !== requiredGroup)
    );

    for (const priorGroup of priorGroups) {
        if (incompatibleGroups.has(priorGroup)) {
            throw createError('You cannot approve or endorse a record in which you already performed an incompatible workflow action.', 409);
        }
    }
}

async function submitRecord({
    companyId,
    module,
    workflowItemId,
    user,
    connection = null
}) {
    const actor = normalizeUser(user);
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }

        const item = await getWorkflowItemById(companyId, workflowItemId, executor);
        if (!item) {
            throw createError('Workflow item not found.', 404);
        }

        await assertRoleCanAct(item, actor, ROLE_GROUPS.DATA_ENTRY, executor);
        validateTransition(item.Status, RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER);

        const sourceRecord = await fetchModuleRecord(companyId, module, item.RecordReference, executor);
        if (!sourceRecord) {
            throw createError('The source record was not found for submission.', 404);
        }

        const snapshot = buildRecordSnapshot(sourceRecord);
        const checksum = buildChecksum(snapshot);

        await updateWorkflowItem(executor, item.id, {
            Status: RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER,
            SubmittedBy: actor.id || null,
            SubmittedAt: new Date(),
            RecordSnapshot: JSON.stringify(snapshot),
            RecordChecksum: checksum
        });

        const actionId = await logWorkflowAction(executor, {
            workflowItemId: item.id,
            companyId,
            module: item.Module,
            sourceTable: item.SourceTable,
            recordReference: item.RecordReference,
            action: RECORD_WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER,
            fromStatus: item.Status,
            toStatus: RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER,
            actionBy: actor.id,
            comments: 'Submitted to Manager for endorsement.',
            metadata: { actorRole: actor.role, actorName: actor.name }
        });

        await logAudit(executor, {
            companyId,
            userName: actor.name,
            action: 'SUBMIT_TO_MANAGER',
            recordId: item.id,
            message: `${item.Module} submitted to Manager.`
        });

        await workflowNotificationService.ensureNotificationTable(executor);
        await workflowNotificationService.notifyRecordWorkflowAction({
            companyId,
            item: {
                ...item,
                Status: RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER,
                SubmittedBy: actor.id || null
            },
            action: RECORD_WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER,
            actionId,
            actor,
            comments: 'Submitted to Manager for endorsement.',
            connection: executor
        });

        if (managedConnection) {
            await executor.commit();
        }

        return getWorkflowItemById(companyId, item.id, executor);
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

async function managerEndorseRecord({ companyId, workflowItemId, user, comments = '', connection = null }) {
    const actor = normalizeUser(user);
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }

        const item = await getWorkflowItemById(companyId, workflowItemId, executor);
        if (!item) {
            throw createError('Workflow item not found.', 404);
        }

        await assertRoleCanAct(item, actor, ROLE_GROUPS.MANAGER, executor);
        validateTransition(item.Status, RECORD_WORKFLOW_STATUSES.MANAGER_ENDORSED);

        const sourceRecord = await fetchModuleRecord(companyId, item.Module, item.RecordReference, executor);
        if (!sourceRecord) {
            throw createError('The source record was not found for endorsement.', 404);
        }

        const integrity = verifySourceRecordUnchanged(item, sourceRecord);
        if (!integrity.matches) {
            throw createError('The record has changed since submission. It must be returned and resubmitted.', 409);
        }

        await updateWorkflowItem(executor, item.id, {
            Status: RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD,
            ManagerEndorsedBy: actor.id || null,
            ManagerEndorsedAt: new Date(),
            ManagerComments: comments || null
        });

        await logWorkflowAction(executor, {
            workflowItemId: item.id,
            companyId,
            module: item.Module,
            sourceTable: item.SourceTable,
            recordReference: item.RecordReference,
            action: RECORD_WORKFLOW_ACTIONS.MANAGER_ENDORSE,
            fromStatus: item.Status,
            toStatus: RECORD_WORKFLOW_STATUSES.MANAGER_ENDORSED,
            actionBy: actor.id,
            comments,
            metadata: { actorRole: actor.role, actorName: actor.name }
        });

        const actionId = await logWorkflowAction(executor, {
            workflowItemId: item.id,
            companyId,
            module: item.Module,
            sourceTable: item.SourceTable,
            recordReference: item.RecordReference,
            action: RECORD_WORKFLOW_ACTIONS.SUBMIT_TO_ENTITY_HEAD,
            fromStatus: RECORD_WORKFLOW_STATUSES.MANAGER_ENDORSED,
            toStatus: RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD,
            actionBy: actor.id,
            comments: comments || 'Forwarded to Entity Head/HNO for final approval.',
            metadata: { actorRole: actor.role, actorName: actor.name }
        });

        await logAudit(executor, {
            companyId,
            userName: actor.name,
            action: 'MANAGER_ENDORSE',
            recordId: item.id,
            message: `${item.Module} endorsed and forwarded to Entity Head/HNO.`
        });

        await workflowNotificationService.ensureNotificationTable(executor);
        await workflowNotificationService.notifyRecordWorkflowAction({
            companyId,
            item: {
                ...item,
                Status: RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD,
                ManagerEndorsedBy: actor.id || null,
                ManagerComments: comments || null
            },
            action: RECORD_WORKFLOW_ACTIONS.SUBMIT_TO_ENTITY_HEAD,
            actionId,
            actor,
            comments: comments || 'Forwarded to Entity Head/HNO for final approval.',
            connection: executor
        });

        if (managedConnection) {
            await executor.commit();
        }

        return getWorkflowItemById(companyId, item.id, executor);
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

async function managerReturnRecord({ companyId, workflowItemId, user, comments, connection = null }) {
    const actor = normalizeUser(user);
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;
    const reason = normalizeText(comments);
    if (!reason) {
        throw createError('Please provide a reason for returning the record to Data Entry.', 400);
    }

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }

        const item = await getWorkflowItemById(companyId, workflowItemId, executor);
        if (!item) {
            throw createError('Workflow item not found.', 404);
        }

        await assertRoleCanAct(item, actor, ROLE_GROUPS.MANAGER, executor);
        validateTransition(item.Status, RECORD_WORKFLOW_STATUSES.RETURNED_BY_MANAGER);

        const sourceRecord = await fetchModuleRecord(companyId, item.Module, item.RecordReference, executor);
        if (!sourceRecord) {
            throw createError('The source record was not found for return.', 404);
        }

        const integrity = verifySourceRecordUnchanged(item, sourceRecord);
        if (!integrity.matches) {
            throw createError('The record has changed since submission. It must be returned and resubmitted.', 409);
        }

        await updateWorkflowItem(executor, item.id, {
            Status: RECORD_WORKFLOW_STATUSES.RETURNED_BY_MANAGER,
            ManagerComments: reason
        });

        const actionId = await logWorkflowAction(executor, {
            workflowItemId: item.id,
            companyId,
            module: item.Module,
            sourceTable: item.SourceTable,
            recordReference: item.RecordReference,
            action: RECORD_WORKFLOW_ACTIONS.MANAGER_RETURN,
            fromStatus: item.Status,
            toStatus: RECORD_WORKFLOW_STATUSES.RETURNED_BY_MANAGER,
            actionBy: actor.id,
            comments: reason,
            metadata: { actorRole: actor.role, actorName: actor.name }
        });

        await logAudit(executor, {
            companyId,
            userName: actor.name,
            action: 'MANAGER_RETURN',
            recordId: item.id,
            message: `${item.Module} returned to Data Entry.`
        });

        await workflowNotificationService.ensureNotificationTable(executor);
        await workflowNotificationService.notifyRecordWorkflowAction({
            companyId,
            item: {
                ...item,
                Status: RECORD_WORKFLOW_STATUSES.RETURNED_BY_MANAGER,
                ManagerComments: reason
            },
            action: RECORD_WORKFLOW_ACTIONS.MANAGER_RETURN,
            actionId,
            actor,
            comments: reason,
            connection: executor
        });

        if (managedConnection) {
            await executor.commit();
        }

        return getWorkflowItemById(companyId, item.id, executor);
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

async function applyLegacyFinalApproval(connection, companyId, module, recordReference, actorName) {
    const config = getModuleConfig(module);
    const [columns] = await connection.query(
        `
            SELECT COLUMN_NAME, LOWER(COLUMN_NAME) AS normalized_name
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND LOWER(COLUMN_NAME) IN ('approved', 'approvedby', 'dateapproved', 'timeapproved')
        `,
        [config.sourceTable]
    );
    const columnMap = columns.reduce((acc, row) => {
        acc[row.normalized_name] = row.COLUMN_NAME;
        return acc;
    }, {});
    const params = [];
    const updates = [];

    if (columnMap.approved) {
        updates.push(`${columnMap.approved} = ?`);
        params.push(LEGACY_FINAL_APPROVED_VALUE);
    }
    if (columnMap.approvedby) {
        updates.push(`${columnMap.approvedby} = ?`);
        params.push(actorName);
    }
    if (columnMap.dateapproved) {
        updates.push(`${columnMap.dateapproved} = NOW()`);
    }
    if (columnMap.timeapproved) {
        updates.push(`${columnMap.timeapproved} = CURTIME()`);
    }

    if (!updates.length) {
        return;
    }

    let whereClause = '';
    let whereParams = [];
    switch (config.module) {
        case 'salary-review': {
            const [reviewDate, revCode, startGrade, endGrade] = parseReference(recordReference);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND DATE(RevDate) = ? AND RevCode = ? AND SGrade = ? AND EGrade = ?`;
            whereParams = [Number(companyId) || 1, reviewDate, revCode, startGrade, endGrade];
            break;
        }
        case 'salary-query': {
            const [pfno, qDate] = parseReference(recordReference);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND PFNO = ? AND QDate = ?`;
            whereParams = [Number(companyId) || 1, pfno, qDate];
            break;
        }
        case 'yearly-payment': {
            const [pfNo, pMonth, pYear, payType] = parseReference(recordReference);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND PFNo = ? AND PMonth = ? AND PYear = ? AND PType = ?`;
            whereParams = [Number(companyId) || 1, pfNo, Number(pMonth), Number(pYear), payType];
            break;
        }
        case 'end-of-service': {
            const [pfNo, dateKeyed] = parseReference(recordReference);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND PFNo = ? AND COALESCE(DateKeyed, DateLeft, RetirementDate, '1900-01-01') = COALESCE(?, COALESCE(DateKeyed, DateLeft, RetirementDate, '1900-01-01'))`;
            whereParams = [Number(companyId) || 1, pfNo, dateKeyed || null];
            break;
        }
        case 'increment': {
            const [pfNo, incDate, type, grade, incNo] = parseReference(recordReference);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND PFNo = ? AND IncDate = ? AND Type = ? AND COALESCE(Grade, '') = COALESCE(?, COALESCE(Grade, '')) AND COALESCE(IncNo, 0) = COALESCE(?, COALESCE(IncNo, 0))`;
            whereParams = [Number(companyId) || 1, pfNo, incDate, type, grade || null, Number(incNo || 0)];
            break;
        }
        case 'loan': {
            const [transNo, entryDate, lTypeCode, lTrans] = parseReference(recordReference);
            const sqlEntryDate = normalizeSqlDateTimeValue(entryDate);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND TransNo = ? AND (EntryDate = ? OR EntryDate = ? OR DATE(EntryDate) = DATE(?)) AND LTypeCode = ? AND LTrans = ?`;
            whereParams = [Number(companyId) || 1, Number(transNo), sqlEntryDate, entryDate, sqlEntryDate, lTypeCode, lTrans];
            break;
        }
        case 'loan-repayment': {
            const [repayId] = parseReference(recordReference);
            whereClause = `RepayID = ?`;
            whereParams = [Number(repayId)];
            break;
        }
        case 'medical': {
            const [transNo] = parseReference(recordReference);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND TransNo = ?`;
            whereParams = [Number(companyId) || 1, Number(transNo)];
            break;
        }
        case 'surcharge': {
            const [pfNo, entryDate, sType, startDate] = parseReference(recordReference);
            const sqlEntryDate = normalizeSqlDateTimeValue(entryDate);
            const sqlStartDate = normalizeSqlDateTimeValue(startDate);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND PFNo = ? AND (COALESCE(EntryDate, '1900-01-01') = COALESCE(?, COALESCE(EntryDate, '1900-01-01')) OR COALESCE(EntryDate, '1900-01-01') = COALESCE(?, COALESCE(EntryDate, '1900-01-01')) OR DATE(COALESCE(EntryDate, '1900-01-01')) = DATE(COALESCE(?, COALESCE(EntryDate, '1900-01-01')))) AND SType = ? AND (COALESCE(StarDate, '1900-01-01') = COALESCE(?, COALESCE(StarDate, '1900-01-01')) OR COALESCE(StarDate, '1900-01-01') = COALESCE(?, COALESCE(StarDate, '1900-01-01')) OR DATE(COALESCE(StarDate, '1900-01-01')) = DATE(COALESCE(?, COALESCE(StarDate, '1900-01-01'))))`;
            whereParams = [
                Number(companyId) || 1,
                pfNo,
                sqlEntryDate || null,
                entryDate || null,
                sqlEntryDate || null,
                sType,
                sqlStartDate || null,
                startDate || null,
                sqlStartDate || null
            ];
            break;
        }
        case 'transfer': {
            const [pfno, transferDate, prevDept] = parseReference(recordReference);
            const sqlTransferDate = normalizeSqlDateTimeValue(transferDate);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND PFNO = ? AND (TDate = ? OR TDate = ? OR DATE(TDate) = DATE(?)) AND PrevDept = ?`;
            whereParams = [Number(companyId) || 1, pfno, sqlTransferDate, transferDate, sqlTransferDate, prevDept];
            break;
        }
        case 'promotion': {
            const [pfno, activity, promotionDate] = parseReference(recordReference);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND PFNO = ? AND Activity = ? AND DATE(PDate) = DATE(?)`;
            whereParams = [Number(companyId) || 1, pfno, Number(activity), normalizeSqlDateValue(promotionDate)];
            break;
        }
        case 'acting': {
            const [pfno, sDate] = parseReference(recordReference);
            const sqlStartDate = normalizeSqlDateTimeValue(sDate);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND PFNO = ? AND (SDate = ? OR SDate = ? OR DATE(SDate) = DATE(?))`;
            whereParams = [Number(companyId) || 1, pfno, sqlStartDate, sDate, sqlStartDate];
            break;
        }
        case 'leave': {
            const [id] = parseReference(recordReference);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND ID = ?`;
            whereParams = [Number(companyId) || 1, Number(id)];
            break;
        }
        case 'training': {
            const [pfno, course, startDate] = parseReference(recordReference);
            const sqlStartDate = normalizeSqlDateTimeValue(startDate);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND PFNo = ? AND Course = ? AND (StartDate = ? OR StartDate = ? OR DATE(StartDate) = DATE(?))`;
            whereParams = [Number(companyId) || 1, pfno, course, sqlStartDate, startDate, sqlStartDate];
            break;
        }
        case 'staff-exit': {
            const [pfno] = parseReference(recordReference);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND PFNo = ?`;
            whereParams = [Number(companyId) || 1, pfno];
            break;
        }
        case 'redundancy': {
            const [pfno] = parseReference(recordReference);
            whereClause = `(CompanyID = ? OR CompanyID IS NULL) AND PFNo = ?`;
            whereParams = [Number(companyId) || 1, pfno];
            break;
        }
        default:
            throw createError(`Legacy final approval update is not configured for module ${config.module}.`, 400);
    }

    await connection.query(
        `UPDATE ${config.sourceTable} SET ${updates.join(', ')} WHERE ${whereClause}`,
        [...params, ...whereParams]
    );
}

function resolveExitEmpStatus(reasonCode) {
    return '02';
}

async function applyModuleFinalActivation(connection, companyId, module, recordReference, sourceRecord) {
    switch (module) {
        case 'loan-repayment': {
            const [loanRows] = await connection.query(
                `
                    SELECT *
                    FROM tblloan
                    WHERE TransNo = ?
                      AND (CompanyID = ? OR CompanyID IS NULL)
                    LIMIT 1
                `,
                [sourceRecord.LoanTransNo, Number(companyId) || 1]
            );

            const loan = loanRows[0];
            if (!loan) {
                throw createError('The related loan record was not found for repayment activation.', 404);
            }

            const approvedRepaymentAmount = Number(sourceRecord.Amount || 0);
            const newRepaidAmount = Number(loan.RepaidAmount || 0) + approvedRepaymentAmount;
            const newLoanBalance = Number(loan.LoanBal || 0) - approvedRepaymentAmount;
            const repaidFlag = newLoanBalance <= 0 ? 1 : 0;

            await connection.query(
                `
                    UPDATE tblloan
                    SET RepaidAmount = ?,
                        LoanBal = ?,
                        Repaid = ?,
                        RepaidDate = CASE WHEN ? = 1 THEN NOW() ELSE RepaidDate END
                    WHERE TransNo = ?
                      AND (CompanyID = ? OR CompanyID IS NULL)
                `,
                [
                    newRepaidAmount,
                    newLoanBalance,
                    repaidFlag,
                    repaidFlag,
                    sourceRecord.LoanTransNo,
                    Number(companyId) || 1
                ]
            );
            break;
        }
        case 'transfer': {
            await connection.query(
                `
                    UPDATE tblstaff
                    SET CDept = ?, CDeptDate = ?
                    WHERE PFNo = ?
                      AND (CompanyID = ? OR CompanyID IS NULL)
                `,
                [sourceRecord.TDept, sourceRecord.TDate || new Date(), sourceRecord.PFNO, Number(companyId) || 1]
            );
            break;
        }
        case 'promotion': {
            await connection.query(
                `
                    UPDATE tblstaff
                    SET CGrade = ?,
                        GradeCode = ?,
                        JobTitle = ?,
                        CGradeDate = ?
                    WHERE PFNo = ?
                      AND (CompanyID = ? OR CompanyID IS NULL)
                `,
                [
                    sourceRecord.CGrade,
                    sourceRecord.CGrade,
                    sourceRecord.JobTitle,
                    sourceRecord.PDate || new Date(),
                    sourceRecord.PFNO,
                    Number(companyId) || 1
                ]
            );
            break;
        }
        case 'acting': {
            await connection.query(
                `
                    UPDATE tblsalary
                    SET Approved = 0
                    WHERE PFNo = ?
                      AND (CompanyID = ? OR CompanyID IS NULL)
                `,
                [sourceRecord.PFNO, Number(companyId) || 1]
            );
            await connection.query(
                `
                    UPDATE tblsalary
                    SET Allw14 = ?
                    WHERE PFNo = ?
                      AND Approved = 0
                      AND (CompanyID = ? OR CompanyID IS NULL)
                `,
                [sourceRecord.A_Salary || 0, sourceRecord.PFNO, Number(companyId) || 1]
            );
            break;
        }
        case 'staff-exit': {
            const effectiveDate = sourceRecord.DateLeft || sourceRecord.ExpDate || sourceRecord.DateResigned || sourceRecord.DateAccepted || new Date();
            await connection.query(
                `
                    UPDATE tblstaff
                    SET EmpStatus = ?,
                        ReasonCode = ?,
                        ReasonDate = ?,
                        Redundant = CASE WHEN ? = '12' THEN 1 ELSE COALESCE(Redundant, 0) END,
                        DateRedundant = CASE WHEN ? = '12' THEN COALESCE(DateRedundant, ?) ELSE DateRedundant END
                    WHERE PFNo = ?
                      AND (CompanyID = ? OR CompanyID IS NULL)
                `,
                [
                    resolveExitEmpStatus(sourceRecord.Reason),
                    sourceRecord.Reason || null,
                    effectiveDate,
                    normalizeText(sourceRecord.Reason),
                    normalizeText(sourceRecord.Reason),
                    effectiveDate,
                    sourceRecord.PFNo,
                    Number(companyId) || 1
                ]
            );
            break;
        }
        case 'redundancy': {
            const effectiveDate = sourceRecord.DateRedundant || new Date();
            await connection.query(
                `
                    UPDATE tblstaff
                    SET EmpStatus = '02',
                        Redundant = 1,
                        DateRedundant = ?,
                        ReasonCode = COALESCE(ReasonCode, '12'),
                        ReasonDate = COALESCE(ReasonDate, ?)
                    WHERE PFNo = ?
                      AND (CompanyID = ? OR CompanyID IS NULL)
                `,
                [effectiveDate, effectiveDate, sourceRecord.PFNo, Number(companyId) || 1]
            );
            break;
        }
        default:
            break;
    }
}

async function entityHeadApproveRecord({ companyId, workflowItemId, user, comments = '', connection = null }) {
    const actor = normalizeUser(user);
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }

        const item = await getWorkflowItemById(companyId, workflowItemId, executor);
        if (!item) {
            throw createError('Workflow item not found.', 404);
        }

        await assertRoleCanAct(item, actor, ROLE_GROUPS.ENTITY_HEAD, executor);
        validateTransition(item.Status, RECORD_WORKFLOW_STATUSES.FINAL_APPROVED);

        const sourceRecord = await fetchModuleRecord(companyId, item.Module, item.RecordReference, executor);
        if (!sourceRecord) {
            throw createError('The source record was not found for final approval.', 404);
        }

        const integrity = verifySourceRecordUnchanged(item, sourceRecord);
        if (!integrity.matches) {
            throw createError('The record has changed since submission. It must be returned and resubmitted.', 409);
        }

        await applyLegacyFinalApproval(executor, companyId, item.Module, item.RecordReference, actor.name);
        await applyModuleFinalActivation(executor, companyId, item.Module, item.RecordReference, sourceRecord);

        await updateWorkflowItem(executor, item.id, {
            Status: RECORD_WORKFLOW_STATUSES.FINAL_APPROVED,
            FinalApprovedBy: actor.id || null,
            FinalApprovedAt: new Date(),
            EntityHeadComments: comments || null
        });

        const actionId = await logWorkflowAction(executor, {
            workflowItemId: item.id,
            companyId,
            module: item.Module,
            sourceTable: item.SourceTable,
            recordReference: item.RecordReference,
            action: RECORD_WORKFLOW_ACTIONS.ENTITY_HEAD_APPROVE,
            fromStatus: item.Status,
            toStatus: RECORD_WORKFLOW_STATUSES.FINAL_APPROVED,
            actionBy: actor.id,
            comments,
            metadata: { actorRole: actor.role, actorName: actor.name, finalApprovedValue: LEGACY_FINAL_APPROVED_VALUE }
        });

        await logAudit(executor, {
            companyId,
            userName: actor.name,
            action: 'FINAL_APPROVE',
            recordId: item.id,
            message: `${item.Module} received final Entity Head/HNO approval.`
        });

        await workflowNotificationService.ensureNotificationTable(executor);
        await workflowNotificationService.notifyRecordWorkflowAction({
            companyId,
            item: {
                ...item,
                Status: RECORD_WORKFLOW_STATUSES.FINAL_APPROVED,
                FinalApprovedBy: actor.id || null,
                EntityHeadComments: comments || null
            },
            action: RECORD_WORKFLOW_ACTIONS.ENTITY_HEAD_APPROVE,
            actionId,
            actor,
            comments,
            connection: executor
        });

        if (managedConnection) {
            await executor.commit();
        }

        return getWorkflowItemById(companyId, item.id, executor);
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

async function entityHeadReturnRecord({ companyId, workflowItemId, user, comments, connection = null }) {
    const actor = normalizeUser(user);
    const reason = normalizeText(comments);
    if (!reason) {
        throw createError('Please provide a reason for returning the record.', 400);
    }

    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }

        const item = await getWorkflowItemById(companyId, workflowItemId, executor);
        if (!item) {
            throw createError('Workflow item not found.', 404);
        }

        await assertRoleCanAct(item, actor, ROLE_GROUPS.ENTITY_HEAD, executor);
        validateTransition(item.Status, RECORD_WORKFLOW_STATUSES.RETURNED_BY_ENTITY_HEAD);

        const sourceRecord = await fetchModuleRecord(companyId, item.Module, item.RecordReference, executor);
        if (!sourceRecord) {
            throw createError('The source record was not found for return.', 404);
        }

        const integrity = verifySourceRecordUnchanged(item, sourceRecord);
        if (!integrity.matches) {
            throw createError('The record has changed since submission. It must be returned and resubmitted.', 409);
        }

        await updateWorkflowItem(executor, item.id, {
            Status: RECORD_WORKFLOW_STATUSES.RETURNED_BY_ENTITY_HEAD,
            EntityHeadComments: reason
        });

        const actionId = await logWorkflowAction(executor, {
            workflowItemId: item.id,
            companyId,
            module: item.Module,
            sourceTable: item.SourceTable,
            recordReference: item.RecordReference,
            action: RECORD_WORKFLOW_ACTIONS.ENTITY_HEAD_RETURN,
            fromStatus: item.Status,
            toStatus: RECORD_WORKFLOW_STATUSES.RETURNED_BY_ENTITY_HEAD,
            actionBy: actor.id,
            comments: reason,
            metadata: { actorRole: actor.role, actorName: actor.name }
        });

        await logAudit(executor, {
            companyId,
            userName: actor.name,
            action: 'RETURNED_BY_ENTITY_HEAD',
            recordId: item.id,
            message: `${item.Module} returned by Entity Head/HNO.`
        });

        await workflowNotificationService.ensureNotificationTable(executor);
        await workflowNotificationService.notifyRecordWorkflowAction({
            companyId,
            item: {
                ...item,
                Status: RECORD_WORKFLOW_STATUSES.RETURNED_BY_ENTITY_HEAD,
                EntityHeadComments: reason
            },
            action: RECORD_WORKFLOW_ACTIONS.ENTITY_HEAD_RETURN,
            actionId,
            actor,
            comments: reason,
            connection: executor
        });

        if (managedConnection) {
            await executor.commit();
        }

        return getWorkflowItemById(companyId, item.id, executor);
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

async function entityHeadRejectRecord({ companyId, workflowItemId, user, comments, connection = null }) {
    const actor = normalizeUser(user);
    const reason = normalizeText(comments);
    if (!reason) {
        throw createError('Please provide a reason for rejecting the record.', 400);
    }

    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }

        const item = await getWorkflowItemById(companyId, workflowItemId, executor);
        if (!item) {
            throw createError('Workflow item not found.', 404);
        }

        await assertRoleCanAct(item, actor, ROLE_GROUPS.ENTITY_HEAD, executor);
        validateTransition(item.Status, RECORD_WORKFLOW_STATUSES.FINAL_REJECTED);

        const sourceRecord = await fetchModuleRecord(companyId, item.Module, item.RecordReference, executor);
        if (!sourceRecord) {
            throw createError('The source record was not found for rejection.', 404);
        }

        const integrity = verifySourceRecordUnchanged(item, sourceRecord);
        if (!integrity.matches) {
            throw createError('The record has changed since submission. It must be returned and resubmitted.', 409);
        }

        await updateWorkflowItem(executor, item.id, {
            Status: RECORD_WORKFLOW_STATUSES.FINAL_REJECTED,
            RejectedBy: actor.id || null,
            RejectedAt: new Date(),
            RejectionReason: reason,
            EntityHeadComments: reason
        });

        const actionId = await logWorkflowAction(executor, {
            workflowItemId: item.id,
            companyId,
            module: item.Module,
            sourceTable: item.SourceTable,
            recordReference: item.RecordReference,
            action: RECORD_WORKFLOW_ACTIONS.ENTITY_HEAD_REJECT,
            fromStatus: item.Status,
            toStatus: RECORD_WORKFLOW_STATUSES.FINAL_REJECTED,
            actionBy: actor.id,
            comments: reason,
            metadata: { actorRole: actor.role, actorName: actor.name }
        });

        await logAudit(executor, {
            companyId,
            userName: actor.name,
            action: 'FINAL_REJECT',
            recordId: item.id,
            message: `${item.Module} rejected by Entity Head/HNO.`
        });

        await workflowNotificationService.ensureNotificationTable(executor);
        await workflowNotificationService.notifyRecordWorkflowAction({
            companyId,
            item: {
                ...item,
                Status: RECORD_WORKFLOW_STATUSES.FINAL_REJECTED,
                RejectedBy: actor.id || null,
                RejectionReason: reason,
                EntityHeadComments: reason
            },
            action: RECORD_WORKFLOW_ACTIONS.ENTITY_HEAD_REJECT,
            actionId,
            actor,
            comments: reason,
            connection: executor
        });

        if (managedConnection) {
            await executor.commit();
        }

        return getWorkflowItemById(companyId, item.id, executor);
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

async function listWorkflowItems(companyId, filters = {}, connection = null) {
    const executor = getConnectionExecutor(connection);
    const conditions = ['i.CompanyID = ?'];
    const params = [Number(companyId) || 1];

    if (filters.module) {
        conditions.push('i.Module = ?');
        params.push(normalizeText(filters.module));
    }

    if (filters.status) {
        conditions.push('i.Status = ?');
        params.push(normalizeText(filters.status));
    }

    const [rows] = await executor.query(
        `
            SELECT
                i.*,
                COALESCE(u1.FullName, u1.Username, CONCAT('User ', u1.PFNo)) AS submittedByName,
                COALESCE(u2.FullName, u2.Username, CONCAT('User ', u2.PFNo)) AS managerEndorsedByName,
                COALESCE(u3.FullName, u3.Username, CONCAT('User ', u3.PFNo)) AS finalApprovedByName,
                COALESCE(u4.FullName, u4.Username, CONCAT('User ', u4.PFNo)) AS rejectedByName
            FROM record_workflow_items i
            LEFT JOIN tblpassword u1
                ON u1.PFNo = i.SubmittedBy
            LEFT JOIN tblpassword u2
                ON u2.PFNo = i.ManagerEndorsedBy
            LEFT JOIN tblpassword u3
                ON u3.PFNo = i.FinalApprovedBy
            LEFT JOIN tblpassword u4
                ON u4.PFNo = i.RejectedBy
            WHERE ${conditions.join(' AND ')}
            ORDER BY i.UpdatedAt DESC, i.id DESC
        `,
        params
    );

    return rows.map((row) => ({
        ...row,
        moduleLabel: getModuleConfig(row.Module).label
    }));
}

async function getWorkflowDetail(companyId, workflowItemId, connection = null) {
    const item = await getWorkflowItemById(companyId, workflowItemId, connection);
    if (!item) {
        throw createError('Workflow item not found.', 404);
    }

    const sourceRecord = await fetchModuleRecord(companyId, item.Module, item.RecordReference, connection);
    const history = await getWorkflowActions(item.id, connection);
    const config = getModuleConfig(item.Module);

    return {
        item: {
            ...item,
            moduleLabel: config.label,
            statusBadgeClass: mapWorkflowStatusBadge(item.Status)
        },
        moduleConfig: config,
        sourceRecord,
        snapshot: item.RecordSnapshot ? JSON.parse(item.RecordSnapshot) : null,
        history,
        displayRows: config.displayFields.map((field) => ({
            field,
            currentValue: sourceRecord ? sourceRecord[field] : null,
            submittedValue: item.RecordSnapshot ? JSON.parse(item.RecordSnapshot)[field] : null
        }))
    };
}

async function getWorkflowCountsByStatus(companyId, connection = null) {
    const executor = getConnectionExecutor(connection);
    const [rows] = await executor.query(
        `
            SELECT Status, COUNT(*) AS total
            FROM record_workflow_items
            WHERE CompanyID = ?
            GROUP BY Status
        `,
        [Number(companyId) || 1]
    );
    return rows.reduce((acc, row) => {
        acc[row.Status] = Number(row.total || 0);
        return acc;
    }, {});
}

module.exports = {
    HISTORICAL_APPROVED_VALUES,
    LEGACY_FINAL_APPROVED_VALUE,
    MODULE_CONFIG,
    RECORD_WORKFLOW_ACTIONS,
    RECORD_WORKFLOW_STATUSES,
    buildReference,
    assertRecordEditableByReference,
    ensureDraftItemForExistingRecord,
    ensureWorkflowTables,
    entityHeadApproveRecord,
    entityHeadRejectRecord,
    entityHeadReturnRecord,
    fetchModuleRecord,
    getModuleConfig,
    getWorkflowActions,
    getWorkflowCountsByStatus,
    getWorkflowDetail,
    getWorkflowItemById,
    getWorkflowItemByReference,
    listWorkflowItems,
    managerEndorseRecord,
    managerReturnRecord,
    mapWorkflowStatusBadge,
    submitRecord,
    syncAllDraftModules,
    validateTransition
};
