const dataEntryController = {
    getDashboard: (req, res) => {
        res.render('data_entry/dashboard', {
            title: 'Data Entry Dashboard',
            path: '/data-entry/dashboard',
            user: { name: 'Data Entry Clerk' } // Mock user for now
        });
    },

    getComingSoon: (req, res) => {
        // Extract title and group from the URL path for better context
        const parts = req.path.split('/').filter(p => p);
        const title = parts.length > 0 ? parts[parts.length - 1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Feature';
        const group = parts.length > 1 ? parts[parts.length - 2].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Data Entry';

        res.render('shared/coming-soon', {
            title: `${title} - Coming Soon`,
            path: req.path,
            user: { name: 'Data Entry Clerk' },
            role: 'data_entry', // Important for the coming-soon template to know which partials to load
            group: group,
            page: title
        });
    }
};

module.exports = dataEntryController;
