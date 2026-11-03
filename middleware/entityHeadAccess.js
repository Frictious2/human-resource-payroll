const pool = require('../config/db');
const staffStatusService = require('../services/staffStatusService');

function forbiddenResponse(req, res, message) {
    if (req.xhr || req.path.startsWith('/api/') || String(req.get('accept') || '').includes('application/json')) {
        return res.status(403).json({
            success: false,
            message
        });
    }

    return res.status(403).render('shared/coming-soon', {
        role: req.user ? req.user.role : 'user',
        title: 'Access Denied',
        group: 'Security',
        user: req.user || { name: 'User' },
        message
    });
}

function normalizeIdentifier(value) {
    return String(value || '').trim();
}

function normalizeLower(value) {
    return normalizeIdentifier(value).toLowerCase();
}

function buildIdentifierConditions(user) {
    const conditions = [];
    const params = [];
    const unique = new Set();

    const rawValues = [
        normalizeIdentifier(user?.pfno),
        normalizeIdentifier(user?.username),
        normalizeIdentifier(user?.email),
        normalizeIdentifier(user?.fullName),
        normalizeIdentifier(user?.name)
    ].filter(Boolean);

    rawValues.forEach((value) => {
        const lower = value.toLowerCase();
        if (unique.has(`PF:${value}`)) {
            return;
        }
        unique.add(`PF:${value}`);
        conditions.push('s.PFNo = ?');
        params.push(value);

        if (!unique.has(`UN:${lower}`)) {
            unique.add(`UN:${lower}`);
            conditions.push('LOWER(COALESCE(s.Email, \'\')) = ?');
            params.push(lower);
        }

        if (!unique.has(`NM:${lower}`)) {
            unique.add(`NM:${lower}`);
            conditions.push('LOWER(COALESCE(s.SName, \'\')) = ?');
            params.push(lower);
        }
    });

    return { conditions, params };
}

async function resolveEntityHeadScope(req, res, next) {
    if (!req.user || req.user.role !== 'entity-head') {
        return forbiddenResponse(req, res, 'You are not authorized to access this page.');
    }

    const companyId = req.user.companyId || req.session?.companyId || req.session?.CompanyID || 1;
    const { conditions, params } = buildIdentifierConditions(req.user);

    if (!conditions.length) {
        return forbiddenResponse(req, res, 'No valid Entity Head identity mapping was found for this account.');
    }

    try {
        const [rows] = await pool.query(
            `
                SELECT
                    s.PFNo,
                    s.SName,
                    s.CDept AS DeptCode,
                    d.Dept AS DeptName,
                    s.HOD,
                    s.HOD_SDate,
                    s.HOD_EDate,
                    s.CompanyID
                FROM tblstaff s
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND ${staffStatusService.getActiveStaffFilter('s')}
                  AND COALESCE(CAST(s.HOD AS CHAR), '') NOT IN ('', '0')
                  AND (s.HOD_SDate IS NULL OR DATE(s.HOD_SDate) <= CURDATE())
                  AND (s.HOD_EDate IS NULL OR DATE(s.HOD_EDate) >= CURDATE())
                  AND (${conditions.join(' OR ')})
                ORDER BY s.HOD_SDate DESC, s.PFNo ASC
                LIMIT 1
            `,
            [companyId, ...params]
        );

        if (!rows.length) {
            req.entityScope = {
                companyId,
                staffPfNo: req.user.pfno || req.user.id || null,
                staffName: req.user.fullName || req.user.name || 'Entity Head',
                deptCode: null,
                deptName: 'Organization-wide view',
                assignedDeptCode: null,
                assignedDeptName: null,
                scopeLabel: 'Organization-wide view'
            };
            res.locals.entityScope = req.entityScope;
            return next();
        }

        const scope = rows[0];

        req.entityScope = {
            companyId,
            staffPfNo: scope.PFNo,
            staffName: scope.SName,
            deptCode: scope.DeptCode || null,
            deptName: scope.DeptName || scope.DeptCode || 'Organization-wide view',
            assignedDeptCode: scope.DeptCode || null,
            assignedDeptName: scope.DeptName || scope.DeptCode || null,
            scopeLabel: 'Organization-wide view'
        };
        res.locals.entityScope = req.entityScope;

        return next();
    } catch (error) {
        console.error('Entity Head scope resolution error:', error);
        return res.status(500).send('Server Error');
    }
}

module.exports = resolveEntityHeadScope;
