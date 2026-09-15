function getViewUser(req, fallbackName = 'Admin') {
    return (req.session && req.session.user) || { name: fallbackName };
}
const adminDashboardService = require('../services/adminDashboardService');
const workflowNotificationService = require('../services/workflowNotificationService');
const parameterChangeService = require('../services/parameterChangeService');

function getSessionCompanyId(req) {
    if (req.user && req.user.companyId) {
        return req.user.companyId;
    }

    if (req.session) {
        return req.session.CompanyID ?? req.session.companyId ?? null;
    }

    return null;
}

function getAdminActor(req) {
    return (req.session && req.session.user) || req.user || { name: 'Admin', role: 'admin', id: 0 };
}

function getAdminCompanyId(req) {
    return getSessionCompanyId(req) || 1;
}

function respondWithProposal(res, detail, message) {
    res.json({
        success: true,
        pendingApproval: true,
        message,
        proposal: {
            id: detail.request.id,
            status: detail.request.Status,
            module: detail.request.ParameterModule,
            reference: detail.request.RecordReference,
            detailUrl: `/admin/parameter-changes/${detail.request.id}`
        },
        item: detail.proposedValues || detail.oldValues || {}
    });
}

const renderDashboard = async (req, res) => {
  try {
    const companyId = getSessionCompanyId(req);
    const user = getViewUser(req, 'Admin');
    const [dashboardData, unreadNotifications] = await Promise.all([
      adminDashboardService.getAdminDashboardData({ companyId: companyId || 1 }),
      workflowNotificationService.getUnreadCount(user.id || 0, companyId || 1)
    ]);
    const parameterChangeCounts = await parameterChangeService.getCountsByStatus(companyId || 1);

    res.render('admin/admin-dashboard', {
      user,
      error: null,
      unreadNotifications,
      parameterChangeCounts,
      ...dashboardData
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.render('admin/admin-dashboard', {
      user: getViewUser(req, 'Admin'),
      error: 'Failed to load dashboard data',
      unreadNotifications: 0,
      parameterChangeCounts: {},
      company: {},
      departmentChart: {
        labels: [],
        values: [],
        rows: []
      },
      metrics: {
        activeDepartments: 0,
        totalConfiguredDepartments: 0,
        totalUsers: 0,
        pendingPasswordSetup: 0,
        configurationCompleteness: 0,
        configurationWarnings: 0
      },
      userAccess: {
        totalUsers: 0,
        pendingPasswordSetup: 0,
        roleCounts: [],
        recentUsers: [],
        pendingPasswordRows: []
      },
      configHealth: {
        completenessPercent: 0,
        warningsCount: 0,
        items: [],
        warnings: []
      },
      recentAdminChanges: [],
      alerts: []
    });
  }
};

const comingSoon = (title, group) => {
  return (req, res) => {
    res.render('shared/coming-soon', {
      role: 'admin',
      title,
      group,
      user: getViewUser(req, 'Admin'),
    });
  };
};

const pool = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mailer = require('../config/mailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const lookupTableService = require('../services/lookupTableService');
const controllerAuditHelper = require('../services/controllerAuditHelper');
const brandingService = require('../services/brandingService');
const RESET_SECRET = process.env.RESET_TOKEN_SECRET || process.env.JWT_SECRET || 'reset_secret';

// Configure Multer for logo uploads
const logoUploadDirectory = path.join(process.cwd(), 'public', 'uploads');
fs.mkdirSync(logoUploadDirectory, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, logoUploadDirectory);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Error: File upload only supports images!'));
    }
});

