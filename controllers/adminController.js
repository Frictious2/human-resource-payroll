const renderDashboard = (req, res) => {
  res.render('admin/admin-dashboard', { user: { name: 'David' } });
};

const comingSoon = (title, group) => {
  return (req, res) => {
    res.render('shared/coming-soon', {
      role: 'admin',
      title,
      group,
      user: { name: 'David' },
    });
  };
};

const pool = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mailer = require('../config/mailer');

async function adminsListPage(req, res) {
    res.render('admin/admins', { user: { name: 'David' } });
}

async function adminsListJson(req, res) {
    try {
        const [rows] = await pool.execute(
            `SELECT p.PFNo, p.Username, p.FullName, p.Email, p.CompanyID, p.DateCreated, c.Com_Name
             FROM tblpassword p
             LEFT JOIN tblcominfo c ON p.CompanyID = c.CompanyID
             WHERE p.Level = 'Admin'
             ORDER BY p.PFNo DESC`
        );
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ data: [], error: 'Failed to load admins' });
    }
}

async function adminsNewPage(req, res) {
    try {
        const [companies] = await pool.execute(
            `SELECT CompanyID, Com_Name FROM tblcominfo ORDER BY Com_Name ASC`
        );
        res.render('admin/admins-new', { companies, user: { name: 'David' } });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading form');
    }
}

async function createAdmin(req, res) {
    try {
        const { Username, Email, FullName, CompanyID } = req.body;
        const Level = 'Admin';
        const [result] = await pool.execute(
            `INSERT INTO tblpassword (DateCreated, Level, Username, FullName, Pword, Email, CompanyID)
             VALUES (NOW(), ?, ?, ?, NULL, ?, ?)`,
            [Level, Username, FullName, Email, CompanyID || null]
        );
        const pfno = result.insertId;

        const token = jwt.sign({ pfno, email: Email }, process.env.RESET_TOKEN_SECRET, { expiresIn: '30m' });
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const link = `${baseUrl}/admin/admins/set-password?token=${encodeURIComponent(token)}`;

        const subject = `Set up your HR Payroll admin password`;
        const html = `
            <p>Dear ${FullName || Username},</p>
            <p>An admin account has been created for you on HR Payroll${CompanyID ? ' for your company' : ''}.</p>
            <p>Please click the link below to set your password. The link expires in 30 minutes:</p>
            <p><a href="${link}" target="_blank" rel="noopener">Set Password</a></p>
            <p>If you did not request this, please ignore this email.</p>
            <p>Regards,<br/>HR Payroll Team</p>
        `;
        await mailer.sendMail({
            from: process.env.SMTP_USER || 'info@hrpayroll.davisasmedia.com',
            to: Email,
            subject,
            html
        });

        res.redirect('/admin/admins');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error creating admin');
    }
}

async function setPasswordPage(req, res) {
    const { token } = req.query;
    try {
        jwt.verify(token, process.env.RESET_TOKEN_SECRET);
        res.render('admin/admins-set-password', { token, user: { name: 'David' } });
    } catch (err) {
        res.status(400).send('Invalid or expired link.');
    }
}

async function setPasswordSubmit(req, res) {
    const { token, password } = req.body;
    try {
        const payload = jwt.verify(token, process.env.RESET_TOKEN_SECRET);
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
        const token = jwt.sign({ pfno, email: admin.Email }, process.env.RESET_TOKEN_SECRET, { expiresIn: '30m' });
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

async function deleteAdmin(req, res) {
    const { pfno } = req.params;
    try {
        await pool.execute(`DELETE FROM tblpassword WHERE PFNo = ?`, [pfno]);
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: 'Failed to delete admin' });
    }
}

module.exports = {
  renderDashboard,
  comingSoon,
  adminsListPage,
  adminsListJson,
  adminsNewPage,
  createAdmin,
  setPasswordPage,
  setPasswordSubmit,
  resendLink,
  deleteAdmin,
};