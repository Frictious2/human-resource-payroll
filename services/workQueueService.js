const pool = require('../config/db');
const payrollWorkflowService = require('./payrollWorkflowService');
const payrollReversalService = require('./payrollReversalService');
const payrollReopenService = require('./payrollReopenService');
const yearlyPaymentService = require('./yearlyPaymentService');
const recordWorkflowService = require('./recordWorkflowService');
const parameterChangeService = require('./parameterChangeService');

function normalizeRole(role) {
    return String(role || '').trim().toLowerCase();
}

function getWorkspacePaths(role) {
    switch (normalizeRole(role)) {
        case 'finance-officer':
            return {
                payroll: '/finance/payroll/workflow',
                reversal: '/finance/payroll/reversals',
                reopen: '/finance/payroll/reopen',
                yearly: '/finance/payroll/yearly-payments',
                record: '/data-entry/workflow/records'
            };
        case 'manager':
            return {
                payroll: '/manager/payroll/endorsement',
                reversal: '/manager/payroll/reversals',
                reopen: '/manager/payroll/reopen',
                yearly: '/manager/yearly-payments',
                record: '/manager/record-workflow'
            };
        case 'auditor':
            return {
                payroll: '/auditor/payroll/review',
                reversal: '/auditor/payroll/reversals',
                reopen: '/auditor/payroll/reopen',
                yearly: '/auditor/yearly-payments'
            };
        case 'entity-head':
            return {
                payroll: '/entity-head/payroll/approvals',
                reversal: '/entity-head/payroll/reversals',
                reopen: '/entity-head/payroll/reopen',
                yearly: '/entity-head/yearly-payments',
                record: '/entity-head/record-workflow'
            };
        case 'data-entry':
            return {
                record: '/data-entry/workflow/records'
            };
        default:
            return {};
    }
}

function getPriorityLabel(daysOpen) {
    if (daysOpen >= 14) return 'High';
    if (daysOpen >= 7) return 'Medium';
    return 'Normal';
}

function getActionableRecordStatuses(role) {
    switch (normalizeRole(role)) {
        case 'manager':
            return [recordWorkflowService.RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER];
        case 'entity-head':
            return [recordWorkflowService.RECORD_WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD];
        case 'data-entry':
            return [
                recordWorkflowService.RECORD_WORKFLOW_STATUSES.DRAFT,
                recordWorkflowService.RECORD_WORKFLOW_STATUSES.RETURNED_BY_MANAGER,
                recordWorkflowService.RECORD_WORKFLOW_STATUSES.RETURNED_BY_ENTITY_HEAD,
                recordWorkflowService.RECORD_WORKFLOW_STATUSES.FINAL_REJECTED
            ];
        default:
            return [];
    }
}

function getActionableParameterStatuses(role) {
    switch (normalizeRole(role)) {
        case 'admin':
            return [
                parameterChangeService.PARAMETER_CHANGE_STATUSES.DRAFT,
                parameterChangeService.PARAMETER_CHANGE_STATUSES.RETURNED_BY_ENTITY_HEAD,
                parameterChangeService.PARAMETER_CHANGE_STATUSES.APPLY_FAILED
            ];
        case 'entity-head':
            return [parameterChangeService.PARAMETER_CHANGE_STATUSES.SUBMITTED_TO_ENTITY_HEAD];
        default:
            return [];
    }
}

function getActionableYearlyStatuses(role) {
    switch (normalizeRole(role)) {
        case 'finance-officer':
            return [
                yearlyPaymentService.YEARLY_PAYMENT_STATUSES.DRAFT,
                yearlyPaymentService.YEARLY_PAYMENT_STATUSES.CALCULATED,
                yearlyPaymentService.YEARLY_PAYMENT_STATUSES.RETURNED_BY_MANAGER,
                yearlyPaymentService.YEARLY_PAYMENT_STATUSES.RETURNED_BY_AUDITOR
            ];
        case 'manager':
            return [yearlyPaymentService.YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_MANAGER];
        case 'auditor':
            return [yearlyPaymentService.YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_AUDITOR];
        case 'entity-head':
            return [yearlyPaymentService.YEARLY_PAYMENT_STATUSES.SUBMITTED_TO_ENTITY_HEAD];
        default:
            return [];
    }
}

