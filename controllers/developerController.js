// Top imports
const pool = require('../config/db');
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;
const mailer = require('../config/mailer');
const jwt = require('jsonwebtoken');

const renderDashboard = (req, res) => {
  res.render('developer/developers-dashboard', { user: { name: 'David' } });
};

const comingSoon = (title, group) => {
  return (req, res) => {
    res.render('shared/coming-soon', {
      role: 'developer',
      title,
      group,
      user: { name: 'David' },
    });
  };
};

// List page
const listPage = async (req, res) => {
  res.render('developer/developers', { user: { name: 'David' } });
};

// List JSON for DataTables
const listJson = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT ID, username, email, FullName, dateCreated, createdBy FROM developer ORDER BY ID DESC'
    );
    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch developers' });
  }
};

// Add form page
const newPage = async (req, res) => {
  res.render('developer/developers-new', { user: { name: 'David' }, error: null });
};

// Create developer (with bcrypt hashing)
const createDeveloper = async (req, res) => {
  const { FullName, username, email, password, createdBy } = req.body;
  if (!FullName || !username || !email) {
    return res.status(400).render('developer/developers-new', {
      user: { name: 'David' },
      error: 'Full name, username, and email are required.',
    });
  }
  try {
    const hashed = password ? await bcrypt.hash(password, SALT_ROUNDS) : null;
    await pool.query(
      'INSERT INTO developer (FullName, username, email, password, createdBy) VALUES (?,?,?,?,?)',
      [FullName, username, email, hashed, createdBy || null]
    );
    res.redirect('/developer/developers');
  } catch (err) {
    console.error(err);
    res.status(500).render('developer/developers-new', {
      user: { name: 'David' },
      error: 'Failed to create developer.',
    });
  }
};

// Edit page
const editPage = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM developer WHERE ID = ?', [req.params.id]);
    if (!rows.length) return res.status(404).send('Developer not found');
    res.render('developer/developers-edit', { user: { name: 'David' }, dev: rows[0], error: null });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to load developer');
  }
};

// Update developer (conditional bcrypt hashing)
const updateDeveloper = async (req, res) => {
  const { FullName, username, email, password, createdBy } = req.body;
  try {
    if (password && password.trim().length > 0) {
      const hashed = await bcrypt.hash(password, SALT_ROUNDS);
      await pool.query(
        'UPDATE developer SET FullName=?, username=?, email=?, password=?, createdBy=? WHERE ID=?',
        [FullName, username, email, hashed, createdBy || null, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE developer SET FullName=?, username=?, email=?, createdBy=? WHERE ID=?',
        [FullName, username, email, createdBy || null, req.params.id]
      );
    }
    res.redirect('/developer/developers');
  } catch (err) {
    console.error(err);
    res.status(500).render('developer/developers-edit', {
      user: { name: 'David' },
      dev: { ID: req.params.id, FullName, username, email, password, createdBy },
      error: 'Failed to update developer.',
    });
  }
};

// Delete developer
const deleteDeveloper = async (req, res) => {
  try {
    await pool.query('DELETE FROM developer WHERE ID = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete developer' });
  }
};

// Companies: list page
const companiesListPage = async (req, res) => {
  res.render('developer/companies', { user: { name: 'David' } });
};

