const payrollLiabilityReportService = require('../services/payrollLiabilityReportService');
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

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatMoney(value) {
    return Number(value || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function buildExcelTableHtml({ title, companyName, companyAddress, subtitle, rows, columns }) {
    const headerCells = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('');
    const bodyRows = rows.map((row) => {
        const cells = columns.map((column) => {
            const raw = row[column.key];
            const value = column.type === 'money' ? formatMoney(raw) : escapeHtml(raw);
            return `<td>${value}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8" />
    <style>
        body { font-family: Arial, sans-serif; }
        .meta { margin-bottom: 12px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #222; padding: 6px 8px; }
        th { background: #f2f2f2; }
    </style>
</head>
<body>
    <div class="meta">
        <div><strong>${escapeHtml(companyName)}</strong></div>
        <div>${escapeHtml(companyAddress)}</div>
        <div><strong>${escapeHtml(title)}</strong></div>
        <div>${escapeHtml(subtitle)}</div>
    </div>
    <table>
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${bodyRows || '<tr><td colspan="' + columns.length + '">No rows found.</td></tr>'}</tbody>
    </table>
</body>
</html>`;
}

function renderErrorPage(req, res, fallbackRole, workspace, title, message, statusCode = 400) {
    return res.status(statusCode).render('shared/coming-soon', {
        role: req.user?.role || fallbackRole,
        title,
        group: 'Reports',
        user: getViewUser(req, workspace?.workspaceLabel || fallbackRole),
        message
    });
}

async function getFinanceIndex(req, res) {
    const workspace = buildWorkspaceView(req, 'finance-officer');
    try {
        const pageData = await payrollLiabilityReportService.getFinanceIndexPageData({
            companyId: getCompanyId(req),
            filters: req.query
        });

        res.render('reports/payroll_liabilities/index', {
            title: 'Payroll Liabilities',
            path: '/finance/reports/payroll-liabilities',
            user: getViewUser(req, workspace.workspaceLabel),
            ...workspace,
            branding: {
                companyName: pageData.company.Com_Name,
                logoPath: pageData.company.LogoPath
            },
            pageData
        });
    } catch (error) {
        console.error('Payroll liabilities page error:', error);
        return renderErrorPage(
            req,
            res,
            'finance-officer',
            workspace,
            'Report Error',
            error.expose ? error.message : 'Unable to load the Payroll Liabilities page right now.',
            error.expose ? 400 : 500
        );
    }
}

async function getFinancePreview(req, res) {
    const workspace = buildWorkspaceView(req, 'finance-officer');
    try {
        const pageData = await payrollLiabilityReportService.getPayrollLiabilityReportData({
            companyId: getCompanyId(req),
            filters: req.query
        });

        res.render('reports/payroll_liabilities/preview', {
            title: 'Payroll Liabilities Report',
            path: '/finance/reports/payroll-liabilities/preview',
            user: getViewUser(req, workspace.workspaceLabel),
            ...workspace,
            branding: {
                companyName: pageData.company.Com_Name,
                logoPath: pageData.company.LogoPath
            },
            pageData
        });
    } catch (error) {
        console.error('Payroll liabilities preview error:', error);
        return renderErrorPage(
            req,
            res,
            'finance-officer',
            workspace,
            'Payroll Liabilities Report',
            error.expose ? error.message : 'Unable to generate the Payroll Liabilities report right now.',
            error.expose ? 400 : 500
        );
    }
}

async function getFinancePdf(req, res) {
    const workspace = buildWorkspaceView(req, 'finance-officer');
    try {
        const pageData = await payrollLiabilityReportService.getPayrollLiabilityReportData({
            companyId: getCompanyId(req),
            filters: { ...req.query, autoDownloadPdf: '1' }
        });

        res.render('reports/payroll_liabilities/preview', {
            title: 'Payroll Liabilities Report',
            path: '/finance/reports/payroll-liabilities/pdf',
            user: getViewUser(req, workspace.workspaceLabel),
            ...workspace,
            branding: {
                companyName: pageData.company.Com_Name,
                logoPath: pageData.company.LogoPath
            },
            pageData
        });
    } catch (error) {
        console.error('Payroll liabilities PDF error:', error);
        return renderErrorPage(
            req,
            res,
            'finance-officer',
            workspace,
            'Payroll Liabilities Report',
            error.expose ? error.message : 'Unable to prepare the Payroll Liabilities PDF right now.',
            error.expose ? 400 : 500
        );
    }
}

async function getFinanceExcel(req, res) {
    const workspace = buildWorkspaceView(req, 'finance-officer');
    try {
        const pageData = await payrollLiabilityReportService.getPayrollLiabilityReportData({
            companyId: getCompanyId(req),
            filters: req.query
        });

        if (!pageData.report.supported) {
            return renderErrorPage(
                req,
                res,
                'finance-officer',
                workspace,
                'Payroll Liabilities Report',
                pageData.report.sourceSummary,
                400
            );
        }

        const columnMap = {
            PAYE: [
                { key: 'Serial No', label: 'Serial No' },
                { key: 'Employee Name', label: "Employee's Name" },
                { key: 'Emp-ID / PFNo', label: 'Emp-ID / PFNo' },
                { key: 'Basic Monthly Salary', label: 'Basic Monthly Salary', type: 'money' },
                { key: 'Less NASSIT Deduction', label: 'Less NASSIT Deduction', type: 'money' },
                { key: 'Monthly Allowance', label: 'Monthly Allowance', type: 'money' },
                { key: 'Gross Monthly Emoluments', label: 'Gross Monthly Emoluments', type: 'money' },
                { key: 'Tax Deducted', label: 'Tax Deducted', type: 'money' }
            ],
            NASSIT: [
                { key: 'No.', label: 'No.' },
                { key: 'NASSIT No', label: 'NASSIT No' },
                { key: 'Name', label: 'Name' },
                { key: 'Emp-ID / PFNo', label: 'Emp-ID / PFNo' },
                { key: 'Monthly Salary', label: 'Monthly Salary', type: 'money' },
                { key: 'Employee Contribution', label: 'Employee Contribution', type: 'money' },
                { key: 'Employer Contribution', label: 'Employer Contribution', type: 'money' },
                { key: 'Total', label: 'Total', type: 'money' }
            ],
            EOS: [
                { key: 'Serial No', label: 'Serial No' },
                { key: 'Employee Name', label: "Employee's Name" },
                { key: 'Emp-ID / PFNo', label: 'Emp-ID / PFNo' },
                { key: 'Total EOS Benefit', label: 'Total EOS Benefit', type: 'money' },
                { key: 'Taxable Leave Allowance', label: 'Taxable Leave Allowance', type: 'money' },
                { key: 'Tax Deducted', label: 'Tax Deducted', type: 'money' }
            ]
        };

        const html = buildExcelTableHtml({
            title: pageData.report.title,
            companyName: pageData.company.Com_Name,
            companyAddress: pageData.company.fullAddress,
            subtitle: pageData.report.subtitle,
            rows: pageData.exportRows,
            columns: columnMap[pageData.report.liabilityType] || []
        });

        res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${pageData.filenames.excel}"`);
        res.send(html);
    } catch (error) {
        console.error('Payroll liabilities Excel export error:', error);
        return renderErrorPage(
            req,
            res,
            'finance-officer',
            workspace,
            'Payroll Liabilities Report',
            error.expose ? error.message : 'Unable to export the Payroll Liabilities report to Excel right now.',
            error.expose ? 400 : 500
        );
    }
}

async function getFinanceStaffPreview(req, res) {
    const workspace = buildWorkspaceView(req, 'finance-officer');
    try {
        const pageData = await payrollLiabilityReportService.getStaffPayeStatementData({
            companyId: getCompanyId(req),
            filters: req.query
        });

        res.render('reports/payroll_liabilities/staff_statement', {
            title: 'Staff PAYE Statement',
            path: '/finance/reports/payroll-liabilities/staff-preview',
            user: getViewUser(req, workspace.workspaceLabel),
            ...workspace,
            branding: {
                companyName: pageData.company.Com_Name,
                logoPath: pageData.company.LogoPath
            },
            pageData
        });
    } catch (error) {
        console.error('Staff PAYE statement preview error:', error);
        return renderErrorPage(
            req,
            res,
            'finance-officer',
            workspace,
            'Staff PAYE Statement',
            error.expose ? error.message : 'Unable to generate the staff PAYE statement right now.',
            error.expose ? 400 : 500
        );
    }
}

async function getFinanceStaffPdf(req, res) {
    const workspace = buildWorkspaceView(req, 'finance-officer');
    try {
        const pageData = await payrollLiabilityReportService.getStaffPayeStatementData({
            companyId: getCompanyId(req),
            filters: { ...req.query, autoDownloadPdf: '1' }
        });

        res.render('reports/payroll_liabilities/staff_statement', {
            title: 'Staff PAYE Statement',
            path: '/finance/reports/payroll-liabilities/staff-pdf',
            user: getViewUser(req, workspace.workspaceLabel),
            ...workspace,
            branding: {
                companyName: pageData.company.Com_Name,
                logoPath: pageData.company.LogoPath
            },
            pageData
        });
    } catch (error) {
        console.error('Staff PAYE statement PDF error:', error);
        return renderErrorPage(
            req,
            res,
            'finance-officer',
            workspace,
            'Staff PAYE Statement',
            error.expose ? error.message : 'Unable to prepare the staff PAYE statement PDF right now.',
            error.expose ? 400 : 500
        );
    }
}

async function getFinanceManagerIndex(req, res) {
    const workspace = buildWorkspaceView(req, 'finance-manager');
    try {
        const pageData = await payrollLiabilityReportService.getFinanceIndexPageData({
            companyId: getCompanyId(req),
            filters: req.query
        });

        res.render('reports/payroll_liabilities/index', {
            title: 'Payroll Liabilities',
            path: '/finance-manager/reports/payroll-liabilities',
            user: getViewUser(req, workspace.workspaceLabel),
            ...workspace,
            branding: {
                companyName: pageData.company.Com_Name,
                logoPath: pageData.company.LogoPath
            },
            pageData
        });
    } catch (error) {
        console.error('Finance Manager payroll liabilities page error:', error);
        return renderErrorPage(
            req,
            res,
            'finance-manager',
            workspace,
            'Report Error',
            error.expose ? error.message : 'Unable to load the Payroll Liabilities page right now.',
            error.expose ? 400 : 500
        );
    }
}

async function getFinanceManagerPreview(req, res) {
    const workspace = buildWorkspaceView(req, 'finance-manager');
    try {
        const pageData = await payrollLiabilityReportService.getPayrollLiabilityReportData({
            companyId: getCompanyId(req),
            filters: req.query
        });

        res.render('reports/payroll_liabilities/preview', {
            title: 'Payroll Liabilities Report',
            path: '/finance-manager/reports/payroll-liabilities/preview',
            user: getViewUser(req, workspace.workspaceLabel),
            ...workspace,
            branding: {
                companyName: pageData.company.Com_Name,
                logoPath: pageData.company.LogoPath
            },
            pageData
        });
    } catch (error) {
        console.error('Finance Manager payroll liabilities preview error:', error);
        return renderErrorPage(
            req,
            res,
            'finance-manager',
            workspace,
            'Payroll Liabilities Report',
            error.expose ? error.message : 'Unable to generate the Payroll Liabilities report right now.',
            error.expose ? 400 : 500
        );
    }
}

async function getFinanceManagerPdf(req, res) {
    const workspace = buildWorkspaceView(req, 'finance-manager');
    try {
        const pageData = await payrollLiabilityReportService.getPayrollLiabilityReportData({
            companyId: getCompanyId(req),
            filters: { ...req.query, autoDownloadPdf: '1' }
        });

        res.render('reports/payroll_liabilities/preview', {
            title: 'Payroll Liabilities Report',
            path: '/finance-manager/reports/payroll-liabilities/pdf',
            user: getViewUser(req, workspace.workspaceLabel),
            ...workspace,
            branding: {
                companyName: pageData.company.Com_Name,
                logoPath: pageData.company.LogoPath
            },
            pageData
        });
    } catch (error) {
        console.error('Finance Manager payroll liabilities PDF error:', error);
        return renderErrorPage(
            req,
            res,
            'finance-manager',
            workspace,
            'Payroll Liabilities Report',
            error.expose ? error.message : 'Unable to prepare the Payroll Liabilities PDF right now.',
            error.expose ? 400 : 500
        );
    }
}

async function getFinanceManagerExcel(req, res) {
    const workspace = buildWorkspaceView(req, 'finance-manager');
    try {
        const pageData = await payrollLiabilityReportService.getPayrollLiabilityReportData({
            companyId: getCompanyId(req),
            filters: req.query
        });

        if (!pageData.report.supported) {
            return renderErrorPage(
                req,
                res,
                'finance-manager',
                workspace,
                'Payroll Liabilities Report',
                pageData.report.sourceSummary,
                400
            );
        }

        const columnMap = {
            PAYE: [
                { key: 'Serial No', label: 'Serial No' },
                { key: 'Employee Name', label: "Employee's Name" },
                { key: 'Emp-ID / PFNo', label: 'Emp-ID / PFNo' },
                { key: 'Basic Monthly Salary', label: 'Basic Monthly Salary', type: 'money' },
                { key: 'Less NASSIT Deduction', label: 'Less NASSIT Deduction', type: 'money' },
                { key: 'Monthly Allowance', label: 'Monthly Allowance', type: 'money' },
                { key: 'Gross Monthly Emoluments', label: 'Gross Monthly Emoluments', type: 'money' },
                { key: 'Tax Deducted', label: 'Tax Deducted', type: 'money' }
            ],
            NASSIT: [
                { key: 'No.', label: 'No.' },
                { key: 'NASSIT No', label: 'NASSIT No' },
                { key: 'Name', label: 'Name' },
                { key: 'Emp-ID / PFNo', label: 'Emp-ID / PFNo' },
                { key: 'Monthly Salary', label: 'Monthly Salary', type: 'money' },
                { key: 'Employee Contribution', label: 'Employee Contribution', type: 'money' },
                { key: 'Employer Contribution', label: 'Employer Contribution', type: 'money' },
                { key: 'Total', label: 'Total', type: 'money' }
            ],
            EOS: [
                { key: 'Serial No', label: 'Serial No' },
                { key: 'Employee Name', label: "Employee's Name" },
                { key: 'Emp-ID / PFNo', label: 'Emp-ID / PFNo' },
                { key: 'Total EOS Benefit', label: 'Total EOS Benefit', type: 'money' },
                { key: 'Taxable Leave Allowance', label: 'Taxable Leave Allowance', type: 'money' },
                { key: 'Tax Deducted', label: 'Tax Deducted', type: 'money' }
            ]
        };

        const html = buildExcelTableHtml({
            title: pageData.report.title,
            companyName: pageData.company.Com_Name,
            companyAddress: pageData.company.fullAddress,
            subtitle: pageData.report.subtitle,
            rows: pageData.exportRows,
            columns: columnMap[pageData.report.liabilityType] || []
        });

        res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${pageData.filenames.excel}"`);
        res.send(html);
    } catch (error) {
        console.error('Finance Manager payroll liabilities Excel export error:', error);
        return renderErrorPage(
            req,
            res,
            'finance-manager',
            workspace,
            'Payroll Liabilities Report',
            error.expose ? error.message : 'Unable to export the Payroll Liabilities report to Excel right now.',
            error.expose ? 400 : 500
        );
    }
}

async function getFinanceManagerStaffPreview(req, res) {
    const workspace = buildWorkspaceView(req, 'finance-manager');
    try {
        const pageData = await payrollLiabilityReportService.getStaffPayeStatementData({
            companyId: getCompanyId(req),
            filters: req.query
        });

        res.render('reports/payroll_liabilities/staff_statement', {
            title: 'Staff PAYE Statement',
            path: '/finance-manager/reports/payroll-liabilities/staff-preview',
            user: getViewUser(req, workspace.workspaceLabel),
            ...workspace,
            branding: {
                companyName: pageData.company.Com_Name,
                logoPath: pageData.company.LogoPath
            },
            pageData
        });
    } catch (error) {
        console.error('Finance Manager staff PAYE preview error:', error);
        return renderErrorPage(
            req,
            res,
            'finance-manager',
            workspace,
            'Staff PAYE Statement',
            error.expose ? error.message : 'Unable to generate the Staff PAYE statement right now.',
            error.expose ? 400 : 500
        );
    }
}

async function getFinanceManagerStaffPdf(req, res) {
    const workspace = buildWorkspaceView(req, 'finance-manager');
    try {
        const pageData = await payrollLiabilityReportService.getStaffPayeStatementData({
            companyId: getCompanyId(req),
            filters: { ...req.query, autoDownloadPdf: '1' }
        });

        res.render('reports/payroll_liabilities/staff_statement', {
            title: 'Staff PAYE Statement',
            path: '/finance-manager/reports/payroll-liabilities/staff-pdf',
            user: getViewUser(req, workspace.workspaceLabel),
            ...workspace,
            branding: {
                companyName: pageData.company.Com_Name,
                logoPath: pageData.company.LogoPath
            },
            pageData
        });
    } catch (error) {
        console.error('Finance Manager staff PAYE PDF error:', error);
        return renderErrorPage(
            req,
            res,
            'finance-manager',
            workspace,
            'Staff PAYE Statement',
            error.expose ? error.message : 'Unable to prepare the Staff PAYE PDF right now.',
            error.expose ? 400 : 500
        );
    }
}

module.exports = {
    getFinanceExcel,
    getFinanceIndex,
    getFinanceManagerExcel,
    getFinanceManagerIndex,
    getFinanceManagerPdf,
    getFinanceManagerPreview,
    getFinanceManagerStaffPdf,
    getFinanceManagerStaffPreview,
    getFinancePdf,
    getFinancePreview,
    getFinanceStaffPdf,
    getFinanceStaffPreview
};
