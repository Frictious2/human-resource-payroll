const pool = require('../config/db');

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

// Create developer
const createDeveloper = async (req, res) => {
  const { FullName, username, email, password, createdBy } = req.body;
  if (!FullName || !username || !email) {
    return res.status(400).render('developer/developers-new', {
      user: { name: 'David' },
      error: 'Full name, username, and email are required.',
    });
  }
  try {
    await pool.query(
      'INSERT INTO developer (FullName, username, email, password, createdBy) VALUES (?,?,?,?,?)',
      [FullName, username, email, password || null, createdBy || null]
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

// Update developer
const updateDeveloper = async (req, res) => {
  const { FullName, username, email, password, createdBy } = req.body;
  try {
    await pool.query(
      'UPDATE developer SET FullName=?, username=?, email=?, password=?, createdBy=? WHERE ID=?',
      [FullName, username, email, password || null, createdBy || null, req.params.id]
    );
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
};