// Companies: list JSON for DataTables (include all table columns)
const companiesListJson = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT CompanyID, Com_Name, TinNo, Address, Town, City, Country,
              AccNo, Phone, Bank, PayingBank, Logopath, Email, Manager,
              DateCreated, SubscriptionType, SubscriptionPlanType, NoOfStaffLeft, StaffCapacity
       FROM tblcominfo
       ORDER BY CompanyID DESC`
    );
    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
};

// Companies: add form page
const companiesNewPage = async (req, res) => {
  res.render('developer/companies-new', { user: { name: 'David' }, error: null });
};

// Companies: create (only specified fields)
async function createCompany(req, res) {
    try {
        const {
            Com_Name, Email, Address, Town, City, Country,
            Phone, Manager
        } = req.body;

        // Basic insert (other fields can be added later by admin)
        const [result] = await pool.query(
            `INSERT INTO tblcominfo 
             (Com_Name, Email, Address, Town, City, Country, Phone, Manager, DateCreated) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURDATE())`,
            [Com_Name, Email, Address, Town, City, Country, Phone, Manager]
        );

        const companyId = result.insertId;

        // Compose company added email
        if (Email) {
            const subject = 'Your company has been added to HR Payroll';
            const html = `
                <p>Hello ${Com_Name || 'there'},</p>
                <p>Your company has been added into the system.</p>
                <p>The admin you provided (${Manager || 'Company Admin'}) will have their account created shortly. 
                Once created, they can use their admin account to set up your company information in the database.</p>
                <p>Company ID: ${companyId}</p>
                <p>Regards,<br/>HR Payroll</p>
            `;

            try {
                await mailer.sendMail({
                    from: process.env.SMTP_USER || 'info@hrpayroll.davisasmedia.com',
                    to: Email,
                    subject,
                    html
                });
            } catch (mailErr) {
                console.error('Company creation email failed:', mailErr.message);
            }
        }

        res.redirect('/developer/companies');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to create company');
    }
};
// define admin handlers (developer dashboard)
async function adminsListPage(req, res) {
  res.render('developer/admins', { user: { name: 'David' } });
}

async function adminsListJson(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT p.PFNo, p.Username, p.FullName, p.Email, p.CompanyID, p.DateCreated, c.Com_Name
       FROM tblpassword p
       LEFT JOIN tblcominfo c ON c.CompanyID = p.CompanyID
       ORDER BY p.PFNo DESC`
    );

    const data = rows.map(r => ({
      picture: `<img src="https://picsum.photos/seed/admin-${r.PFNo}/40" class="rounded-circle" alt="avatar">`,
      name: r.FullName || r.Username || '',
      email: r.Email || '',
      company: r.Com_Name || r.CompanyID || '',
      dateCreated: r.DateCreated ? new Date(r.DateCreated).toLocaleString() : '',
      actions: `
        <a href="/developer/admins/${r.PFNo}/set-password" class="btn btn-sm btn-warning">Set Password</a>
        <button data-id="${r.PFNo}" class="btn btn-sm btn-danger btn-delete-admin">Delete</button>
      `
    }));

    res.json({ data });
  } catch (err) {
    console.error(err);
    res.json({ data: [] });
  }
}

async function adminsNewPage(req, res) {
  try {
    const [companies] = await pool.query(`SELECT CompanyID, Com_Name FROM tblcominfo ORDER BY Com_Name`);
    res.render('developer/admins-new', { title: 'Add Admin', companies, user: { name: 'David' } });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to load form');
  }
}

async function createAdmin(req, res) {
  try {
    const { Username, Email, FullName, CompanyID } = req.body;

    const [result] = await pool.query(
      `INSERT INTO tblpassword (DateCreated, Level, Username, FullName, Pword, Email, CompanyID)
       VALUES (NOW(), 'Admin', ?, ?, NULL, ?, ?)`,
      [Username, FullName, Email, CompanyID || null]
    );

    const pfno = result.insertId;
    const token = jwt.sign({ pfno }, process.env.JWT_SECRET, { expiresIn: '30m' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const link = `${baseUrl}/developer/admins/${pfno}/set-password?token=${encodeURIComponent(token)}`;

    if (Email) {
      const subject = 'Set up your HR Payroll admin password';
      const html = `
        <p>Hello ${FullName || Username},</p>
        <p>An admin account has been created for you in HR Payroll${CompanyID ? ` (Company ID: ${CompanyID})` : ''}.</p>
        <p>Please click the link below to set your password. This link will expire in 30 minutes:</p>
        <p><a href="${link}">Set your password</a></p>
        <p>If you did not expect this email, you can ignore it.</p>
      `;
      try {
        await mailer.sendMail({
          from: process.env.SMTP_USER || 'info@hrpayroll.davisasmedia.com',
          to: Email,
          subject,
          html
        });
      } catch (mailErr) {
        console.error('Admin password email failed:', mailErr.message);
      }
    }

    res.redirect('/developer/admins');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to create admin');
  }
}

async function setAdminPasswordPage(req, res) {
  const { pfno } = req.params;
  const { token } = req.query;
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    res.render('developer/admins-set-password', { title: 'Set Password', pfno, token, user: { name: 'David' } });
  } catch {
    res.status(400).send('Invalid or expired link');
  }
}

async function setAdminPasswordUpdate(req, res) {
  const { pfno } = req.params;
  const { token } = req.query;
  const { password } = req.body;

  try {
    jwt.verify(token, process.env.JWT_SECRET);
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query(`UPDATE tblpassword SET Pword = ? WHERE PFNo = ?`, [hash, pfno]);
    res.redirect('/developer/admins');
  } catch (err) {
    console.error(err);
    res.status(400).send('Failed to set password (link invalid or expired)');
  }
}

async function deleteAdmin(req, res) {
  const { pfno } = req.params;
  try {
    await pool.query(`DELETE FROM tblpassword WHERE PFNo = ?`, [pfno]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
}

// exports block
module.exports = {
  renderDashboard,
  comingSoon,
  listPage,
  listJson,
  newPage,
  createDeveloper,
  editPage,
  updateDeveloper,
  deleteDeveloper,
  companiesListPage,
  companiesListJson,
  companiesNewPage,
  createCompany,
  adminsListPage,
  adminsListJson,
  adminsNewPage,
  createAdmin,
  setAdminPasswordPage,
  setAdminPasswordUpdate,
  deleteAdmin
};