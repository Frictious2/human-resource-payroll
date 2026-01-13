const managerController = {
  getDashboard: (req, res) => {
    res.render('manager/dashboard', { user: { name: 'Manager' } });
  },

  getComingSoon: (req, res) => {
    // Infer title from path, e.g. /enquiry/staff -> Staff
    // req.path might be just /staff if mounted at /manager/enquiry, but here it's mounted at /manager and routes are /enquiry/staff
    // Actually, in routes/manager.js: router.get('/enquiry/staff', ...)
    // So req.path will be '/enquiry/staff'
    
    const parts = req.path.split('/').filter(p => p);
    const title = parts.length > 0 ? parts[parts.length - 1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Feature';
    const group = parts.length > 1 ? parts[parts.length - 2].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Manager';

    res.render('shared/coming-soon', { 
      user: { name: 'Manager' },
      role: 'manager',
      group: group,
      title: title
    });
  }
};

module.exports = managerController;
