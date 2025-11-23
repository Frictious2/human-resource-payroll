const express = require('express');
const path = require('path');

const app = express();

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Body parsing for form POSTs
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
    // If session/auth is added later, clear it here
    res.redirect('/login');
});

// Developers Dashboard routes
app.get('/developer', (req, res) => {
    res.redirect('/developer/dashboard');
});
app.get('/developer/dashboard', (req, res) => {
    res.render('developer/developers-dashboard', { user: { name: 'David' } });
});

// Helper: render shared Coming Soon page with role-based layout
function comingSoon(role, title, group) {
    return (req, res) =>
        res.render('shared/coming-soon', { role, title, group, user: { name: 'David' } });
}

// Admin subnav routes
app.get('/admin/admins', comingSoon('admin', 'Admins', 'Admin'));
app.get('/admin/admins/new', comingSoon('admin', 'Add Admin', 'Admin'));

app.get('/admin/managers', comingSoon('admin', 'Managers', 'Manager'));
app.get('/admin/managers/new', comingSoon('admin', 'Add Manager', 'Manager'));

app.get('/admin/data-entry-officers', comingSoon('admin', 'Data Entry Officers', 'Data Entry'));
app.get('/admin/data-entry-officers/new', comingSoon('admin', 'Add Data Entry Officer', 'Data Entry'));

app.get('/admin/parameters/payroll-items', comingSoon('admin', 'Payroll Items', 'Parameters'));
app.get('/admin/parameters/departments', comingSoon('admin', 'Department', 'Parameters'));
app.get('/admin/parameters/job-titles', comingSoon('admin', 'Job Title', 'Parameters'));
app.get('/admin/parameters/grades', comingSoon('admin', 'Grade', 'Parameters'));
app.get('/admin/parameters/banks', comingSoon('admin', 'Banks', 'Parameters'));
app.get('/admin/parameters/company-bban', comingSoon('admin', 'Company BBAN', 'Parameters'));
app.get('/admin/parameters/gl-accounts', comingSoon('admin', 'GL Accounts', 'Parameters'));
app.get('/admin/parameters/discipline-outcomes', comingSoon('admin', 'Discipline Outcomes', 'Parameters'));
app.get('/admin/parameters/discipline-reasons', comingSoon('admin', 'Discipline Reasons', 'Parameters'));
app.get('/admin/parameters/queries', comingSoon('admin', 'Queries', 'Parameters'));
app.get('/admin/parameters/courses', comingSoon('admin', 'Courses', 'Parameters'));
app.get('/admin/parameters/emp-status', comingSoon('admin', 'EMP Status', 'Parameters'));
app.get('/admin/parameters/service-benefit', comingSoon('admin', 'Service Benefit', 'Parameters'));
app.get('/admin/parameters/global-params', comingSoon('admin', 'Global Params', 'Parameters'));
app.get('/admin/parameters/work-days', comingSoon('admin', 'Work Days', 'Parameters'));
app.get('/admin/parameters/public-holidays', comingSoon('admin', 'Public Holidays', 'Parameters'));
app.get('/admin/parameters/tax-table', comingSoon('admin', 'Tax Table', 'Parameters'));
app.get('/admin/parameters/sponsors', comingSoon('admin', 'Sponsors', 'Parameters'));

app.get('/admin/activities/enquiry', comingSoon('admin', 'Enquiry', 'Activities'));
app.get('/admin/activities/staff-file', comingSoon('admin', 'Staff File', 'Activities'));
app.get('/admin/activities/import', comingSoon('admin', 'Import', 'Activities'));
app.get('/admin/activities/discipline', comingSoon('admin', 'Discipline', 'Activities'));

app.get('/admin/reports/voucher', comingSoon('admin', 'Voucher', 'Reports'));
app.get('/admin/reports/payslip', comingSoon('admin', 'Pay slip', 'Reports'));
app.get('/admin/reports/end-of-service', comingSoon('admin', 'End of Service', 'Reports'));

app.get('/admin/company-info', comingSoon('admin', 'Company Info', 'Company Info'));

// Developer subnav routes
app.get('/developer/developers', comingSoon('developer', 'Developers', 'Developers'));
app.get('/developer/developers/new', comingSoon('developer', 'Add Developer', 'Developers'));

app.get('/developer/companies', comingSoon('developer', 'Companies', 'Company'));
app.get('/developer/companies/new', comingSoon('developer', 'Add Company', 'Company'));

app.get('/developer/admins', comingSoon('developer', 'Admins', 'Admin'));
app.get('/developer/admins/new', comingSoon('developer', 'Add Admin', 'Admin'));

app.get('/developer/licenses', comingSoon('developer', 'Licenses', 'License'));
app.get('/developer/licenses/new', comingSoon('developer', 'Add License', 'License'));

app.get('/logout', (req, res) => {
    // If session/auth is added later, clear it here
    res.redirect('/login');
});

// Developers Dashboard routes
app.get('/developer', (req, res) => {
    res.redirect('/developer/dashboard');
});
app.get('/developer/dashboard', (req, res) => {
    res.render('developer/developers-dashboard', { user: { name: 'David' } });
});

// Server start
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});