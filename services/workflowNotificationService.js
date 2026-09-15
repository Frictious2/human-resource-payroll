const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const mailer = require('../config/mailer');
const authService = require('./authService');

const RECORD_MODULE_LABELS = Object.freeze({
    'salary-review': 'Salary Reviews',
    'salary-query': 'Salary Queries',
    'yearly-payment': 'Yearly Payments',
    'end-of-service': 'End of Service',
    increment: 'Increment Records',
    loan: 'Staff Loans',
    'loan-repayment': 'Loan Repayment Adjustments',
    medical: 'Medical Recoveries',
    surcharge: 'Surcharge Records',
    transfer: 'Transfers',
    promotion: 'Promotions / Demotions',
    acting: 'Acting Appointments',
    leave: 'Leave Applications',
    training: 'Training Records',
    'staff-exit': 'Staff Status Changes',
    redundancy: 'Redundancy Status Changes'
});

const PARAMETER_MODULE_LABELS = Object.freeze({
    'payroll-items': 'Payroll Items',
    departments: 'Departments',
    'job-titles': 'Job Titles',
    grades: 'Salary Grades',
    banks: 'Banks',
    'company-bban': 'Company BBAN',
    'gl-accounts': 'GL Accounts',
    'discipline-outcomes': 'Discipline Outcomes',
    'discipline-reasons': 'Discipline Reasons',
    queries: 'Query Types',
    courses: 'Course Types',
    'emp-status': 'Employee Statuses',
    'end-of-service-benefit': 'End of Service Benefit',
    'global-params': 'Global Parameters',
    'work-days': 'Work Days',
    'public-holidays': 'Public Holidays',
    sponsors: 'Training Sponsors',
    'tax-table': 'Tax Table'
});

let notificationTableReadyPromise = null;

function createError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeRole(role) {
    return authService.normalizeRole(role) || normalizeText(role).toLowerCase();
}

function normalizeUser(user = {}) {
    return {
        id: Number(user.id ?? user.pfno ?? user.PFNo ?? 0) || 0,
        role: normalizeRole(user.role || user.level),
        name: user.name || user.fullName || user.username || user.email || 'System',
        email: user.email || ''
    };
}

function buildEventKey(...parts) {
    return parts.map((part) => encodeURIComponent(normalizeText(part))).join(':');
}

function isEmailConfigured() {
    return typeof mailer.isEnabled === 'function'
        ? mailer.isEnabled()
        : Boolean(process.env.SMTP_HOST && process.env.SMTP_PASS);
}

async function ensureNotificationTable(connection = null) {
    if (!notificationTableReadyPromise) {
        notificationTableReadyPromise = (async () => {
            const migrationPath = path.join(__dirname, '..', 'database', 'migrations', '20260714-workflow-notifications.sql');
            const sql = fs.readFileSync(migrationPath, 'utf8').trim();
            if (sql) {
                await pool.query(sql);
            }
        })().catch((error) => {
            notificationTableReadyPromise = null;
            throw error;
        });
    }

    await notificationTableReadyPromise;
}

async function getUsersByRole(companyId, role, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `
            SELECT PFNo, Username, FullName, Email, Level, CompanyID
            FROM tblpassword
            WHERE (CompanyID = ? OR CompanyID IS NULL)
            ORDER BY PFNo ASC
        `,
        [Number(companyId) || 1]
    );

    return rows
        .map((row) => ({
            id: Number(row.PFNo),
            username: row.Username || '',
            name: row.FullName || row.Username || `User ${row.PFNo}`,
            email: row.Email || '',
            role: normalizeRole(row.Level),
            companyId: row.CompanyID
        }))
        .filter((row) => row.role === normalizeRole(role));
}

async function getUserById(userId, companyId, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.query(
        `
            SELECT PFNo, Username, FullName, Email, Level, CompanyID
            FROM tblpassword
            WHERE PFNo = ?
              AND (CompanyID = ? OR CompanyID IS NULL)
            LIMIT 1
        `,
        [Number(userId) || 0, Number(companyId) || 1]
    );

    if (!rows.length) {
        return null;
    }

    const row = rows[0];
    return {
        id: Number(row.PFNo),
        username: row.Username || '',
        name: row.FullName || row.Username || `User ${row.PFNo}`,
        email: row.Email || '',
        role: normalizeRole(row.Level),
        companyId: row.CompanyID
    };
}

