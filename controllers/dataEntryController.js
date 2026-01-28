const pool = require('../config/db');

const dataEntryController = {
    getDashboard: (req, res) => {
        res.render('data_entry/dashboard', {
            title: 'Data Entry Dashboard',
            path: '/data-entry/dashboard',
            user: { name: 'Data Entry Clerk' }
        });
    },

    getApplicationsEnquiry: async (req, res) => {
        try {
            const { ageFrom, ageTo, sex, scoreFrom, scoreTo, dateFrom, dateTo, page = 1 } = req.query;
            const limit = 10;
            const offset = (page - 1) * limit;

            // Fetch Company Info
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            const [sexes] = await pool.query('SELECT SexCode, Status FROM tblsex ORDER BY Status');

            let baseQuery = `
                SELECT 
                    a.RefNo,
                    a.SName,
                    a.DOB,
                    a.QCode,
                    a.Sex,
                    a.ExamDate,
                    a.Result,
                    a.IntDate,
                    a.DateAppointed,
                    s.Status as SexName,
                    q.QType as QualifName
                FROM tblapplication a
                LEFT JOIN tblsex s ON a.Sex = s.SexCode
                LEFT JOIN tblqualiftype q ON a.QCode = q.Code
                WHERE 1=1
            `;

            const params = [];

            if (ageFrom || ageTo) {
                baseQuery += ' AND TIMESTAMPDIFF(YEAR, a.DOB, CURDATE()) BETWEEN ? AND ?';
                params.push(ageFrom || 0, ageTo || 100);
            }

            if (sex) {
                baseQuery += ' AND a.Sex = ?';
                params.push(sex);
            }

            if (scoreFrom || scoreTo) {
                baseQuery += ' AND CAST(a.Result AS DECIMAL(10,2)) BETWEEN ? AND ?';
                params.push(scoreFrom || 0, scoreTo || 999999);
            }

            if (dateFrom) {
                baseQuery += ' AND a.ExamDate >= ?';
                params.push(dateFrom);
            }

            if (dateTo) {
                baseQuery += ' AND a.ExamDate <= ?';
                params.push(dateTo);
            }

            const countQuery = `SELECT COUNT(*) as total FROM (${baseQuery}) as sub`;
            const [countRows] = await pool.query(countQuery, params);
            const total = countRows[0].total;

            const pagedQuery = baseQuery + ' ORDER BY a.ExamDate DESC, a.RefNo ASC LIMIT ? OFFSET ?';
            const pageParams = params.slice();
            pageParams.push(limit, offset);

            const [rows] = await pool.query(pagedQuery, pageParams);

            res.render('data_entry/enquiry/applications', {
                title: 'Applications Enquiry',
                group: 'Enquiry',
                path: '/data-entry/enquiry/applications',
                user: { name: 'Data Entry Clerk' },
                role: 'data_entry',
                companyName,
                data: rows,
                sexes,
                filters: {
                    ageFrom,
                    ageTo,
                    sex,
                    scoreFrom,
                    scoreTo,
                    dateFrom,
                    dateTo
                },
                pagination: {
                    page: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalItems: total
                }
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getDisciplineEnquiry: async (req, res) => {
        try {
            const { pfno, queryType, dateFrom, dateTo, page = 1 } = req.query;
            const limit = 10;
            const offset = (page - 1) * limit;

            // Fetch Company Info
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            // Fetch distinct query types for filter
            const [types] = await pool.query('SELECT Code, QType FROM tblqtype ORDER BY QType');

            let query = `
                SELECT 
                    q.PFNO, 
                    s.SName, 
                    qt.QType, 
                    q.MResponse, 
                    q.SDate, 
                    q.EDate 
                FROM tblquery q
                LEFT JOIN tblstaff s ON q.PFNO = s.PFNO
                LEFT JOIN tblqtype qt ON q.QType = qt.Code
                WHERE 1=1
            `;

            const params = [];

            if (pfno) {
                query += ' AND q.PFNO LIKE ?';
                params.push(`%${pfno}%`);
            }

            if (queryType) {
                query += ' AND q.QType = ?';
                params.push(queryType);
            }

            if (dateFrom) {
                query += ' AND q.SDate >= ?';
                params.push(dateFrom);
            }

            if (dateTo) {
                query += ' AND q.EDate <= ?';
                params.push(dateTo);
            }

            const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM (${query}) as sub`, params);
            const total = countRows[0].total;

            query += ' ORDER BY q.QDate DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const [rows] = await pool.query(query, params);

            res.render('data_entry/enquiry/discipline', {
                title: 'Discipline Enquiry',
                group: 'Enquiry',
                path: '/data-entry/enquiry/discipline',
                user: { name: 'Data Entry Clerk' },
                role: 'data_entry',
                companyName,
                data: rows,
                queryTypes: types,
                filters: { pfno, queryType, dateFrom, dateTo },
                pagination: {
                    page: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalItems: total
                }
            });

        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getStaffEnquiry: async (req, res) => {
        try {
            // Fetch Company Info
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            res.render('data_entry/enquiry/staff', {
                title: 'Staff Enquiry',
                group: 'Enquiry',
                path: '/data-entry/enquiry/staff',
                user: { name: 'Data Entry Clerk' },
                role: 'data_entry',
                companyName
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getStaffBirthdays: async (req, res) => {
        try {
            const { month } = req.query;
            if (!month) {
                return res.status(400).json({ error: 'Month is required' });
            }

            const query = `
                SELECT PFNo, SName, DATE_FORMAT(DOB, '%Y-%m-%d') as Birthdate 
                FROM tblstaff 
                WHERE MONTH(DOB) = ? 
                ORDER BY DAY(DOB)
            `;
            const [rows] = await pool.query(query, [month]);
            res.json(rows);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    getStaffGeneralInfo: async (req, res) => {
        try {
            const { 
                servedFrom, servedTo, 
                dept, jobTitle, gender, 
                ageFrom, ageTo, 
                retireFrom, retireTo, 
                formerDept, 
                contractExpFrom, contractExpTo, 
                expiredContract,
                page = 1
            } = req.query;

            // Helper to sanitize input (handle 'undefined' string from frontend serialization)
            const clean = (val) => (val && val !== 'undefined' && val !== 'null' && val !== '') ? val : '';

            const fServedFrom = clean(servedFrom);
            const fServedTo = clean(servedTo);
            const fDept = clean(dept);
            const fJobTitle = clean(jobTitle);
            const fGender = clean(gender);
            const fAgeFrom = clean(ageFrom);
            const fAgeTo = clean(ageTo);
            const fRetireFrom = clean(retireFrom);
            const fRetireTo = clean(retireTo);
            const fFormerDept = clean(formerDept);
            const fContractExpFrom = clean(contractExpFrom);
            const fContractExpTo = clean(contractExpTo);
            const fExpiredContract = clean(expiredContract);
            
            const pageNum = parseInt(page, 10) || 1;

            // Fetch Company Info
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            // Fetch lookups
            const [depts] = await pool.query('SELECT Code, Dept FROM tbldept ORDER BY Dept');
            const [jobs] = await pool.query('SELECT Code, JobTitle FROM tbljobtitle ORDER BY JobTitle');
            const [sexes] = await pool.query('SELECT SexCode, Status FROM tblsex ORDER BY Status');

            let query = `
                SELECT 
                    s.PFNo,
                    s.SName,
                    d.Dept as Department,
                    j.JobTitle,
                    s.DOE as DateEmployed,
                    TIMESTAMPDIFF(YEAR, s.DOE, CURDATE()) as ServedYears,
                    TIMESTAMPDIFF(YEAR, s.DOB, CURDATE()) as Age,
                    s.SexCode,
                    s.Contract_Exp,
                    t.PrevDept
                FROM tblstaff s
                LEFT JOIN tbldept d ON s.CDept = d.Code
                LEFT JOIN tbljobtitle j ON s.JobTitle = j.Code
                LEFT JOIN (
                    SELECT PFNO, PrevDept FROM tbltransfer t1
                    WHERE TDate = (SELECT MAX(TDate) FROM tbltransfer t2 WHERE t2.PFNO = t1.PFNO)
                ) t ON s.PFNo = t.PFNO
                WHERE 1=1
            `;

            const params = [];

            if (fServedFrom) {
                query += ' AND TIMESTAMPDIFF(YEAR, s.DOE, CURDATE()) >= ?';
                params.push(fServedFrom);
            }
            if (fServedTo) {
                query += ' AND TIMESTAMPDIFF(YEAR, s.DOE, CURDATE()) <= ?';
                params.push(fServedTo);
            }

            if (fDept) {
                query += ' AND s.CDept = ?';
                params.push(fDept);
            }

            if (fJobTitle) {
                query += ' AND s.JobTitle = ?';
                params.push(fJobTitle);
            }

            if (fGender) {
                query += ' AND s.SexCode = ?';
                params.push(fGender);
            }

            if (fAgeFrom) {
                query += ' AND TIMESTAMPDIFF(YEAR, s.DOB, CURDATE()) >= ?';
                params.push(fAgeFrom);
            }
            if (fAgeTo) {
                query += ' AND TIMESTAMPDIFF(YEAR, s.DOB, CURDATE()) <= ?';
                params.push(fAgeTo);
            }

            if (fRetireFrom) {
                // Assuming retirement age is 60
                query += ' AND (60 - TIMESTAMPDIFF(YEAR, s.DOB, CURDATE())) >= ?';
                params.push(fRetireFrom);
            }
            if (fRetireTo) {
                query += ' AND (60 - TIMESTAMPDIFF(YEAR, s.DOB, CURDATE())) <= ?';
                params.push(fRetireTo);
            }

            if (fFormerDept) {
                query += ' AND t.PrevDept = ?';
                params.push(fFormerDept);
            }

            if (fContractExpFrom) {
                query += ' AND TIMESTAMPDIFF(YEAR, CURDATE(), s.Contract_Exp) >= ?';
                params.push(fContractExpFrom);
            }
            if (fContractExpTo) {
                query += ' AND TIMESTAMPDIFF(YEAR, CURDATE(), s.Contract_Exp) <= ?';
                params.push(fContractExpTo);
            }

            if (fExpiredContract === 'Yes') {
                query += ' AND s.Contract_Exp < CURDATE()';
            } else if (fExpiredContract === 'No') {
                query += ' AND (s.Contract_Exp >= CURDATE() OR s.Contract_Exp IS NULL)';
            }

            if (req.query.export === 'json') {
                query += ' ORDER BY s.SName ASC';
                const [rows] = await pool.query(query, params);
                return res.json(rows);
            }

            const limit = 50; // Show more rows for general info
            const offset = (pageNum - 1) * limit;
            
            // Count total for pagination
            const countQuery = `SELECT COUNT(*) as total FROM (${query}) as sub`;
            const [countRows] = await pool.query(countQuery, params);
            const total = countRows[0].total;

            query += ' ORDER BY s.SName ASC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const [rows] = await pool.query(query, params);

            res.render('data_entry/enquiry/staff_general_info', {
                title: 'Staff General Information',
                companyName,
                data: rows,
                depts,
                jobs,
                sexes,
                filters: {
                    servedFrom: fServedFrom, servedTo: fServedTo, dept: fDept, jobTitle: fJobTitle, gender: fGender, 
                    ageFrom: fAgeFrom, ageTo: fAgeTo, retireFrom: fRetireFrom, retireTo: fRetireTo, formerDept: fFormerDept,
                    contractExpFrom: fContractExpFrom, contractExpTo: fContractExpTo, expiredContract: fExpiredContract
                },
                pagination: {
                    page: pageNum,
                    totalPages: Math.ceil(total / limit),
                    totalItems: total
                }
            });

        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getPayrollReports: (req, res) => {
        res.render('data_entry/reports/payroll', {
            title: 'Payroll Reports',
            group: 'Reports',
            path: '/data-entry/reports/payroll',
            user: { name: 'Data Entry Clerk' }
        });
    },

    getStaffName: async (req, res) => {
        try {
            const { pfno } = req.params;
            const [rows] = await pool.query('SELECT SName FROM tblstaff WHERE PFNo = ?', [pfno]);
            if (rows.length > 0) {
                res.json({ name: rows[0].SName });
            } else {
                res.status(404).json({ error: 'Staff not found' });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    getPayslipData: async (req, res) => {
        try {
            const { month, year, scope, pfno } = req.query;

            const [comRows] = await pool.query('SELECT Com_Name, Address FROM tblcominfo LIMIT 1');
            const company = comRows[0] || { Com_Name: '', Address: '' };

            let query = `
                SELECT 
                    p.PFNo, p.Salary, p.Allw02, p.Allw03, p.Allw04, p.Allw05, p.Allw06, p.Allw07, p.Allw08, p.Allw09, p.Allw10, p.Allw11, p.Allw12, p.Allw14, p.Allw16, p.Allw17, p.Allw19,
                    p.Tax, p.NassitEmp, p.GratEmp, p.Ded1, p.Ded2, p.Ded3, p.Ded4, p.Ded5, p.NetIncome,
                    s.SName, s.AccountNo,
                    d.Dept AS DeptName,
                    j.JobTitle AS JobTitleName
                FROM tblpayroll p
                LEFT JOIN tblstaff s ON p.PFNo = s.PFNo
                LEFT JOIN tbldept d ON s.Dept = d.Code
                LEFT JOIN tbljobtitle j ON s.JobTitle = j.Code
                WHERE p.PMonth = ? AND p.PYear = ?
            `;

            const params = [month, year];

            if (scope === 'staff' && pfno) {
                query += ' AND p.PFNo = ?';
                params.push(pfno);
            } else {
                query += ' ORDER BY p.PFNo ASC';
            }

            const [rows] = await pool.query(query, params);

            res.json({
                company: {
                    name: company.Com_Name,
                    address: company.Address
                },
                period: { month, year },
                data: rows
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error fetching payslip data' });
        }
    },

    getApplications: async (req, res) => {
        try {
            // Fetch lookups
            const [sexes] = await pool.query('SELECT SexCode, Status FROM tblsex ORDER BY Status');
            const [qualifs] = await pool.query('SELECT Code, QType FROM tblqualiftype ORDER BY QType');
            const [nations] = await pool.query('SELECT NationCode, Nation FROM tblnation ORDER BY Nation');
            const [mstatuses] = await pool.query('SELECT Code, Status FROM tblmstatus ORDER BY Status');
            const [depts] = await pool.query('SELECT Code, Dept FROM tbldept ORDER BY Dept');
            const [grades] = await pool.query('SELECT GradeCode, Grade FROM tblgrade ORDER BY Grade');
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            res.render('data_entry/staff/applications', {
                title: 'Applications',
                group: 'Staff',
                path: '/data-entry/staff/applications',
                user: { name: 'Data Entry Clerk' },
                role: 'data_entry',
                companyName,
                sexes,
                qualifs,
                nations,
                mstatuses,
                depts,
                grades,
                success: req.query.success,
                error: req.query.error
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postApplications: async (req, res) => {
        try {
            const { 
                RefNo,
                Received,
                SName,
                DOB,
                Sex,
                Nationality,
                MStatus,
                Address,
                City,
                DApplied,
                QCode,
                Ref1Name,
                Ref1Addr,
                Ref1Phone,
                Ref2Name,
                Ref2Addr,
                Ref2Phone,
                ExamDate,
                Result,
                IntDate,
                DateAppointed,
                PFNo,
                Dept,
                Grade
            } = req.body;

            if (!RefNo || !SName) {
                return res.redirect('/data-entry/staff/applications?error=RefNo and Name are required');
            }

            const cleanDateTime = (d) => {
                if (!d) return null;
                if (d.includes('T')) {
                    const base = d.replace('T', ' ');
                    return base.length === 16 ? `${base}:00` : base;
                }
                return d;
            };

            const query = `
                INSERT INTO tblapplication 
                (RefNo, Received, SName, DOB, Sex, Nationality, MStatus, Address, City, DApplied, QCode, Ref1Name, Ref1Addr, Ref1Phone, Ref2Name, Ref2Addr, Ref2Phone, ExamDate, Result, IntDate, DateAppointed, PFNo, Dept, Grade, Approved, DateApproved, Selected, dateSelected, CompanyID) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            await pool.query(query, [
                RefNo,
                cleanDateTime(Received),
                SName,
                cleanDateTime(DOB),
                Sex,
                Nationality,
                MStatus,
                Address,
                City || null,
                cleanDateTime(DApplied),
                QCode || null,
                Ref1Name || null,
                Ref1Addr || null,
                Ref1Phone || null,
                Ref2Name || null,
                Ref2Addr || null,
                Ref2Phone || null,
                cleanDateTime(ExamDate),
                Result || null,
                cleanDateTime(IntDate),
                cleanDateTime(DateAppointed),
                PFNo || null,
                Dept || null,
                Grade || null,
                0,
                null,
                0,
                null,
                1
            ]);

            res.redirect('/data-entry/staff/applications?success=Application saved successfully');
        } catch (error) {
            console.error(error);
            if (error.code === 'ER_DUP_ENTRY') {
                 res.redirect('/data-entry/staff/applications?error=Reference Number already exists');
            } else {
                 res.redirect('/data-entry/staff/applications?error=Server Error: ' + error.message);
            }
        }
    },

    getComingSoon: (req, res) => {
        const parts = req.path.split('/').filter(p => p);
        const title = parts.length > 0 ? parts[parts.length - 1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Feature';
        const group = parts.length > 1 ? parts[parts.length - 2].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Data Entry';

        res.render('shared/coming-soon', {
            title: `${title} - Coming Soon`,
            path: req.path,
            user: { name: 'Data Entry Clerk' },
            role: 'data_entry',
            group: group,
            page: title
        });
    }
};

module.exports = dataEntryController;
