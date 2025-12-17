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
    res.render('admin/admins-new', { user: { name: 'David' } });
}

async function createAdmin(req, res) {
    try {
        const { Username, Email, FullName } = req.body;
        const Level = 'Admin';
        const companyId = (req.session && (req.session.CompanyID ?? req.session.companyId)) || null;
        const [result] = await pool.execute(
            `INSERT INTO tblpassword (DateCreated, Level, Username, FullName, Pword, Email, CompanyID)
             VALUES (NOW(), ?, ?, ?, NULL, ?, ?)`,
            [Level, Username, FullName, Email, companyId]
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

async function managersNewPage(req, res) {
    res.render('admin/managers-new', { user: { name: 'David' } });
}

async function createManager(req, res) {
    try {
        const { Username, Email, FullName } = req.body;
        const Level = 'Manager';
        const companyId = (req.session && (req.session.CompanyID ?? req.session.companyId)) || null;
        const [result] = await pool.execute(
            `INSERT INTO tblpassword (DateCreated, Level, Username, FullName, Pword, Email, CompanyID)
             VALUES (NOW(), ?, ?, ?, NULL, ?, ?)`,
            [Level, Username, FullName, Email, companyId]
        );
        const pfno = result.insertId;

        const token = jwt.sign({ pfno, email: Email }, process.env.RESET_TOKEN_SECRET, { expiresIn: '30m' });
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const link = `${baseUrl}/admin/admins/set-password?token=${encodeURIComponent(token)}`;

        const subject = `Set up your HR Payroll manager password`;
        const html = `
            <p>Dear ${FullName || Username},</p>
            <p>A manager account has been created for you on HR Payroll.</p>
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

        res.redirect('/admin/managers');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error creating manager');
    }
}

async function managersListPage(req, res) {
    res.render('admin/managers', { user: { name: 'David' } });
}

async function managersListJson(req, res) {
    try {
        const [rows] = await pool.execute(
            `SELECT p.PFNo, p.Username, p.FullName, p.Email, p.CompanyID, p.DateCreated, c.Com_Name
             FROM tblpassword p
             LEFT JOIN tblcominfo c ON p.CompanyID = c.CompanyID
             WHERE p.Level = 'Manager'
             ORDER BY p.PFNo DESC`
        );
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ data: [], error: 'Failed to load managers' });
    }
}

async function dataEntryListPage(req, res) {
    res.render('admin/data-entry-officers', { user: { name: 'David' } });
}

async function dataEntryListJson(req, res) {
    try {
        const [rows] = await pool.execute(
            `SELECT p.PFNo, p.Username, p.FullName, p.Email, p.CompanyID, p.DateCreated, c.Com_Name
             FROM tblpassword p
             LEFT JOIN tblcominfo c ON p.CompanyID = c.CompanyID
             WHERE p.Level = 'Data Entry'
             ORDER BY p.PFNo DESC`
        );
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ data: [], error: 'Failed to load data entry officers' });
    }
}

async function dataEntryNewPage(req, res) {
    res.render('admin/data-entry-new', { user: { name: 'David' } });
}

async function createDataEntry(req, res) {
    try {
        const { Username, Email, FullName } = req.body;
        const Level = 'Data Entry';
        const companyId = (req.session && (req.session.CompanyID ?? req.session.companyId)) || null;
        const [result] = await pool.execute(
            `INSERT INTO tblpassword (DateCreated, Level, Username, FullName, Pword, Email, CompanyID)
             VALUES (NOW(), ?, ?, ?, NULL, ?, ?)`,
            [Level, Username, FullName, Email, companyId]
        );
        const pfno = result.insertId;

        const token = jwt.sign({ pfno, email: Email }, process.env.RESET_TOKEN_SECRET, { expiresIn: '30m' });
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const link = `${baseUrl}/admin/admins/set-password?token=${encodeURIComponent(token)}`;

        const subject = `Set up your HR Payroll data entry password`;
        const html = `
            <p>Dear ${FullName || Username},</p>
            <p>A data entry officer account has been created for you on HR Payroll.</p>
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

        res.redirect('/admin/data-entry-officers');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error creating data entry officer');
    }
}

async function deleteManager(req, res) {
    const { pfno } = req.params;
    try {
        await pool.execute(`DELETE FROM tblpassword WHERE PFNo = ?`, [pfno]);
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: 'Failed to delete manager' });
    }
}

async function deleteDataEntry(req, res) {
    const { pfno } = req.params;
    try {
        await pool.execute(`DELETE FROM tblpassword WHERE PFNo = ?`, [pfno]);
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: 'Failed to delete data entry officer' });
    }
}

// --- Payroll Items Controller Methods ---

const payrollItemsPage = (req, res) => {
    res.render('admin/parameters/payroll-items', {
        title: 'Payroll Items',
        group: 'Parameters',
        user: { name: 'David' }
    });
};

const payrollItemsListJson = async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM tblpayrollitems ORDER BY Code ASC');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch payroll items' });
    }
};