async function getCompanyInfo(req, res) {
    try {
        const [rows] = await pool.query('SELECT * FROM tblcominfo LIMIT 1');
        const company = rows[0] || {};
        company.LogoPath = brandingService.normalizeLogoPath(company.LogoPath || company.Logopath);
        if (!company.Logopath && company.LogoPath) {
            company.Logopath = company.LogoPath;
        }
        res.render('admin/company-info', { 
            title: 'Company Information',
            group: 'Company Info',
            user: getViewUser(req, 'Admin'),
            company 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
}

async function updateCompanyInfo(req, res) {
    try {
        const {
            Com_Name, TinNo, Address, Town, City, Country,
            AccNo, Phone, Bank, PayingBank, Email, Manager
        } = req.body;

        const LogoPath = brandingService.normalizeLogoPath(req.file ? `/uploads/${req.file.filename}` : req.body.currentLogo);

        // Check if company record exists
        const [rows] = await pool.query('SELECT CompanyID FROM tblcominfo LIMIT 1');
        
        if (rows.length > 0) {
            const companyId = rows[0].CompanyID;
            await controllerAuditHelper.auditUpdate({
                table: 'tblcominfo',
                formName: 'admin/company-info',
                recordId: companyId,
                fetchQuery: 'SELECT * FROM tblcominfo WHERE CompanyID = ?',
                fetchParams: [companyId],
                applyChange: async () => {
                    await pool.query(
                        `UPDATE tblcominfo SET 
                            Com_Name=?, TinNo=?, Address=?, Town=?, City=?, Country=?, 
                            AccNo=?, Phone=?, Bank=?, PayingBank=?, Email=?, Manager=?, LogoPath=? 
                         WHERE CompanyID=?`,
                        [Com_Name, TinNo, Address, Town, City, Country, AccNo, Phone, Bank, PayingBank, Email, Manager, LogoPath, companyId]
                    );
                }
            });
        } else {
            await controllerAuditHelper.auditCreate({
                table: 'tblcominfo',
                formName: 'admin/company-info',
                recordId: 1,
                fetchQuery: 'SELECT * FROM tblcominfo ORDER BY CompanyID DESC LIMIT 1',
                fetchParams: [],
                applyChange: async () => {
                    await pool.query(
                        `INSERT INTO tblcominfo (
                            Com_Name, TinNo, Address, Town, City, Country, 
                            AccNo, Phone, Bank, PayingBank, Email, Manager, LogoPath, DateCreated
                         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                        [Com_Name, TinNo, Address, Town, City, Country, AccNo, Phone, Bank, PayingBank, Email, Manager, LogoPath]
                    );
                }
            });
        }

        res.redirect('/admin/company-info?success=Company info updated successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/company-info?error=Failed to update company info');
    }
}


async function adminsListPage(req, res) {
    const rows = await getPortalUsersByLevel('Admin');
    res.render('admin/admins', {
        user: getViewUser(req, 'Admin'),
        rows,
        success: req.query.success || '',
        warning: req.query.warning || ''
    });
}

async function adminsListJson(req, res) {
    try {
        const rows = await getPortalUsersByLevel('Admin');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ data: [], error: 'Failed to load admins' });
    }
}

async function adminsNewPage(req, res) {
    res.render('admin/admins-new', {
        user: getViewUser(req, 'Admin'),
        success: req.query.success || '',
        warning: req.query.warning || '',
        error: req.query.error || ''
    });
}

async function getPortalUsersByLevel(level) {
    const [rows] = await pool.execute(
        `
            SELECT p.PFNo, p.Username, p.FullName, p.Email, p.CompanyID, p.DateCreated, c.Com_Name
            FROM tblpassword p
            LEFT JOIN tblcominfo c ON p.CompanyID = c.CompanyID
            WHERE p.Level = ?
            ORDER BY p.PFNo DESC
        `,
        [level]
    );

    return rows;
}

async function getEntityHeadAccounts(companyId) {
    const [rows] = await pool.execute(
        `
            SELECT
                p.PFNo,
                p.Username,
                p.FullName,
                p.Email,
                p.CompanyID,
                p.DateCreated,
                c.Com_Name,
                s.PFNo AS StaffPFNo,
                s.SName AS StaffName,
                s.CDept,
                d.Dept AS DeptName,
                s.HOD,
                s.HOD_SDate,
                s.HOD_EDate
            FROM tblpassword p
            LEFT JOIN tblcominfo c
                ON p.CompanyID = c.CompanyID
            LEFT JOIN tblstaff s
                ON (
                    CAST(s.PFNo AS CHAR) = p.Username
                    OR LOWER(COALESCE(s.Email, '')) = LOWER(COALESCE(p.Email, ''))
                )
               AND (s.CompanyID = p.CompanyID OR s.CompanyID IS NULL)
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            WHERE p.Level = 'Entity Head'
              AND (? IS NULL OR p.CompanyID = ?)
            ORDER BY p.PFNo DESC
        `,
        [companyId, companyId]
    );

    return rows.map((row) => {
        const isCurrentHod = row.HOD && String(row.HOD) !== '0';
        return {
            ...row,
            ScopeStatus: row.StaffPFNo && row.CDept && isCurrentHod ? 'Active Scope' : 'Scope Needs Review'
        };
    });
}

async function ensurePortalAccountIdentityAvailable({ username, email }) {
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedUsername) {
        throw new Error('Username is required');
    }

    if (!normalizedEmail) {
        throw new Error('Email is required');
    }

    const [portalRows] = await pool.execute(
        `
            SELECT PFNo
            FROM tblpassword
            WHERE LOWER(COALESCE(Username, '')) = ?
               OR LOWER(COALESCE(Email, '')) = ?
            LIMIT 1
        `,
        [normalizedUsername, normalizedEmail]
    );

    if (portalRows.length) {
        throw new Error('That username or email is already in use.');
    }

    const [developerRows] = await pool.execute(
        `
            SELECT ID
            FROM developer
            WHERE LOWER(COALESCE(username, '')) = ?
               OR LOWER(COALESCE(email, '')) = ?
            LIMIT 1
        `,
        [normalizedUsername, normalizedEmail]
    );

    if (developerRows.length) {
        throw new Error('That username or email is already in use.');
    }
}

function buildAccountSetupLink(req, pfno, email) {
    const token = jwt.sign({ pfno, email }, RESET_SECRET, { expiresIn: '30m' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return `${baseUrl}/admin/admins/set-password?token=${encodeURIComponent(token)}`;
}

async function sendAccountSetupEmail({ to, subject, html }) {
    if (!to) {
        return false;
    }

    await mailer.sendMail({
        from: process.env.SMTP_USER || 'info@hrpayroll.davisasmedia.com',
        to,
        subject,
        html
    });

    return true;
}

async function createPortalUser(req, res, { level, redirectPath, accountLabel }) {
    try {
        const Username = String(req.body.Username || '').trim();
        const Email = String(req.body.Email || '').trim();
        const FullName = String(req.body.FullName || '').trim();
        const companyId = getSessionCompanyId(req);
        await ensurePortalAccountIdentityAvailable({ username: Username, email: Email });

        const [result] = await pool.execute(
            `INSERT INTO tblpassword (DateCreated, Level, Username, FullName, Pword, Email, CompanyID)
             VALUES (NOW(), ?, ?, ?, NULL, ?, ?)`,
            [level, Username, FullName, Email, companyId]
        );
        const pfno = result.insertId;

        const link = buildAccountSetupLink(req, pfno, Email);

        const subject = `Set up your HR Payroll ${accountLabel} password`;
        const html = `
            <p>Dear ${FullName || Username},</p>
            <p>A ${accountLabel} account has been created for you on HR Payroll${companyId ? ' for your company' : ''}.</p>
            <p>Please click the link below to set your password. The link expires in 30 minutes:</p>
            <p><a href="${link}" target="_blank" rel="noopener">Set Password</a></p>
            <p>If you did not request this, please ignore this email.</p>
            <p>Regards,<br/>HR Payroll Team</p>
        `;

        try {
            await sendAccountSetupEmail({ to: Email, subject, html });
            return res.redirect(`${redirectPath}?success=${encodeURIComponent(`${accountLabel} account created successfully.`)}`);
        } catch (mailError) {
            console.error(`Failed to send ${accountLabel} setup email:`, mailError);
            return res.redirect(`${redirectPath}?warning=${encodeURIComponent(`${accountLabel} account was created, but the password email could not be sent.`)}`);
        }
    } catch (err) {
        console.error(err);
        res.redirect(`${redirectPath}/new?error=${encodeURIComponent(err.message || `Error creating ${accountLabel}`)}`);
    }
}

async function createAdmin(req, res) {
    return createPortalUser(req, res, {
        level: 'Admin',
        redirectPath: '/admin/admins',
        accountLabel: 'admin'
    });
}

async function setPasswordPage(req, res) {
    const { token } = req.query;
    try {
        jwt.verify(token, RESET_SECRET);
        res.render('admin/admins-set-password', { token, user: getViewUser(req, 'Admin') });
    } catch (err) {
        res.status(400).send('Invalid or expired link.');
    }
}

async function setPasswordSubmit(req, res) {
    const { token, password } = req.body;
    try {
        const payload = jwt.verify(token, RESET_SECRET);
        const hash = await bcrypt.hash(password, 10);
        await pool.execute(`UPDATE tblpassword SET Pword = ? WHERE PFNo = ?`, [hash, payload.pfno]);
        res.redirect('/admin/admins');
    } catch (err) {
        console.error(err);
        res.status(400).send('Failed to set password. Link may be invalid or expired.');
    }
}

async function resendLink(req, res) {
    const { pfno } = req.params;
    try {
        const [[admin]] = await pool.execute(`SELECT Email, Username, FullName FROM tblpassword WHERE PFNo = ?`, [pfno]);
        if (!admin) return res.status(404).json({ ok: false, message: 'Admin not found' });
        const token = jwt.sign({ pfno, email: admin.Email }, RESET_SECRET, { expiresIn: '30m' });
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const link = `${baseUrl}/admin/admins/set-password?token=${encodeURIComponent(token)}`;
        const subject = `Set up your HR Payroll admin password`;
        const html = `
            <p>Dear ${admin.FullName || admin.Username},</p>
            <p>Please click the link below to set your password. The link expires in 30 minutes:</p>
            <p><a href="${link}" target="_blank" rel="noopener">Set Password</a></p>
            <p>Regards,<br/>HR Payroll Team</p>
        `;
        await mailer.sendMail({
            from: process.env.SMTP_USER || 'info@hrpayroll.davisasmedia.com',
            to: admin.Email,
            subject,
            html
        });
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: 'Failed to resend link' });
    }
}

async function resendPortalLinkForLevel(req, res, { level, accountLabel }) {
    const { pfno } = req.params;
    try {
        const [[account]] = await pool.execute(
            `SELECT Email, Username, FullName FROM tblpassword WHERE PFNo = ? AND Level = ?`,
            [pfno, level]
        );
        if (!account) {
            return res.status(404).json({ ok: false, message: `${accountLabel} account not found` });
        }
        const token = jwt.sign({ pfno, email: account.Email }, RESET_SECRET, { expiresIn: '30m' });
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const link = `${baseUrl}/admin/admins/set-password?token=${encodeURIComponent(token)}`;
        const subject = `Set up your HR Payroll ${accountLabel} password`;
        const html = `
            <p>Dear ${account.FullName || account.Username},</p>
            <p>Please click the link below to set your password. The link expires in 30 minutes:</p>
            <p><a href="${link}" target="_blank" rel="noopener">Set Password</a></p>
            <p>Regards,<br/>HR Payroll Team</p>
        `;
        await mailer.sendMail({
            from: process.env.SMTP_USER || 'info@hrpayroll.davisasmedia.com',
            to: account.Email,
            subject,
            html
        });
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: `Failed to resend ${accountLabel} link` });
    }
}

async function deletePortalUserForLevel(req, res, { level, accountLabel }) {
    const { pfno } = req.params;
    try {
        const [result] = await pool.execute(
            `DELETE FROM tblpassword WHERE PFNo = ? AND Level = ?`,
            [pfno, level]
        );
        if (!result.affectedRows) {
            return res.status(404).json({ ok: false, error: `${accountLabel} account not found` });
        }
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: `Failed to delete ${accountLabel}` });
    }
}

async function resendAdminLink(req, res) {
    return resendPortalLinkForLevel(req, res, { level: 'Admin', accountLabel: 'admin' });
}

async function resendManagerLink(req, res) {
    return resendPortalLinkForLevel(req, res, { level: 'Manager', accountLabel: 'manager' });
}

async function resendDataEntryLink(req, res) {
    return resendPortalLinkForLevel(req, res, { level: 'Data Entry', accountLabel: 'data entry officer' });
}

async function resendFinanceOfficerLink(req, res) {
    return resendPortalLinkForLevel(req, res, { level: 'Finance Officer', accountLabel: 'finance officer' });
}

async function resendFinanceManagerLink(req, res) {
    return resendPortalLinkForLevel(req, res, { level: 'Finance Manager', accountLabel: 'finance manager' });
}

async function resendAuditorLink(req, res) {
    return resendPortalLinkForLevel(req, res, { level: 'Auditor', accountLabel: 'auditor' });
}

async function resendEntityHeadLink(req, res) {
    return resendPortalLinkForLevel(req, res, { level: 'Entity Head', accountLabel: 'entity head' });
}

async function deleteAdmin(req, res) {
    return deletePortalUserForLevel(req, res, { level: 'Admin', accountLabel: 'admin' });
}

async function managersNewPage(req, res) {
    res.render('admin/managers-new', {
        user: getViewUser(req, 'Admin'),
        error: req.query.error || ''
    });
}

async function createManager(req, res) {
    return createPortalUser(req, res, {
        level: 'Manager',
        redirectPath: '/admin/managers',
        accountLabel: 'manager'
    });
}

async function managersListPage(req, res) {
    const rows = await getPortalUsersByLevel('Manager');
    res.render('admin/managers', {
        user: getViewUser(req, 'Admin'),
        rows,
        success: req.query.success || '',
        warning: req.query.warning || ''
    });
}

async function managersListJson(req, res) {
    try {
        const rows = await getPortalUsersByLevel('Manager');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ data: [], error: 'Failed to load managers' });
    }
}

async function dataEntryListPage(req, res) {
    const rows = await getPortalUsersByLevel('Data Entry');
    res.render('admin/data-entry-officers', {
        user: getViewUser(req, 'Admin'),
        rows,
        success: req.query.success || '',
        warning: req.query.warning || ''
    });
}

async function financeOfficersListPage(req, res) {
    const rows = await getPortalUsersByLevel('Finance Officer');
    res.render('admin/finance-officers', {
        user: getViewUser(req, 'Admin'),
        rows,
        success: req.query.success || '',
        warning: req.query.warning || ''
    });
}

async function financeOfficersListJson(req, res) {
    try {
        const rows = await getPortalUsersByLevel('Finance Officer');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ data: [], error: 'Failed to load finance officers' });
    }
}

async function financeManagersListPage(req, res) {
    const rows = await getPortalUsersByLevel('Finance Manager');
    res.render('admin/finance-managers', {
        user: getViewUser(req, 'Admin'),
        rows,
        success: req.query.success || '',
        warning: req.query.warning || ''
    });
}

async function financeManagersListJson(req, res) {
    try {
        const rows = await getPortalUsersByLevel('Finance Manager');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ data: [], error: 'Failed to load finance managers' });
    }
}

async function dataEntryListJson(req, res) {
    try {
        const rows = await getPortalUsersByLevel('Data Entry');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ data: [], error: 'Failed to load data entry officers' });
    }
}

async function dataEntryNewPage(req, res) {
    res.render('admin/data-entry-new', {
        user: getViewUser(req, 'Admin'),
        error: req.query.error || ''
    });
}

async function financeOfficersNewPage(req, res) {
    res.render('admin/finance-officers-new', {
        user: getViewUser(req, 'Admin'),
        error: req.query.error || ''
    });
}

async function financeManagersNewPage(req, res) {
    res.render('admin/finance-managers-new', {
        user: getViewUser(req, 'Admin'),
        error: req.query.error || ''
    });
}

async function createDataEntry(req, res) {
    return createPortalUser(req, res, {
        level: 'Data Entry',
        redirectPath: '/admin/data-entry-officers',
        accountLabel: 'data entry officer'
    });
}

async function createFinanceOfficer(req, res) {
    return createPortalUser(req, res, {
        level: 'Finance Officer',
        redirectPath: '/admin/finance-officers',
        accountLabel: 'finance officer'
    });
}

async function createFinanceManager(req, res) {
    return createPortalUser(req, res, {
        level: 'Finance Manager',
        redirectPath: '/admin/finance-managers',
        accountLabel: 'finance manager'
    });
}

async function auditorsListPage(req, res) {
    const rows = await getPortalUsersByLevel('Auditor');
    res.render('admin/auditors', {
        user: getViewUser(req, 'Admin'),
        rows,
        success: req.query.success || '',
        warning: req.query.warning || ''
    });
}

async function auditorsListJson(req, res) {
    try {
        const rows = await getPortalUsersByLevel('Auditor');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ data: [], error: 'Failed to load auditors' });
    }
}

async function auditorsNewPage(req, res) {
    res.render('admin/auditors-new', {
        user: getViewUser(req, 'Admin'),
        error: req.query.error || ''
    });
}

async function createAuditor(req, res) {
    return createPortalUser(req, res, {
        level: 'Auditor',
        redirectPath: '/admin/auditors',
        accountLabel: 'auditor'
    });
}

async function getCurrentHodCandidates(companyId) {
    const [rows] = await pool.query(
        `
            SELECT
                s.PFNo,
                s.SName,
                s.Email,
                s.CDept,
                d.Dept AS DeptName,
                s.HOD,
                s.HOD_SDate,
                s.HOD_EDate
            FROM tblstaff s
            LEFT JOIN tbldept d
                ON d.Code = s.CDept
            WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
              AND COALESCE(CAST(s.HOD AS CHAR), '') NOT IN ('', '0')
              AND COALESCE(s.Redundant, 0) = 0
              AND (
                    s.EmpStatus IS NULL
                    OR CAST(COALESCE(s.EmpStatus, '') AS CHAR) IN ('1', '01', '3', '03', '4', '04')
                  )
              AND (s.HOD_SDate IS NULL OR DATE(s.HOD_SDate) <= CURDATE())
              AND (s.HOD_EDate IS NULL OR DATE(s.HOD_EDate) >= CURDATE())
              AND s.CDept IS NOT NULL
              AND s.CDept <> ''
            ORDER BY d.Dept ASC, s.SName ASC, s.PFNo ASC
        `,
        [companyId]
    );

    return rows;
}

async function entityHeadsListPage(req, res) {
    const companyId = getSessionCompanyId(req);
    const rows = await getEntityHeadAccounts(companyId);
    res.render('admin/entity-heads', {
        user: getViewUser(req, 'Admin'),
        rows,
        success: req.query.success || '',
        warning: req.query.warning || ''
    });
}

async function entityHeadsListJson(req, res) {
    try {
        const companyId = getSessionCompanyId(req);
        const rows = await getEntityHeadAccounts(companyId);
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ data: [], error: 'Failed to load entity heads' });
    }
}

async function entityHeadsNewPage(req, res) {
    try {
        const companyId = getSessionCompanyId(req) || 1;
        const candidates = await getCurrentHodCandidates(companyId);
        res.render('admin/entity-heads-new', {
            user: getViewUser(req, 'Admin'),
            candidates,
            error: req.query.error || ''
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
}

async function createEntityHead(req, res) {
    try {
        const companyId = getSessionCompanyId(req) || 1;
        const staffPfNo = String(req.body.StaffPFNo || '').trim();
        const email = String(req.body.Email || '').trim();

        if (!staffPfNo) {
            return res.status(400).send('Staff PFNo is required');
        }

        if (!email) {
            return res.status(400).send('Email is required');
        }

        const [staffRows] = await pool.query(
            `
                SELECT
                    s.PFNo,
                    s.SName,
                    s.Email,
                    s.CDept,
                    d.Dept AS DeptName
                FROM tblstaff s
                LEFT JOIN tbldept d
                    ON d.Code = s.CDept
                WHERE (s.CompanyID = ? OR s.CompanyID IS NULL)
                  AND s.PFNo = ?
                  AND COALESCE(CAST(s.HOD AS CHAR), '') NOT IN ('', '0')
                  AND COALESCE(s.Redundant, 0) = 0
                  AND (
                        s.EmpStatus IS NULL
                        OR CAST(COALESCE(s.EmpStatus, '') AS CHAR) IN ('1', '01', '3', '03', '4', '04')
                      )
                  AND (s.HOD_SDate IS NULL OR DATE(s.HOD_SDate) <= CURDATE())
                  AND (s.HOD_EDate IS NULL OR DATE(s.HOD_EDate) >= CURDATE())
                  AND s.CDept IS NOT NULL
                  AND s.CDept <> ''
                LIMIT 1
            `,
            [companyId, staffPfNo]
        );

        if (!staffRows.length) {
            return res.status(400).send('Selected staff is not a current active HOD with a department assignment.');
        }

        const staff = staffRows[0];
        const username = String(staff.PFNo);
        const fullName = staff.SName;

        await ensurePortalAccountIdentityAvailable({ username, email });

        const [existingRows] = await pool.query(
            `
                SELECT PFNo
                FROM tblpassword
                WHERE CompanyID = ?
                  AND Level = 'Entity Head'
                  AND (Username = ? OR LOWER(COALESCE(Email, '')) = LOWER(?))
                LIMIT 1
            `,
            [companyId, username, email]
        );

        if (existingRows.length > 0) {
            return res.status(400).send('An Entity Head account already exists for this staff PFNo or email.');
        }

        const [result] = await pool.execute(
            `
                INSERT INTO tblpassword (DateCreated, Level, Username, FullName, Pword, Email, CompanyID)
                VALUES (NOW(), ?, ?, ?, NULL, ?, ?)
            `,
            ['Entity Head', username, fullName, email, companyId]
        );

        const pfno = result.insertId;
        const link = buildAccountSetupLink(req, pfno, email);

        try {
            await sendAccountSetupEmail({
                to: email,
                subject: 'Set up your HR Payroll Entity Head password',
                html: `
                    <p>Dear ${fullName || username},</p>
                    <p>An Entity Head account has been created for you on HR Payroll for <strong>${staff.DeptName || staff.CDept}</strong>.</p>
                    <p>Please click the link below to set your password. The link expires in 30 minutes:</p>
                    <p><a href="${link}" target="_blank" rel="noopener">Set Password</a></p>
                    <p>Regards,<br/>HR Payroll Team</p>
                `
            });
            res.redirect('/admin/entity-heads?success=' + encodeURIComponent('Entity Head account created successfully.'));
        } catch (mailError) {
            console.error('Failed to send Entity Head setup email:', mailError);
            res.redirect('/admin/entity-heads?warning=' + encodeURIComponent('Entity Head account was created, but the password email could not be sent.'));
        }
    } catch (err) {
        console.error(err);
        res.redirect('/admin/entity-heads/new?error=' + encodeURIComponent(err.message || 'Error creating Entity Head'));
    }
}

async function deleteManager(req, res) {
    return deletePortalUserForLevel(req, res, { level: 'Manager', accountLabel: 'manager' });
}

async function deleteDataEntry(req, res) {
    return deletePortalUserForLevel(req, res, { level: 'Data Entry', accountLabel: 'data entry officer' });
}

async function deleteFinanceOfficer(req, res) {
    return deletePortalUserForLevel(req, res, { level: 'Finance Officer', accountLabel: 'finance officer' });
}

async function deleteFinanceManager(req, res) {
    return deletePortalUserForLevel(req, res, { level: 'Finance Manager', accountLabel: 'finance manager' });
}

async function deleteAuditor(req, res) {
    return deletePortalUserForLevel(req, res, { level: 'Auditor', accountLabel: 'auditor' });
}

async function deleteEntityHead(req, res) {
    return deletePortalUserForLevel(req, res, { level: 'Entity Head', accountLabel: 'entity head' });
}

// --- Payroll Items Controller Methods ---

const payTypesPage = async (req, res) => {
    try {
        res.render('admin/parameters/pay-types', {
            title: 'Payroll Activities / Pay Types',
            group: 'Parameters',
            user: getViewUser(req, 'Admin'),
            createMode: req.path.endsWith('/new'),
            editCode: req.params.code || req.query.edit || ''
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const normalizePayTypeCode = (value) => String(value || '').trim().toUpperCase();
const isValidPayTypeCode = (value) => /^[A-Z0-9]{2}$/.test(normalizePayTypeCode(value));

const payTypesListJson = async (req, res) => {
    try {
        const data = await parameterChangeService.listPayTypeRows(getAdminCompanyId(req));
        res.json({ data });
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch payroll activities' });
    }
};

const createPayType = async (req, res) => {
    try {
        const { Code, PayType, reason } = req.body;
        if (!Code) return res.status(400).json({ error: 'Activity code is required' });
        if (!isValidPayTypeCode(Code)) {
            return res.status(400).json({ error: 'Activity code must be exactly 2 letters or digits.' });
        }
        if (!PayType) return res.status(400).json({ error: 'Activity name is required' });

        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'pay-types',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: { Code: normalizePayTypeCode(Code), PayType: String(PayType).trim() },
            reason: reason || `Proposed creation of payroll activity ${Code} - ${PayType}.`,
            user: getAdminActor(req)
        });

        respondWithProposal(res, detail, 'Payroll activity proposal saved. The live activity list remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create payroll activity proposal' });
    }
};

const updatePayType = async (req, res) => {
    try {
        const { code } = req.params;
        const { PayType, reason } = req.body;
        if (!isValidPayTypeCode(code)) {
            return res.status(400).json({ error: 'Activity code is invalid.' });
        }
        if (!PayType) return res.status(400).json({ error: 'Activity name is required' });

        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'pay-types',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { Code: normalizePayTypeCode(code), PayType: String(PayType).trim() },
            reason: reason || `Proposed update to payroll activity ${code}.`,
            user: getAdminActor(req)
        });

        respondWithProposal(res, detail, 'Payroll activity update proposed successfully. The live activity remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update payroll activity proposal' });
    }
};

const deactivatePayType = async (req, res) => {
    res.status(409).json({
        error: 'tblpaytype does not contain an active or inactive field. Deactivation is not supported in the live legacy schema, so direct deactivation cannot be proposed in this phase.'
    });
};

const deletePayType = async (req, res) => {
    try {
        const { code } = req.params;
        if (!isValidPayTypeCode(code)) {
            return res.status(400).json({ error: 'Activity code is invalid.' });
        }
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'pay-types',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { Code: normalizePayTypeCode(code) },
            reason: req.body.reason || `Proposed deletion of payroll activity ${code}.`,
            user: getAdminActor(req)
        });

        respondWithProposal(res, detail, 'Payroll activity deletion proposal saved. The live activity remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to propose payroll activity deletion' });
    }
};

const payrollItemsPage = (req, res) => {
    res.render('admin/parameters/payroll-items', {
        title: 'Payroll Items',
        group: 'Parameters',
        user: { name: 'David' }
    });
};

const payrollItemsListJson = async (req, res) => {
    try {
        const rows = await lookupTableService.listRows('tblpayrollitems');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch payroll items' });
    }
};

const createPayrollItem = async (req, res) => {
    try {
        const { Income, Taxable, Threshhold, TPercent, TPercentage, TAmount, Mode, Fixed, Percent, Freq } = req.body;
        if (!Income) return res.status(400).json({ error: 'Description (Income) is required' });
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'payroll-items',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: {
                Income,
                Taxable: Taxable ? 1 : 0,
                Threshhold: Threshhold ? 1 : 0,
                TPercent: TPercent ? 1 : 0,
                TPercentage: TPercentage || 0,
                TAmount: TAmount || 0,
                Mode: Mode || '',
                Fixed: Fixed ? 1 : 0,
                Percent: Percent || 0,
                Freq: Freq || ''
            },
            reason: req.body.reason || `Proposed creation of payroll item ${Income}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Payroll item proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create payroll item proposal' });
    }
};

const updatePayrollItem = async (req, res) => {
    const { code } = req.params;
    const { field, value } = req.body;

    const allowedFields = ['Income', 'Taxable', 'Threshhold', 'TPercent', 'TPercentage', 'TAmount', 'Mode', 'Fixed', 'Percent', 'Freq'];
    if (!allowedFields.includes(field)) {
        return res.status(400).json({ error: 'Invalid field' });
    }

    try {
        let sqlValue = value;
        if (['Taxable', 'Threshhold', 'TPercent', 'Fixed'].includes(field)) {
            sqlValue = (value === 'true' || value === true || value == 1) ? 1 : 0;
        }
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'payroll-items',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { Code: code, [field]: sqlValue },
            reason: req.body.reason || `Proposed update to payroll item ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Payroll item update proposed successfully. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update payroll item proposal' });
    }
};

const deletePayrollItem = async (req, res) => {
    const { code } = req.params;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'payroll-items',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { Code: code },
            reason: req.body.reason || `Proposed deletion of payroll item ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Payroll item deletion proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to propose payroll item deletion' });
    }
};

// --- Department Controller Methods ---

const departmentsPage = (req, res) => {
    res.render('admin/parameters/departments', {
        title: 'Department',
        group: 'Parameters',
        user: getViewUser(req, 'Admin')
    });
};

const departmentsListJson = async (req, res) => {
    try {
        const data = await parameterChangeService.listLookupModuleRows(getAdminCompanyId(req), 'departments');
        res.json({ data });
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch departments' });
    }
};

const createDepartment = async (req, res) => {
    try {
        const { Code, Dept, reason } = req.body;
        if (!Dept) return res.status(400).json({ error: 'Department Name is required' });
        if (!String(reason || '').trim()) {
            return res.status(400).json({ error: 'Reason for change is required.' });
        }
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'departments',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: Code ? { Code, Dept } : { Dept },
            reason: reason || `Proposed creation of department ${Dept}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Department proposal saved. The live department list remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create department proposal' });
    }
};

const updateDepartment = async (req, res) => {
    const { code } = req.params;
    const { Dept, reason } = req.body;

    if (!Dept) return res.status(400).json({ error: 'Department Name is required' });
    if (!String(reason || '').trim()) {
        return res.status(400).json({ error: 'Reason for change is required.' });
    }

    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'departments',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { Code: code, Dept },
            reason: reason || `Proposed update to department ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Department update proposed successfully. The live department remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update department proposal' });
    }
};

const deleteDepartment = async (req, res) => {
    const { code } = req.params;
    const { reason } = req.body;
    if (!String(reason || '').trim()) {
        return res.status(400).json({ error: 'Reason for change is required.' });
    }
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'departments',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { Code: code },
            reason: reason || `Proposed deletion of department ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Department deletion proposal saved. The live department remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to propose department deletion' });
    }
};

// --- Job Titles Controller Methods ---

const jobTitlesPage = (req, res) => {
    res.render('admin/parameters/job-titles', {
        title: 'Job Titles',
        group: 'Parameters',
        user: { name: 'David' }
    });
};

const jobTitlesListJson = async (req, res) => {
    try {
        const rows = await lookupTableService.listRows('tbljobtitle');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch job titles' });
    }
};

const createJobTitle = async (req, res) => {
    try {
        const { JobTitle } = req.body;
        if (!JobTitle) return res.status(400).json({ error: 'Job Title is required' });
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'job-titles',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: { JobTitle },
            reason: req.body.reason || `Proposed creation of job title ${JobTitle}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Job title proposal saved. The live job-title setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create job title proposal' });
    }
};

const updateJobTitle = async (req, res) => {
    const { code } = req.params;
    const { JobTitle } = req.body;

    if (!JobTitle) return res.status(400).json({ error: 'Job Title is required' });

    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'job-titles',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { Code: code, JobTitle },
            reason: req.body.reason || `Proposed update to job title ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Job title update proposed successfully. The live job title remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update job title proposal' });
    }
};

const deleteJobTitle = async (req, res) => {
    const { code } = req.params;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'job-titles',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { Code: code },
            reason: req.body.reason || `Proposed deletion of job title ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Job title deletion proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to propose job title deletion' });
    }
};

// Grades
const gradesPage = async (req, res) => {
    try {
        const [jobTitles] = await pool.query('SELECT Code, JobTitle FROM tbljobtitle ORDER BY JobTitle');
        res.render('admin/parameters/grades', {
            title: 'Grades',
            group: 'Parameters',
            user: { name: 'David' }, // Hardcoded for now as per previous pattern
            jobTitles
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const gradesListJson = async (req, res) => {
    try {
        const sql = `
            SELECT g.GradeCode, g.Grade, g.JobTitle AS JobTitleCode, j.JobTitle AS JobTitleName,
                   g.LDays, g.Medical, g.Confirm, g.NotchIncr, g.Notice, g.PromPeriod
            FROM tblgrade g 
            LEFT JOIN tbljobtitle j ON g.JobTitle = j.Code 
            ORDER BY g.GradeCode
        `;
        const [rows] = await pool.query(sql);
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch grades' });
    }
};

const createGrade = async (req, res) => {
    try {
        const { Grade, JobTitle, LDays, Medical, Confirm, NotchIncr, Notice, PromPeriod } = req.body;
        
        if (!Grade) return res.status(400).json({ error: 'Grade Name is required' });
        if (!JobTitle) return res.status(400).json({ error: 'Job Title is required' });
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'grades',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: { Grade, JobTitle, LDays: LDays || 0, Medical: Medical || 0, Confirm: Confirm || 0, NotchIncr: NotchIncr || 0, Notice: Notice || 0, PromPeriod: PromPeriod || 0 },
            reason: req.body.reason || `Proposed creation of salary grade ${Grade}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Grade proposal saved. The live grade setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create grade proposal' });
    }
};

const updateGrade = async (req, res) => {
    const { code } = req.params;
    const { Grade, JobTitle, LDays, Medical, Confirm, NotchIncr, Notice, PromPeriod } = req.body;

    try {
        if ([Grade, JobTitle, LDays, Medical, Confirm, NotchIncr, Notice, PromPeriod].every((value) => value === undefined)) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'grades',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { GradeCode: code, Grade, JobTitle, LDays, Medical, Confirm, NotchIncr, Notice, PromPeriod },
            reason: req.body.reason || `Proposed update to salary grade ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Grade update proposed successfully. The live grade remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update grade proposal' });
    }
};

const deleteGrade = async (req, res) => {
    const { code } = req.params;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'grades',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { GradeCode: code },
            reason: req.body.reason || `Proposed deletion of salary grade ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Grade deletion proposal saved. The live grade remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to propose grade deletion' });
    }
};

// Banks
const banksPage = async (req, res) => {
    res.render('admin/parameters/banks', {
        title: 'Banks',
        group: 'Parameters',
        user: { name: 'David' }
    });
};

const banksListJson = async (req, res) => {
    try {
        const rows = await lookupTableService.listRows('tblbanks', { orderBy: 'Code' });
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch banks' });
    }
};

const createBank = async (req, res) => {
    try {
        const { Bank, Short, BankCode, Street_Address, Town_Address } = req.body;
        
        if (!Bank) return res.status(400).json({ error: 'Bank Name is required' });
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'banks',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: {
                Bank,
                Short: Short || null,
                BankCode: BankCode || null,
                Street_Address: Street_Address || null,
                Town_Address: Town_Address || null
            },
            reason: req.body.reason || `Proposed creation of bank ${Bank}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Bank proposal saved. The live bank list remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create bank proposal' });
    }
};

const updateBank = async (req, res) => {
    const { code } = req.params;
    const { Bank, Short, BankCode, Street_Address, Town_Address } = req.body;

    try {
        if ([Bank, Short, BankCode, Street_Address, Town_Address].every((value) => value === undefined)) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'banks',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { Code: code, Bank, Short, BankCode, Street_Address, Town_Address },
            reason: req.body.reason || `Proposed update to bank ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Bank update proposed successfully. The live bank remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update bank proposal' });
    }
};

const deleteBank = async (req, res) => {
    const { code } = req.params;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'banks',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { Code: code },
            reason: req.body.reason || `Proposed deletion of bank ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Bank deletion proposal saved. The live bank remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to propose bank deletion' });
    }
};

// Company BBAN
const companyBBANPage = async (req, res) => {
    try {
        const [banks] = await pool.query('SELECT Code, Bank, Short FROM tblbanks ORDER BY Short');
        res.render('admin/parameters/company-bban', {
            title: 'Company BBAN',
            group: 'Parameters',
            user: { name: 'David' },
            banks
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const companyBBANListJson = async (req, res) => {
    try {
        const rows = await lookupTableService.listRows('tblpayingbank', { orderBy: 'Code' });
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch company bbans' });
    }
};

const createCompanyBBAN = async (req, res) => {
    try {
        const { Bank, BBAN, Short } = req.body;
        
        if (!Bank) return res.status(400).json({ error: 'Bank Name is required' });
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'company-bban',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: {
                Bank,
                BBAN: BBAN || null,
                Short: Short || null
            },
            reason: req.body.reason || `Proposed creation of company BBAN for ${Bank}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Company BBAN proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create company BBAN proposal' });
    }
};

const updateCompanyBBAN = async (req, res) => {
    const { code } = req.params;
    const { Bank, BBAN, Short } = req.body;

    try {
        if ([Bank, BBAN, Short].every((value) => value === undefined)) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'company-bban',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { Code: code, Bank, BBAN, Short },
            reason: req.body.reason || `Proposed update to company BBAN ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Company BBAN update proposed successfully. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update company BBAN proposal' });
    }
};

const deleteCompanyBBAN = async (req, res) => {
    const { code } = req.params;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'company-bban',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { Code: code },
            reason: req.body.reason || `Proposed deletion of company BBAN ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Company BBAN deletion proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to propose company BBAN deletion' });
    }
};

// GL Accounts
const glAccountsPage = async (req, res) => {
    try {
        res.render('admin/parameters/gl-accounts', {
            title: 'GL Accounts',
            group: 'Parameters',
            user: { name: 'David' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const glAccountsListJson = async (req, res) => {
    try {
        const rows = await lookupTableService.listRows('tblglaccounts', { orderBy: 'GLNo' });
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch gl accounts' });
    }
};

const createGLAccount = async (req, res) => {
    try {
        const { AccountsHead, Code } = req.body;
        
        if (!AccountsHead) return res.status(400).json({ error: 'Account Head is required' });
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'gl-accounts',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: {
                AccountsHead,
                Code: Code || null
            },
            reason: req.body.reason || `Proposed creation of GL account ${AccountsHead}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'GL account proposal saved. The live mapping setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create GL account proposal' });
    }
};

const updateGLAccount = async (req, res) => {
    const { glNo } = req.params;
    const { AccountsHead, Code } = req.body;

    try {
        if (AccountsHead === undefined && Code === undefined) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'gl-accounts',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { GLNo: glNo, AccountsHead, Code },
            reason: req.body.reason || `Proposed update to GL account ${glNo}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'GL account update proposed successfully. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update GL account proposal' });
    }
};

const deleteGLAccount = async (req, res) => {
    const { glNo } = req.params;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'gl-accounts',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { GLNo: glNo },
            reason: req.body.reason || `Proposed deletion of GL account ${glNo}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'GL account deletion proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to propose GL account deletion' });
    }
};

// Discipline Reasons
const disciplineReasonsPage = async (req, res) => {
    try {
        res.render('admin/parameters/discipline-reasons', {
            title: 'Discipline Reasons',
            group: 'Parameters',
            user: { name: 'David' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const disciplineReasonsListJson = async (req, res) => {
    try {
        const rows = await lookupTableService.listRows('tblreason', { orderBy: 'ReasonCode' });
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch discipline reasons' });
    }
};

const createDisciplineReason = async (req, res) => {
    try {
        const { Reason } = req.body;
        if (!Reason) return res.status(400).json({ error: 'Reason is required' });
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'discipline-reasons',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: { Reason },
            reason: req.body.reason || `Proposed creation of discipline reason ${Reason}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Discipline reason proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create discipline reason proposal' });
    }
};

const updateDisciplineReason = async (req, res) => {
    const { code } = req.params;
    const { Reason } = req.body;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'discipline-reasons',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { ReasonCode: code, Reason },
            reason: req.body.reason || `Proposed update to discipline reason ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Discipline reason update proposed successfully. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update discipline reason proposal' });
    }
};

const deleteDisciplineReason = async (req, res) => {
    const { code } = req.params;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'discipline-reasons',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { ReasonCode: code },
            reason: req.body.reason || `Proposed deletion of discipline reason ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Discipline reason deletion proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to propose discipline reason deletion' });
    }
};

// Queries (tblQType)
const queriesPage = async (req, res) => {
    try {
        res.render('admin/parameters/queries', {
            title: 'Queries',
            group: 'Parameters',
            user: { name: 'David' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const queriesListJson = async (req, res) => {
    try {
        const rows = await lookupTableService.listRows('tblqtype', { orderBy: 'Code' });
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch queries' });
    }
};

const createQuery = async (req, res) => {
    try {
        const { QType } = req.body;
        if (!QType) return res.status(400).json({ error: 'Query Type is required' });
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'queries',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: { QType },
            reason: req.body.reason || `Proposed creation of query type ${QType}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Query-type proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create query-type proposal' });
    }
};

const updateQuery = async (req, res) => {
    const { code } = req.params;
    const { QType } = req.body;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'queries',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { Code: code, QType },
            reason: req.body.reason || `Proposed update to query type ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Query-type update proposed successfully. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update query-type proposal' });
    }
};

const deleteQuery = async (req, res) => {
    const { code } = req.params;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'queries',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { Code: code },
            reason: req.body.reason || `Proposed deletion of query type ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Query-type deletion proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to propose query-type deletion' });
    }
};

const disciplineOutcomesPage = async (req, res) => {
    try {
        res.render('admin/parameters/discipline-outcomes', {
            title: 'Discipline Outcomes',
            group: 'Parameters',
            user: { name: 'David' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const disciplineOutcomesListJson = async (req, res) => {
    try {
        const rows = await lookupTableService.listRows('tblmreaction', { orderBy: 'Code' });
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch discipline outcomes' });
    }
};

const createDisciplineOutcome = async (req, res) => {
    try {
        const { Reaction } = req.body;
        if (!Reaction) return res.status(400).json({ error: 'Reaction is required' });
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'discipline-outcomes',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: { Reaction },
            reason: req.body.reason || `Proposed creation of discipline outcome ${Reaction}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Discipline outcome proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create discipline outcome proposal' });
    }
};

const updateDisciplineOutcome = async (req, res) => {
    const { code } = req.params;
    const { Reaction } = req.body;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'discipline-outcomes',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { Code: code, Reaction },
            reason: req.body.reason || `Proposed update to discipline outcome ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Discipline outcome update proposed successfully. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update discipline outcome proposal' });
    }
};

const deleteDisciplineOutcome = async (req, res) => {
    const { code } = req.params;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'discipline-outcomes',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { Code: code },
            reason: req.body.reason || `Proposed deletion of discipline outcome ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Discipline outcome deletion proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to propose discipline outcome deletion' });
    }
};

// Courses (tblcoursetype)
const coursesPage = async (req, res) => {
    try {
        res.render('admin/parameters/courses', {
            title: 'Courses',
            group: 'Parameters',
            user: { name: 'David' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const coursesListJson = async (req, res) => {
    try {
        const rows = await lookupTableService.listRows('tblcoursetype', { orderBy: 'CourseCode' });
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch courses' });
    }
};

const createCourse = async (req, res) => {
    try {
        const { CType } = req.body;
        if (!CType) return res.status(400).json({ error: 'Course Type is required' });
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'courses',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: { CType },
            reason: req.body.reason || `Proposed creation of course type ${CType}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Course-type proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create course-type proposal' });
    }
};

const updateCourse = async (req, res) => {
    const { code } = req.params;
    const { CType } = req.body;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'courses',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { CourseCode: code, CType },
            reason: req.body.reason || `Proposed update to course type ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Course-type update proposed successfully. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update course-type proposal' });
    }
};

const deleteCourse = async (req, res) => {
    const { code } = req.params;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'courses',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { CourseCode: code },
            reason: req.body.reason || `Proposed deletion of course type ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Course-type deletion proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to propose course-type deletion' });
    }
};

// EMP Status (tblempstatus)
const empStatusPage = async (req, res) => {
    try {
        res.render('admin/parameters/emp-status', {
            title: 'EMP Status',
            group: 'Parameters',
            user: { name: 'David' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const empStatusListJson = async (req, res) => {
    try {
        const rows = await lookupTableService.listRows('tblempstatus', { orderBy: 'Code' });
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch emp status' });
    }
};

const createEmpStatus = async (req, res) => {
    try {
        const { EmpStatus } = req.body;
        if (!EmpStatus) return res.status(400).json({ error: 'Status is required' });
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'emp-status',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: { EmpStatus },
            reason: req.body.reason || `Proposed creation of employee status ${EmpStatus}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Employee-status proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create employee-status proposal' });
    }
};

const updateEmpStatus = async (req, res) => {
    const { code } = req.params;
    const { EmpStatus } = req.body;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'emp-status',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { Code: code, EmpStatus },
            reason: req.body.reason || `Proposed update to employee status ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Employee-status update proposed successfully. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update employee-status proposal' });
    }
};

const deleteEmpStatus = async (req, res) => {
    const { code } = req.params;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'emp-status',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { Code: code },
            reason: req.body.reason || `Proposed deletion of employee status ${code}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Employee-status deletion proposal saved. The live setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to propose employee-status deletion' });
    }
};

// End of Service Benefit (tblEOSCalc)
const eosBenefitPage = async (req, res) => {
    try {
        res.render('admin/parameters/end-of-service-benefit', {
            title: 'END OF SERVICE CALCULATION',
            group: 'Parameters',
            user: { name: 'David' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const getEOSBenefit = async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM tbleoscalc LIMIT 1');
        res.json(rows[0] || {});
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch EOS data' });
    }
};

const saveEOSBenefit = async (req, res) => {
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'end-of-service-benefit',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: req.body,
            reason: req.body.reason || 'Proposed update to End of Service benefit parameters.',
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'End of Service benefit proposal saved. The live calculation parameters remain unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to save EOS parameter proposal' });
    }
};

// Global Params (tblParams1)
const globalParamsPage = async (req, res) => {
    try {
        res.render('admin/parameters/global-params', {
            title: 'Global Parameters',
            group: 'Parameters',
            user: { name: 'David' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const getGlobalParams = async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM tblparams1 LIMIT 1');
        res.json(rows[0] || {});
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch Global Params' });
    }
};

const saveGlobalParams = async (req, res) => {
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'global-params',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: req.body,
            reason: req.body.reason || 'Proposed update to global payroll parameters.',
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Global parameter proposal saved. The live system parameters remain unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to save global-parameter proposal' });
    }
};

// Work Days (tblWeek)
const workDaysPage = async (req, res) => {
    try {
        res.render('admin/parameters/work-days', {
            title: 'Work Days',
            group: 'Parameters',
            user: { name: 'David' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const getWorkDays = async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM tblweek ORDER BY DayNo');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch Work Days' });
    }
};

const saveWorkDays = async (req, res) => {
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'work-days',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: req.body,
            reason: req.body.reason || 'Proposed update to work-day configuration.',
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Work-day proposal saved. The live work schedule remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to save work-day proposal' });
    }
};

// Public Holidays
const publicHolidaysPage = async (req, res) => {
    try {
        res.render('admin/parameters/public-holidays', {
            title: 'Public Holidays',
            group: 'Parameters',
            user: { name: 'David' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const getPublicHolidays = async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM tblpublic_holidays ORDER BY Pub_Year DESC, Pub_Date DESC');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch public holidays' });
    }
};

const savePublicHoliday = async (req, res) => {
    const { Pub_Date, Pub_Year, Pub_Name, HDate, Approved } = req.body;
    
    if (!Pub_Year || !Pub_Name || !HDate) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'public-holidays',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: { Pub_Date, Pub_Year, Pub_Name, HDate, Approved: Approved || 0 },
            reason: req.body.reason || `Proposed creation of public holiday ${Pub_Name} (${Pub_Year}).`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Public holiday proposal saved. The live holiday calendar remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create public holiday proposal' });
    }
};

const updatePublicHoliday = async (req, res) => {
    const { year, name } = req.params;
    const { Pub_Date, Pub_Year, Pub_Name, HDate, Approved } = req.body;
    
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'public-holidays',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { year, name, Pub_Date, Pub_Year, Pub_Name, HDate, Approved },
            reason: req.body.reason || `Proposed update to public holiday ${name} (${year}).`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Public holiday update proposed successfully. The live holiday calendar remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update public holiday proposal' });
    }
};

const deletePublicHoliday = async (req, res) => {
    const { year, name } = req.params;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'public-holidays',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { year, name },
            reason: req.body.reason || `Proposed deletion of public holiday ${name} (${year}).`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Public holiday deletion proposal saved. The live holiday calendar remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to propose public holiday deletion' });
    }
};

// Sponsors
const sponsorsPage = async (req, res) => {
    try {
        res.render('admin/parameters/sponsors', {
            title: 'Sponsors',
            group: 'Parameters',
            user: req.user
        });
    } catch (error) {
        console.error('Error rendering sponsors page:', error);
        res.status(500).send('Server Error');
    }
};

const getSponsors = async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM tblCourseSponsor ORDER BY SCode');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching sponsors:', error);
        res.status(500).json({ message: 'Error fetching sponsors' });
    }
};

const addSponsor = async (req, res) => {
    const { SCode, Sponsor } = req.body;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'sponsors',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.CREATE,
            payload: { SCode, Sponsor },
            reason: req.body.reason || `Proposed creation of sponsor ${Sponsor}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Sponsor proposal saved. The live sponsor list remains unchanged until final approval.');
    } catch (error) {
        console.error('Error adding sponsor:', error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Error adding sponsor proposal' });
    }
};

const updateSponsor = async (req, res) => {
    const { SCode } = req.params;
    const { Sponsor } = req.body;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'sponsors',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: { SCode, Sponsor },
            reason: req.body.reason || `Proposed update to sponsor ${SCode}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Sponsor update proposed successfully. The live sponsor list remains unchanged until final approval.');
    } catch (error) {
        console.error('Error updating sponsor:', error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Error updating sponsor proposal' });
    }
};

const deleteSponsor = async (req, res) => {
    const { SCode } = req.params;
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'sponsors',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.DELETE,
            payload: { SCode },
            reason: req.body.reason || `Proposed deletion of sponsor ${SCode}.`,
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Sponsor deletion proposal saved. The live sponsor list remains unchanged until final approval.');
    } catch (error) {
        console.error('Error deleting sponsor:', error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Error deleting sponsor proposal' });
    }
};

const saveTaxTable = async (req, res) => {
    try {
        const detail = await parameterChangeService.createParameterChangeDraft({
            companyId: getAdminCompanyId(req),
            module: 'tax-table',
            changeType: parameterChangeService.PARAMETER_CHANGE_TYPES.UPDATE,
            payload: req.body,
            reason: req.body.reason || 'Proposed update to tax parameters.',
            user: getAdminActor(req)
        });
        respondWithProposal(res, detail, 'Tax-table proposal saved. The live tax setup remains unchanged until final approval.');
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to save tax-table proposal' });
    }
};

const taxTablePage = async (req, res) => {
    try {
        res.render('admin/parameters/tax-table', {
            title: 'Tax Table',
            group: 'Parameters',
            user: { name: 'David' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const getTaxTable = async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM tbltax WHERE CompanyID = 1 LIMIT 1');
        res.json({ data: rows[0] || {} });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch tax table' });
    }
};


const enquiryPage = async (req, res) => {
    try {
        const [departments] = await pool.query('SELECT Code, Dept FROM tbldept ORDER BY Dept');
        const [jobTitles] = await pool.query('SELECT Code, JobTitle FROM tbljobtitle ORDER BY JobTitle');
        res.render('admin/activity/enquiry', { 
            title: 'Enquiry', 
            group: 'Activity',
            user: { name: 'David' },
            departments,
            jobTitles
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading enquiry page');
    }
};

const getEnquiryData = async (req, res) => {
    try {
        const { servedYearMin, servedYearMax, department, jobTitle, gender, ageMin, ageMax, retireMin, retireMax, formerDept, approved } = req.query;

        // Get retirement age first
        const [params] = await pool.query('SELECT RetireAge FROM tblparams1 LIMIT 1');
        const retireAge = params[0]?.RetireAge || 60;

        let sql = `
            SELECT 
                s.PFNo, 
                s.SName, 
                d.Dept AS Department, 
                j.JobTitle, 
                s.DOE, 
                s.DOB, 
                s.SexCode,
                s.Approved,
                TIMESTAMPDIFF(YEAR, s.DOE, CURDATE()) AS ServedYears,
                TIMESTAMPDIFF(YEAR, s.DOB, CURDATE()) AS Age,
                (${retireAge} - TIMESTAMPDIFF(YEAR, s.DOB, CURDATE())) AS YearsToRetire
            FROM tblstaff s 
            LEFT JOIN tbldept d ON s.CDept = d.Code 
            LEFT JOIN tbljobtitle j ON s.JobTitle = j.Code 
            WHERE 1=1
        `;

        const values = [];

        if (approved) {
            sql += ` AND s.Approved = ?`;
            values.push(approved);
        }

        if (servedYearMin) {
            sql += ` AND TIMESTAMPDIFF(YEAR, s.DOE, CURDATE()) >= ?`;
            values.push(servedYearMin);
        }

        if (servedYearMax) {
            sql += ` AND TIMESTAMPDIFF(YEAR, s.DOE, CURDATE()) <= ?`;
            values.push(servedYearMax);
        }

        if (department) {
            sql += ` AND s.CDept = ?`;
            values.push(department);
        }

        if (jobTitle) {
            sql += ` AND s.JobTitle = ?`;
            values.push(jobTitle);
        }

        if (gender) {
            sql += ` AND s.SexCode = ?`;
            values.push(gender);
        }

        if (ageMin) {
            sql += ` AND TIMESTAMPDIFF(YEAR, s.DOB, CURDATE()) >= ?`;
            values.push(ageMin);
        }

        if (ageMax) {
            sql += ` AND TIMESTAMPDIFF(YEAR, s.DOB, CURDATE()) <= ?`;
            values.push(ageMax);
        }

        if (formerDept) {
            sql += ` AND s.DEmp = ?`;
            values.push(formerDept);
        }

        // For "To Retire", we filter using HAVING because YearsToRetire is a calculated column
        // However, WHERE is more efficient if we repeat the calculation or use a subquery.
        // Let's use the expression in WHERE for efficiency/standard SQL support.
        
        if (retireMin) {
            sql += ` AND (${retireAge} - TIMESTAMPDIFF(YEAR, s.DOB, CURDATE())) >= ?`;
            values.push(retireMin);
        }

        if (retireMax) {
            sql += ` AND (${retireAge} - TIMESTAMPDIFF(YEAR, s.DOB, CURDATE())) <= ?`;
            values.push(retireMax);
        }

        sql += ` ORDER BY s.PFNo`;

        const [rows] = await pool.query(sql, values);
        res.json({ data: rows });

    } catch (err) {
        console.error(err);
        res.status(500).json({ data: [], error: 'Failed to load enquiry data' });
    }
};

const staffFilePage = (req, res) => {
  res.render('admin/activity/staff-file', {
    title: 'Staff File',
    path: '/admin/activity/staff-file',
    user: { name: 'David' }
  });
};

const getStaffFileData = async (req, res) => {
  try {
    const pfNo = req.query.pfNo;
    if (!pfNo) {
      return res.status(400).json({ success: false, message: 'PFNo is required' });
    }

    // 1. Staff Details
    const detailsQuery = `
      SELECT
        s.SName,
        jt.JobTitle AS JobTitleName,
        g.Medical AS MedicalLimit,
        g.WDays AS LeaveDays
      FROM tblStaff s
      LEFT JOIN tblJobTitle jt ON s.JobTitle = jt.Code
      LEFT JOIN tblGrade g ON s.GradeCode = g.GradeCode AND s.JobTitle = g.JobTitle
      WHERE s.PFNo = ?
    `;

    const [details] = await pool.query(detailsQuery, [pfNo]);

    if (details.length === 0) {
      return res.json({ success: false, message: 'Staff not found' });
    }

    const staff = details[0];

    // 2. Leave Days Due (tblLeaveHistory)
    // "subtracting the values from LDay and BalDay"
    const leaveQuery = `
      SELECT LDays, BalDays
      FROM tblLeaveHistory
      WHERE PFNo = ?
      ORDER BY LYear DESC, EntryDate DESC
      LIMIT 1
    `;
    const [leaveHistory] = await pool.query(leaveQuery, [pfNo]);
    let leaveDue = 0;
    if (leaveHistory.length > 0) {
      const lh = leaveHistory[0];
      leaveDue = (lh.LDays || 0) - (lh.BalDays || 0);
    }

    // 3. Salary History
    const salaryQuery = `
      SELECT PDate, Annual
      FROM tblSalary
      WHERE PFNo = ?
      ORDER BY PDate DESC
    `;
    const [salaryHistory] = await pool.query(salaryQuery, [pfNo]);

    // 4. Grade History
    const gradeQuery = `
      SELECT p.PDate, jt.JobTitle
      FROM tblPromotions p
      LEFT JOIN tblJobTitle jt ON p.JobTitle = jt.Code
      WHERE p.PFNO = ?
      ORDER BY p.PDate DESC
    `;
    const [gradeHistory] = await pool.query(gradeQuery, [pfNo]);

    // 5. Discipline / Queries
    const queryQuery = `
      SELECT QDate, QDetails, QType
      FROM tblQuery
      WHERE PFNO = ?
      ORDER BY QDate DESC
    `;
    const [queryHistory] = await pool.query(queryQuery, [pfNo]);

    // 6. Transfer History
    const transferQuery = `
      SELECT t.TDate, d1.Dept AS PrevDeptName, d2.Dept AS NewDeptName
      FROM tblTransfer t
      LEFT JOIN tbldept d1 ON t.PrevDept = d1.Code
      LEFT JOIN tbldept d2 ON t.TDept = d2.Code
      WHERE t.PFNO = ?
      ORDER BY t.TDate DESC
    `;
    const [transferHistory] = await pool.query(transferQuery, [pfNo]);

    // 7. Training / Course History
    const courseQuery = `
      SELECT StartDate, Course, OrganisedBy, Duration, Country
      FROM tblCourse
      WHERE PFNo = ?
      ORDER BY StartDate DESC
    `;
    const [courseHistory] = await pool.query(courseQuery, [pfNo]);

    res.json({
      success: true,
      data: {
        details: {
          SName: staff.SName,
          JobTitle: staff.JobTitleName,
          MedicalLimit: staff.MedicalLimit,
          LeaveDays: staff.LeaveDays,
          LeaveDue: leaveDue
        },
        salaryHistory: salaryHistory,
        gradeHistory: gradeHistory,
        queryHistory: queryHistory,
        transferHistory: transferHistory,
        courseHistory: courseHistory
      }
    });

  } catch (error) {
    console.error('Error fetching staff file data:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

module.exports = {
  renderDashboard,
  comingSoon,
  adminsListPage,
  adminsListJson,
  adminsNewPage,
  createAdmin,
  setPasswordPage,
  setPasswordSubmit,
  resendAdminLink,
  resendManagerLink,
  resendDataEntryLink,
  resendFinanceOfficerLink,
  resendFinanceManagerLink,
  resendAuditorLink,
  resendEntityHeadLink,
  deleteAdmin,
  managersNewPage,
  createManager,
  managersListPage,
  managersListJson,
  deleteManager,
  dataEntryListPage,
  dataEntryListJson,
  financeOfficersListPage,
  financeOfficersListJson,
  financeManagersListPage,
  financeManagersListJson,
  dataEntryNewPage,
  financeOfficersNewPage,
  financeManagersNewPage,
  createDataEntry,
  createFinanceOfficer,
  createFinanceManager,
  deleteDataEntry,
  deleteFinanceOfficer,
  deleteFinanceManager,
  auditorsListPage,
  auditorsListJson,
  auditorsNewPage,
  createAuditor,
  deleteAuditor,
  entityHeadsListPage,
  entityHeadsListJson,
  entityHeadsNewPage,
  createEntityHead,
  deleteEntityHead,
  payTypesPage,
  payTypesListJson,
  createPayType,
  updatePayType,
  deactivatePayType,
  deletePayType,
  payrollItemsPage,
  payrollItemsListJson,
  createPayrollItem,
  updatePayrollItem,
  deletePayrollItem,
  departmentsPage,
  departmentsListJson,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  jobTitlesPage,
  jobTitlesListJson,
  createJobTitle,
  updateJobTitle,
  deleteJobTitle,
  gradesPage,
  gradesListJson,
  createGrade,
  updateGrade,
  deleteGrade,
  banksPage,
  banksListJson,
  createBank,
  updateBank,
  deleteBank,
  companyBBANPage,
  companyBBANListJson,
  createCompanyBBAN,
  updateCompanyBBAN,
  deleteCompanyBBAN,
  glAccountsPage,
  glAccountsListJson,
  createGLAccount,
  updateGLAccount,
  deleteGLAccount,
  disciplineReasonsPage,
  disciplineReasonsListJson,
  createDisciplineReason,
  updateDisciplineReason,
  deleteDisciplineReason,
  queriesPage,
  queriesListJson,
  createQuery,
  updateQuery,
  deleteQuery,
  disciplineOutcomesPage,
  disciplineOutcomesListJson,
  createDisciplineOutcome,
  updateDisciplineOutcome,
  deleteDisciplineOutcome,
  coursesPage,
  coursesListJson,
  createCourse,
  updateCourse,
  deleteCourse,
  empStatusPage,
  empStatusListJson,
  createEmpStatus,
  updateEmpStatus,
  deleteEmpStatus,
  eosBenefitPage,
  getEOSBenefit,
  saveEOSBenefit,
  globalParamsPage,
  getGlobalParams,
  saveGlobalParams,
  workDaysPage,
  getWorkDays,
  saveWorkDays,
  publicHolidaysPage,
  getPublicHolidays,
  savePublicHoliday,
  updatePublicHoliday,
  deletePublicHoliday,
  taxTablePage,
  getTaxTable,
  saveTaxTable,
  sponsorsPage,
  getSponsors,
  addSponsor,
  updateSponsor,
  deleteSponsor,
  enquiryPage,
  getEnquiryData,
  staffFilePage,
    getStaffFileData,

    // Company Info
    getCompanyInfo,
    updateCompanyInfo,
    upload
};
