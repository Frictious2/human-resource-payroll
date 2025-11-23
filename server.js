const express = require('express');
const path = require('path');

const app = express();

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Body parsing for form POSTs
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// After login, land on Admin dashboard (keeps your current behavior)
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).render('login', { error: 'Email and password are required.' });
    }

    // TODO: Replace with your actual authentication logic
    // For now, simulate success:
    res.send(`Logged in as ${email}`);
    // Simulate success: redirect to the dashboard
    res.redirect('/dashboard');
});

// Redirect /dashboard to Admin dashboard
app.get('/dashboard', (req, res) => {
    res.redirect('/admin/dashboard');
});

// Wire route modules
const adminRoutes = require('./routes/admin');
const developerRoutes = require('./routes/developer');
app.use('/admin', adminRoutes);
app.use('/developer', developerRoutes);

// Admin dashboard routes
app.get('/admin', (req, res) => {
    res.redirect('/admin/dashboard');
});
app.get('/admin/dashboard', (req, res) => {
    res.render('admin/admin-dashboard', { user: { name: 'David' } });
});

// Developer dashboard route stays as-is
app.get('/developer', (req, res) => {
    res.redirect('/developer/dashboard');
});
app.get('/developer/dashboard', (req, res) => {
    res.render('developer/developers-dashboard', { user: { name: 'David' } });
});

app.get('/logout', (req, res) => {
    res.redirect('/login');
});

// Server start
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});