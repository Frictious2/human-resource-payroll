const statementReportService = require('../services/statementReportService');
const { getWorkspaceContext } = require('../utils/workspaceContext');

function getCompanyId(req) {
    return req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1;
}

function getViewUser(req, fallbackRoleLabel) {
    return req.session?.user || req.user || { name: fallbackRoleLabel, role: fallbackRoleLabel };
}

function buildWorkspaceView(req, fallbackRole) {
    const workspace = getWorkspaceContext(req, fallbackRole);
    return {
        partialsBase: workspace.partialsBase,
        dashboardPath: workspace.dashboardPath,
        workspaceLabel: workspace.workspaceLabel
    };
}

async function renderNassitGratuityReport(req, res, fallbackRole) {
    const workspace = buildWorkspaceView(req, fallbackRole);
    try {
        const pageData = await statementReportService.getNassitGratuityReportData({
            companyId: getCompanyId(req),
            filters: req.query
        });

        res.render('reports/nassit_gratuity', {
            title: 'NASSIT / Gratuity Statement',
            path: req.baseUrl + req.path,
            user: getViewUser(req, workspace.workspaceLabel),
            ...workspace,
            branding: {
                companyName: pageData.company.Com_Name,
                logoPath: pageData.company.LogoPath
            },
            pageData
        });
    } catch (error) {
        console.error('NASSIT / Gratuity report error:', error);
        res.status(error.expose ? 400 : 500).render('shared/coming-soon', {
            role: req.user?.role || fallbackRole,
            title: 'Report Error',
            group: 'Reports',
            user: getViewUser(req, workspace?.workspaceLabel || fallbackRole),
            message: error.expose ? error.message : 'Unable to generate the NASSIT / Gratuity statement right now.'
        });
    }
}

async function renderBioDataReport(req, res, fallbackRole) {
    const workspace = buildWorkspaceView(req, fallbackRole);
    try {
        const pageData = await statementReportService.getBioDataReportData({
            companyId: getCompanyId(req),
            filters: req.query
        });

        res.render('reports/bio_data_statement', {
            title: 'Bio Data Report',
            path: req.baseUrl + req.path,
            user: getViewUser(req, workspace.workspaceLabel),
            ...workspace,
            branding: {
                companyName: pageData.company.Com_Name,
                logoPath: pageData.company.LogoPath
            },
            pageData
        });
    } catch (error) {
        console.error('Bio data report error:', error);
        res.status(error.expose ? 400 : 500).render('shared/coming-soon', {
            role: req.user?.role || fallbackRole,
            title: 'Report Error',
            group: 'Reports',
            user: getViewUser(req, fallbackRole),
            message: error.expose ? error.message : 'Unable to generate the Bio Data report right now.'
        });
    }
}

module.exports = {
    getDataEntryNassitGratuityReport(req, res) {
        return renderNassitGratuityReport(req, res, 'data-entry');
    },
    getManagerNassitGratuityReport(req, res) {
        return renderNassitGratuityReport(req, res, 'manager');
    },
    getFinanceNassitGratuityReport(req, res) {
        return renderNassitGratuityReport(req, res, 'finance-officer');
    },
    getDataEntryBioDataReport(req, res) {
        return renderBioDataReport(req, res, 'data-entry');
    },
    getManagerBioDataReport(req, res) {
        return renderBioDataReport(req, res, 'manager');
    }
};
