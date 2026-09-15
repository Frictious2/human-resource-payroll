const crypto = require('crypto');
const pool = require('../config/db');
const { ACTIVITY_DEFINITIONS } = require('../validations/processEmolumentsValidation');
const workflowNotificationService = require('./workflowNotificationService');
const auditTrailService = require('./auditTrailService');

const WORKFLOW_STATUSES = Object.freeze({
    DRAFT: 'DRAFT',
    CORRECTION_IN_PROGRESS: 'CORRECTION_IN_PROGRESS',
    PROCESSED: 'PROCESSED',
    SUBMITTED_TO_MANAGER: 'SUBMITTED_TO_MANAGER',
    MANAGER_ENDORSED: 'MANAGER_ENDORSED',
    RETURNED_BY_MANAGER: 'RETURNED_BY_MANAGER',
    SUBMITTED_TO_AUDITOR: 'SUBMITTED_TO_AUDITOR',
    AUDITOR_ENDORSED: 'AUDITOR_ENDORSED',
    RETURNED_BY_AUDITOR: 'RETURNED_BY_AUDITOR',
    SUBMITTED_TO_ENTITY_HEAD: 'SUBMITTED_TO_ENTITY_HEAD',
    FINAL_APPROVED: 'FINAL_APPROVED',
    FINAL_REJECTED: 'FINAL_REJECTED',
    POSTED_TO_ACCOUNTS: 'POSTED_TO_ACCOUNTS',
    REVERSED: 'REVERSED'
});

const WORKFLOW_ACTIONS = Object.freeze({
    PROCESS_PAYROLL: 'PROCESS_PAYROLL',
    SUBMIT_TO_MANAGER: 'SUBMIT_TO_MANAGER',
    MANAGER_ENDORSE: 'MANAGER_ENDORSE',
    MANAGER_RETURN: 'MANAGER_RETURN',
    SUBMIT_TO_AUDITOR: 'SUBMIT_TO_AUDITOR',
    AUDITOR_ENDORSE: 'AUDITOR_ENDORSE',
    AUDITOR_RETURN: 'AUDITOR_RETURN',
    SUBMIT_TO_ENTITY_HEAD: 'SUBMIT_TO_ENTITY_HEAD',
    FINAL_APPROVE: 'FINAL_APPROVE',
    FINAL_RETURN: 'FINAL_RETURN',
    FINAL_REJECT: 'FINAL_REJECT',
    POST_TO_ACCOUNTS: 'POST_TO_ACCOUNTS',
    CORRECTION_RESTART: 'CORRECTION_RESTART',
    REVERSE_POSTING: 'REVERSE_POSTING'
});

const ACTOR_GROUPS = Object.freeze({
    FINANCE: 'finance',
    MANAGER: 'manager',
    AUDITOR: 'auditor',
    ENTITY_HEAD: 'entity-head'
});

const VALID_TRANSITIONS = Object.freeze({
    [WORKFLOW_STATUSES.DRAFT]: [WORKFLOW_STATUSES.PROCESSED],
    [WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS]: [WORKFLOW_STATUSES.PROCESSED],
    [WORKFLOW_STATUSES.PROCESSED]: [WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER],
    [WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER]: [WORKFLOW_STATUSES.MANAGER_ENDORSED, WORKFLOW_STATUSES.RETURNED_BY_MANAGER],
    [WORKFLOW_STATUSES.RETURNED_BY_MANAGER]: [WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS],
    [WORKFLOW_STATUSES.MANAGER_ENDORSED]: [WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR],
    [WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR]: [WORKFLOW_STATUSES.AUDITOR_ENDORSED, WORKFLOW_STATUSES.RETURNED_BY_AUDITOR],
    [WORKFLOW_STATUSES.RETURNED_BY_AUDITOR]: [WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS],
    [WORKFLOW_STATUSES.AUDITOR_ENDORSED]: [WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD],
    [WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD]: [WORKFLOW_STATUSES.FINAL_APPROVED, WORKFLOW_STATUSES.FINAL_REJECTED],
    [WORKFLOW_STATUSES.FINAL_REJECTED]: [WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS],
    [WORKFLOW_STATUSES.FINAL_APPROVED]: [WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS],
    [WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS]: [WORKFLOW_STATUSES.REVERSED],
    [WORKFLOW_STATUSES.REVERSED]: []
});

const ACTION_DEFINITIONS = Object.freeze({
    [WORKFLOW_ACTIONS.PROCESS_PAYROLL]: { toStatus: WORKFLOW_STATUSES.PROCESSED, actorGroup: ACTOR_GROUPS.FINANCE },
    [WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER]: { toStatus: WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER, actorGroup: ACTOR_GROUPS.FINANCE },
    [WORKFLOW_ACTIONS.MANAGER_ENDORSE]: { toStatus: WORKFLOW_STATUSES.MANAGER_ENDORSED, actorGroup: ACTOR_GROUPS.MANAGER },
    [WORKFLOW_ACTIONS.MANAGER_RETURN]: { toStatus: WORKFLOW_STATUSES.RETURNED_BY_MANAGER, actorGroup: ACTOR_GROUPS.MANAGER },
    [WORKFLOW_ACTIONS.SUBMIT_TO_AUDITOR]: { toStatus: WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR, actorGroup: ACTOR_GROUPS.MANAGER },
    [WORKFLOW_ACTIONS.AUDITOR_ENDORSE]: { toStatus: WORKFLOW_STATUSES.AUDITOR_ENDORSED, actorGroup: ACTOR_GROUPS.AUDITOR },
    [WORKFLOW_ACTIONS.AUDITOR_RETURN]: { toStatus: WORKFLOW_STATUSES.RETURNED_BY_AUDITOR, actorGroup: ACTOR_GROUPS.AUDITOR },
    [WORKFLOW_ACTIONS.SUBMIT_TO_ENTITY_HEAD]: { toStatus: WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD, actorGroup: ACTOR_GROUPS.AUDITOR },
    [WORKFLOW_ACTIONS.FINAL_APPROVE]: { toStatus: WORKFLOW_STATUSES.FINAL_APPROVED, actorGroup: ACTOR_GROUPS.ENTITY_HEAD },
    [WORKFLOW_ACTIONS.FINAL_RETURN]: { toStatus: WORKFLOW_STATUSES.FINAL_REJECTED, actorGroup: ACTOR_GROUPS.ENTITY_HEAD },
    [WORKFLOW_ACTIONS.FINAL_REJECT]: { toStatus: WORKFLOW_STATUSES.FINAL_REJECTED, actorGroup: ACTOR_GROUPS.ENTITY_HEAD },
    [WORKFLOW_ACTIONS.POST_TO_ACCOUNTS]: { toStatus: WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS, actorGroup: ACTOR_GROUPS.FINANCE },
    [WORKFLOW_ACTIONS.CORRECTION_RESTART]: { toStatus: WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS, actorGroup: ACTOR_GROUPS.FINANCE },
    [WORKFLOW_ACTIONS.REVERSE_POSTING]: { toStatus: WORKFLOW_STATUSES.REVERSED, actorGroup: ACTOR_GROUPS.FINANCE }
});

const ROLE_GROUP_MAP = Object.freeze({
    'finance-officer': ACTOR_GROUPS.FINANCE,
    manager: ACTOR_GROUPS.MANAGER,
    auditor: ACTOR_GROUPS.AUDITOR,
    'entity-head': ACTOR_GROUPS.ENTITY_HEAD
});

