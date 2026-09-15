const assert = require('assert');
const ejs = require('ejs');
const path = require('path');
const pool = require('../config/db');
const reportService = require('../services/statementReportService');

async function renderView(relativePath, data) {
    const viewPath = path.join(process.cwd(), relativePath);
    return ejs.renderFile(viewPath, data, { async: true });
}

async function getDirectContributionTotals({ companyId, statementType, pfNo = null, asAtDate }) {
    const contributionColumns = statementType === 'NASSIT'
        ? ['NassitEmp', 'NassitInst']
        : ['GratEmp', 'GratInst'];
    const params = [Number(companyId) || 1, asAtDate];
    let staffFilterSql = '';
    if (pfNo) {
        staffFilterSql = ' AND p.PFNo = ?';
        params.push(String(pfNo));
    }

    const [rows] = await pool.query(
        `
            SELECT
                p.PFNo,
                SUM(COALESCE(p.${contributionColumns[0]}, 0) + COALESCE(p.${contributionColumns[1]}, 0)) AS Balance
            FROM tblpayroll p
            WHERE p.CompanyID = ?
              AND DATE(COALESCE(p.PDate, p.SalDate)) <= ?
              AND p.Approved IN (-1, 1)
              AND (
                    NOT EXISTS (
                        SELECT 1
                        FROM payroll_workflow_batches wb_any
                        WHERE wb_any.CompanyID = p.CompanyID
                          AND wb_any.PMonth = p.PMonth
                          AND wb_any.PYear = p.PYear
                          AND wb_any.PType = p.PType
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM payroll_workflow_batches wb_effective
                        WHERE wb_effective.id = (
                            SELECT wb_latest.id
                            FROM payroll_workflow_batches wb_latest
                            WHERE wb_latest.CompanyID = p.CompanyID
                              AND wb_latest.PMonth = p.PMonth
                              AND wb_latest.PYear = p.PYear
                              AND wb_latest.PType = p.PType
                            ORDER BY COALESCE(wb_latest.GenerationNo, 1) DESC, wb_latest.id DESC
                            LIMIT 1
                        )
                          AND wb_effective.Status <> 'REVERSED'
                    )
              )
              ${staffFilterSql}
            GROUP BY p.PFNo
            ORDER BY p.PFNo ASC
        `,
        params
    );

    return rows;
}