async function createNotification(connection, {
    companyId,
    recipientUserId,
    recipientRole = null,
    notificationType,
    module,
    title,
    message,
    referenceType = null,
    referenceId = null,
    actionUrl = null,
    createdBy = null,
    expiresAt = null,
    metadata = null,
    eventKey
}) {
    if (!recipientUserId || !eventKey) {
        return null;
    }

    await connection.query(
        `
            INSERT INTO workflow_notifications (
                CompanyID, RecipientUserID, RecipientRole, NotificationType, Module,
                Title, Message, ReferenceType, ReferenceID, ActionURL, EventKey,
                IsRead, ReadAt, CreatedBy, CreatedAt, ExpiresAt, Metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NOW(), ?, ?)
            ON DUPLICATE KEY UPDATE id = id
        `,
        [
            Number(companyId) || 1,
            Number(recipientUserId),
            recipientRole || null,
            notificationType,
            module,
            title,
            message,
            referenceType || null,
            referenceId || null,
            actionUrl || null,
            eventKey,
            createdBy ? Number(createdBy) : null,
            expiresAt || null,
            metadata ? JSON.stringify(metadata) : null
        ]
    );

    const [rows] = await connection.query(
        'SELECT id FROM workflow_notifications WHERE EventKey = ? LIMIT 1',
        [eventKey]
    );
    return rows[0] || null;
}

async function sendNotificationEmail(recipient, notification) {
    if (!isEmailConfigured() || !recipient?.email) {
        return false;
    }

    try {
        const appBase = process.env.APP_BASE_URL || process.env.BASE_URL || '';
        const actionLink = notification.ActionURL
            ? (appBase ? `${appBase}${notification.ActionURL}` : notification.ActionURL)
            : (appBase || 'Log in to the HR & Payroll system to review this item.');

        await mailer.sendMail({
            to: recipient.email,
            subject: notification.Title,
            text: `${notification.Message}\n\nReview: ${actionLink}`
        });
        return true;
    } catch (error) {
        console.error('Workflow notification email failed:', error.message);
        return false;
    }
}

async function createNotifications(connection, {
    companyId,
    recipients,
    notificationType,
    module,
    title,
    message,
    referenceType,
    referenceId,
    actionUrl,
    createdBy,
    metadata,
    eventKeyBase
}) {
    const uniqueRecipients = [];
    const seen = new Set();
    for (const recipient of recipients || []) {
        const normalizedId = Number(recipient?.id || 0);
        if (!normalizedId || seen.has(normalizedId)) {
            continue;
        }
        seen.add(normalizedId);
        uniqueRecipients.push(recipient);
    }

    const created = [];
    for (const recipient of uniqueRecipients) {
        const notification = await createNotification(connection, {
            companyId,
            recipientUserId: recipient.id,
            recipientRole: recipient.role,
            notificationType,
            module,
            title,
            message,
            referenceType,
            referenceId,
            actionUrl,
            createdBy,
            metadata,
            eventKey: buildEventKey(eventKeyBase, recipient.id)
        });

        if (notification) {
            created.push(notification);
            void sendNotificationEmail(recipient, {
                Title: title,
                Message: message,
                ActionURL: actionUrl
            });
        }
    }

    return created;
}

async function resolveFinanceRecipients(companyId, batch, connection = null) {
    const recipients = [];
    const primaryUserId = Number(batch?.SubmittedToManagerBy || batch?.ProcessedBy || 0);
    if (primaryUserId) {
        const primary = await getUserById(primaryUserId, companyId, connection);
        if (primary && primary.role === 'finance-officer') {
            recipients.push(primary);
        }
    }

    if (!recipients.length) {
        recipients.push(...await getUsersByRole(companyId, 'finance-officer', connection));
    }

    return recipients;
}

