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
const multer = require('multer');
const path = require('path');

// Configure Multer for logo uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './public/uploads/');
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
        res.render('admin/company-info', { 
            title: 'Company Information',
            group: 'Company Info',
            user: { name: 'David' },
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

        const LogoPath = req.file ? '/uploads/' + req.file.filename : req.body.currentLogo;

        // Check if company record exists
        const [rows] = await pool.query('SELECT CompanyID FROM tblcominfo LIMIT 1');
        
        if (rows.length > 0) {
            // Update
            await pool.query(
                `UPDATE tblcominfo SET 
                    Com_Name=?, TinNo=?, Address=?, Town=?, City=?, Country=?, 
                    AccNo=?, Phone=?, Bank=?, PayingBank=?, Email=?, Manager=?, LogoPath=? 
                 WHERE CompanyID=?`,
                [Com_Name, TinNo, Address, Town, City, Country, AccNo, Phone, Bank, PayingBank, Email, Manager, LogoPath, rows[0].CompanyID]
            );
        } else {
            // Insert
            await pool.query(
                `INSERT INTO tblcominfo (
                    Com_Name, TinNo, Address, Town, City, Country, 
                    AccNo, Phone, Bank, PayingBank, Email, Manager, LogoPath, DateCreated
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [Com_Name, TinNo, Address, Town, City, Country, AccNo, Phone, Bank, PayingBank, Email, Manager, LogoPath]
            );
        }

        res.redirect('/admin/company-info?success=Company info updated successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/company-info?error=Failed to update company info');
    }
}


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
        const [rows] = await pool.query('SELECT * FROM tblcoursetype ORDER BY CourseCode');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch courses' });
    }
};

const createCourse = async (req, res) => {
    try {
        const [lastItem] = await pool.query('SELECT CourseCode FROM tblcoursetype ORDER BY CourseCode DESC LIMIT 1');
        let nextCode = '01';
        if (lastItem.length > 0) {
            const lastCodeInt = parseInt(lastItem[0].CourseCode, 10);
            if (!isNaN(lastCodeInt)) {
                nextCode = (lastCodeInt + 1).toString().padStart(2, '0');
            }
        }

        const { CType } = req.body;
        if (!CType) return res.status(400).json({ error: 'Course Type is required' });

        await pool.query('INSERT INTO tblcoursetype (CourseCode, CType, CompanyID) VALUES (?, ?, ?)', [nextCode, CType, 1]);
        const [newRow] = await pool.query('SELECT * FROM tblcoursetype WHERE CourseCode = ?', [nextCode]);
        res.json({ success: true, item: newRow[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create course' });
    }
};

const updateCourse = async (req, res) => {
    const { code } = req.params;
    const { CType } = req.body;
    try {
        await pool.query('UPDATE tblcoursetype SET CType = ? WHERE CourseCode = ?', [CType, code]);
        const [updatedRow] = await pool.query('SELECT * FROM tblcoursetype WHERE CourseCode = ?', [code]);
        res.json({ success: true, item: updatedRow[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update course' });
    }
};

const deleteCourse = async (req, res) => {
    const { code } = req.params;
    try {
        await pool.query('DELETE FROM tblcoursetype WHERE CourseCode = ?', [code]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete course' });
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
        const [rows] = await pool.query('SELECT * FROM tblempstatus ORDER BY Code');
        res.json({ data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch emp status' });
    }
};

const createEmpStatus = async (req, res) => {
    try {
        const [lastItem] = await pool.query('SELECT Code FROM tblempstatus ORDER BY Code DESC LIMIT 1');
        let nextCode = '01';
        if (lastItem.length > 0) {
            const lastCodeInt = parseInt(lastItem[0].Code, 10);
            if (!isNaN(lastCodeInt)) {
                nextCode = (lastCodeInt + 1).toString().padStart(2, '0');
            }
        }

        const { EmpStatus } = req.body;
        if (!EmpStatus) return res.status(400).json({ error: 'Status is required' });

        await pool.query('INSERT INTO tblempstatus (Code, EmpStatus, CompanyID) VALUES (?, ?, ?)', [nextCode, EmpStatus, 1]);
        const [newRow] = await pool.query('SELECT * FROM tblempstatus WHERE Code = ?', [nextCode]);
        res.json({ success: true, item: newRow[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create emp status' });
    }
};

const updateEmpStatus = async (req, res) => {
    const { code } = req.params;
    const { EmpStatus } = req.body;
    try {
        await pool.query('UPDATE tblempstatus SET EmpStatus = ? WHERE Code = ?', [EmpStatus, code]);
        const [updatedRow] = await pool.query('SELECT * FROM tblempstatus WHERE Code = ?', [code]);
        res.json({ success: true, item: updatedRow[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update emp status' });
    }
};

const deleteEmpStatus = async (req, res) => {
    const { code } = req.params;
    try {
        await pool.query('DELETE FROM tblempstatus WHERE Code = ?', [code]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete emp status' });
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
        const {
            EOSDate,
            Y1, D1, R1,
            Y2, D2, R2,
            Y3, D3, R3,
            Y4, D4, R4,
            Y5, D5, R5,
            E1, E2, B1,
            E3, E4, B2,
            MinAge,
            Exemption, EOSTax,
            LS1, L1Percent, L1_USD,
            LS2, L2ercent, L2_USD,
            LS3, L3Percent, L3_USD
        } = req.body;

        // Check if record exists
        const [existing] = await pool.query('SELECT * FROM tbleoscalc LIMIT 1');

        if (existing.length > 0) {
            // Update logic
            let whereClause = '';
            let whereParams = [];
            
            if (existing[0].BankID) {
                whereClause = ' WHERE BankID = ?';
                whereParams = [existing[0].BankID];
            } else if (existing[0].CompanyID) {
                whereClause = ' WHERE CompanyID = ?';
                whereParams = [existing[0].CompanyID];
            }
            
            const sql = `UPDATE tbleoscalc SET 
                EOSDate = ?, 
                Y1 = ?, D1 = ?, R1 = ?,
                Y2 = ?, D2 = ?, R2 = ?,
                Y3 = ?, D3 = ?, R3 = ?,
                Y4 = ?, D4 = ?, R4 = ?,
                Y5 = ?, D5 = ?, R5 = ?,
                E1 = ?, E2 = ?, B1 = ?,
                E3 = ?, E4 = ?, B2 = ?,
                MinAge = ?,
                Exemption = ?, EOSTax = ?,
                LS1 = ?, L1Percent = ?, L1_USD = ?,
                LS2 = ?, L2ercent = ?, L2_USD = ?,
                LS3 = ?, L3Percent = ?, L3_USD = ?` + whereClause;
                
            await pool.query(sql, [
                EOSDate,
                Y1, D1, R1,
                Y2, D2, R2,
                Y3, D3, R3,
                Y4, D4, R4,
                Y5, D5, R5,
                E1, E2, B1,
                E3, E4, B2,
                MinAge,
                Exemption, EOSTax,
                LS1, L1Percent, L1_USD,
                LS2, L2ercent, L2_USD,
                LS3, L3Percent, L3_USD,
                ...whereParams
            ]);
            
            res.json({ success: true, message: 'Updated successfully' });
        } else {
            // Insert logic
            const sql = `INSERT INTO tbleoscalc (
                BankID, EOSDate, 
                Y1, D1, R1,
                Y2, D2, R2,
                Y3, D3, R3,
                Y4, D4, R4,
                Y5, D5, R5,
                E1, E2, B1,
                E3, E4, B2,
                MinAge,
                Exemption, EOSTax,
                LS1, L1Percent, L1_USD,
                LS2, L2ercent, L2_USD,
                LS3, L3Percent, L3_USD,
                CompanyID
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            
            await pool.query(sql, [
                '0001', EOSDate,
                Y1, D1, R1,
                Y2, D2, R2,
                Y3, D3, R3,
                Y4, D4, R4,
                Y5, D5, R5,
                E1, E2, B1,
                E3, E4, B2,
                MinAge,
                Exemption, EOSTax,
                LS1, L1Percent, L1_USD,
                LS2, L2ercent, L2_USD,
                LS3, L3Percent, L3_USD,
                1
            ]);
            res.json({ success: true, message: 'Created successfully' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save EOS data' });
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
        const {
            SeqNo, RegNo,
            NDate, NRate, NORate,
            GDate, GRate, GORate,
            RetireAge, ConfirmDays, ChildAge,
            EmpAge, Management, UnionDues,
            Max_Dependants, RetireNotice, AdvanceInt,
            QueryLimit, ClockIn, LoanDuration,
            HOD, Dept, DeptName,
            VPolicy
        } = req.body;

        const [existing] = await pool.query('SELECT * FROM tblparams1 LIMIT 1');
        
        if (existing.length > 0) {
            // Update
            const sql = `UPDATE tblparams1 SET 
                SeqNo=?, RegNo=?, 
                NDate=?, NRate=?, NORate=?, 
                GDate=?, GRate=?, GORate=?, 
                RetireAge=?, ConfirmDays=?, ChildAge=?, 
                EmpAge=?, Management=?, UnionDues=?, 
                Max_Dependants=?, RetireNotice=?, AdvanceInt=?, 
                QueryLimit=?, ClockIn=?, 
                HOD=?, Dept=?, DeptName=?, 
                VPolicy=?`;
                
            const params = [
                SeqNo, RegNo,
                NDate, NRate, NORate,
                GDate, GRate, GORate,
                RetireAge, ConfirmDays, ChildAge,
                EmpAge, Management, UnionDues,
                Max_Dependants, RetireNotice, AdvanceInt,
                QueryLimit, ClockIn,
                HOD, Dept, DeptName,
                VPolicy
            ];
            
            await pool.query(sql, params);
            res.json({ success: true, message: 'Updated successfully' });
        } else {
            // Insert
            const sql = `INSERT INTO tblparams1 (
                SeqNo, RegNo, 
                NDate, NRate, NORate, 
                GDate, GRate, GORate, 
                RetireAge, ConfirmDays, ChildAge, 
                EmpAge, Management, UnionDues, 
                Max_Dependants, RetireNotice, AdvanceInt, 
                QueryLimit, ClockIn, 
                HOD, Dept, DeptName, 
                VPolicy, CompanyID
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            
            const params = [
                SeqNo, RegNo,
                NDate, NRate, NORate,
                GDate, GRate, GORate,
                RetireAge, ConfirmDays, ChildAge,
                EmpAge, Management, UnionDues,
                Max_Dependants, RetireNotice, AdvanceInt,
                QueryLimit, ClockIn,
                HOD, Dept, DeptName,
                VPolicy, 1
            ];
            
            await pool.query(sql, params);
            res.json({ success: true, message: 'Created successfully' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save Global Params' });
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
        const days = req.body; // Expecting an array of objects
        
        // We'll use a transaction to ensure all updates succeed or fail together
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            for (const day of days) {
                const { DayNo, WDayNo, WorkDay } = day;
                // WorkDay should be -1 for true, 0 for false based on schema observation
                // But let's trust what the frontend sends if we normalize it there.
                // Or normalize here.
                
                await connection.query(
                    'UPDATE tblweek SET WDayNo = ?, WorkDay = ? WHERE DayNo = ?',
                    [WDayNo, WorkDay, DayNo]
                );
            }
            await connection.commit();
            res.json({ success: true, message: 'Work days updated successfully' });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save Work Days' });
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
        const sql = `INSERT INTO tblpublic_holidays (Pub_Date, Pub_Year, Pub_Name, HDate, Approved, CompanyID, DateKeyedIn) VALUES (?, ?, ?, ?, ?, ?, NOW())`;
        await pool.query(sql, [Pub_Date || null, Pub_Year, Pub_Name, HDate, Approved || 0, 1]);
        
        const [rows] = await pool.query('SELECT * FROM tblpublic_holidays WHERE Pub_Year = ? AND Pub_Name = ?', [Pub_Year, Pub_Name]);
        res.json({ success: true, item: rows[0] });
    } catch (err) {
        console.error(err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Holiday with this Year and Name already exists' });
        }
        res.status(500).json({ error: 'Failed to create public holiday' });
    }
};

const updatePublicHoliday = async (req, res) => {
    const { year, name } = req.params;
    const { Pub_Date, Pub_Year, Pub_Name, HDate, Approved } = req.body;
    
    try {
        const fields = [];
        const values = [];
        
        if (Pub_Date !== undefined) { fields.push('Pub_Date = ?'); values.push(Pub_Date || null); }
        if (Pub_Year !== undefined) { fields.push('Pub_Year = ?'); values.push(Pub_Year); }
        if (Pub_Name !== undefined) { fields.push('Pub_Name = ?'); values.push(Pub_Name); }
        if (HDate !== undefined) { fields.push('HDate = ?'); values.push(HDate); }
        if (Approved !== undefined) { fields.push('Approved = ?'); values.push(Approved); }
        
        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
        
        const sql = `UPDATE tblpublic_holidays SET ${fields.join(', ')} WHERE Pub_Year = ? AND Pub_Name = ?`;
        values.push(year, name);
        
        await pool.query(sql, values);
        
        const newYear = Pub_Year !== undefined ? Pub_Year : year;
        const newName = Pub_Name !== undefined ? Pub_Name : name;
        
        const [rows] = await pool.query('SELECT * FROM tblpublic_holidays WHERE Pub_Year = ? AND Pub_Name = ?', [newYear, newName]);
        res.json({ success: true, item: rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update public holiday' });
    }
};

const deletePublicHoliday = async (req, res) => {
    const { year, name } = req.params;
    try {
        await pool.query('DELETE FROM tblpublic_holidays WHERE Pub_Year = ? AND Pub_Name = ?', [year, name]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete public holiday' });
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
        await pool.query(
            'INSERT INTO tblCourseSponsor (SCode, Sponsor, CompanyID) VALUES (?, ?, ?)',
            [SCode, Sponsor, 1] // Assuming CompanyID 1 for now
        );
        res.status(201).json({ message: 'Sponsor added successfully' });
    } catch (error) {
        console.error('Error adding sponsor:', error);
        res.status(500).json({ message: 'Error adding sponsor' });
    }
};

const updateSponsor = async (req, res) => {
    const { SCode } = req.params;
    const { Sponsor } = req.body;
    try {
        await pool.query(
            'UPDATE tblCourseSponsor SET Sponsor = ? WHERE SCode = ?',
            [Sponsor, SCode]
        );
        res.json({ message: 'Sponsor updated successfully' });
    } catch (error) {
        console.error('Error updating sponsor:', error);
        res.status(500).json({ message: 'Error updating sponsor' });
    }
};

const deleteSponsor = async (req, res) => {
    const { SCode } = req.params;
    try {
        await pool.query('DELETE FROM tblCourseSponsor WHERE SCode = ?', [SCode]);
        res.json({ message: 'Sponsor deleted successfully' });
    } catch (error) {
        console.error('Error deleting sponsor:', error);
        res.status(500).json({ message: 'Error deleting sponsor' });
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

const saveTaxTable = async (req, res) => {
    const { 
        TaxDate, 
        R1, R1Tax, 
        R2, R2Tax, 
        R3, R3Tax, 
        R4, R4Tax, 
        R5, R5Tax, 
        R6, R6Tax, 
        R7, R7Tax, 
        RentThreshold, AllwThreshold, Withholding_Tax 
    } = req.body;

    try {
        // Check if record exists
        const [rows] = await pool.query('SELECT * FROM tbltax WHERE CompanyID = 1');
        
        if (rows.length > 0) {
            // Update
            const sql = `UPDATE tbltax SET 
                TaxDate = ?, 
                R1 = ?, R1Tax = ?, 
                R2 = ?, R2Tax = ?, 
                R3 = ?, R3Tax = ?, 
                R4 = ?, R4Tax = ?, 
                R5 = ?, R5Tax = ?, 
                R6 = ?, R6Tax = ?, 
                R7 = ?, R7Tax = ?, 
                RentThreshold = ?, AllwThreshold = ?, Withholding_Tax = ?
                WHERE CompanyID = 1`;
            
            const values = [
                TaxDate, 
                R1, R1Tax, 
                R2, R2Tax, 
                R3, R3Tax, 
                R4, R4Tax, 
                R5, R5Tax, 
                R6, R6Tax, 
                R7, R7Tax, 
                RentThreshold, AllwThreshold, Withholding_Tax
            ];
            
            await pool.query(sql, values);
        } else {
            // Insert
            const sql = `INSERT INTO tbltax (
                TaxDate, 
                R1, R1Tax, 
                R2, R2Tax, 
                R3, R3Tax, 
                R4, R4Tax, 
                R5, R5Tax, 
                R6, R6Tax, 
                R7, R7Tax, 
                RentThreshold, AllwThreshold, Withholding_Tax, 
                CompanyID
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`;
            
            const values = [
                TaxDate, 
                R1, R1Tax, 
                R2, R2Tax, 
                R3, R3Tax, 
                R4, R4Tax, 
                R5, R5Tax, 
                R6, R6Tax, 
                R7, R7Tax, 
                RentThreshold, AllwThreshold, Withholding_Tax
            ];
            
            await pool.query(sql, values);
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save tax table' });
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