const INCOMPATIBLE_ACTOR_GROUPS = Object.freeze({
    [ACTOR_GROUPS.FINANCE]: [ACTOR_GROUPS.MANAGER, ACTOR_GROUPS.AUDITOR, ACTOR_GROUPS.ENTITY_HEAD],
    [ACTOR_GROUPS.MANAGER]: [ACTOR_GROUPS.FINANCE, ACTOR_GROUPS.AUDITOR, ACTOR_GROUPS.ENTITY_HEAD],
    [ACTOR_GROUPS.AUDITOR]: [ACTOR_GROUPS.FINANCE, ACTOR_GROUPS.MANAGER, ACTOR_GROUPS.ENTITY_HEAD],
    [ACTOR_GROUPS.ENTITY_HEAD]: [ACTOR_GROUPS.FINANCE, ACTOR_GROUPS.MANAGER, ACTOR_GROUPS.AUDITOR]
});

const ALLOWANCE_COLUMNS = Array.from({ length: 19 }, (_, index) => `Allw${String(index + 2).padStart(2, '0')}`);
const DEDUCTION_COLUMNS = ['Ded1', 'Ded2', 'Ded3', 'Ded4', 'Ded5', 'Ded6', 'Ded7'];
const EXTRA_DEDUCTION_COLUMNS = ['UnionDues', 'GratEmp'];

function createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizePayrollType(pType) {
    const value = String(pType || '').trim();
    if (!value) {
        throw createError('Payroll type is required.', 400);
    }

    if (/^\d+$/.test(value)) {
        return value.padStart(2, '0');
    }

    return value;
}

function getPayrollTypeVariants(pType) {
    const raw = String(pType || '').trim();
    const variants = new Set();

    if (raw) {
        variants.add(raw);
        if (/^\d+$/.test(raw)) {
            variants.add(raw.padStart(2, '0'));
            variants.add(String(Number(raw)));
        }
    }

    return Array.from(variants).filter(Boolean);
}

function normalizeUser(user = {}) {
    const id = Number(user.id ?? user.pfno ?? 0);
    return {
        id: Number.isFinite(id) && id > 0 ? id : 0,
        role: String(user.role || '').trim(),
        name: user.name || user.fullName || user.username || user.email || 'System',
        source: user.source || 'tblpassword'
    };
}

function getActorGroupForRole(role) {
    return ROLE_GROUP_MAP[String(role || '').trim()] || null;
}

function getConnectionExecutor(connection) {
    return connection || pool;
}

async function logWorkflowAudit(connection, {
    companyId,
    userName,
    action,
    batchId,
    fromStatus,
    toStatus,
    comments
}) {
    const summary = [fromStatus || 'DRAFT', '->', toStatus, comments || ''].join(' ').trim();
    await auditTrailService.writeAuditEntryWithExecutor(connection, {
        action,
        userName: userName || 'System',
        formName: 'payroll/workflow',
        recordId: String(batchId || '').slice(0, 6) || null,
        fieldName: 'Status',
        oldValue: fromStatus || 'DRAFT',
        newValue: summary,
        loggedout: 0,
        companyId: Number(companyId) || 1
    });
}

function buildAllowanceSumExpression(alias = 'p') {
    return ALLOWANCE_COLUMNS.map((column) => `COALESCE(${alias}.${column}, 0)`).join(' + ');
}

function buildDeductionSumExpression(alias = 'p') {
    return [...DEDUCTION_COLUMNS, ...EXTRA_DEDUCTION_COLUMNS].map((column) => `COALESCE(${alias}.${column}, 0)`).join(' + ');
}

async function resolvePayrollCompanyScope(executor, { companyId, pMonth, pYear, pType }) {
    const variants = getPayrollTypeVariants(pType);
    const placeholders = variants.map(() => '?').join(', ');

    const [exactRows] = await executor.query(
        `
            SELECT COUNT(*) AS count
            FROM tblpayroll
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND PType IN (${placeholders})
        `,
        [companyId, pMonth, pYear, ...variants]
    );

    const exactCount = Number(exactRows[0]?.count || 0);
    if (exactCount > 0) {
        return {
            companyWhereClause: 'p.CompanyID = ?',
            companyParams: [companyId],
            companyMatchMode: 'exact',
            payrollTypeVariants: variants
        };
    }

    return {
        companyWhereClause: '(p.CompanyID = ? OR p.CompanyID IS NULL)',
        companyParams: [companyId],
        companyMatchMode: 'legacy-null-fallback',
        payrollTypeVariants: variants
    };
}

function mapSnapshotRow(row, companyMatchMode, payrollTypeVariants) {
    return {
        totalStaff: Number(row.total_staff || 0),
        payrollRowCount: Number(row.payroll_row_count || 0),
        totalBasic: roundMoney(row.total_basic),
        totalAllowances: roundMoney(row.total_allowances),
        totalGross: roundMoney(row.total_gross),
        totalTaxable: roundMoney(row.total_taxable),
        totalTax: roundMoney(row.total_tax),
        totalNassitEmployee: roundMoney(row.total_nassit_employee),
        totalNassitEmployer: roundMoney(row.total_nassit_employer),
        totalDeductions: roundMoney(row.total_deductions),
        totalNet: roundMoney(row.total_net),
        companyMatchMode,
        payrollTypeVariants
    };
}

function getActivityName(pType) {
    return ACTIVITY_DEFINITIONS[String(pType || '').trim()] || 'Payroll Activity';
}

async function calculatePayrollSnapshot(companyId, pMonth, pYear, pType, connection = null) {
    const executor = getConnectionExecutor(connection);
    const normalizedCompanyId = Number(companyId) || 1;
    const normalizedMonth = Number(pMonth);
    const normalizedYear = Number(pYear);
    const normalizedPType = normalizePayrollType(pType);
    const scope = await resolvePayrollCompanyScope(executor, {
        companyId: normalizedCompanyId,
        pMonth: normalizedMonth,
        pYear: normalizedYear,
        pType: normalizedPType
    });
    const typePlaceholders = scope.payrollTypeVariants.map(() => '?').join(', ');
    const summaryParams = [
        ...scope.companyParams,
        normalizedMonth,
        normalizedYear,
        ...scope.payrollTypeVariants
    ];

    const [summaryRows] = await executor.query(
        `
            SELECT
                COUNT(DISTINCT p.PFNo) AS total_staff,
                COUNT(*) AS payroll_row_count,
                SUM(COALESCE(p.Salary, 0)) AS total_basic,
                SUM(${buildAllowanceSumExpression('p')}) AS total_allowances,
                SUM(COALESCE(p.TotalIncome, 0)) AS total_gross,
                SUM(COALESCE(p.Taxable, 0)) AS total_taxable,
                SUM(COALESCE(p.Tax, 0)) AS total_tax,
                SUM(COALESCE(p.NassitEmp, 0)) AS total_nassit_employee,
                SUM(COALESCE(p.NassitInst, 0)) AS total_nassit_employer,
                SUM(${buildDeductionSumExpression('p')}) AS total_deductions,
                SUM(COALESCE(p.NetIncome, 0)) AS total_net
            FROM tblpayroll p
            WHERE ${scope.companyWhereClause}
              AND p.PMonth = ?
              AND p.PYear = ?
              AND p.PType IN (${typePlaceholders})
        `,
        summaryParams
    );

    const snapshot = mapSnapshotRow(summaryRows[0] || {}, scope.companyMatchMode, scope.payrollTypeVariants);

    const [detailRows] = await executor.query(
        `
            SELECT
                p.PFNo,
                COALESCE(p.Salary, 0) AS Salary,
                ${buildAllowanceSumExpression('p')} AS AllowanceTotal,
                COALESCE(p.TotalIncome, 0) AS TotalIncome,
                COALESCE(p.Taxable, 0) AS Taxable,
                COALESCE(p.Tax, 0) AS Tax,
                COALESCE(p.NassitEmp, 0) AS NassitEmp,
                COALESCE(p.NassitInst, 0) AS NassitInst,
                COALESCE(p.UnionDues, 0) AS UnionDues,
                COALESCE(p.GratEmp, 0) AS GratEmp,
                COALESCE(p.Ded1, 0) AS Ded1,
                COALESCE(p.Ded2, 0) AS Ded2,
                COALESCE(p.Ded3, 0) AS Ded3,
                COALESCE(p.Ded4, 0) AS Ded4,
                COALESCE(p.Ded5, 0) AS Ded5,
                COALESCE(p.Ded6, 0) AS Ded6,
                COALESCE(p.Ded7, 0) AS Ded7,
                COALESCE(p.NetIncome, 0) AS NetIncome,
                COALESCE(p.Approved, 0) AS Approved
            FROM tblpayroll p
            WHERE ${scope.companyWhereClause}
              AND p.PMonth = ?
              AND p.PYear = ?
              AND p.PType IN (${typePlaceholders})
            ORDER BY p.PFNo ASC, p.AccountNo ASC, p.PDate ASC
        `,
        summaryParams
    );

    snapshot.payrollChecksum = crypto
        .createHash('sha256')
        .update(JSON.stringify(detailRows))
        .digest('hex');

    snapshot.detailRowCount = detailRows.length;
    return snapshot;
}