function getActionablePayrollStatuses(role) {
    switch (normalizeRole(role)) {
        case 'finance-officer':
            return [
                payrollWorkflowService.WORKFLOW_STATUSES.PROCESSED,
                payrollWorkflowService.WORKFLOW_STATUSES.RETURNED_BY_MANAGER,
                payrollWorkflowService.WORKFLOW_STATUSES.RETURNED_BY_AUDITOR,
                payrollWorkflowService.WORKFLOW_STATUSES.FINAL_REJECTED,
                payrollWorkflowService.WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS,
                payrollWorkflowService.WORKFLOW_STATUSES.FINAL_APPROVED
            ];
        case 'manager':
            return [payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_MANAGER];
        case 'auditor':
            return [payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_AUDITOR];
        case 'entity-head':
            return [payrollWorkflowService.WORKFLOW_STATUSES.SUBMITTED_TO_ENTITY_HEAD];
        default:
            return [];
    }
}

function getActionableReversalStatuses(role) {
    switch (normalizeRole(role)) {
        case 'finance-officer':
            return [
                payrollReversalService.REVERSAL_STATUSES.REQUESTED,
                payrollReversalService.REVERSAL_STATUSES.RETURNED_BY_MANAGER,
                payrollReversalService.REVERSAL_STATUSES.RETURNED_BY_AUDITOR,
                payrollReversalService.REVERSAL_STATUSES.READY_TO_EXECUTE
            ];
        case 'manager':
            return [payrollReversalService.REVERSAL_STATUSES.SUBMITTED_TO_MANAGER];
        case 'auditor':
            return [payrollReversalService.REVERSAL_STATUSES.SUBMITTED_TO_AUDITOR];
        case 'entity-head':
            return [payrollReversalService.REVERSAL_STATUSES.SUBMITTED_TO_ENTITY_HEAD];
        default:
            return [];
    }
}

function getActionableReopenStatuses(role) {
    switch (normalizeRole(role)) {
        case 'finance-officer':
            return [
                payrollReopenService.REOPEN_STATUSES.REQUESTED,
                payrollReopenService.REOPEN_STATUSES.RETURNED_BY_MANAGER,
                payrollReopenService.REOPEN_STATUSES.RETURNED_BY_AUDITOR,
                payrollReopenService.REOPEN_STATUSES.READY_TO_REOPEN
            ];
        case 'manager':
            return [payrollReopenService.REOPEN_STATUSES.SUBMITTED_TO_MANAGER];
        case 'auditor':
            return [payrollReopenService.REOPEN_STATUSES.SUBMITTED_TO_AUDITOR];
        case 'entity-head':
            return [payrollReopenService.REOPEN_STATUSES.SUBMITTED_TO_ENTITY_HEAD];
        default:
            return [];
    }
}

