function normalizeRole(role) {
    return String(role || '').trim().toLowerCase();
}

function getPartialsBaseForRole(role) {
    switch (normalizeRole(role)) {
        case 'admin':
            return 'admin/partials';
        case 'manager':
            return 'manager/partials';
        case 'auditor':
            return 'auditor/partials';
        case 'developer':
            return 'developer/partials';
        case 'entity-head':
            return 'entity_head/partials';
        case 'finance-officer':
            return 'finance/partials';
        case 'finance-manager':
            return 'finance_manager/partials';
        case 'data-entry':
        default:
            return 'data_entry/partials';
    }
}

function getWorkspaceLabelForRole(role) {
    switch (normalizeRole(role)) {
        case 'finance-officer':
            return 'Finance Officer';
        case 'finance-manager':
            return 'Finance Manager';
        case 'data-entry':
            return 'Data Entry';
        case 'manager':
            return 'Manager';
        case 'auditor':
            return 'Auditor';
        case 'entity-head':
            return 'Entity Head';
        case 'admin':
            return 'Admin';
        case 'developer':
            return 'Developer';
        default:
            return 'User';
    }
}

function getDashboardPathForRole(role) {
    switch (normalizeRole(role)) {
        case 'finance-officer':
            return '/finance/dashboard';
        case 'finance-manager':
            return '/finance-manager/dashboard';
        case 'manager':
            return '/manager/dashboard';
        case 'auditor':
            return '/auditor/dashboard';
        case 'entity-head':
            return '/entity-head/dashboard';
        case 'admin':
            return '/admin/dashboard';
        case 'developer':
            return '/developer/dashboard';
        case 'data-entry':
        default:
            return '/data-entry/dashboard';
    }
}

function getWorkspaceContext(req, fallbackRole = null) {
    const role = normalizeRole(req.user?.role || req.session?.user?.role || fallbackRole || 'data-entry');
    return {
        role,
        workspaceLabel: getWorkspaceLabelForRole(role),
        partialsBase: getPartialsBaseForRole(role),
        dashboardPath: getDashboardPathForRole(role),
        isFinance: role === 'finance-officer',
        isFinanceManager: role === 'finance-manager'
    };
}

module.exports = {
    getDashboardPathForRole,
    getPartialsBaseForRole,
    getWorkspaceContext,
    getWorkspaceLabelForRole
};