async function main() {
    const companyId = Number(process.env.TEST_COMPANY_ID || 1);
    const knownPfNo = process.env.TEST_PFNO || '0300';
    const otherCompanyPfNo = process.env.TEST_OTHER_COMPANY_PFNO || '9999';

    const nassitAll = await reportService.getNassitGratuityReportData({
        companyId,
        filters: { run: '1', statementType: 'NASSIT', staffScope: 'ALL', asAtDate: '2026-08-21' }
    });
    assert.equal(nassitAll.report.statementType, 'NASSIT');
    assert.ok(nassitAll.company.Com_Name);
    assert.ok(Array.isArray(nassitAll.pages) && nassitAll.pages.length >= 1);
    if (nassitAll.rows.length > 28) {
        assert.ok(nassitAll.pages.length > 1, 'Large NASSIT result sets should be split into logical pages.');
    }
    assert.equal(nassitAll.pages[0].rows[0]?.RowNo || 1, 1, 'Statement row numbering should start at 1.');
    if (nassitAll.pages.length > 1) {
        const firstPageLastRow = nassitAll.pages[0].rows[nassitAll.pages[0].rows.length - 1];
        const secondPageFirstRow = nassitAll.pages[1].rows[0];
        assert.equal(Number(secondPageFirstRow.RowNo), Number(firstPageLastRow.RowNo) + 1, 'Statement numbering should continue across pages.');
    }
    assert.ok(!/Freetown, Freetown/i.test(nassitAll.company.fullAddress || ''), 'Company address display should collapse obvious duplicates.');

    const nassitSingle = await reportService.getNassitGratuityReportData({
        companyId,
        filters: { run: '1', statementType: 'NASSIT', staffScope: 'SINGLE', pfNo: knownPfNo, asAtDate: '2026-08-21' }
    });
    assert.ok(Array.isArray(nassitSingle.rows));
    if (nassitSingle.rows.length) {
        assert.ok(nassitSingle.rows.every((row) => row.PFNo === knownPfNo));
    }

    const gratuityAll = await reportService.getNassitGratuityReportData({
        companyId,
        filters: { run: '1', statementType: 'GRATUITY', staffScope: 'ALL', asAtDate: '2026-08-21' }
    });
    assert.equal(gratuityAll.report.statementType, 'GRATUITY');

    const gratuitySingle = await reportService.getNassitGratuityReportData({
        companyId,
        filters: { run: '1', statementType: 'GRATUITY', staffScope: 'SINGLE', pfNo: knownPfNo, asAtDate: '2026-08-21' }
    });
    if (gratuitySingle.rows.length) {
        assert.ok(gratuitySingle.rows.every((row) => row.PFNo === knownPfNo));
    }

    const defaultDateReport = await reportService.getNassitGratuityReportData({
        companyId,
        filters: { run: '1', statementType: 'NASSIT', staffScope: 'ALL' }
    });
    assert.ok(/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(defaultDateReport.report.asAtDateLabel), 'Default As At date label should be populated.');

    const cutOffEarlier = await reportService.getNassitGratuityReportData({
        companyId,
        filters: { run: '1', statementType: 'NASSIT', staffScope: 'SINGLE', pfNo: knownPfNo, asAtDate: '2025-12-31' }
    });
    const cutOffLater = await reportService.getNassitGratuityReportData({
        companyId,
        filters: { run: '1', statementType: 'NASSIT', staffScope: 'SINGLE', pfNo: knownPfNo, asAtDate: '2026-03-31' }
    });
    const earlierBalance = Number(cutOffEarlier.rows[0]?.Balance || 0);
    const laterBalance = Number(cutOffLater.rows[0]?.Balance || 0);
    assert.equal(
        laterBalance,
        earlierBalance,
        'A payroll period whose latest workflow batch is REVERSED should not increase the statement balance after the cut-off date moves past it.'
    );

    const directLater = await getDirectContributionTotals({
        companyId,
        statementType: 'NASSIT',
        pfNo: knownPfNo,
        asAtDate: '2026-03-31'
    });
    assert.equal(
        Number(directLater[0]?.Balance || 0),
        laterBalance,
        'Statement service should match the effective approved-payroll contribution query.'
    );

    let crossCompanyBlocked = false;
    try {
        await reportService.getNassitGratuityReportData({
            companyId,
            filters: { run: '1', statementType: 'NASSIT', staffScope: 'SINGLE', pfNo: otherCompanyPfNo, asAtDate: '2026-08-21' }
        });
    } catch (error) {
        crossCompanyBlocked = true;
    }
    assert.equal(crossCompanyBlocked, true, 'Cross-company PFNo access should be blocked.');

    const bioAll = await reportService.getBioDataReportData({
        companyId,
        filters: { run: '1', staffScope: 'ALL', reportDate: '2026-08-21' }
    });
    assert.ok(bioAll.company.Com_Name);
    assert.ok(Array.isArray(bioAll.rows));
    assert.equal(bioAll.pages.length, Math.max(bioAll.rows.length, 1), 'Bio Data all-staff mode should expose one logical page per employee.');

    const bioSingle = await reportService.getBioDataReportData({
        companyId,
        filters: { run: '1', staffScope: 'SINGLE', pfNo: knownPfNo, reportDate: '2026-08-21' }
    });
    if (bioSingle.rows.length) {
        assert.ok(bioSingle.rows.every((row) => row.PFNo === knownPfNo));
    }
    assert.equal(bioSingle.pages.length, 1, 'Single-staff Bio Data should render one logical page.');

    const bioWithDependants = await reportService.getBioDataReportData({
        companyId,
        filters: { run: '1', staffScope: 'SINGLE', pfNo: knownPfNo, reportDate: '2026-08-21', includeDependants: '1' }
    });
    assert.equal(bioWithDependants.filters.includeDependants, true);

    const renderedNassit = await renderView('views/reports/nassit_gratuity.ejs', {
        title: 'NASSIT / Gratuity Statement',
        path: '/manager/reports/nassit-grats',
        user: { name: 'Manager' },
        branding: { companyName: nassitAll.company.Com_Name, logoPath: nassitAll.company.LogoPath },
        partialsBase: 'manager/partials',
        dashboardPath: '/manager/dashboard',
        workspaceLabel: 'Manager',
        pageData: nassitAll
    });
    assert.ok(renderedNassit.includes('SUMMARY OF NASSIT ACCOUNT BALANCES'));
    assert.ok(renderedNassit.includes('Download PDF'));
    assert.ok(!renderedNassit.includes('excluding reversed payroll generations'));
    assert.ok(renderedNassit.includes('target="_blank"'));
    assert.ok(renderedNassit.includes('data-report-page'));
    assert.ok(renderedNassit.includes('data-report-prev'));
    assert.ok(renderedNassit.includes('Page 1 of'));
    assert.ok(renderedNassit.includes('report-company'));
    assert.ok(renderedNassit.includes('report-address'));

    const renderedBio = await renderView('views/reports/bio_data_statement.ejs', {
        title: 'Bio Data Report',
        path: '/manager/reports/bio-data',
        user: { name: 'Manager' },
        branding: { companyName: bioWithDependants.company.Com_Name, logoPath: bioWithDependants.company.LogoPath },
        partialsBase: 'manager/partials',
        dashboardPath: '/manager/dashboard',
        workspaceLabel: 'Manager',
        pageData: bioWithDependants
    });
    assert.ok(renderedBio.includes('BIO DATA REPORT'));
    assert.ok(renderedBio.includes('I CONFIRM THE CORRECTNESS OF THE ABOVE PERSONAL DATA.'));
    assert.ok(renderedBio.includes('Download PDF'));
    assert.ok(renderedBio.includes('target="_blank"'));
    assert.ok(renderedBio.includes('data-report-page'));
    assert.ok(renderedBio.includes('data-report-detail'));
    assert.ok(renderedBio.includes('Dependants'));

    console.log('NASSIT / Gratuity and Bio Data report tests passed.');
    await pool.end();
    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    pool.end().catch(() => {});
    process.exit(1);
});