async function getPayrollQueueRows(companyId, role) {
    const statuses = getActionablePayrollStatuses(role);
    if (!statuses.length) {
        return [];
    }

    const placeholders = statuses.map(() => '?').join(', ');
    const [rows] = await pool.query(
        `
            SELECT id, PMonth, PYear, PType, Status, TotalStaff, UpdatedAt,
                   ProcessedAt, SubmittedToManagerAt, ManagerEndorsedAt,
                   AuditorEndorsedAt, FinalApprovedAt, PostedToAccountsAt
            FROM payroll_workflow_batches
            WHERE CompanyID = ?
              AND Status IN (${placeholders})
            ORDER BY UpdatedAt DESC, id DESC
        `,
        [Number(companyId) || 1, ...statuses]
    );

    const basePaths = getWorkspacePaths(role);
    return rows.map((row) => {
        const receivedAt = row.UpdatedAt || row.ProcessedAt || row.SubmittedToManagerAt || row.ManagerEndorsedAt || row.AuditorEndorsedAt || row.FinalApprovedAt;
        const daysOpen = receivedAt ? Math.max(Math.floor((Date.now() - new Date(receivedAt).getTime()) / 86400000), 0) : 0;
        return {
            type: 'payroll',
            module: 'Payroll Workflow',
            reference: `${String(row.PMonth).padStart(2, '0')}/${row.PYear}/${row.PType}`,
            description: `${row.Status.replaceAll('_', ' ')} payroll batch`,
            actionRequired: row.Status === payrollWorkflowService.WORKFLOW_STATUSES.FINAL_APPROVED ? 'Post to Accounts' : 'Workflow Action',
            submittedBy: '',
            receivedAt,
            status: row.Status,
            priority: getPriorityLabel(daysOpen),
            ageDays: daysOpen,
            actionUrl: `${basePaths.payroll}/${row.id}`
        };
    });
}

async function getReversalQueueRows(companyId, role) {
    const statuses = getActionableReversalStatuses(role);
    if (!statuses.length) {
        return [];
    }

    await payrollReversalService.ensureReversalTables();

    const placeholders = statuses.map(() => '?').join(', ');
    const [rows] = await pool.query(
        `
            SELECT id, PMonth, PYear, PType, Status, RequestedAt, UpdatedAt
            FROM payroll_reversal_requests
            WHERE CompanyID = ?
              AND Status IN (${placeholders})
            ORDER BY UpdatedAt DESC, id DESC
        `,
        [Number(companyId) || 1, ...statuses]
    );

    const basePaths = getWorkspacePaths(role);
    return rows.map((row) => {
        const receivedAt = row.UpdatedAt || row.RequestedAt;
        const daysOpen = receivedAt ? Math.max(Math.floor((Date.now() - new Date(receivedAt).getTime()) / 86400000), 0) : 0;
        return {
            type: 'reversal',
            module: 'Payroll Reversal',
            reference: `${String(row.PMonth).padStart(2, '0')}/${row.PYear}/${row.PType}`,
            description: `${row.Status.replaceAll('_', ' ')} payroll reversal request`,
            actionRequired: row.Status === payrollReversalService.REVERSAL_STATUSES.READY_TO_EXECUTE ? 'Execute Reversal' : 'Workflow Action',
            submittedBy: '',
            receivedAt,
            status: row.Status,
            priority: getPriorityLabel(daysOpen),
            ageDays: daysOpen,
            actionUrl: `${basePaths.reversal}/${row.id}`
        };
    });
}

async function getReopenQueueRows(companyId, role) {
    const statuses = getActionableReopenStatuses(role);
    if (!statuses.length) {
        return [];
    }

    await payrollReopenService.ensureReopenTables();

    const placeholders = statuses.map(() => '?').join(', ');
    const [rows] = await pool.query(
        `
            SELECT id, PMonth, PYear, PType, OriginalGenerationNo, ProposedGenerationNo, Status, RequestedAt, UpdatedAt
            FROM payroll_reopen_requests
            WHERE CompanyID = ?
              AND Status IN (${placeholders})
            ORDER BY UpdatedAt DESC, id DESC
        `,
        [Number(companyId) || 1, ...statuses]
    );

    const basePaths = getWorkspacePaths(role);
    return rows.map((row) => {
        const receivedAt = row.UpdatedAt || row.RequestedAt;
        const daysOpen = receivedAt ? Math.max(Math.floor((Date.now() - new Date(receivedAt).getTime()) / 86400000), 0) : 0;
        return {
            type: 'reopen',
            module: 'Payroll Reopen',
            reference: `${String(row.PMonth).padStart(2, '0')}/${row.PYear}/${row.PType} · Gen ${row.OriginalGenerationNo} → ${row.ProposedGenerationNo}`,
            description: `${row.Status.replaceAll('_', ' ')} payroll reopen request`,
            actionRequired: row.Status === payrollReopenService.REOPEN_STATUSES.READY_TO_REOPEN ? 'Start Reprocessing' : 'Workflow Action',
            submittedBy: '',
            receivedAt,
            status: row.Status,
            priority: getPriorityLabel(daysOpen),
            ageDays: daysOpen,
            actionUrl: `${basePaths.reopen}/${row.id}`
        };
    });
}

