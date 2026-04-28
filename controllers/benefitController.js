const pool = require('../config/db');
const eosBenefitService = require('../services/eosBenefitService');

exports.getBenefitStatusManager = async (req, res) => {
    try {
        const pageData = await eosBenefitService.getBenefitStatusPageData({
            companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
            filters: req.query
        });
        res.render('manager/reports/benefit_status', { 
            user: req.user,
            title: 'End Of Service Benefits',
            departments: pageData.departments,
            filters: pageData.filters,
            company: pageData.company,
            results: []
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getWelfareBenefits = async (req, res) => {
    try {
        const pageData = await eosBenefitService.getBenefitStatusPageData({
            companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
            filters: req.query
        });
        res.render('data_entry/welfare/benefits', { 
            user: req.user,
            title: 'End Of Service Benefits',
            departments: pageData.departments,
            filters: pageData.filters,
            company: pageData.company,
            results: []
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.getBenefitStatusReport = async (req, res) => {
    try {
        const pageData = await eosBenefitService.getBenefitStatusPageData({
            companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
            filters: req.query
        });
        res.render('data_entry/reports/benefit_status', { 
            user: req.user,
            title: 'End Of Service Benefits',
            departments: pageData.departments,
            filters: pageData.filters,
            company: pageData.company,
            results: []
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

exports.calculateBenefits = async (req, res) => {
    const { section, staffId, searchType, endDate } = req.body;
    
    if (!endDate) {
        return res.json({ success: false, error: 'End Date is required' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        let rows = [];
        let validationErrors = [];
        const companyId = req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1;
        const pfNo = req.body.pfNo || staffId;
        const department = req.body.department;

        if (searchType === 'eos') {
            const eosPreview = await eosBenefitService.calculateEOSPreview(connection, {
                companyId,
                pfNo,
                department,
                previewDate: endDate
            });

            rows = eosPreview.rows.map((row) => ({
                ...row
            }));
            validationErrors = eosPreview.warnings;
        } else if (searchType === 'ex-gracia') {
            const exGratiaPreview = await eosBenefitService.calculateExGratiaPreview(connection, {
                companyId,
                pfNo,
                department,
                previewDate: endDate
            });

            rows = exGratiaPreview.rows.map((row) => ({
                ...row
            }));
            validationErrors = exGratiaPreview.warnings;
        }

        await connection.commit();
        
        // Group data by Department
        const groupedResults = {};
        rows.forEach(row => {
            const dept = row.DeptName || 'Unknown Department';
            if (!groupedResults[dept]) {
                groupedResults[dept] = [];
            }
            groupedResults[dept].push(row);
        });

        // Fetch Company Info for Header
        const company = await eosBenefitService.getCompanyInfo(connection);

        // Render the Preview Page directly
        res.render('reports/benefit_preview', {
            title: 'Benefit Status Report',
            company,
            results: groupedResults,
            searchType,
            endDate,
            validationErrors
        });

    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).send('Error calculating benefits: ' + error.message);
    } finally {
        connection.release();
    }
};
