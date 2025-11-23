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

module.exports = {
  renderDashboard,
  comingSoon,
};