async function getYearlyQueueRows(companyId, role) {
    const statuses = getActionableYearlyStatuses(role);
    if (!statuses.length) {
        return [];
    }

    await yearlyPaymentService.ensureYearlyPaymentTables();

    const placeholders = statuses.map(() => '?').join(', ');
    const [rows] = await pool.query(
        `
            SELECT id, PaymentYear, PaymentType, Status, TotalStaff, TotalAmount, PreparedBy, UpdatedAt
            FROM yearly_payment_batches
            WHERE CompanyID = ?
              AND Status IN (${placeholders})
            ORDER BY UpdatedAt DESC, id DESC
        `,
        [Number(companyId) || 1, ...statuses]
    );

    const basePaths = getWorkspacePaths(role);
    return rows.map((row) => ({
        type: 'yearly-payment',
        module: 'Yearly Payments',
        reference: `${row.PaymentYear}/${row.PaymentType}`,
        description: `${row.Status.replaceAll('_', ' ')} yearly payment batch`,
        actionRequired: 'Workflow Action',
        submittedBy: row.PreparedBy || '',
        receivedAt: row.UpdatedAt,
        status: row.Status,
        priority: getPriorityLabel(0),
        ageDays: 0,
        actionUrl: `${basePaths.yearly}/${row.id}`
    }));
}

async function getRecordQueueRows(companyId, role, userId = null) {
    const statuses = getActionableRecordStatuses(role);
    if (!statuses.length) {
        return [];
    }

    const conditions = ['CompanyID = ?'];
    const params = [Number(companyId) || 1];
    const placeholders = statuses.map(() => '?').join(', ');
    conditions.push(`Status IN (${placeholders})`);
    params.push(...statuses);

    if (normalizeRole(role) === 'data-entry' && userId) {
        conditions.push('(SubmittedBy = ? OR (SubmittedBy IS NULL AND Status = ?))');
        params.push(Number(userId), recordWorkflowService.RECORD_WORKFLOW_STATUSES.DRAFT);
    }

    const [rows] = await pool.query(
        `
            SELECT id, Module, RecordReference, Status, SubmittedAt, UpdatedAt, SubmittedBy
            FROM record_workflow_items
            WHERE ${conditions.join(' AND ')}
            ORDER BY UpdatedAt DESC, id DESC
        `,
        params
    );

    const basePaths = getWorkspacePaths(role);
    return rows.map((row) => {
        const receivedAt = row.UpdatedAt || row.SubmittedAt;
        const daysOpen = receivedAt ? Math.max(Math.floor((Date.now() - new Date(receivedAt).getTime()) / 86400000), 0) : 0;
        const moduleLabel = recordWorkflowService.MODULE_CONFIG[row.Module]?.label || row.Module;
        const actionUrl = normalizeRole(role) === 'manager'
            ? `${basePaths.record}/${row.id}`
            : normalizeRole(role) === 'entity-head'
                ? `${basePaths.record}/${row.id}`
                : `${basePaths.record}?module=${encodeURIComponent(row.Module)}`;

        return {
            type: 'record',
            module: moduleLabel,
            reference: row.RecordReference,
            description: `${moduleLabel} record`,
            actionRequired: row.Status === recordWorkflowService.RECORD_WORKFLOW_STATUSES.DRAFT ? 'Submit to Manager' : 'Workflow Action',
            submittedBy: row.SubmittedBy || '',
            receivedAt,
            status: row.Status,
            priority: getPriorityLabel(daysOpen),
            ageDays: daysOpen,
            actionUrl
        };
    });
}