const createPayrollItem = async (req, res) => {
    try {
        const [lastItem] = await pool.query('SELECT Code FROM tblpayrollitems ORDER BY Code DESC LIMIT 1');
        let nextCode = '01';
        if (lastItem.length > 0) {
            const lastCodeInt = parseInt(lastItem[0].Code, 10);
            if (!isNaN(lastCodeInt)) {
                nextCode = (lastCodeInt + 1).toString().padStart(2, '0');
            }
        }

        const { Income, Taxable, Threshhold, TPercent, TPercentage, TAmount, Mode, Fixed, Percent, Freq } = req.body;

        if (!Income) return res.status(400).json({ error: 'Description (Income) is required' });

        const sql = `INSERT INTO tblpayrollitems
            (Code, Income, Taxable, Threshhold, TPercent, TPercentage, TAmount, Mode, Fixed, Percent, Freq, CompanyID)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        
        const values = [
            nextCode,
            Income,
            Taxable ? 1 : 0,
            Threshhold ? 1 : 0,
            TPercent ? 1 : 0,
            TPercentage || 0,
            TAmount || 0,
            Mode || '',
            Fixed ? 1 : 0,
            Percent || 0,
            Freq || '',
            1 
        ];

        await pool.query(sql, values);
        
        const [newRow] = await pool.query('SELECT * FROM tblpayrollitems WHERE Code = ?', [nextCode]);
        res.json({ success: true, item: newRow[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create payroll item' });
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

        const sql = `UPDATE tblpayrollitems SET ${field} = ? WHERE Code = ?`;
        await pool.query(sql, [sqlValue, code]);
        
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update payroll item' });
    }
};

const deletePayrollItem = async (req, res) => {
    const { code } = req.params;
    try {
        await pool.query('DELETE FROM tblpayrollitems WHERE Code = ?', [code]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete payroll item' });
    }
};

// --- Department Controller Methods ---

const departmentsPage = (req, res) => {
    res.render('admin/parameters/departments', {
        title: 'Department',
        group: 'Parameters',
        user: { name: 'David' }
    });
};

const departmentsListJson = async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM tbldept ORDER BY Code ASC');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch departments' });
    }
};

const createDepartment = async (req, res) => {
    try {
        const [lastItem] = await pool.query('SELECT Code FROM tbldept ORDER BY Code DESC LIMIT 1');
        let nextCode = '001'; // Departments usually have 3 or 4 char codes, based on schema (varchar(4))
        if (lastItem.length > 0) {
            const lastCodeInt = parseInt(lastItem[0].Code, 10);
            if (!isNaN(lastCodeInt)) {
                nextCode = (lastCodeInt + 1).toString().padStart(3, '0');
            }
        }

        const { Dept } = req.body;
        if (!Dept) return res.status(400).json({ error: 'Department Name is required' });

        const sql = `INSERT INTO tbldept (Code, Dept, CompanyID) VALUES (?, ?, ?)`;
        await pool.query(sql, [nextCode, Dept, 1]);
        
        const [newRow] = await pool.query('SELECT * FROM tbldept WHERE Code = ?', [nextCode]);
        res.json({ success: true, item: newRow[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create department' });
    }
};

const updateDepartment = async (req, res) => {
    const { code } = req.params;
    const { Dept } = req.body;

    if (!Dept) return res.status(400).json({ error: 'Department Name is required' });

    try {
        const sql = `UPDATE tbldept SET Dept = ? WHERE Code = ?`;
        await pool.query(sql, [Dept, code]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update department' });
    }
};

const deleteDepartment = async (req, res) => {
    const { code } = req.params;
    try {
        await pool.query('DELETE FROM tbldept WHERE Code = ?', [code]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete department' });
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
        const [rows] = await pool.query('SELECT * FROM tbljobtitle ORDER BY Code ASC');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch job titles' });
    }
};

const createJobTitle = async (req, res) => {
    try {
        const [lastItem] = await pool.query('SELECT Code FROM tbljobtitle ORDER BY Code DESC LIMIT 1');
        let nextCode = '00001'; // Job titles are varchar(5)
        if (lastItem.length > 0) {
            const lastCodeInt = parseInt(lastItem[0].Code, 10);
            if (!isNaN(lastCodeInt)) {
                nextCode = (lastCodeInt + 1).toString().padStart(5, '0');
            }
        }

        const { JobTitle } = req.body;
        if (!JobTitle) return res.status(400).json({ error: 'Job Title is required' });

        const sql = `INSERT INTO tbljobtitle (Code, JobTitle, CompanyID) VALUES (?, ?, ?)`;
        await pool.query(sql, [nextCode, JobTitle, 1]);
        
        const [newRow] = await pool.query('SELECT * FROM tbljobtitle WHERE Code = ?', [nextCode]);
        res.json({ success: true, item: newRow[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create job title' });
    }
};

const updateJobTitle = async (req, res) => {
    const { code } = req.params;
    const { JobTitle } = req.body;

    if (!JobTitle) return res.status(400).json({ error: 'Job Title is required' });

    try {
        const sql = `UPDATE tbljobtitle SET JobTitle = ? WHERE Code = ?`;
        await pool.query(sql, [JobTitle, code]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update job title' });
    }
};

const deleteJobTitle = async (req, res) => {
    const { code } = req.params;
    try {
        await pool.query('DELETE FROM tbljobtitle WHERE Code = ?', [code]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete job title' });
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
  resendLink,
  deleteAdmin,
  managersNewPage,
  createManager,
  managersListPage,
  managersListJson,
  deleteManager,
  dataEntryListPage,
  dataEntryListJson,
  dataEntryNewPage,
  createDataEntry,
  deleteDataEntry,
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
};