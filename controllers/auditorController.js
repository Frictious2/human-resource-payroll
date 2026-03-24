const pool = require('../config/db');

const AUDITOR_SCOPE_CLAUSE = `
    (
        UserName IS NULL OR UserName NOT IN (SELECT username FROM developer)
    )
    AND (
        FormName IS NULL
        OR (
            FormName NOT LIKE 'developer/%'
            AND FormName NOT LIKE '/developer/%'
        )
    )
`;

function buildAuditFilters(query) {
    const filters = [AUDITOR_SCOPE_CLAUSE];
    const params = [];

    if (query.userName) {
        filters.push('UserName = ?');
        params.push(query.userName);
    }

    if (query.action) {
        filters.push('Action = ?');
        params.push(query.action);
    }

    if (query.formName) {
        filters.push('FormName = ?');
        params.push(query.formName);
    }

    if (query.dateFrom) {
        filters.push('DATE(ChangeDate) >= ?');
        params.push(query.dateFrom);
    }

    if (query.dateTo) {
        filters.push('DATE(ChangeDate) <= ?');
        params.push(query.dateTo);
    }

    return {
        params,
        whereClause: filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    };
}

const auditorController = {
    renderDashboard: async (req, res) => {
        try {
            const [
                totalRows,
                todayRows,
                activeUserRows,
                actionRows,
                recentRows
            ] = await Promise.all([
                pool.query(`SELECT COUNT(*) AS totalCount FROM tblaudittrail WHERE ${AUDITOR_SCOPE_CLAUSE}`),
                pool.query(`SELECT COUNT(*) AS todayCount FROM tblaudittrail WHERE ${AUDITOR_SCOPE_CLAUSE} AND DATE(ChangeDate) = CURDATE()`),
                pool.query(`SELECT COUNT(DISTINCT UserName) AS activeUsers FROM tblaudittrail WHERE ${AUDITOR_SCOPE_CLAUSE} AND DATE(ChangeDate) = CURDATE() AND UserName IS NOT NULL`),
                pool.query(`
                    SELECT Action, COUNT(*) AS total
                    FROM tblaudittrail
                    WHERE ${AUDITOR_SCOPE_CLAUSE}
                    GROUP BY Action
                    ORDER BY total DESC, Action ASC
                    LIMIT 8
                `),
                pool.query(`
                    SELECT AuditTrailID, ChangeDate, UserName, FormName, Action, RecordID, FieldName, OldValue, NewValue
                    FROM tblaudittrail
                    WHERE ${AUDITOR_SCOPE_CLAUSE}
                    ORDER BY ChangeDate DESC, AuditTrailID DESC
                    LIMIT 20
                `)
            ]);

            res.render('auditor/dashboard', {
                title: 'Auditor Dashboard',
                path: '/auditor/dashboard',
                user: req.session.user || { name: 'Auditor' },
                metrics: {
                    totalCount: totalRows[0][0].totalCount || 0,
                    todayCount: todayRows[0][0].todayCount || 0,
                    activeUsers: activeUserRows[0][0].activeUsers || 0
                },
                actionBreakdown: actionRows[0],
                recentActivity: recentRows[0]
            });
        } catch (error) {
            console.error('Auditor dashboard error:', error);
            res.status(500).send('Server Error');
        }
    },

    auditTrailPage: async (req, res) => {
        try {
            const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
            const pageSize = 50;
            const offset = (page - 1) * pageSize;
            const filters = buildAuditFilters(req.query);

            const [entriesResult, countResult, usersResult, actionsResult, formsResult] = await Promise.all([
                pool.query(
                    `
                    SELECT AuditTrailID, ChangeDate, UserName, FormName, Action, RecordID, FieldName, OldValue, NewValue, Loggedout
                    FROM tblaudittrail
                    ${filters.whereClause}
                    ORDER BY ChangeDate DESC, AuditTrailID DESC
                    LIMIT ${pageSize} OFFSET ${offset}
                    `,
                    filters.params
                ),
                pool.query(
                    `
                    SELECT COUNT(*) AS totalCount
                    FROM tblaudittrail
                    ${filters.whereClause}
                    `,
                    filters.params
                ),
                pool.query(`SELECT DISTINCT UserName FROM tblaudittrail WHERE ${AUDITOR_SCOPE_CLAUSE} AND UserName IS NOT NULL AND UserName <> "" ORDER BY UserName ASC`),
                pool.query(`SELECT DISTINCT Action FROM tblaudittrail WHERE ${AUDITOR_SCOPE_CLAUSE} AND Action IS NOT NULL AND Action <> "" ORDER BY Action ASC`),
                pool.query(`SELECT DISTINCT FormName FROM tblaudittrail WHERE ${AUDITOR_SCOPE_CLAUSE} AND FormName IS NOT NULL AND FormName <> "" ORDER BY FormName ASC`)
            ]);

            const totalCount = countResult[0][0].totalCount || 0;
            const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);

            res.render('auditor/audit-trail', {
                title: 'Audit Trail',
                path: '/auditor/audit-trail',
                user: req.session.user || { name: 'Auditor' },
                entries: entriesResult[0],
                filters: {
                    action: req.query.action || '',
                    dateFrom: req.query.dateFrom || '',
                    dateTo: req.query.dateTo || '',
                    formName: req.query.formName || '',
                    userName: req.query.userName || ''
                },
                options: {
                    actions: actionsResult[0].map((row) => row.Action),
                    forms: formsResult[0].map((row) => row.FormName),
                    users: usersResult[0].map((row) => row.UserName)
                },
                pagination: {
                    page,
                    pageSize,
                    totalCount,
                    totalPages
                }
            });
        } catch (error) {
            console.error('Audit trail page error:', error);
            res.status(500).send('Server Error');
        }
    }
};

module.exports = auditorController;