async function resolveDataEntryRecipients(companyId, item, connection = null) {
    const recipients = [];
    const primaryUserId = Number(item?.SubmittedBy || 0);
    if (primaryUserId) {
        const primary = await getUserById(primaryUserId, companyId, connection);
        if (primary && primary.role === 'data-entry') {
            recipients.push(primary);
        }
    }
    return recipients;
}

async function notifyPayrollWorkflowAction({
    companyId,
    batch,
    action,
    actionId,
    actor,
    comments = '',
    connection
}) {
    const recipients = [];
    const referenceId = `${batch.PMonth}/${batch.PYear}/${batch.PType}`;
    const referenceType = 'payroll_workflow_batch';
    const actorName = actor?.name || 'System';
    let title = '';
    let message = '';
    let actionUrl = '';

    switch (action) {
        case 'SUBMIT_TO_MANAGER':
            recipients.push(...await getUsersByRole(companyId, 'manager', connection));
            title = 'Payroll awaiting Manager endorsement';
            message = `${actorName} submitted payroll ${referenceId} for Manager review.`;
            actionUrl = batch.id ? `/manager/payroll/endorsement/${batch.id}` : '/manager/payroll/endorsement';
            break;
        case 'MANAGER_RETURN':
            recipients.push(...await resolveFinanceRecipients(companyId, batch, connection));
            title = 'Payroll returned by Manager';
            message = `Payroll ${referenceId} was returned to Finance${comments ? `: ${comments}` : '.'}`;
            actionUrl = batch.id ? `/finance/payroll/workflow/${batch.id}` : '/finance/payroll/workflow';
            break;
        case 'SUBMIT_TO_AUDITOR':
            recipients.push(...await getUsersByRole(companyId, 'auditor', connection));
            title = 'Payroll awaiting Auditor review';
            message = `${actorName} forwarded payroll ${referenceId} to the Auditor.`;
            actionUrl = batch.id ? `/auditor/payroll/review/${batch.id}` : '/auditor/payroll/review';
            break;
        case 'AUDITOR_RETURN':
            recipients.push(...await resolveFinanceRecipients(companyId, batch, connection));
            title = 'Payroll returned after audit review';
            message = `Payroll ${referenceId} was returned to Finance after audit review${comments ? `: ${comments}` : '.'}`;
            actionUrl = batch.id ? `/finance/payroll/workflow/${batch.id}` : '/finance/payroll/workflow';
            break;
        case 'SUBMIT_TO_ENTITY_HEAD':
            recipients.push(...await getUsersByRole(companyId, 'entity-head', connection));
            title = 'Payroll awaiting final approval';
            message = `${actorName} forwarded payroll ${referenceId} for final Entity Head/HNO approval.`;
            actionUrl = batch.id ? `/entity-head/payroll/approvals/${batch.id}` : '/entity-head/payroll/approvals';
            break;
        case 'FINAL_APPROVE':
            recipients.push(...await resolveFinanceRecipients(companyId, batch, connection));
            recipients.push(...await getUsersByRole(companyId, 'manager', connection));
            recipients.push(...await getUsersByRole(companyId, 'auditor', connection));
            title = 'Payroll received final approval';
            message = `Payroll ${referenceId} received final Entity Head/HNO approval.`;
            actionUrl = batch.id ? `/finance/payroll/workflow/${batch.id}` : '/finance/payroll/workflow';
            break;
        case 'FINAL_RETURN':
        case 'FINAL_REJECT':
            recipients.push(...await resolveFinanceRecipients(companyId, batch, connection));
            recipients.push(...await getUsersByRole(companyId, 'manager', connection));
            recipients.push(...await getUsersByRole(companyId, 'auditor', connection));
            title = action === 'FINAL_REJECT' ? 'Payroll rejected by Entity Head/HNO' : 'Payroll returned by Entity Head/HNO';
            message = `Payroll ${referenceId} ${action === 'FINAL_REJECT' ? 'was rejected' : 'was returned'}${comments ? `: ${comments}` : '.'}`;
            actionUrl = batch.id ? `/finance/payroll/workflow/${batch.id}` : '/finance/payroll/workflow';
            break;
        case 'POST_TO_ACCOUNTS':
            recipients.push(...await resolveFinanceRecipients(companyId, batch, connection));
            title = 'Payroll posted to accounts';
            message = `Payroll ${referenceId} was posted to accounts successfully.`;
            actionUrl = batch.id ? `/finance/payroll/workflow/${batch.id}` : '/finance/payroll/workflow';
            break;
        default:
            return [];
    }

    return createNotifications(connection, {
        companyId,
        recipients,
        notificationType: action,
        module: 'payroll-workflow',
        title,
        message,
        referenceType,
        referenceId,
        actionUrl,
        createdBy: actor?.id || null,
        metadata: { batchId: batch.id, actionId, comments: comments || null },
        eventKeyBase: buildEventKey('payroll', actionId, action, batch.id)
    });
}

