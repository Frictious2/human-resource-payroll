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
        let nextCode = '0001';
        if (lastItem.length > 0) {
            const lastCodeInt = parseInt(lastItem[0].Code, 10);
            if (!isNaN(lastCodeInt)) {
                nextCode = (lastCodeInt + 1).toString().padStart(4, '0');
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
        const [lastItem] = await pool.query('SELECT GradeCode FROM tblgrade ORDER BY GradeCode DESC LIMIT 1');
        let nextCode = '0001';
        if (lastItem.length > 0) {
            const lastCodeInt = parseInt(lastItem[0].GradeCode, 10);
            if (!isNaN(lastCodeInt)) {
                nextCode = (lastCodeInt + 1).toString().padStart(4, '0');
            }
        }

        const { Grade, JobTitle, LDays, Medical, Confirm, NotchIncr, Notice, PromPeriod } = req.body;
        
        if (!Grade) return res.status(400).json({ error: 'Grade Name is required' });
        if (!JobTitle) return res.status(400).json({ error: 'Job Title is required' });

        const sql = `INSERT INTO tblgrade (GradeCode, Grade, JobTitle, LDays, Medical, Confirm, NotchIncr, Notice, PromPeriod, CompanyID) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        await pool.query(sql, [nextCode, Grade, JobTitle, LDays || 0, Medical || 0, Confirm || 0, NotchIncr || 0, Notice || 0, PromPeriod || 0, 1]);
        
        // Return the new row with JobTitle name
        const fetchSql = `
            SELECT g.GradeCode, g.Grade, g.JobTitle AS JobTitleCode, j.JobTitle AS JobTitleName,
                   g.LDays, g.Medical, g.Confirm, g.NotchIncr, g.Notice, g.PromPeriod
            FROM tblgrade g 
            LEFT JOIN tbljobtitle j ON g.JobTitle = j.Code 
            WHERE g.GradeCode = ?
        `;
        const [newRow] = await pool.query(fetchSql, [nextCode]);
        res.json({ success: true, item: newRow[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create grade' });
    }
};

const updateGrade = async (req, res) => {
    const { code } = req.params;
    const { Grade, JobTitle, LDays, Medical, Confirm, NotchIncr, Notice, PromPeriod } = req.body;

    try {
        // Build dynamic update query
        const fields = [];
        const values = [];

        if (Grade !== undefined) { fields.push('Grade = ?'); values.push(Grade); }
        if (JobTitle !== undefined) { fields.push('JobTitle = ?'); values.push(JobTitle); }
        if (LDays !== undefined) { fields.push('LDays = ?'); values.push(LDays); }
        if (Medical !== undefined) { fields.push('Medical = ?'); values.push(Medical); }
        if (Confirm !== undefined) { fields.push('Confirm = ?'); values.push(Confirm); }
        if (NotchIncr !== undefined) { fields.push('NotchIncr = ?'); values.push(NotchIncr); }
        if (Notice !== undefined) { fields.push('Notice = ?'); values.push(Notice); }
        if (PromPeriod !== undefined) { fields.push('PromPeriod = ?'); values.push(PromPeriod); }

        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

        const sql = `UPDATE tblgrade SET ${fields.join(', ')} WHERE GradeCode = ?`;
        values.push(code);

        await pool.query(sql, values);
        
        // Fetch updated row to return correct data
        const fetchSql = `
            SELECT g.GradeCode, g.Grade, g.JobTitle AS JobTitleCode, j.JobTitle AS JobTitleName,
                   g.LDays, g.Medical, g.Confirm, g.NotchIncr, g.Notice, g.PromPeriod
            FROM tblgrade g 
            LEFT JOIN tbljobtitle j ON g.JobTitle = j.Code 
            WHERE g.GradeCode = ?
        `;
        const [updatedRow] = await pool.query(fetchSql, [code]);
        
        res.json({ success: true, item: updatedRow[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update grade' });
    }
};

const deleteGrade = async (req, res) => {
    const { code } = req.params;
    try {
        await pool.query('DELETE FROM tblgrade WHERE GradeCode = ?', [code]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete grade' });
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
        const [rows] = await pool.query('SELECT * FROM tblbanks ORDER BY Code');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch banks' });
    }
};

const createBank = async (req, res) => {
    try {
        const [lastItem] = await pool.query('SELECT Code FROM tblbanks ORDER BY Code DESC LIMIT 1');
        let nextCode = '01';
        if (lastItem.length > 0) {
            const lastCodeInt = parseInt(lastItem[0].Code, 10);
            if (!isNaN(lastCodeInt)) {
                nextCode = (lastCodeInt + 1).toString().padStart(2, '0');
            }
        }

        const { Bank, Short, BankCode, Street_Address, Town_Address } = req.body;
        
        if (!Bank) return res.status(400).json({ error: 'Bank Name is required' });

        const sql = `INSERT INTO tblbanks (Code, Bank, Short, BankCode, Street_Address, Town_Address, CompanyID) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        await pool.query(sql, [nextCode, Bank, Short || null, BankCode || null, Street_Address || null, Town_Address || null, 1]);
        
        const [newRow] = await pool.query('SELECT * FROM tblbanks WHERE Code = ?', [nextCode]);
        res.json({ success: true, item: newRow[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create bank' });
    }
};

const updateBank = async (req, res) => {
    const { code } = req.params;
    const { Bank, Short, BankCode, Street_Address, Town_Address } = req.body;

    try {
        const fields = [];
        const values = [];

        if (Bank !== undefined) { fields.push('Bank = ?'); values.push(Bank); }
        if (Short !== undefined) { fields.push('Short = ?'); values.push(Short); }
        if (BankCode !== undefined) { fields.push('BankCode = ?'); values.push(BankCode); }
        if (Street_Address !== undefined) { fields.push('Street_Address = ?'); values.push(Street_Address); }
        if (Town_Address !== undefined) { fields.push('Town_Address = ?'); values.push(Town_Address); }

        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

        const sql = `UPDATE tblbanks SET ${fields.join(', ')} WHERE Code = ?`;
        values.push(code);

        await pool.query(sql, values);
        
        const [updatedRow] = await pool.query('SELECT * FROM tblbanks WHERE Code = ?', [code]);
        res.json({ success: true, item: updatedRow[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update bank' });
    }
};

const deleteBank = async (req, res) => {
    const { code } = req.params;
    try {
        await pool.query('DELETE FROM tblbanks WHERE Code = ?', [code]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete bank' });
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
        const [rows] = await pool.query('SELECT * FROM tblpayingbank ORDER BY Code');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch company bbans' });
    }
};

const createCompanyBBAN = async (req, res) => {
    try {
        const [lastItem] = await pool.query('SELECT Code FROM tblpayingbank ORDER BY Code DESC LIMIT 1');
        let nextCode = '01';
        if (lastItem.length > 0) {
            const lastCodeInt = parseInt(lastItem[0].Code, 10);
            if (!isNaN(lastCodeInt)) {
                nextCode = (lastCodeInt + 1).toString().padStart(2, '0');
            }
        }

        const { Bank, BBAN, Short } = req.body;
        
        if (!Bank) return res.status(400).json({ error: 'Bank Name is required' });

        const sql = `INSERT INTO tblpayingbank (Code, Bank, BBAN, Short, CompanyID) VALUES (?, ?, ?, ?, ?)`;
        await pool.query(sql, [nextCode, Bank, BBAN || null, Short || null, 1]);
        
        const [newRow] = await pool.query('SELECT * FROM tblpayingbank WHERE Code = ?', [nextCode]);
        res.json({ success: true, item: newRow[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create company bban' });
    }
};

const updateCompanyBBAN = async (req, res) => {
    const { code } = req.params;
    const { Bank, BBAN, Short } = req.body;

    try {
        const fields = [];
        const values = [];

        if (Bank !== undefined) { fields.push('Bank = ?'); values.push(Bank); }
        if (BBAN !== undefined) { fields.push('BBAN = ?'); values.push(BBAN); }
        if (Short !== undefined) { fields.push('Short = ?'); values.push(Short); }

        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

        const sql = `UPDATE tblpayingbank SET ${fields.join(', ')} WHERE Code = ?`;
        values.push(code);

        await pool.query(sql, values);
        
        const [updatedRow] = await pool.query('SELECT * FROM tblpayingbank WHERE Code = ?', [code]);
        res.json({ success: true, item: updatedRow[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update company bban' });
    }
};

const deleteCompanyBBAN = async (req, res) => {
    const { code } = req.params;
    try {
        await pool.query('DELETE FROM tblpayingbank WHERE Code = ?', [code]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete company bban' });
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
        const [rows] = await pool.query('SELECT * FROM tblglaccounts ORDER BY GLNo');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch gl accounts' });
    }
};

const createGLAccount = async (req, res) => {
    try {
        const [lastItem] = await pool.query('SELECT GLNo FROM tblglaccounts ORDER BY GLNo DESC LIMIT 1');
        let nextCode = '01';
        if (lastItem.length > 0) {
            const lastCodeInt = parseInt(lastItem[0].GLNo, 10);
            if (!isNaN(lastCodeInt)) {
                nextCode = (lastCodeInt + 1).toString().padStart(2, '0');
            }
        }

        const { AccountsHead, Code } = req.body;
        
        if (!AccountsHead) return res.status(400).json({ error: 'Account Head is required' });

        const sql = `INSERT INTO tblglaccounts (GLNo, AccountsHead, Code, CompanyID) VALUES (?, ?, ?, ?)`;
        await pool.query(sql, [nextCode, AccountsHead, Code || null, 1]);
        
        const [newRow] = await pool.query('SELECT * FROM tblglaccounts WHERE GLNo = ?', [nextCode]);
        res.json({ success: true, item: newRow[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create gl account' });
    }
};

const updateGLAccount = async (req, res) => {
    const { glNo } = req.params;
    const { AccountsHead, Code } = req.body;

    try {
        const fields = [];
        const values = [];

        if (AccountsHead !== undefined) { fields.push('AccountsHead = ?'); values.push(AccountsHead); }
        if (Code !== undefined) { fields.push('Code = ?'); values.push(Code); }

        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

        const sql = `UPDATE tblglaccounts SET ${fields.join(', ')} WHERE GLNo = ?`;
        values.push(glNo);

        await pool.query(sql, values);
        
        const [updatedRow] = await pool.query('SELECT * FROM tblglaccounts WHERE GLNo = ?', [glNo]);
        res.json({ success: true, item: updatedRow[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update gl account' });
    }
};

const deleteGLAccount = async (req, res) => {
    const { glNo } = req.params;
    try {
        await pool.query('DELETE FROM tblglaccounts WHERE GLNo = ?', [glNo]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete gl account' });
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
        const [rows] = await pool.query('SELECT * FROM tblreason ORDER BY ReasonCode');
        console.log('Discipline Reasons Data:', rows);
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch discipline reasons' });
    }
};

const createDisciplineReason = async (req, res) => {
    try {
        const [lastItem] = await pool.query('SELECT ReasonCode FROM tblreason ORDER BY ReasonCode DESC LIMIT 1');
        let nextCode = '01';
        if (lastItem.length > 0) {
            const lastCodeInt = parseInt(lastItem[0].ReasonCode, 10);
            if (!isNaN(lastCodeInt)) {
                nextCode = (lastCodeInt + 1).toString().padStart(2, '0');
            }
        }

        const { Reason } = req.body;
        if (!Reason) return res.status(400).json({ error: 'Reason is required' });

        await pool.query('INSERT INTO tblreason (ReasonCode, Reason, CompanyID) VALUES (?, ?, ?)', [nextCode, Reason, 1]);
        const [newRow] = await pool.query('SELECT * FROM tblreason WHERE ReasonCode = ?', [nextCode]);
        res.json({ success: true, item: newRow[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create discipline reason' });
    }
};

const updateDisciplineReason = async (req, res) => {
    const { code } = req.params;
    const { Reason } = req.body;
    try {
        await pool.query('UPDATE tblreason SET Reason = ? WHERE ReasonCode = ?', [Reason, code]);
        const [updatedRow] = await pool.query('SELECT * FROM tblreason WHERE ReasonCode = ?', [code]);
        res.json({ success: true, item: updatedRow[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update discipline reason' });
    }
};

const deleteDisciplineReason = async (req, res) => {
    const { code } = req.params;
    try {
        await pool.query('DELETE FROM tblreason WHERE ReasonCode = ?', [code]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete discipline reason' });
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
        const [rows] = await pool.query('SELECT * FROM tblqtype ORDER BY Code');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch queries' });
    }
};

const createQuery = async (req, res) => {
    try {
        const [lastItem] = await pool.query('SELECT Code FROM tblqtype ORDER BY Code DESC LIMIT 1');
        let nextCode = '01';
        if (lastItem.length > 0) {
            const lastCodeInt = parseInt(lastItem[0].Code, 10);
            if (!isNaN(lastCodeInt)) {
                nextCode = (lastCodeInt + 1).toString().padStart(2, '0');
            }
        }

        const { QType } = req.body;
        if (!QType) return res.status(400).json({ error: 'Query Type is required' });

        await pool.query('INSERT INTO tblqtype (Code, QType, CompanyID) VALUES (?, ?, ?)', [nextCode, QType, 1]);
        const [newRow] = await pool.query('SELECT * FROM tblqtype WHERE Code = ?', [nextCode]);
        res.json({ success: true, item: newRow[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create query' });
    }
};

const updateQuery = async (req, res) => {
    const { code } = req.params;
    const { QType } = req.body;
    try {
        await pool.query('UPDATE tblqtype SET QType = ? WHERE Code = ?', [QType, code]);
        const [updatedRow] = await pool.query('SELECT * FROM tblqtype WHERE Code = ?', [code]);
        res.json({ success: true, item: updatedRow[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update query' });
    }
};

const deleteQuery = async (req, res) => {
    const { code } = req.params;
    try {
        await pool.query('DELETE FROM tblqtype WHERE Code = ?', [code]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete query' });
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
        const [rows] = await pool.query('SELECT * FROM tblmreaction ORDER BY Code');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch discipline outcomes' });
    }
};

const createDisciplineOutcome = async (req, res) => {
    try {
        const [lastItem] = await pool.query('SELECT Code FROM tblmreaction ORDER BY Code DESC LIMIT 1');
        let nextCode = '01';
        if (lastItem.length > 0) {
            const lastCodeInt = parseInt(lastItem[0].Code, 10);
            if (!isNaN(lastCodeInt)) {
                nextCode = (lastCodeInt + 1).toString().padStart(2, '0');
            }
        }

        const { Reaction } = req.body;
        if (!Reaction) return res.status(400).json({ error: 'Reaction is required' });

        await pool.query('INSERT INTO tblmreaction (Code, Reaction, CompanyID) VALUES (?, ?, ?)', [nextCode, Reaction, 1]);
        const [newRow] = await pool.query('SELECT * FROM tblmreaction WHERE Code = ?', [nextCode]);
        res.json({ success: true, item: newRow[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create discipline outcome' });
    }
};

const updateDisciplineOutcome = async (req, res) => {
    const { code } = req.params;
    const { Reaction } = req.body;
    try {
        await pool.query('UPDATE tblmreaction SET Reaction = ? WHERE Code = ?', [Reaction, code]);
        const [updatedRow] = await pool.query('SELECT * FROM tblmreaction WHERE Code = ?', [code]);
        res.json({ success: true, item: updatedRow[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update discipline outcome' });
    }
};

const deleteDisciplineOutcome = async (req, res) => {
    const { code } = req.params;
    try {
        await pool.query('DELETE FROM tblmreaction WHERE Code = ?', [code]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete discipline outcome' });
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
};