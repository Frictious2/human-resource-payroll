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

module.exports = {
  renderDashboard,
  comingSoon,
};