function validateTransition(currentStatus, nextStatus) {
    const allowedStatuses = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowedStatuses.includes(nextStatus)) {
        throw createError(`Invalid payroll workflow transition: ${currentStatus} -> ${nextStatus}.`, 409);
    }

    return true;
}

async function getWorkflowBatch(companyId, pMonth, pYear, pType, connection = null) {
    const executor = getConnectionExecutor(connection);
    const normalizedPType = normalizePayrollType(pType);
    const [rows] = await executor.query(
        `
            SELECT *
            FROM payroll_workflow_batches
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND PType = ?
            ORDER BY COALESCE(GenerationNo, 1) DESC, id DESC
            LIMIT 1
        `,
        [Number(companyId) || 1, Number(pMonth), Number(pYear), normalizedPType]
    );

    return rows[0] || null;
}

function mapSnapshotToBatchValues(snapshot) {
    return [
        snapshot.totalStaff,
        snapshot.totalBasic,
        snapshot.totalAllowances,
        snapshot.totalGross,
        snapshot.totalTaxable,
        snapshot.totalTax,
        snapshot.totalNassitEmployee,
        snapshot.totalNassitEmployer,
        snapshot.totalDeductions,
        snapshot.totalNet,
        snapshot.payrollRowCount,
        snapshot.payrollChecksum
    ];
}

async function createWorkflowBatch({
    companyId,
    pMonth,
    pYear,
    pType,
    status = WORKFLOW_STATUSES.DRAFT,
    snapshot = null,
    connection = null,
    transitionUser = null,
    comments = null
}) {
    const executor = getConnectionExecutor(connection);
    const normalizedPType = normalizePayrollType(pType);
    const normalizedCompanyId = Number(companyId) || 1;
    const actor = normalizeUser(transitionUser || {});
    const effectiveSnapshot = snapshot || {
        totalStaff: 0,
        totalBasic: 0,
        totalAllowances: 0,
        totalGross: 0,
        totalTaxable: 0,
        totalTax: 0,
        totalNassitEmployee: 0,
        totalNassitEmployer: 0,
        totalDeductions: 0,
        totalNet: 0,
        payrollRowCount: 0,
        payrollChecksum: null
    };

    try {
        await executor.query(
            `
                INSERT INTO payroll_workflow_batches (
                    CompanyID, PMonth, PYear, PType, Status,
                    TotalStaff, TotalBasic, TotalAllowances, TotalGross, TotalTaxable,
                    TotalTax, TotalNassitEmployee, TotalNassitEmployer, TotalDeductions, TotalNet,
                    PayrollRowCount, PayrollChecksum,
                    ProcessedBy, ProcessedAt, ManagerComments, AuditorComments, EntityHeadComments,
                    CreatedAt, UpdatedAt
                ) VALUES (
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?,
                    ?, ?, ?, ?, ?,
                    NOW(), NOW()
                )
            `,
            [
                normalizedCompanyId,
                Number(pMonth),
                Number(pYear),
                normalizedPType,
                status,
                ...mapSnapshotToBatchValues(effectiveSnapshot),
                status === WORKFLOW_STATUSES.PROCESSED ? actor.id || null : null,
                status === WORKFLOW_STATUSES.PROCESSED ? new Date() : null,
                status === WORKFLOW_STATUSES.RETURNED_BY_MANAGER ? comments || null : null,
                status === WORKFLOW_STATUSES.RETURNED_BY_AUDITOR ? comments || null : null,
                status === WORKFLOW_STATUSES.FINAL_REJECTED ? comments || null : null
            ]
        );

        return getWorkflowBatch(normalizedCompanyId, pMonth, pYear, normalizedPType, executor);
    } catch (error) {
        if (error && error.code === 'ER_DUP_ENTRY') {
            throw createError('A workflow batch already exists for the selected payroll period.', 409);
        }

        throw error;
    }
}

async function updatePayrollSnapshot({ batchId, snapshot, connection = null }) {
    const executor = getConnectionExecutor(connection);
    await executor.query(
        `
            UPDATE payroll_workflow_batches
            SET
                TotalStaff = ?,
                TotalBasic = ?,
                TotalAllowances = ?,
                TotalGross = ?,
                TotalTaxable = ?,
                TotalTax = ?,
                TotalNassitEmployee = ?,
                TotalNassitEmployer = ?,
                TotalDeductions = ?,
                TotalNet = ?,
                PayrollRowCount = ?,
                PayrollChecksum = ?,
                UpdatedAt = NOW()
            WHERE id = ?
        `,
        [...mapSnapshotToBatchValues(snapshot), batchId]
    );
}

function assertWorkflowStatus(actualStatus, expectedStatuses) {
    const statuses = Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses];
    if (!statuses.includes(actualStatus)) {
        throw createError(`Expected payroll workflow status ${statuses.join(' or ')}, found ${actualStatus}.`, 409);
    }

    return true;
}

function compareSnapshots(batch, snapshot) {
    const comparisons = [
        ['TotalStaff', Number(batch.TotalStaff || 0), Number(snapshot.totalStaff || 0)],
        ['TotalBasic', roundMoney(batch.TotalBasic), roundMoney(snapshot.totalBasic)],
        ['TotalAllowances', roundMoney(batch.TotalAllowances), roundMoney(snapshot.totalAllowances)],
        ['TotalGross', roundMoney(batch.TotalGross), roundMoney(snapshot.totalGross)],
        ['TotalTaxable', roundMoney(batch.TotalTaxable), roundMoney(snapshot.totalTaxable)],
        ['TotalTax', roundMoney(batch.TotalTax), roundMoney(snapshot.totalTax)],
        ['TotalNassitEmployee', roundMoney(batch.TotalNassitEmployee), roundMoney(snapshot.totalNassitEmployee)],
        ['TotalNassitEmployer', roundMoney(batch.TotalNassitEmployer), roundMoney(snapshot.totalNassitEmployer)],
        ['TotalDeductions', roundMoney(batch.TotalDeductions), roundMoney(snapshot.totalDeductions)],
        ['TotalNet', roundMoney(batch.TotalNet), roundMoney(snapshot.totalNet)],
        ['PayrollRowCount', Number(batch.PayrollRowCount || 0), Number(snapshot.payrollRowCount || 0)],
        ['PayrollChecksum', String(batch.PayrollChecksum || ''), String(snapshot.payrollChecksum || '')]
    ];

    return comparisons
        .filter(([, previousValue, nextValue]) => String(previousValue) !== String(nextValue))
        .map(([field, previousValue, nextValue]) => ({ field, previousValue, nextValue }));
}

function verifyPayrollSnapshotUnchanged(batch, snapshot) {
    const differences = compareSnapshots(batch, snapshot);
    return {
        matches: differences.length === 0,
        differences
    };
}

function parseActionMetadata(metadata) {
    if (!metadata) {
        return {};
    }

    try {
        return typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    } catch (error) {
        return {};
    }
}

function getActionActorName(actionRow) {
    const metadata = parseActionMetadata(actionRow?.Metadata);
    return metadata.actorName || metadata.userName || metadata.name || '';
}