async function notifyPayrollReversalAction({
    companyId,
    request,
    action,
    actionId,
    actor,
    comments = '',
    connection
}) {
    const recipients = [];
    const actorName = actor?.name || 'System';
    const referenceType = 'payroll_reversal_request';
    const referenceId = String(request.id);
    const payrollReference = `${String(request.PMonth).padStart(2, '0')}/${request.PYear}/${String(request.PType || '').trim()}`;
    let title = '';
    let message = '';
    let actionUrl = '';

    switch (action) {
        case 'SUBMIT_TO_MANAGER':
            recipients.push(...await getUsersByRole(companyId, 'manager', connection));
            title = 'Payroll reversal awaiting Manager endorsement';
            message = `${actorName} submitted payroll reversal ${payrollReference} for Manager review.`;
            actionUrl = `/manager/payroll/reversals/${request.id}`;
            break;
        case 'MANAGER_RETURN':
            recipients.push(...await resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
            title = 'Payroll reversal returned by Manager';
            message = `Payroll reversal ${payrollReference} was returned by the Manager${comments ? `: ${comments}` : '.'}`;
            actionUrl = `/finance/payroll/reversals/${request.id}`;
            break;
        case 'SUBMIT_TO_AUDITOR':
            recipients.push(...await getUsersByRole(companyId, 'auditor', connection));
            title = 'Payroll reversal awaiting Auditor review';
            message = `${actorName} forwarded payroll reversal ${payrollReference} to the Auditor.`;
            actionUrl = `/auditor/payroll/reversals/${request.id}`;
            break;
        case 'AUDITOR_RETURN':
            recipients.push(...await resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
            title = 'Payroll reversal returned after audit review';
            message = `Payroll reversal ${payrollReference} was returned after audit review${comments ? `: ${comments}` : '.'}`;
            actionUrl = `/finance/payroll/reversals/${request.id}`;
            break;
        case 'SUBMIT_TO_ENTITY_HEAD':
            recipients.push(...await getUsersByRole(companyId, 'entity-head', connection));
            title = 'Payroll reversal awaiting final approval';
            message = `${actorName} forwarded payroll reversal ${payrollReference} for final approval.`;
            actionUrl = `/entity-head/payroll/reversals/${request.id}`;
            break;
        case 'READY_TO_EXECUTE':
            recipients.push(...await resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
            title = 'Payroll reversal approved and ready to execute';
            message = `Payroll reversal ${payrollReference} received final approval and is ready for execution.`;
            actionUrl = `/finance/payroll/reversals/${request.id}`;
            break;
        case 'FINAL_RETURN':
        case 'FINAL_REJECT':
            recipients.push(...await resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
            recipients.push(...await getUsersByRole(companyId, 'manager', connection));
            recipients.push(...await getUsersByRole(companyId, 'auditor', connection));
            title = action === 'FINAL_REJECT' ? 'Payroll reversal rejected' : 'Payroll reversal returned';
            message = `Payroll reversal ${payrollReference} ${action === 'FINAL_REJECT' ? 'was rejected' : 'was returned'}${comments ? `: ${comments}` : '.'}`;
            actionUrl = `/finance/payroll/reversals/${request.id}`;
            break;
        case 'EXECUTE_REVERSAL':
            recipients.push(...await resolveFinanceRecipients(companyId, { SubmittedToManagerBy: request.RequestedBy }, connection));
            recipients.push(...await getUsersByRole(companyId, 'manager', connection));
            recipients.push(...await getUsersByRole(companyId, 'auditor', connection));
            recipients.push(...await getUsersByRole(companyId, 'entity-head', connection));
            title = 'Payroll reversal completed';
            message = `Payroll reversal ${payrollReference} was executed successfully.`;
            actionUrl = `/finance/payroll/reversals/${request.id}`;
            break;
        default:
            return [];
    }

    return createNotifications(connection, {
        companyId,
        recipients,
        notificationType: action,
        module: 'payroll-reversal',
        title,
        message,
        referenceType,
        referenceId,
        actionUrl,
        createdBy: actor?.id || null,
        metadata: {
            requestId: request.id,
            workflowBatchId: request.WorkflowBatchID,
            glPostingBatchId: request.GLPostingBatchID,
            status: request.Status,
            comments: comments || null
        },
        eventKeyBase: buildEventKey('payroll-reversal', actionId, action, request.id)
    });
}

async function notifyRecordWorkflowAction({
    companyId,
    item,
    action,
    actionId,
    actor,
    comments = '',
    connection
}) {
    const recipients = [];
    const referenceType = 'record_workflow_item';
    const referenceId = item.RecordReference;
    const actorName = actor?.name || 'System';
    let title = '';
    let message = '';
    let actionUrl = '';
    const moduleLabel = item.moduleLabel || RECORD_MODULE_LABELS[item.Module] || item.Module;

    switch (action) {
        case 'SUBMIT_TO_MANAGER':
            recipients.push(...await getUsersByRole(companyId, 'manager', connection));
            title = `${moduleLabel} awaiting Manager endorsement`;
            message = `${actorName} submitted a ${moduleLabel.toLowerCase()} record for Manager review.`;
            actionUrl = item.id ? `/manager/record-workflow/${item.id}` : '/manager/record-workflow';
            break;
        case 'SUBMIT_TO_ENTITY_HEAD':
            recipients.push(...await getUsersByRole(companyId, 'entity-head', connection));
            title = `${moduleLabel} awaiting final approval`;
            message = `${actorName} forwarded a ${moduleLabel.toLowerCase()} record for final Entity Head/HNO approval.`;
            actionUrl = `/entity-head/record-workflow/${item.id}`;
            break;
        case 'MANAGER_RETURN':
            recipients.push(...await resolveDataEntryRecipients(companyId, item, connection));
            title = `${moduleLabel} returned by Manager`;
            message = `A ${moduleLabel.toLowerCase()} record was returned to Data Entry${comments ? `: ${comments}` : '.'}`;
            actionUrl = '/data-entry/workflow/records';
            break;
        case 'ENTITY_HEAD_APPROVE':
            recipients.push(...await resolveDataEntryRecipients(companyId, item, connection));
            recipients.push(...await getUsersByRole(companyId, 'manager', connection));
            title = `${moduleLabel} finally approved`;
            message = `A ${moduleLabel.toLowerCase()} record received final Entity Head/HNO approval.`;
            actionUrl = '/data-entry/workflow/records';
            break;
        case 'ENTITY_HEAD_RETURN':
        case 'ENTITY_HEAD_REJECT':
            recipients.push(...await resolveDataEntryRecipients(companyId, item, connection));
            recipients.push(...await getUsersByRole(companyId, 'manager', connection));
            title = action === 'ENTITY_HEAD_REJECT' ? `${moduleLabel} rejected` : `${moduleLabel} returned for correction`;
            message = `A ${moduleLabel.toLowerCase()} record ${action === 'ENTITY_HEAD_REJECT' ? 'was rejected' : 'was returned'}${comments ? `: ${comments}` : '.'}`;
            actionUrl = '/data-entry/workflow/records';
            break;
        default:
            return [];
    }

    return createNotifications(connection, {
        companyId,
        recipients,
        notificationType: action,
        module: item.Module,
        title,
        message,
        referenceType,
        referenceId,
        actionUrl,
        createdBy: actor?.id || null,
        metadata: { workflowItemId: item.id, actionId, comments: comments || null },
        eventKeyBase: buildEventKey('record', actionId, action, item.id)
    });
}

async function resolveAdminRecipients(companyId, request, connection = null) {
    const recipients = [];
    const primaryUserId = Number(request?.SubmittedBy || 0);
    if (primaryUserId) {
        const primary = await getUserById(primaryUserId, companyId, connection);
        if (primary && primary.role === 'admin') {
            recipients.push(primary);
        }
    }

    if (!recipients.length) {
        recipients.push(...await getUsersByRole(companyId, 'admin', connection));
    }

    return recipients;
}

async function notifyParameterChangeAction({
    companyId,
    request,
    action,
    actionId,
    actor,
    comments = '',
    connection
}) {
    const recipients = [];
    const referenceType = 'parameter_change_request';
    const referenceId = String(request.id || request.RecordReference || '');
    const actorName = actor?.name || 'System';
    const moduleLabel = request.moduleLabel || PARAMETER_MODULE_LABELS[request.ParameterModule] || request.ParameterModule;
    let title = '';
    let message = '';
    let actionUrl = '';

    switch (action) {
        case 'SUBMIT':
            recipients.push(...await getUsersByRole(companyId, 'entity-head', connection));
            title = `${moduleLabel} change awaiting approval`;
            message = `${actorName} submitted a ${moduleLabel.toLowerCase()} change proposal for final approval.`;
            actionUrl = request.id ? `/entity-head/parameter-changes/${request.id}` : '/entity-head/parameter-changes';
            break;
        case 'RETURN':
            recipients.push(...await resolveAdminRecipients(companyId, request, connection));
            title = `${moduleLabel} change returned`;
            message = `${moduleLabel} change proposal was returned by the Entity Head/HNO${comments ? `: ${comments}` : '.'}`;
            actionUrl = request.id ? `/admin/parameter-changes/${request.id}` : '/admin/parameter-changes';
            break;
        case 'REJECT':
            recipients.push(...await resolveAdminRecipients(companyId, request, connection));
            title = `${moduleLabel} change rejected`;
            message = `${moduleLabel} change proposal was rejected by the Entity Head/HNO${comments ? `: ${comments}` : '.'}`;
            actionUrl = request.id ? `/admin/parameter-changes/${request.id}` : '/admin/parameter-changes';
            break;
        case 'APPLY':
            recipients.push(...await resolveAdminRecipients(companyId, request, connection));
            title = `${moduleLabel} change approved and applied`;
            message = `${moduleLabel} change proposal received final approval and the live parameter was updated.`;
            actionUrl = request.id ? `/admin/parameter-changes/${request.id}` : '/admin/parameter-changes';
            break;
        default:
            return [];
    }

    return createNotifications(connection, {
        companyId,
        recipients,
        notificationType: action,
        module: 'parameter-change',
        title,
        message,
        referenceType,
        referenceId,
        actionUrl,
        createdBy: actor?.id || null,
        metadata: { requestId: request.id, actionId, parameterModule: request.ParameterModule },
        eventKeyBase: buildEventKey('parameter-change', actionId, action, request.id)
    });
}

async function getUnreadCount(userId, companyId) {
    await ensureNotificationTable();
    const [rows] = await pool.query(
        `
            SELECT COUNT(*) AS total
            FROM workflow_notifications
            WHERE RecipientUserID = ?
              AND CompanyID = ?
              AND IsRead = 0
        `,
        [Number(userId) || 0, Number(companyId) || 1]
    );
    return Number(rows[0]?.total || 0);
}

async function getRecentNotifications(userId, companyId, limit = 8) {
    await ensureNotificationTable();
    const [rows] = await pool.query(
        `
            SELECT *
            FROM workflow_notifications
            WHERE RecipientUserID = ?
              AND CompanyID = ?
            ORDER BY CreatedAt DESC, id DESC
            LIMIT ?
        `,
        [Number(userId) || 0, Number(companyId) || 1, Number(limit) || 8]
    );
    return rows;
}

async function getNotifications(userId, companyId, filters = {}) {
    await ensureNotificationTable();
    const conditions = ['RecipientUserID = ?', 'CompanyID = ?'];
    const params = [Number(userId) || 0, Number(companyId) || 1];
    const page = Math.max(Number(filters.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(filters.pageSize) || 20, 1), 100);
    const offset = (page - 1) * pageSize;

    if (filters.status === 'unread') {
        conditions.push('IsRead = 0');
    } else if (filters.status === 'read') {
        conditions.push('IsRead = 1');
    }

    if (filters.module) {
        conditions.push('Module = ?');
        params.push(normalizeText(filters.module));
    }

    if (filters.notificationType) {
        conditions.push('NotificationType = ?');
        params.push(normalizeText(filters.notificationType));
    }

    if (filters.dateFrom) {
        conditions.push('DATE(CreatedAt) >= ?');
        params.push(filters.dateFrom);
    }

    if (filters.dateTo) {
        conditions.push('DATE(CreatedAt) <= ?');
        params.push(filters.dateTo);
    }

    const whereClause = conditions.join(' AND ');
    const [countRows] = await pool.query(
        `SELECT COUNT(*) AS total FROM workflow_notifications WHERE ${whereClause}`,
        params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await pool.query(
        `
            SELECT *
            FROM workflow_notifications
            WHERE ${whereClause}
            ORDER BY CreatedAt DESC, id DESC
            LIMIT ? OFFSET ?
        `,
        [...params, pageSize, offset]
    );

    return {
        rows,
        pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.max(Math.ceil(total / pageSize), 1)
        }
    };
}

async function markAsRead(notificationId, userId, companyId) {
    await ensureNotificationTable();
    const [result] = await pool.query(
        `
            UPDATE workflow_notifications
            SET IsRead = 1,
                ReadAt = COALESCE(ReadAt, NOW())
            WHERE id = ?
              AND RecipientUserID = ?
              AND CompanyID = ?
        `,
        [Number(notificationId) || 0, Number(userId) || 0, Number(companyId) || 1]
    );
    return Number(result.affectedRows || 0) > 0;
}

async function markAllAsRead(userId, companyId) {
    await ensureNotificationTable();
    await pool.query(
        `
            UPDATE workflow_notifications
            SET IsRead = 1,
                ReadAt = COALESCE(ReadAt, NOW())
            WHERE RecipientUserID = ?
              AND CompanyID = ?
              AND IsRead = 0
        `,
        [Number(userId) || 0, Number(companyId) || 1]
    );
}

async function getNotificationById(notificationId, userId, companyId) {
    await ensureNotificationTable();
    const [rows] = await pool.query(
        `
            SELECT *
            FROM workflow_notifications
            WHERE id = ?
              AND RecipientUserID = ?
              AND CompanyID = ?
            LIMIT 1
        `,
        [Number(notificationId) || 0, Number(userId) || 0, Number(companyId) || 1]
    );
    return rows[0] || null;
}

async function getNotificationSummary(user, companyId) {
    const actor = normalizeUser(user);
    if (!actor.id) {
        return { unreadCount: 0, recent: [] };
    }

    const [unreadCount, recent] = await Promise.all([
        getUnreadCount(actor.id, companyId),
        getRecentNotifications(actor.id, companyId, 8)
    ]);

    return { unreadCount, recent };
}

module.exports = {
    buildEventKey,
    createNotification,
    createNotifications,
    ensureNotificationTable,
    getNotificationById,
    getNotificationSummary,
    getNotifications,
    getRecentNotifications,
    getUnreadCount,
    getUserById,
    getUsersByRole,
    isEmailConfigured,
    markAllAsRead,
    markAsRead,
    notifyPayrollWorkflowAction,
    notifyPayrollReversalAction,
    notifyParameterChangeAction,
    notifyRecordWorkflowAction,
    normalizeUser,
    resolveAdminRecipients,
    resolveDataEntryRecipients,
    resolveFinanceRecipients
};