async function getParameterQueueRows(companyId, role, userId = null) {
    const statuses = getActionableParameterStatuses(role);
    if (!statuses.length) {
        return [];
    }

    await parameterChangeService.ensureParameterChangeTables();

    const conditions = ['CompanyID = ?'];
    const params = [Number(companyId) || 1];
    conditions.push(`Status IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);

    if (normalizeRole(role) === 'admin' && userId) {
        conditions.push('SubmittedBy = ?');
        params.push(Number(userId) || 0);
    }

    const [rows] = await pool.query(
        `SELECT id, ParameterModule, RecordReference, ChangeType, Status, SubmittedAt, UpdatedAt, SubmittedBy
         FROM parameter_change_requests
         WHERE ${conditions.join(' AND ')}
         ORDER BY UpdatedAt DESC, id DESC`,
        params
    );

    return rows.map((row) => {
        const receivedAt = row.UpdatedAt || row.SubmittedAt;
        const daysOpen = receivedAt ? Math.max(Math.floor((Date.now() - new Date(receivedAt).getTime()) / 86400000), 0) : 0;
        const config = parameterChangeService.PARAMETER_MODULE_CONFIG[row.ParameterModule];
        const moduleLabel = config?.label || row.ParameterModule;
        const actionUrl = normalizeRole(role) === 'entity-head'
            ? `/entity-head/parameter-changes/${row.id}`
            : `/admin/parameter-changes/${row.id}`;

        return {
            type: 'parameter',
            module: `${moduleLabel} Change`,
            reference: row.RecordReference,
            description: `${row.ChangeType} proposal for ${moduleLabel}`,
            actionRequired: normalizeRole(role) === 'entity-head' ? 'Final Approval' : 'Submit or revise proposal',
            submittedBy: row.SubmittedBy || '',
            receivedAt,
            status: row.Status,
            priority: getPriorityLabel(daysOpen),
            ageDays: daysOpen,
            actionUrl
        };
    });
}

async function getRoleWorkQueue({ companyId, user, filters = {} }) {
    const role = normalizeRole(user?.role);
    const userId = Number(user?.id || 0) || null;
    const moduleFilter = String(filters.module || '').trim().toLowerCase();
    const statusFilter = String(filters.status || '').trim();

    const [payrollRows, recordRows, reversalRows, reopenRows, yearlyRows] = await Promise.all([
        getPayrollQueueRows(companyId, role),
        getRecordQueueRows(companyId, role, userId),
        getReversalQueueRows(companyId, role),
        getReopenQueueRows(companyId, role),
        getYearlyQueueRows(companyId, role)
    ]);

    const parameterRows = await getParameterQueueRows(companyId, role, userId);

    let rows = [...payrollRows, ...recordRows, ...reversalRows, ...reopenRows, ...yearlyRows, ...parameterRows];
    if (moduleFilter) {
        rows = rows.filter((row) => row.module.toLowerCase().includes(moduleFilter));
    }
    if (statusFilter) {
        rows = rows.filter((row) => row.status === statusFilter);
    }

    rows.sort((a, b) => {
        const aTime = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
        const bTime = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
        return bTime - aTime;
    });

    const summary = rows.reduce((acc, row) => {
        acc.totalActionable += 1;
        acc.byStatus[row.status] = (acc.byStatus[row.status] || 0) + 1;
        if (row.type === 'payroll') acc.payroll += 1;
        if (row.type === 'reversal') acc.reversals += 1;
        if (row.type === 'reopen') acc.reopens = (acc.reopens || 0) + 1;
        if (row.type === 'yearly-payment') acc.yearlyPayments = (acc.yearlyPayments || 0) + 1;
        if (row.type === 'record') acc.records += 1;
        if (row.type === 'parameter') acc.parameters = (acc.parameters || 0) + 1;
        return acc;
    }, { totalActionable: 0, payroll: 0, reversals: 0, reopens: 0, yearlyPayments: 0, records: 0, parameters: 0, byStatus: {} });

    return { rows, summary };
}

module.exports = {
    getRoleWorkQueue
};