async function logWorkflowAction({
    workflowBatchId,
    companyId,
    pMonth,
    pYear,
    pType,
    action,
    fromStatus,
    toStatus,
    actionBy,
    actionAt = new Date(),
    comments = null,
    result = 'SUCCESS',
    metadata = null,
    connection = null
}) {
    const executor = getConnectionExecutor(connection);
    const serializedMetadata = metadata == null
        ? null
        : (typeof metadata === 'string' ? metadata : JSON.stringify(metadata));

    const [resultSet] = await executor.query(
        `
            INSERT INTO payroll_workflow_actions (
                WorkflowBatchID, CompanyID, PMonth, PYear, PType,
                Action, FromStatus, ToStatus, ActionBy, ActionAt, Comments, Result, Metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            workflowBatchId,
            Number(companyId) || 1,
            Number(pMonth),
            Number(pYear),
            normalizePayrollType(pType),
            action,
            fromStatus || null,
            toStatus,
            Number(actionBy) || 0,
            actionAt,
            comments || null,
            result,
            serializedMetadata
        ]
    );

    return resultSet.insertId;
}

async function getWorkflowHistory(batchId, connection = null) {
    const executor = getConnectionExecutor(connection);
    const [rows] = await executor.query(
        `
            SELECT *
            FROM payroll_workflow_actions
            WHERE WorkflowBatchID = ?
            ORDER BY ActionAt ASC, id ASC
        `,
        [batchId]
    );

    return rows;
}

async function getWorkflowBatchById(companyId, batchId, connection = null) {
    const executor = getConnectionExecutor(connection);
    const [rows] = await executor.query(
        `
            SELECT *
            FROM payroll_workflow_batches
            WHERE id = ?
              AND CompanyID = ?
            LIMIT 1
        `,
        [Number(batchId), Number(companyId) || 1]
    );

    return rows[0] || null;
}

async function listWorkflowBatches(companyId, filters = {}, connection = null) {
    const executor = getConnectionExecutor(connection);
    const conditions = ['b.CompanyID = ?'];
    const params = [Number(companyId) || 1];

    if (filters.status) {
        conditions.push('b.Status = ?');
        params.push(String(filters.status).trim());
    }

    if (filters.month) {
        conditions.push('b.PMonth = ?');
        params.push(Number(filters.month));
    }

    if (filters.year) {
        conditions.push('b.PYear = ?');
        params.push(Number(filters.year));
    }

    if (filters.pType) {
        conditions.push('b.PType = ?');
        params.push(normalizePayrollType(filters.pType));
    }

    const [rows] = await executor.query(
        `
            SELECT *
            FROM payroll_workflow_batches b
            WHERE ${conditions.join(' AND ')}
            ORDER BY b.PYear DESC, b.PMonth DESC, b.PType ASC, b.UpdatedAt DESC, b.id DESC
            LIMIT 200
        `,
        params
    );

    if (!rows.length) {
        return [];
    }

    const placeholders = rows.map(() => '?').join(', ');
    const [actionRows] = await executor.query(
        `
            SELECT WorkflowBatchID, Action, Metadata
            FROM payroll_workflow_actions
            WHERE WorkflowBatchID IN (${placeholders})
            ORDER BY ActionAt ASC, id ASC
        `,
        rows.map((row) => row.id)
    );

    const actionMap = new Map();
    actionRows.forEach((row) => {
        if (!actionMap.has(row.WorkflowBatchID)) {
            actionMap.set(row.WorkflowBatchID, []);
        }
        actionMap.get(row.WorkflowBatchID).push(row);
    });

    return rows.map((row) => {
        const history = actionMap.get(row.id) || [];
        const processAction = history.find((entry) => entry.Action === WORKFLOW_ACTIONS.PROCESS_PAYROLL);
        const submitAction = history.find((entry) => entry.Action === WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER);
        const managerEndorseAction = history.find((entry) => entry.Action === WORKFLOW_ACTIONS.MANAGER_ENDORSE);
        const auditorEndorseAction = history.find((entry) => entry.Action === WORKFLOW_ACTIONS.AUDITOR_ENDORSE);
        const finalApproveAction = history.find((entry) => entry.Action === WORKFLOW_ACTIONS.FINAL_APPROVE);
        const postToAccountsAction = history.find((entry) => entry.Action === WORKFLOW_ACTIONS.POST_TO_ACCOUNTS);

        return {
            ...row,
            processedByName: getActionActorName(processAction) || row.ProcessedBy || '',
            submittedToManagerByName: getActionActorName(submitAction) || row.SubmittedToManagerBy || '',
            managerEndorsedByName: getActionActorName(managerEndorseAction) || row.ManagerEndorsedBy || '',
            auditorEndorsedByName: getActionActorName(auditorEndorseAction) || row.AuditorEndorsedBy || '',
            finalApprovedByName: getActionActorName(finalApproveAction) || row.FinalApprovedBy || '',
            postedToAccountsByName: getActionActorName(postToAccountsAction) || row.PostedToAccountsBy || ''
        };
    });
}

async function getWorkflowBatchDetail(companyId, batchId, connection = null) {
    const executor = getConnectionExecutor(connection);
    const batch = await getWorkflowBatchById(companyId, batchId, executor);

    if (!batch) {
        throw createError('No workflow batch was found for the selected payroll period.', 404);
    }

    const historyRows = await getWorkflowHistory(batch.id, executor);
    const scope = await resolvePayrollCompanyScope(executor, {
        companyId: Number(batch.CompanyID) || 1,
        pMonth: Number(batch.PMonth),
        pYear: Number(batch.PYear),
        pType: batch.PType
    });
    const typePlaceholders = scope.payrollTypeVariants.map(() => '?').join(', ');
    const queryParams = [
        ...scope.companyParams,
        Number(batch.PMonth),
        Number(batch.PYear),
        ...scope.payrollTypeVariants
    ];

    const [payrollRows] = await executor.query(
        `
            SELECT
                p.PFNo,
                COALESCE(s.SName, '') AS StaffName,
                p.Dept AS DeptCode,
                COALESCE(d.Dept, p.Dept) AS DeptName,
                p.Grade AS GradeCode,
                COALESCE(g.Grade, p.Grade) AS GradeName,
                COALESCE(jt.JobTitle, p.JobTitle) AS JobTitle,
                COALESCE(p.Salary, 0) AS Salary,
                ${buildAllowanceSumExpression('p')} AS AllowanceTotal,
                COALESCE(p.TotalIncome, 0) AS TotalIncome,
                COALESCE(p.Taxable, 0) AS Taxable,
                COALESCE(p.Tax, 0) AS Tax,
                COALESCE(p.NassitEmp, 0) AS NassitEmployee,
                COALESCE(p.NassitInst, 0) AS NassitEmployer,
                COALESCE(p.Ded1, 0) AS LoanDeduction,
                COALESCE(p.Ded6, 0) AS MedicalDeduction,
                COALESCE(p.Ded7, 0) AS SurchargeDeduction,
                (
                    COALESCE(p.UnionDues, 0) +
                    COALESCE(p.GratEmp, 0) +
                    COALESCE(p.Ded2, 0) +
                    COALESCE(p.Ded3, 0) +
                    COALESCE(p.Ded4, 0) +
                    COALESCE(p.Ded5, 0)
                ) AS OtherDeductions,
                COALESCE(p.UnionDues, 0) AS UnionDues,
                COALESCE(p.GratEmp, 0) AS GratEmp,
                COALESCE(p.Ded2, 0) AS Ded2,
                COALESCE(p.Ded3, 0) AS Ded3,
                COALESCE(p.Ded4, 0) AS Ded4,
                COALESCE(p.Ded5, 0) AS Ded5,
                ${buildDeductionSumExpression('p')} AS DeductionTotal,
                COALESCE(p.NetIncome, 0) AS NetIncome,
                COALESCE(p.FullPay, 0) AS FullPay,
                COALESCE(p.HalfPay, 0) AS HalfPay,
                COALESCE(p.WithoutPay, 0) AS WithoutPay
            FROM tblpayroll p
            LEFT JOIN tblstaff s
                ON s.PFNo = p.PFNo
            LEFT JOIN tbldept d
                ON d.Code = p.Dept
            LEFT JOIN tblgrade g
                ON g.GradeCode = p.Grade
            LEFT JOIN tbljobtitle jt
                ON jt.Code = p.JobTitle
            WHERE ${scope.companyWhereClause}
              AND p.PMonth = ?
              AND p.PYear = ?
              AND p.PType IN (${typePlaceholders})
            ORDER BY p.PFNo ASC, p.AccountNo ASC, p.PDate ASC
        `,
        queryParams
    );

    const mappedHistory = historyRows.map((row) => {
        const metadata = parseActionMetadata(row.Metadata);
        return {
            ...row,
            actorName: metadata.actorName || metadata.userName || metadata.name || '',
            actorRole: metadata.actorRole || '',
            metadata
        };
    });

    const processAction = mappedHistory.find((entry) => entry.Action === WORKFLOW_ACTIONS.PROCESS_PAYROLL);
    const submitAction = mappedHistory.find((entry) => entry.Action === WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER);
    const managerEndorseAction = mappedHistory.find((entry) => entry.Action === WORKFLOW_ACTIONS.MANAGER_ENDORSE);
    const submitToAuditorAction = mappedHistory.find((entry) => entry.Action === WORKFLOW_ACTIONS.SUBMIT_TO_AUDITOR);
    const auditorEndorseAction = mappedHistory.find((entry) => entry.Action === WORKFLOW_ACTIONS.AUDITOR_ENDORSE);
    const submitToEntityHeadAction = mappedHistory.find((entry) => entry.Action === WORKFLOW_ACTIONS.SUBMIT_TO_ENTITY_HEAD);
    const finalApproveAction = mappedHistory.find((entry) => entry.Action === WORKFLOW_ACTIONS.FINAL_APPROVE);
    const finalReturnAction = mappedHistory.find((entry) => entry.Action === WORKFLOW_ACTIONS.FINAL_RETURN);
    const finalRejectAction = mappedHistory.find((entry) => entry.Action === WORKFLOW_ACTIONS.FINAL_REJECT);
    const finalDecisionAction = finalApproveAction || finalReturnAction || finalRejectAction;
    const postToAccountsAction = mappedHistory.find((entry) => entry.Action === WORKFLOW_ACTIONS.POST_TO_ACCOUNTS);
    const [companyRows] = await executor.query(
        `
            SELECT Com_Name
            FROM tblcominfo
            WHERE (CompanyID = ? OR CompanyID IS NULL)
            LIMIT 1
        `,
        [Number(batch.CompanyID) || 1]
    );
    let postingBatch = null;
    try {
        const [postingRows] = await executor.query(
            `
                SELECT id, status, posting_date, posted_at, posted_by, total_amount, total_lines
                FROM payroll_gl_posting_batches
                WHERE company_id = ?
                  AND activity_code = ?
                  AND posting_month = ?
                  AND posting_year = ?
                ORDER BY id DESC
                LIMIT 1
            `,
            [Number(batch.CompanyID) || 1, normalizePayrollType(batch.PType), Number(batch.PMonth), Number(batch.PYear)]
        );
        postingBatch = postingRows[0] || null;
    } catch (error) {
        if (!['ER_NO_SUCH_TABLE', '42S02'].includes(error.code)) {
            throw error;
        }
    }

    return {
        batch: {
            ...batch,
            companyName: companyRows[0]?.Com_Name || `Company ${batch.CompanyID}`,
            activityName: getActivityName(batch.PType),
            processedByName: processAction?.actorName || batch.ProcessedBy || '',
            submittedToManagerByName: submitAction?.actorName || batch.SubmittedToManagerBy || '',
            processPayrollDate: processAction?.metadata?.payrollDate || null,
            managerEndorsedByName: managerEndorseAction?.actorName || batch.ManagerEndorsedBy || '',
            managerEndorsedAt: managerEndorseAction?.ActionAt || batch.ManagerEndorsedAt || null,
            submitToAuditorByName: submitToAuditorAction?.actorName || '',
            submitToAuditorAt: submitToAuditorAction?.ActionAt || null,
            auditorEndorsedByName: auditorEndorseAction?.actorName || batch.AuditorEndorsedBy || '',
            auditorEndorsedAt: auditorEndorseAction?.ActionAt || batch.AuditorEndorsedAt || null,
            submitToEntityHeadByName: submitToEntityHeadAction?.actorName || '',
            submitToEntityHeadAt: submitToEntityHeadAction?.ActionAt || null,
            finalApprovedByName: finalApproveAction?.actorName || batch.FinalApprovedBy || '',
            finalApprovedAt: finalApproveAction?.ActionAt || batch.FinalApprovedAt || null,
            finalDecisionByName: finalDecisionAction?.actorName || batch.FinalApprovedBy || '',
            finalDecisionAt: finalDecisionAction?.ActionAt || batch.FinalApprovedAt || null,
            finalDecisionAction: finalDecisionAction?.Action || '',
            postedToAccountsByName: postToAccountsAction?.actorName || batch.PostedToAccountsBy || '',
            postedToAccountsAt: postToAccountsAction?.ActionAt || batch.PostedToAccountsAt || null,
            glPostingBatchId: postingBatch?.id || null,
            glPostingStatus: postingBatch?.status || null,
            glPostingDate: postingBatch?.posting_date || null,
            glPostingPostedAt: postingBatch?.posted_at || null,
            glPostingPostedBy: postingBatch?.posted_by || null,
            companyMatchMode: scope.companyMatchMode
        },
        payrollRows,
        history: mappedHistory
    };
}

async function getPerformedActorGroupsForUser({ batchId, actor, connection }) {
    const historyRows = await getWorkflowHistory(batchId, connection);
    const groups = new Set();

    historyRows.forEach((row) => {
        if (Number(row.ActionBy || 0) !== actor.id) {
            return;
        }

        try {
            const metadata = row.Metadata ? JSON.parse(row.Metadata) : {};
            if (metadata.actorRole && metadata.actorSource && metadata.actorSource !== actor.source) {
                return;
            }

            if (metadata.actorRole && metadata.actorRole !== actor.role) {
                return;
            }
        } catch (error) {
            // Ignore metadata parse errors and fall back to actor id.
        }

        const definition = ACTION_DEFINITIONS[row.Action];
        if (definition?.actorGroup) {
            groups.add(definition.actorGroup);
        }
    });

    return groups;
}

async function assertActorSeparationOfDuties({ user, batchId, requiredActorGroup, connection = null }) {
    const actor = normalizeUser(user);
    if (!actor.id) {
        throw createError('A valid workflow actor is required.', 400);
    }

    const priorGroups = await getPerformedActorGroupsForUser({
        batchId,
        actor,
        connection
    });
    const incompatibleGroups = INCOMPATIBLE_ACTOR_GROUPS[requiredActorGroup] || [];

    for (const group of incompatibleGroups) {
        if (priorGroups.has(group)) {
            throw createError('This user has already performed an incompatible payroll workflow action on the same batch.', 409);
        }
    }

    return true;
}

function assertRoleMatchesActorGroup(user, requiredActorGroup) {
    const actorGroup = getActorGroupForRole(user.role);
    if (actorGroup !== requiredActorGroup) {
        throw createError('You are not authorized to perform this payroll workflow action.', 403);
    }

    return true;
}

async function assertUserCanProcessPayroll(user, batch = null, connection = null) {
    const normalizedUser = normalizeUser(user);
    assertRoleMatchesActorGroup(normalizedUser, ACTOR_GROUPS.FINANCE);
    if (batch) {
        await assertActorSeparationOfDuties({
            user: normalizedUser,
            batchId: batch.id,
            requiredActorGroup: ACTOR_GROUPS.FINANCE,
            connection
        });
    }
    return true;
}

async function assertUserCanSubmitToManager(user, batch = null, connection = null) {
    return assertUserCanProcessPayroll(user, batch, connection);
}

async function assertUserCanManagerEndorse(user, batch, connection = null) {
    const normalizedUser = normalizeUser(user);
    assertRoleMatchesActorGroup(normalizedUser, ACTOR_GROUPS.MANAGER);
    await assertActorSeparationOfDuties({
        user: normalizedUser,
        batchId: batch.id,
        requiredActorGroup: ACTOR_GROUPS.MANAGER,
        connection
    });
    return true;
}

async function assertUserCanAuditorEndorse(user, batch, connection = null) {
    const normalizedUser = normalizeUser(user);
    assertRoleMatchesActorGroup(normalizedUser, ACTOR_GROUPS.AUDITOR);
    await assertActorSeparationOfDuties({
        user: normalizedUser,
        batchId: batch.id,
        requiredActorGroup: ACTOR_GROUPS.AUDITOR,
        connection
    });
    return true;
}

async function assertUserCanFinalApprove(user, batch, connection = null) {
    const normalizedUser = normalizeUser(user);
    assertRoleMatchesActorGroup(normalizedUser, ACTOR_GROUPS.ENTITY_HEAD);
    await assertActorSeparationOfDuties({
        user: normalizedUser,
        batchId: batch.id,
        requiredActorGroup: ACTOR_GROUPS.ENTITY_HEAD,
        connection
    });
    return true;
}

async function assertUserCanPostToAccounts(user, batch = null, connection = null) {
    return assertUserCanProcessPayroll(user, batch, connection);
}

async function getPostingStateForCorrection(batch, connection = null) {
    const executor = getConnectionExecutor(connection);
    const normalizedPType = normalizePayrollType(batch.PType);
    const [payrollRows] = await executor.query(
        `
            SELECT
                COUNT(*) AS totalRows,
                SUM(CASE WHEN COALESCE(posted_to_gl, 0) <> 0 THEN 1 ELSE 0 END) AS postedRows
            FROM tblpayroll
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND PType = ?
        `,
        [Number(batch.CompanyID) || 1, Number(batch.PMonth), Number(batch.PYear), normalizedPType]
    );

    let glPostingBatchCount = 0;
    try {
        const [glRows] = await executor.query(
            `
                SELECT COUNT(*) AS count
                FROM payroll_gl_posting_batches
                WHERE company_id = ?
                  AND posting_month = ?
                  AND posting_year = ?
                  AND activity_code = ?
            `,
            [Number(batch.CompanyID) || 1, Number(batch.PMonth), Number(batch.PYear), normalizedPType]
        );
        glPostingBatchCount = Number(glRows[0]?.count || 0);
    } catch (error) {
        if (error?.code !== 'ER_NO_SUCH_TABLE' && error?.sqlState !== '42S02') {
            throw error;
        }
    }

    return {
        totalRows: Number(payrollRows[0]?.totalRows || 0),
        postedRows: Number(payrollRows[0]?.postedRows || 0),
        glPostingBatchCount
    };
}

async function assertPayrollCorrectionAllowed(batch, user, connection = null) {
    if (!batch) {
        throw createError('No workflow batch was found for the selected payroll period.', 404);
    }

    const normalizedUser = normalizeUser(user);
    await assertUserCanProcessPayroll(normalizedUser, batch, connection);

    const allowedStatuses = new Set([
        WORKFLOW_STATUSES.RETURNED_BY_MANAGER,
        WORKFLOW_STATUSES.RETURNED_BY_AUDITOR,
        WORKFLOW_STATUSES.FINAL_REJECTED
    ]);

    if (!allowedStatuses.has(batch.Status)) {
        if (batch.Status === WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS) {
            throw createError('This payroll has already been posted to accounts and requires a formal reversal.', 409);
        }

        if (batch.Status === WORKFLOW_STATUSES.FINAL_APPROVED) {
            throw createError('Approved or posted payroll cannot be corrected through this workflow.', 409);
        }

        if (batch.Status === WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS) {
            throw createError('This payroll correction is already in progress.', 409);
        }

        throw createError('This payroll batch is not eligible for correction.', 409);
    }

    const postingState = await getPostingStateForCorrection(batch, connection);
    if (postingState.postedRows > 0 || postingState.glPostingBatchCount > 0) {
        throw createError('This payroll has already been posted to accounts and requires a formal reversal.', 409);
    }

    return postingState;
}

async function assertUserCanPerformAction({ action, user, batch, connection = null }) {
    switch (action) {
        case WORKFLOW_ACTIONS.PROCESS_PAYROLL:
        case WORKFLOW_ACTIONS.CORRECTION_RESTART:
            return assertUserCanProcessPayroll(user, batch, connection);
        case WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER:
        case WORKFLOW_ACTIONS.POST_TO_ACCOUNTS:
        case WORKFLOW_ACTIONS.REVERSE_POSTING:
            return assertUserCanSubmitToManager(user, batch, connection);
        case WORKFLOW_ACTIONS.MANAGER_ENDORSE:
        case WORKFLOW_ACTIONS.MANAGER_RETURN:
        case WORKFLOW_ACTIONS.SUBMIT_TO_AUDITOR:
            return assertUserCanManagerEndorse(user, batch, connection);
        case WORKFLOW_ACTIONS.AUDITOR_ENDORSE:
        case WORKFLOW_ACTIONS.AUDITOR_RETURN:
        case WORKFLOW_ACTIONS.SUBMIT_TO_ENTITY_HEAD:
            return assertUserCanAuditorEndorse(user, batch, connection);
        case WORKFLOW_ACTIONS.FINAL_APPROVE:
        case WORKFLOW_ACTIONS.FINAL_RETURN:
        case WORKFLOW_ACTIONS.FINAL_REJECT:
            return assertUserCanFinalApprove(user, batch, connection);
        default:
            throw createError(`Unsupported workflow action: ${action}.`, 400);
    }
}

function shouldVerifySnapshot(currentStatus, nextStatus) {
    if (currentStatus === WORKFLOW_STATUSES.DRAFT) {
        return false;
    }

    if (nextStatus === WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS) {
        return false;
    }

    if (nextStatus === WORKFLOW_STATUSES.PROCESSED) {
        return false;
    }

    return true;
}

function buildTransitionUpdate({ action, nextStatus, actor, comments, snapshot }) {
    const values = {
        Status: nextStatus,
        UpdatedAt: 'NOW()'
    };

    if (nextStatus === WORKFLOW_STATUSES.PROCESSED) {
        values.ProcessedBy = actor.id || null;
        values.ProcessedAt = new Date();
        values.SubmittedToManagerBy = null;
        values.SubmittedToManagerAt = null;
        values.ManagerEndorsedBy = null;
        values.ManagerEndorsedAt = null;
        values.ManagerComments = null;
        values.AuditorEndorsedBy = null;
        values.AuditorEndorsedAt = null;
        values.AuditorComments = null;
        values.FinalApprovedBy = null;
        values.FinalApprovedAt = null;
        values.EntityHeadComments = null;
        values.PostedToAccountsBy = null;
        values.PostedToAccountsAt = null;
    }

    if (action === WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER) {
        values.SubmittedToManagerBy = actor.id || null;
        values.SubmittedToManagerAt = new Date();
    }

    if (action === WORKFLOW_ACTIONS.MANAGER_ENDORSE) {
        values.ManagerEndorsedBy = actor.id || null;
        values.ManagerEndorsedAt = new Date();
        values.ManagerComments = comments || null;
    }

    if (action === WORKFLOW_ACTIONS.MANAGER_RETURN) {
        values.ManagerComments = comments || null;
    }

    if (action === WORKFLOW_ACTIONS.AUDITOR_ENDORSE) {
        values.AuditorEndorsedBy = actor.id || null;
        values.AuditorEndorsedAt = new Date();
        values.AuditorComments = comments || null;
    }

    if (action === WORKFLOW_ACTIONS.AUDITOR_RETURN) {
        values.AuditorComments = comments || null;
    }

    if (action === WORKFLOW_ACTIONS.FINAL_APPROVE) {
        values.FinalApprovedBy = actor.id || null;
        values.FinalApprovedAt = new Date();
        values.EntityHeadComments = comments || null;
    }

    if (action === WORKFLOW_ACTIONS.FINAL_RETURN || action === WORKFLOW_ACTIONS.FINAL_REJECT) {
        values.EntityHeadComments = comments || null;
    }

    if (action === WORKFLOW_ACTIONS.POST_TO_ACCOUNTS) {
        values.PostedToAccountsBy = actor.id || null;
        values.PostedToAccountsAt = new Date();
    }

    if (nextStatus === WORKFLOW_STATUSES.PROCESSED && snapshot) {
        values.TotalStaff = snapshot.totalStaff;
        values.TotalBasic = snapshot.totalBasic;
        values.TotalAllowances = snapshot.totalAllowances;
        values.TotalGross = snapshot.totalGross;
        values.TotalTaxable = snapshot.totalTaxable;
        values.TotalTax = snapshot.totalTax;
        values.TotalNassitEmployee = snapshot.totalNassitEmployee;
        values.TotalNassitEmployer = snapshot.totalNassitEmployer;
        values.TotalDeductions = snapshot.totalDeductions;
        values.TotalNet = snapshot.totalNet;
        values.PayrollRowCount = snapshot.payrollRowCount;
        values.PayrollChecksum = snapshot.payrollChecksum;
    }

    return values;
}

async function persistBatchTransition(connection, batchId, updateValues) {
    const assignments = [];
    const params = [];

    Object.entries(updateValues).forEach(([field, value]) => {
        if (value === 'NOW()') {
            assignments.push(`${field} = NOW()`);
            return;
        }

        assignments.push(`${field} = ?`);
        params.push(value);
    });

    params.push(batchId);

    await connection.query(
        `
            UPDATE payroll_workflow_batches
            SET ${assignments.join(', ')}
            WHERE id = ?
        `,
        params
    );
}

async function transitionWorkflow({
    companyId,
    pMonth,
    pYear,
    pType,
    action,
    nextStatus = null,
    user,
    comments = null,
    metadata = null,
    connection = null,
    testHooks = null
}) {
    const normalizedPType = normalizePayrollType(pType);
    const definition = ACTION_DEFINITIONS[action];
    if (!definition) {
        throw createError(`Unsupported workflow action: ${action}.`, 400);
    }

    const targetStatus = nextStatus || definition.toStatus;
    if (targetStatus !== definition.toStatus) {
        throw createError(`Action ${action} must transition to ${definition.toStatus}.`, 409);
    }

    const actor = normalizeUser(user);
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }

        let batch = await getWorkflowBatch(companyId, pMonth, pYear, normalizedPType, executor);
        await assertUserCanPerformAction({ action, user: actor, batch, connection: executor });

        const currentStatus = batch ? batch.Status : WORKFLOW_STATUSES.DRAFT;
        validateTransition(currentStatus, targetStatus);

        const currentSnapshot = await calculatePayrollSnapshot(companyId, pMonth, pYear, normalizedPType, executor);

        if (!batch && targetStatus !== WORKFLOW_STATUSES.PROCESSED) {
            throw createError('Payroll workflow batch not found for the selected payroll period.', 404);
        }

        if (shouldVerifySnapshot(currentStatus, targetStatus) && batch) {
            const integrityCheck = verifyPayrollSnapshotUnchanged(batch, currentSnapshot);
            if (!integrityCheck.matches) {
                throw createError('Payroll snapshot has changed since the last workflow step. Reprocess the payroll batch before continuing.', 409);
            }
        }

        if (!batch) {
            batch = await createWorkflowBatch({
                companyId,
                pMonth,
                pYear,
                pType: normalizedPType,
                status: targetStatus,
                snapshot: currentSnapshot,
                connection: executor,
                transitionUser: actor,
                comments
            });
        } else {
            const updateValues = buildTransitionUpdate({
                action,
                nextStatus: targetStatus,
                actor,
                comments,
                snapshot: targetStatus === WORKFLOW_STATUSES.PROCESSED ? currentSnapshot : null
            });

            if (testHooks?.beforeStatusUpdate) {
                await testHooks.beforeStatusUpdate({ batch, currentSnapshot, action, targetStatus, connection: executor });
            }

            await persistBatchTransition(executor, batch.id, updateValues);

            if (testHooks?.afterStatusUpdate) {
                await testHooks.afterStatusUpdate({ batch, currentSnapshot, action, targetStatus, connection: executor });
            }
        }

        const effectiveBatch = await getWorkflowBatch(companyId, pMonth, pYear, normalizedPType, executor);
        const actionMetadata = {
            actorRole: actor.role,
            actorSource: actor.source,
            actorName: actor.name,
            actionGroup: definition.actorGroup,
            payrollChecksum: currentSnapshot.payrollChecksum,
            payrollRowCount: currentSnapshot.payrollRowCount,
            ...(metadata || {})
        };

        const historyId = await logWorkflowAction({
            workflowBatchId: effectiveBatch.id,
            companyId,
            pMonth,
            pYear,
            pType: normalizedPType,
            action,
            fromStatus: currentStatus,
            toStatus: targetStatus,
            actionBy: actor.id,
            comments,
            metadata: actionMetadata,
            connection: executor
        });

        if (testHooks?.afterActionLog) {
            await testHooks.afterActionLog({ batch: effectiveBatch, actionId: historyId, connection: executor });
        }

        await logWorkflowAudit(executor, {
            companyId,
            userName: actor.name,
            action,
            batchId: effectiveBatch.id,
            fromStatus: currentStatus,
            toStatus: targetStatus,
            comments
        });

        await workflowNotificationService.ensureNotificationTable(executor);
        await workflowNotificationService.notifyPayrollWorkflowAction({
            companyId,
            batch: effectiveBatch,
            action,
            actionId: historyId,
            actor,
            comments,
            connection: executor
        });

        if (managedConnection) {
            await executor.commit();
        }

        return {
            batch: effectiveBatch,
            snapshot: currentSnapshot,
            actionId: historyId
        };
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

async function startPayrollCorrection({
    companyId,
    batchId = null,
    pMonth = null,
    pYear = null,
    pType = null,
    user,
    comments,
    metadata = null,
    connection = null
}) {
    const actor = normalizeUser(user);
    const normalizedComments = String(comments || '').trim();
    if (!normalizedComments) {
        throw createError('Please provide a reason for starting payroll correction.', 400);
    }
    const managedConnection = !connection;
    const executor = managedConnection ? await pool.getConnection() : connection;

    try {
        if (managedConnection) {
            await executor.beginTransaction();
        }

        let batch = null;
        if (batchId) {
            batch = await getWorkflowBatchById(companyId, batchId, executor);
        } else {
            batch = await getWorkflowBatch(companyId, pMonth, pYear, pType, executor);
        }

        const postingState = await assertPayrollCorrectionAllowed(batch, actor, executor);
        const previousSnapshot = {
            totalStaff: Number(batch.TotalStaff || 0),
            totalBasic: roundMoney(batch.TotalBasic),
            totalAllowances: roundMoney(batch.TotalAllowances),
            totalGross: roundMoney(batch.TotalGross),
            totalTaxable: roundMoney(batch.TotalTaxable),
            totalTax: roundMoney(batch.TotalTax),
            totalNassitEmployee: roundMoney(batch.TotalNassitEmployee),
            totalNassitEmployer: roundMoney(batch.TotalNassitEmployer),
            totalDeductions: roundMoney(batch.TotalDeductions),
            totalNet: roundMoney(batch.TotalNet),
            payrollRowCount: Number(batch.PayrollRowCount || 0),
            payrollChecksum: batch.PayrollChecksum || null
        };

        const result = await transitionWorkflow({
            companyId,
            pMonth: batch.PMonth,
            pYear: batch.PYear,
            pType: batch.PType,
            action: WORKFLOW_ACTIONS.CORRECTION_RESTART,
            user: actor,
            comments: normalizedComments,
            metadata: {
                previousStatus: batch.Status,
                previousSnapshot,
                totalExistingPayrollRows: postingState.totalRows,
                postedPayrollRows: postingState.postedRows,
                glPostingBatchCount: postingState.glPostingBatchCount,
                ...(metadata || {})
            },
            connection: executor
        });

        if (managedConnection) {
            await executor.commit();
        }

        return result;
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

module.exports = {
    ACTION_DEFINITIONS,
    VALID_TRANSITIONS,
    WORKFLOW_ACTIONS,
    WORKFLOW_STATUSES,
    assertPayrollCorrectionAllowed,
    assertUserCanAuditorEndorse,
    assertUserCanFinalApprove,
    assertUserCanManagerEndorse,
    assertUserCanPostToAccounts,
    assertUserCanProcessPayroll,
    assertUserCanSubmitToManager,
    assertWorkflowStatus,
    calculatePayrollSnapshot,
    createWorkflowBatch,
    getWorkflowBatch,
    getWorkflowBatchById,
    getWorkflowBatchDetail,
    getWorkflowHistory,
    listWorkflowBatches,
    logWorkflowAction,
    transitionWorkflow,
    updatePayrollSnapshot,
    validateTransition,
    verifyPayrollSnapshotUnchanged,
    startPayrollCorrection
};

async function getLatestWorkflowGeneration(companyId, pMonth, pYear, pType, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `
            SELECT *
            FROM payroll_workflow_batches
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND PType = ?
            ORDER BY COALESCE(GenerationNo, 1) DESC, id DESC
            LIMIT 1
        `,
        [Number(companyId) || 1, Number(pMonth), Number(pYear), String(pType || '').trim()]
    );
    return rows[0] || null;
}

async function getWorkflowBatchByGeneration(companyId, pMonth, pYear, pType, generationNo, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `
            SELECT *
            FROM payroll_workflow_batches
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND PType = ?
              AND COALESCE(GenerationNo, 1) = ?
            ORDER BY id DESC
            LIMIT 1
        `,
        [Number(companyId) || 1, Number(pMonth), Number(pYear), String(pType || '').trim(), Number(generationNo) || 1]
    );
    return rows[0] || null;
}

async function listWorkflowBatchGenerations(companyId, pMonth, pYear, pType, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `
            SELECT *
            FROM payroll_workflow_batches
            WHERE CompanyID = ?
              AND PMonth = ?
              AND PYear = ?
              AND PType = ?
            ORDER BY COALESCE(GenerationNo, 1) DESC, id DESC
        `,
        [Number(companyId) || 1, Number(pMonth), Number(pYear), String(pType || '').trim()]
    );
    return rows;
}

const __phase15OriginalCreateOrUpdateProcessedBatch = module.exports.createOrUpdateProcessedBatch;
if (typeof __phase15OriginalCreateOrUpdateProcessedBatch === 'function') {
    module.exports.createOrUpdateProcessedBatch = async function phase15CreateOrUpdateProcessedBatch(payload = {}) {
        const connection = payload.connection || null;
        const executor = connection || pool;
        const normalizedCompanyId = Number(payload.companyId || payload.CompanyID) || 1;
        const pMonth = Number(payload.pMonth || payload.PMonth) || 0;
        const pYear = Number(payload.pYear || payload.PYear) || 0;
        const pType = String(payload.pType || payload.PType || '').trim();

        if (normalizedCompanyId && pMonth && pYear && pType) {
            const [rows] = await executor.query(
                `
                    SELECT *
                    FROM payroll_workflow_batches
                    WHERE CompanyID = ?
                      AND PMonth = ?
                      AND PYear = ?
                      AND PType = ?
                      AND Status IN (?, ?)
                    ORDER BY COALESCE(GenerationNo, 1) DESC, id DESC
                    LIMIT 1
                `,
                [
                    normalizedCompanyId,
                    pMonth,
                    pYear,
                    pType,
                    module.exports.WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS,
                    module.exports.WORKFLOW_STATUSES.DRAFT
                ]
            );

            if (rows.length) {
                const pendingBatch = rows[0];
                if (typeof module.exports.calculatePayrollSnapshot === 'function') {
                    const snapshot = await module.exports.calculatePayrollSnapshot({
                        companyId: normalizedCompanyId,
                        pMonth,
                        pYear,
                        pType,
                        connection: executor
                    });

                    await executor.query(
                        `
                            UPDATE payroll_workflow_batches
                            SET Status = ?,
                                TotalStaff = ?,
                                TotalBasic = ?,
                                TotalAllowances = ?,
                                TotalGross = ?,
                                TotalTaxable = ?,
                                TotalTax = ?,
                                TotalNassitEmployee = ?,
                                TotalNassitEmployer = ?,
                                TotalDeductions = ?,
                                TotalNet = ?,
                                PayrollRowCount = ?,
                                PayrollChecksum = ?,
                                ProcessedBy = ?,
                                ProcessedAt = NOW(),
                                UpdatedAt = NOW()
                            WHERE id = ?
                        `,
                        [
                            module.exports.WORKFLOW_STATUSES.PROCESSED,
                            Number(snapshot.totalStaff || 0),
                            Number(snapshot.totalBasic || 0),
                            Number(snapshot.totalAllowances || 0),
                            Number(snapshot.totalGross || 0),
                            Number(snapshot.totalTaxable || 0),
                            Number(snapshot.totalTax || 0),
                            Number(snapshot.totalNassitEmployee || 0),
                            Number(snapshot.totalNassitEmployer || 0),
                            Number(snapshot.totalDeductions || 0),
                            Number(snapshot.totalNet || 0),
                            Number(snapshot.rowCount || 0),
                            snapshot.checksum || null,
                            Number(payload.processedBy || payload.userId || 0) || null,
                            pendingBatch.id
                        ]
                    );

                    await executor.query(
                        `
                            INSERT INTO payroll_workflow_actions
                                (WorkflowBatchID, CompanyID, PMonth, PYear, PType, Action, FromStatus, ToStatus, ActionBy, ActionAt, Comments, Result, Metadata)
                            VALUES
                                (?, ?, ?, ?, ?, 'PROCESS_PAYROLL_REOPEN', ?, ?, ?, NOW(), ?, 'SUCCESS', ?)
                        `,
                        [
                            pendingBatch.id,
                            normalizedCompanyId,
                            pMonth,
                            pYear,
                            pType,
                            pendingBatch.Status,
                            module.exports.WORKFLOW_STATUSES.PROCESSED,
                            Number(payload.processedBy || payload.userId || 0) || null,
                            `Processed reopened payroll generation ${pendingBatch.GenerationNo || 1}.`,
                            JSON.stringify({ generationNo: pendingBatch.GenerationNo || 1, reopenRequestId: pendingBatch.ReopenRequestID || null })
                        ]
                    );

                    return await module.exports.getWorkflowBatchDetail(normalizedCompanyId, pendingBatch.id, executor);
                }
            }
        }

        return __phase15OriginalCreateOrUpdateProcessedBatch.call(this, payload);
    };
}

module.exports.getLatestWorkflowGeneration = getLatestWorkflowGeneration;
module.exports.getWorkflowBatchByGeneration = getWorkflowBatchByGeneration;
module.exports.listWorkflowBatchGenerations = listWorkflowBatchGenerations;
