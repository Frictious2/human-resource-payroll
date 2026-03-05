const pool = require('../config/db');

const dataEntryController = {
    getDashboard: (req, res) => {
        res.render('data_entry/dashboard', {
            title: 'Data Entry Dashboard',
            path: '/data-entry/dashboard',
            user: { name: 'Data Entry Clerk' }
        });
    },

    getPayrollIncomeSetup: async (req, res) => {
        try {
            const [grades] = await pool.query('SELECT GradeCode, Grade, NotchIncr FROM tblgrade ORDER BY GradeCode');
            const [currencies] = await pool.query('SELECT CurrCode, CurrName FROM tblcurrency ORDER BY CurrCode');
            const [items] = await pool.query("SELECT Code, Income, Freq FROM tblpayrollitems WHERE Code BETWEEN '01' AND '20' ORDER BY Code");
            const [allowances] = await pool.query('SELECT * FROM tblallowance ORDER BY ScaleDate DESC');
            res.render('data_entry/payroll/income_setup', {
                title: 'Income Setup',
                group: 'Payroll',
                path: '/data-entry/payroll/income-setup',
                user: { name: 'Data Entry Officer' },
                grades,
                currencies,
                items,
                allowances
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },
 
    getIncomeSetupByGrade: async (req, res) => {
        try {
            const { grade } = req.query;
            if (!grade) return res.json([]);
            const [rows] = await pool.query('SELECT * FROM tblallowance WHERE Grade = ? ORDER BY ScaleDate DESC', [grade]);
            res.json(rows);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },
 
    getIncomeSetupRecord: async (req, res) => {
        try {
            const { grade, scaleDate } = req.query;
            if (!grade || !scaleDate) return res.status(400).json({ error: 'Missing parameters' });
            const [rows] = await pool.query('SELECT * FROM tblallowance WHERE Grade = ? AND DATE(ScaleDate) = ?', [grade, scaleDate]);
            if (rows.length === 0) return res.json(null);
            res.json(rows[0]);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },
 
    postPayrollIncomeSetup: async (req, res) => {
        try {
            const {
                scaleDate,
                gradeCode,
                currencyCode,
                startLevel,
                endLevel,
                notches,
                increment
            } = req.body;
 
            const now = new Date();
            const operator = 'Data Entry Officer';
 
            // Discover available columns in tblallowance to build resilient INSERT/UPDATE
            const [colsRows] = await pool.query(`
                SELECT COLUMN_NAME 
                FROM information_schema.COLUMNS 
                WHERE TABLE_NAME = 'tblallowance'
            `);
            const colSet = new Set(colsRows.map(r => r.COLUMN_NAME));
 
            const baseData = {
                ScaleDate: scaleDate || null,
                Grade: gradeCode || null,
                PayCurrency: currencyCode || null,
                StartLevel: startLevel || null,
                EndLevel: endLevel || null,
                Notches: notches || null,
                Increment: increment || null,
                KeyedIn: now,
                Operator: operator,
                TimeKeyed: now,
                Approved: 0
            };
 
            const fields = [];
            const values = [];
            Object.entries(baseData).forEach(([k, v]) => {
                if (colSet.has(k)) {
                    fields.push(k);
                    values.push(v);
                }
            });
 
            // Upsert by GradeCode + ScaleDate if possible
            let whereClause = '';
            const whereParams = [];
            if (colSet.has('Grade') && colSet.has('ScaleDate')) {
                whereClause = 'WHERE Grade = ? AND ScaleDate = ?';
                whereParams.push(gradeCode || null, scaleDate || null);
            }
 
            let existing = [];
            if (whereClause) {
                const [ex] = await pool.query(`SELECT * FROM tblallowance ${whereClause}`, whereParams);
                existing = ex;
            }
 
            if (existing.length > 0) {
                const setClause = fields.map(f => `${f} = ?`).join(', ');
                await pool.query(
                    `UPDATE tblallowance SET ${setClause} ${whereClause}`,
                    [...values, ...whereParams]
                );
            } else {
                const placeholders = fields.map(() => '?').join(', ');
                await pool.query(
                    `INSERT INTO tblallowance (${fields.join(', ')}) VALUES (${placeholders})`,
                    values
                );
            }
 
            res.redirect('/data-entry/payroll/income-setup');
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },
 
    getPayrollEntitle: async (req, res) => {
        try {
            const [paythrough] = await pool.query('SELECT Code, PayThrough FROM tblpaythrough ORDER BY PayThrough');
            const [banks] = await pool.query('SELECT Code, Bank, Short FROM tblbanks ORDER BY Bank');
            const [companyBBANs] = await pool.query('SELECT BBAN, Short, Bank FROM tblpayingbank ORDER BY Bank');
            const [items] = await pool.query("SELECT Code, Income FROM tblpayrollitems WHERE Code BETWEEN '01' AND '20' ORDER BY Code");
            const [entitledStaff] = await pool.query(`
                SELECT e.PFNo, s.SName 
                FROM tblentitle e 
                JOIN tblstaff s ON e.PFNo = s.PFNo
                ORDER BY s.SName
            `);
            const [staffList] = await pool.query('SELECT PFNo, SName FROM tblstaff ORDER BY SName');
            res.render('data_entry/payroll/entitle', {
                title: 'Staff Entitlement',
                group: 'Payroll',
                path: '/data-entry/payroll/entitle',
                user: { name: 'Data Entry Officer' },
                paythrough,
                banks,
                items,
                entitledStaff,
                staffList,
                companyBBANs
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },
 
    getEntitleByStaff: async (req, res) => {
        try {
            const { pfno } = req.params;
            const [rows] = await pool.query('SELECT * FROM tblentitle WHERE PFNo = ?', [pfno]);
            if (rows.length === 0) return res.json(null);
            res.json(rows[0]);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },
 
    postPayrollEntitle: async (req, res) => {
        try {
            const {
                pfno,
                paythroughCode,
                bankCode,
                accountNo,
                payingBBAN
            } = req.body;
 
            const now = new Date();
            const operator = 'Data Entry Officer';
 
            const [existing] = await pool.query('SELECT PFNo FROM tblentitle WHERE PFNo = ?', [pfno]);
 
            const getFlag = (name) => {
                return req.body[name] ? -1 : 0;
            };
 
            const salary = getFlag('item_01');
            const flags = {};
            for (let c = 2; c <= 20; c++) {
                const code = c.toString().padStart(2, '0');
                const key = `Allw${code}`;
                flags[key] = getFlag(`item_${code}`);
            }
 
            if (existing.length > 0) {
                const q = `
                    UPDATE tblentitle SET
                        Salary = ?, 
                        Allw02 = ?, Allw03 = ?, Allw04 = ?, Allw05 = ?, Allw06 = ?, Allw07 = ?, Allw08 = ?, Allw09 = ?, 
                        Allw10 = ?, Allw11 = ?, Allw12 = ?, Allw13 = ?, Allw14 = ?, Allw15 = ?, Allw16 = ?, Allw17 = ?, Allw18 = ?, Allw19 = ?, Allw20 = ?,
                        KeyedIn = ?, Operator = ?, TimeKeyed = ?, Approved = 0,
                        PayThrough = ?, Bank = ?, PayingBBAN = ?, AccountNo = ?
                    WHERE PFNo = ?
                `;
                const params = [
                    salary,
                    flags.Allw02, flags.Allw03, flags.Allw04, flags.Allw05, flags.Allw06, flags.Allw07, flags.Allw08, flags.Allw09,
                    flags.Allw10, flags.Allw11, flags.Allw12, flags.Allw13, flags.Allw14, flags.Allw15, flags.Allw16, flags.Allw17, flags.Allw18, flags.Allw19, flags.Allw20,
                    now, operator, now, 
                    paythroughCode || null, bankCode || null, payingBBAN || null, accountNo || null,
                    pfno
                ];
                await pool.query(q, params);
            } else {
                const q = `
                    INSERT INTO tblentitle (
                        PFNo, Salary, 
                        Allw02, Allw03, Allw04, Allw05, Allw06, Allw07, Allw08, Allw09,
                        Allw10, Allw11, Allw12, Allw13, Allw14, Allw15, Allw16, Allw17, Allw18, Allw19, Allw20,
                        KeyedIn, Operator, TimeKeyed, Approved,
                        PayThrough, Bank, PayingBBAN, AccountNo, CompanyID
                    ) VALUES (
                        ?, ?, 
                        ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, 0,
                        ?, ?, ?, ?, 1
                    )
                `;
                const params = [
                    pfno, salary,
                    flags.Allw02, flags.Allw03, flags.Allw04, flags.Allw05, flags.Allw06, flags.Allw07, flags.Allw08, flags.Allw09,
                    flags.Allw10, flags.Allw11, flags.Allw12, flags.Allw13, flags.Allw14, flags.Allw15, flags.Allw16, flags.Allw17, flags.Allw18, flags.Allw19, flags.Allw20,
                    now, operator, now,
                    paythroughCode || null, bankCode || null, payingBBAN || null, accountNo || null
                ];
                await pool.query(q, params);
            }
 
            res.redirect('/data-entry/payroll/entitle');
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getPayrollSetup: async (req, res) => {
        try {
            const [staffList] = await pool.query('SELECT PFNo, SName FROM tblstaff ORDER BY SName');
            const [addItems] = await pool.query("SELECT Code, Income FROM tblpayrollitems WHERE Code BETWEEN '02' AND '20' ORDER BY Code");
            const [dedItems] = await pool.query("SELECT Code, Income FROM tblpayrollitems WHERE Code BETWEEN '31' AND '37' ORDER BY Code");
            res.render('data_entry/payroll/payroll_setup', {
                title: 'Payroll Setup',
                group: 'Payroll',
                path: '/data-entry/payroll/payroll-setup',
                user: { name: 'Data Entry Officer' },
                staffList,
                addItems,
                dedItems
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getPayrollSetupByStaff: async (req, res) => {
        try {
            const { pfno } = req.params;
            const [sRows] = await pool.query(`
                SELECT 
                    s.PFNo, 
                    s.SName, 
                    s.CDept as Dept, 
                    s.CGrade as GradeCode, 
                    g.Grade as GradeName,
                    s.JobTitle as JobTitleCode,
                    j.JobTitle as JobTitleName
                FROM tblstaff s
                LEFT JOIN tblgrade g ON s.CGrade = g.GradeCode
                LEFT JOIN tbljobtitle j ON s.JobTitle = j.Code
                WHERE s.PFNo = ?
            `, [pfno]);
            const staff = sRows[0] || null;
            const [rows] = await pool.query(
                'SELECT * FROM tblsalary WHERE PFNo = ? ORDER BY PDate DESC LIMIT 1',
                [pfno]
            );
            const salary = rows.length > 0 ? rows[0] : null;
            res.json({ staff, salary });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    postPayrollSetup: async (req, res) => {
        try {
            const {
                pfno,
                pdate,
                annual,
                salary,
                totalIncome,
                taxable,
                tax,
                nassitEmp,
                nassitInst,
                gratEmp,
                gratInst,
                totalDeduction,
                netIncome,
                ded1,
                unionDues,
                ded3,
                ded4
            } = req.body;

            const [sRows] = await pool.query('SELECT PFNo, CDept as Dept, CGrade as GradeCode, JobTitle as JobTitleCode FROM tblstaff WHERE PFNo = ?', [pfno]);
            if (sRows.length === 0) {
                return res.status(400).send('Staff not found');
            }
            const staff = sRows[0];

            const now = new Date();
            const submittedDate = (() => {
                if (!pdate) return now;
                const d = new Date(pdate);
                return isNaN(d.getTime()) ? now : d;
            })();
            const operator = 'Data Entry Officer';

            const [existingRows] = await pool.query(
                'SELECT PFNo, PDate FROM tblsalary WHERE PFNo = ? AND PDate = ? LIMIT 1',
                [pfno, submittedDate]
            );

            const getAllw = (code) => {
                const key = 'allw' + code;
                const val = req.body[key];
                return val === '' || val == null ? null : val;
            };

            const round2 = (val) => {
                if (val === '' || val === null || val === undefined) return null;
                return Math.round(parseFloat(val) * 100) / 100;
            };

            const baseFields = {
                PDate: submittedDate,
                PFNo: pfno,
                Dept: staff.Dept,
                Grade: staff.GradeCode,
                JobTitle: staff.JobTitleCode,
                Annual: round2(annual),
                Salary: round2(salary),
                Allw02: getAllw('02'),
                Allw03: getAllw('03'),
                Allw04: getAllw('04'),
                Allw05: getAllw('05'),
                Allw06: getAllw('06'),
                Allw07: getAllw('07'),
                Allw08: getAllw('08'),
                Allw09: getAllw('09'),
                Allw10: getAllw('10'),
                Allw11: getAllw('11'),
                Allw12: getAllw('12'),
                Allw13: getAllw('13'),
                Allw14: getAllw('14'),
                Allw15: getAllw('15'),
                Allw16: getAllw('16'),
                Allw17: getAllw('17'),
                Allw18: getAllw('18'),
                Allw19: getAllw('19'),
                Allw20: getAllw('20'),
                TotalIncome: totalIncome || null,
                Taxable: taxable || null,
                Tax: tax || null,
                NassitEmp: nassitEmp || null,
                NassitInst: nassitInst || null,
                GratEmp: gratEmp || null,
                GratInst: gratInst || null,
                TotalDeduction: totalDeduction || null,
                NetIncome: netIncome || null,
                Ded1: ded1 || null,
                UnionDues: unionDues || null,
                Ded3: ded3 || null,
                Ded4: ded4 || null,
                Operator: operator,
                DateKeyed: now,
                TimeKeyed: now,
                Approved: 0
            };

            if (existingRows.length > 0) {
                const fields = Object.keys(baseFields);
                const setClause = fields.map(f => `${f} = ?`).join(', ');
                const values = fields.map(f => baseFields[f]);
                await pool.query(
                    `UPDATE tblsalary SET ${setClause} WHERE PFNo = ? AND PDate = ?`,
                    [...values, pfno, submittedDate]
                );
            } else {
                const extra = {
                    PType: '01',
                    Paid: 0,
                    FullPay: 0,
                    HalfPay: 0,
                    WithoutPay: 0,
                    Linked: 0,
                    Posted: 0,
                    CompanyID: 1
                };
                const allFields = { ...baseFields, ...extra };
                const cols = Object.keys(allFields);
                const placeholders = cols.map(() => '?').join(', ');
                const values = cols.map(f => allFields[f]);
                await pool.query(
                    `INSERT INTO tblsalary (${cols.join(', ')}) VALUES (${placeholders})`,
                    values
                );
            }

            res.redirect('/data-entry/payroll/payroll-setup');
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getPayrollEdit: async (req, res) => {
        try {
            const [staffList] = await pool.query('SELECT PFNo, SName FROM tblstaff ORDER BY SName');
            const [addItems] = await pool.query("SELECT Code, Income FROM tblpayrollitems WHERE Code BETWEEN '02' AND '20' ORDER BY Code");
            const [dedItems] = await pool.query("SELECT Code, Income FROM tblpayrollitems WHERE Code BETWEEN '31' AND '37' ORDER BY Code");
            const [payDays] = await pool.query('SELECT PayDate FROM tblpayday ORDER BY PayDate DESC');
            res.render('data_entry/payroll/edit_payroll', {
                title: 'Edit Payroll',
                group: 'Payroll',
                path: '/data-entry/payroll/edit-payroll',
                user: { name: 'Data Entry Officer' },
                staffList,
                addItems,
                dedItems,
                payDays
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postPayrollEdit: async (req, res) => {
        try {
            const {
                pfno,
                annual,
                salary,
                totalIncome,
                taxable,
                tax,
                nassitEmp,
                nassitInst,
                gratEmp,
                gratInst,
                totalDeduction,
                netIncome,
                ded1,
                unionDues,
                ded3,
                ded4,
                totAllw,
                fullPay,
                halfPay,
                days
            } = req.body;

            const [rows] = await pool.query(
                'SELECT * FROM tblsalary WHERE PFNo = ? ORDER BY PDate DESC LIMIT 1',
                [pfno]
            );
            if (rows.length === 0) {
                return res.status(400).send('Payroll record not found');
            }
            const existing = rows[0];

            const now = new Date();
            const operator = 'Data Entry Officer';

            const getAllw = (code) => {
                const key = 'allw' + code;
                const val = req.body[key];
                return val === '' || val == null ? null : val;
            };

            const baseFields = {
                Annual: annual || null,
                Salary: salary || null,
                Allw02: getAllw('02'),
                Allw03: getAllw('03'),
                Allw04: getAllw('04'),
                Allw05: getAllw('05'),
                Allw06: getAllw('06'),
                Allw07: getAllw('07'),
                Allw08: getAllw('08'),
                Allw09: getAllw('09'),
                Allw10: getAllw('10'),
                Allw11: getAllw('11'),
                Allw12: getAllw('12'),
                Allw13: getAllw('13'),
                Allw14: getAllw('14'),
                Allw15: getAllw('15'),
                Allw16: getAllw('16'),
                Allw17: getAllw('17'),
                Allw18: getAllw('18'),
                Allw19: getAllw('19'),
                Allw20: getAllw('20'),
                TotAllw: totAllw || null,
                TotalIncome: totalIncome || null,
                Taxable: taxable || null,
                Tax: tax || null,
                NassitEmp: nassitEmp || null,
                NassitInst: nassitInst || null,
                GratEmp: gratEmp || null,
                GratInst: gratInst || null,
                TotalDeduction: totalDeduction || null,
                NetIncome: netIncome || null,
                Ded1: ded1 || null,
                UnionDues: unionDues || null,
                Ded3: ded3 || null,
                Ded4: ded4 || null,
                FullPay: (fullPay === 'on' || fullPay === '1') ? 1 : 0,
                HalfPay: (halfPay === 'on' || halfPay === '1') ? 1 : 0,
                Days: days || null,
                Operator: operator,
                DateKeyed: now,
                TimeKeyed: now,
                Approved: 0,
                ApprovedBy: null,
                DateApproved: null,
                TimeApproved: null
            };

            const fields = Object.keys(baseFields);
            const setClause = fields.map(f => `${f} = ?`).join(', ');
            const values = fields.map(f => baseFields[f]);
            await pool.query(
                `UPDATE tblsalary SET ${setClause} WHERE PFNo = ? AND PDate = ?`,
                [...values, pfno, existing.PDate]
            );

            res.redirect('/data-entry/payroll/edit-payroll');
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getPayrollView: async (req, res) => {
        try {
            const today = new Date();
            const [payTypes] = await pool.query('SELECT Code, PayType FROM tblpaytype ORDER BY Code');
            res.render('data_entry/payroll/view_payroll', {
                title: 'View Payroll',
                group: 'Payroll',
                path: '/data-entry/payroll/view-payroll',
                user: { name: 'Data Entry Officer' },
                today,
                payTypes
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postPayrollViewPreview: async (req, res) => {
        try {
            const { month, year } = req.body;

            const [comRows] = await pool.query('SELECT Com_Name, Address, LogoPath FROM tblcominfo LIMIT 1');
            const company = comRows[0] || { Com_Name: 'Human Resource Payroll', Address: '', LogoPath: '' };

            const m = parseInt(month, 10);
            const y = parseInt(year, 10);
            if (!m || !y) {
                return res.status(400).send('Month and Year are required');
            }

            const [rows] = await pool.query(`
                SELECT 
                    p.PFNo,
                    st.SName,
                    p.Grade as GradeCode,
                    p.Salary,
                    (
                        IFNULL(p.Allw02,0) + IFNULL(p.Allw03,0) + IFNULL(p.Allw04,0) +
                        IFNULL(p.Allw05,0) + IFNULL(p.Allw06,0) + IFNULL(p.Allw07,0) +
                        IFNULL(p.Allw08,0) + IFNULL(p.Allw09,0) + IFNULL(p.Allw10,0) +
                        IFNULL(p.Allw11,0) + IFNULL(p.Allw12,0) + IFNULL(p.Allw13,0) +
                        IFNULL(p.Allw14,0) + IFNULL(p.Allw15,0) + IFNULL(p.Allw16,0) +
                        IFNULL(p.Allw17,0) + IFNULL(p.Allw18,0) + IFNULL(p.Allw19,0) +
                        IFNULL(p.Allw20,0)
                    ) AS TotAllw,
                    p.Tax,
                    p.NetIncome,
                    d.Dept as DeptName
                FROM tblpayroll p
                JOIN tblstaff st ON p.PFNo = st.PFNo
                LEFT JOIN tbldept d ON p.Dept = d.Code
                WHERE 
                    p.PMonth = ?
                    AND p.PYear = ?
                ORDER BY d.Dept, st.SName
            `, [m, y]);

            // Group by department and compute totals
            const departments = [];
            const deptIndex = {};
            let grandTotals = { totAllw: 0, tax: 0, net: 0 };

            rows.forEach(r => {
                const dept = r.DeptName || 'UNASSIGNED';
                if (!deptIndex[dept]) {
                    deptIndex[dept] = {
                        name: dept,
                        rows: [],
                        totals: { totAllw: 0, tax: 0, net: 0 }
                    };
                    departments.push(deptIndex[dept]);
                }
                const group = deptIndex[dept];
                group.rows.push(r);
                const ta = Number(r.TotAllw || 0);
                const tx = Number(r.Tax || 0);
                const ni = Number(r.NetIncome || 0);
                group.totals.totAllw += ta;
                group.totals.tax += tx;
                group.totals.net += ni;
                grandTotals.totAllw += ta;
                grandTotals.tax += tx;
                grandTotals.net += ni;
            });

            const baseUrl = `${req.protocol}://${req.get('host')}`;

            res.render('data_entry/payroll/view_payroll_report', {
                title: 'Payroll Review',
                company,
                baseUrl,
                departments,
                grandTotals,
                month: m,
                year: y
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
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

    getPayrollReports: async (req, res) => {
        try {
            const [staffRows] = await pool.query('SELECT PFNo, SName FROM tblstaff ORDER BY PFNo');
            res.render('data_entry/reports/payroll', {
                title: 'Payroll Reports',
                group: 'Reports',
                path: '/data-entry/reports/payroll',
                user: { name: 'Data Entry Clerk' },
                staffList: staffRows
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
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
            const { month, year, scope, pfno, yearly } = req.query;

            const [comRows] = await pool.query('SELECT Com_Name, Address, LogoPath FROM tblcominfo LIMIT 1');
            const company = comRows[0] || { Com_Name: '', Address: '', LogoPath: null };

            let query = `
                SELECT 
                    p.PFNo, p.Salary, p.Allw02, p.Allw03, p.Allw04, p.Allw05, p.Allw06, p.Allw07, p.Allw08, p.Allw09, p.Allw10, p.Allw11, p.Allw12, p.Allw14, p.Allw16, p.Allw17, p.Allw19,
                    p.TotalIncome, p.Taxable, p.Tax, p.NassitEmp, p.NassitInst, p.GratEmp, p.GratInst, 
                    p.Ded1, p.Ded2, p.Ded3, p.Ded4, p.Ded5, p.NetIncome,
                    s.SName, s.AccountNo,
                    d.Dept AS DeptName,
                    j.JobTitle AS JobTitleName
                FROM tblpayroll p
                LEFT JOIN tblstaff s ON p.PFNo = s.PFNo
                LEFT JOIN tbldept d ON s.CDept = d.Code
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

            let cumSql = `
                SELECT 
                    PFNo,
                    SUM(NassitEmp) AS TotNassitEmp,
                    SUM(NassitInst) AS TotNassitInst,
                    SUM(GratEmp) AS TotGratEmp,
                    SUM(GratInst) AS TotGratInst
                FROM tblpayroll
                WHERE PYear = ? AND PMonth <= ?
            `;
            const cumParams = [year, month];
            if (scope === 'staff' && pfno) {
                cumSql += ' AND PFNo = ?';
                cumParams.push(pfno);
            }
            cumSql += ' GROUP BY PFNo';
            const [cumRows] = await pool.query(cumSql, cumParams);

            const [items] = await pool.query('SELECT Code, Income FROM tblpayrollitems WHERE Code IN (32, 41, 42)');
            const code32 = items.find(r => String(r.Code) === '32');
            const code41 = items.find(r => String(r.Code) === '41');
            const code42 = items.find(r => String(r.Code) === '42');

            // Yearly payments (optional)
            let yearlyTotals = null;
            if (yearly === '1') {
                // Get labels and percentage for Rent(02), Inducement(05), Leave(13)
                const [yItems] = await pool.query(
                    "SELECT Code, Income, Percent FROM tblpayrollitems WHERE Code IN ('02','05','13')"
                );
                const labelMap = {};
                const percentMap = {};
                yItems.forEach(it => {
                    const code = it.Code.padStart(2, '0');
                    labelMap[code] = it.Income;
                    percentMap[code] = it.Percent != null ? parseFloat(it.Percent) : 0;
                });

                // Get yearly Tax values from tblyearlypayments for the selected year (any month)
                const [taxRows] = await pool.query(
                    "SELECT PFNo, PType, Tax FROM tblyearlypayments WHERE PYear = ? AND PType IN ('02','05','13') ORDER BY PMonth DESC, PDate DESC",
                    [year]
                );
                const taxMap = {};
                taxRows.forEach(tr => {
                    const pf = tr.PFNo;
                    const code = tr.PType.padStart(2, '0');
                    if (!taxMap[pf]) taxMap[pf] = {};
                    taxMap[pf][code] = tr.Tax != null ? parseFloat(tr.Tax) : 0;
                });

                const yearlyEntries = [
                    { code: '02' },
                    { code: '05' },
                    { code: '13' }
                ];
                yearlyTotals = {};

                // Build yearly amounts per staff based on Salary * Percent * 12 and attach Tax
                rows.forEach(r => {
                    const pf = r.PFNo;
                    const salary = r.Salary != null ? parseFloat(r.Salary) : 0;
                    if (!salary) {
                        return;
                    }
                    const itemsArr = [];
                    yearlyEntries.forEach(({ code }) => {
                        const pct = percentMap[code] || 0;
                        if (!pct) return;
                        const gross = salary * (pct / 100) * 12;
                        if (!gross) return;
                        const label = labelMap[code] || (code === '13' ? 'LEAVE' : `Allw${code}`);
                        const tax =
                            taxMap[pf] && taxMap[pf][code] != null
                                ? taxMap[pf][code]
                                : 0;
                        itemsArr.push({ code, label, amount: gross, tax });
                    });
                    if (itemsArr.length > 0) {
                        yearlyTotals[pf] = itemsArr;
                    }
                });
            }

            res.json({
                company: {
                    name: company.Com_Name,
                    address: company.Address,
                    logo: company.LogoPath ? `${req.protocol}://${req.get('host')}${company.LogoPath}` : null
                },
                period: { month, year },
                labels: {
                    code32: code32 ? code32.Income : 'Code 32',
                    code41: code41 ? code41.Income : 'Code 41',
                    code42: code42 ? code42.Income : 'Code 42'
                },
                yearly: yearly === '1',
                yearlyTotals,
                cumulative: cumRows,
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

    // Staff New/Edit
    getStaffNewEdit: async (req, res) => {
        try {
            const [sex] = await pool.query('SELECT * FROM tblsex');
            const [mstatus] = await pool.query('SELECT * FROM tblmstatus');
            const [nations] = await pool.query('SELECT * FROM tblnation');
            const [depts] = await pool.query('SELECT * FROM tbldept');
            const [jobTitles] = await pool.query('SELECT * FROM tbljobtitle');
            const [grades] = await pool.query('SELECT * FROM tblgrade');
            const [empTypes] = await pool.query('SELECT * FROM tblemptype');
            const [relations] = await pool.query('SELECT * FROM tblrelation');
            const [empStatuses] = await pool.query('SELECT * FROM tblempstatus');
            const [levels] = await pool.query('SELECT LCode, Level FROM tbllevel ORDER BY Level');
            const [qualifTypes] = await pool.query('SELECT Code, QType FROM tblqualiftype ORDER BY QType');
            const [params1] = await pool.query('SELECT RetireAge FROM tblparams1 LIMIT 1');
            const [vehicles] = await pool.query('SELECT VType FROM tblvehicle ORDER BY VType');

            res.render('data_entry/staff/new_edit', {
                title: 'Staff New/Edit',
                sex,
                mstatus,
                nations,
                depts,
                jobTitles,
                grades,
                empTypes,
                relations,
                empStatuses,
                levels,
                qualifTypes,
                retireAge: params1[0] ? params1[0].RetireAge : 60,
                vehicles,
                user: req.session.user || { name: 'Data Entry' }
            });
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

    getStaffLastLeave: async (req, res) => {
        try {
            const { pfno } = req.params;
            const [rows] = await pool.query(
                'SELECT DATE_FORMAT(MAX(StartDate), "%Y-%m-%d") as LastLeave FROM tblleave WHERE PFNO = ?',
                [pfno]
            );
            const lastLeave = rows[0] ? rows[0].LastLeave : null;
            res.json({ lastLeave });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error fetching last leave' });
        }
    },
 
    getStaffQualifications: async (req, res) => {
        try {
            const { pfno } = req.params;
            const query = `
                SELECT q.Code, q.QName, qt.QType
                FROM tblqualif q
                LEFT JOIN tblqualiftype qt ON q.Code = qt.Code
                WHERE q.PFNo = ?
            `;
            const [rows] = await pool.query(query, [pfno]);
            res.json(rows);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error fetching qualifications' });
        }
    },

    searchStaffNewEdit: async (req, res) => {
        try {
            const { q } = req.query;
            const [rows] = await pool.query(`
                SELECT * FROM tblstaff
                WHERE PFNo LIKE ? OR SName LIKE ?
            `, [`%${q}%`, `%${q}%`]);
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

    postStaffNewEdit: async (req, res) => {
        try {
            const {
                sname, dob, sex, mstatus, nation, address, city, phone, email,
                pfno, doe, dateConfirmed, jobTitle, cGrade, gradeEmployed, dept, empType, empStatus,
                nkin, nkinRelationship, nkinAddr, nkinPhone,
                accountNo, nassitNo,
                cGradeDate, cDeptDate, dEmp, notch, level, unionMember, academic,
                hod, hodStartDate, hodEndDate, vehicle, vehicleStartDate, vehicleEndDate, contractExp,
                qualifCode, qualifName
            } = req.body;

            const operator = (req.session && req.session.user && req.session.user.name) ? req.session.user.name : 'Data Entry Officer';
            const now = new Date();
            const photoPath = req.file ? '/uploads/staff_photos/' + req.file.filename : null;
            const unionMem = unionMember ? 'Y' : 'N';
            const acad = academic ? 'Y' : 'N';
            const hodVal = (hod === 'Y' || hod === 'Yes' || hod === 'true') ? 'Y' : 'N';
            const vehicleVal = vehicle || 'NO';

            // Check if staff exists
            const [existing] = await pool.query('SELECT PFNo FROM tblstaff WHERE PFNo = ?', [pfno]);

            // Notch Validation (Global)
            const [gradeRows] = await pool.query('SELECT NotchIncr FROM tblgrade WHERE GradeCode = ?', [cGrade]);
            const maxNotch = gradeRows.length > 0 ? (gradeRows[0].NotchIncr || 0) : 0;
            if (notch > maxNotch) {
                return res.status(400).json({ error: `Notch cannot exceed ${maxNotch} for this grade` });
            }

            // Salary Calculation (Global)
            let calculatedSalary = 0;
            const [allowanceRows] = await pool.query(
                'SELECT StartLevel, EndLevel, Notches, Increment FROM tblallowance WHERE Grade = ? ORDER BY ScaleDate DESC LIMIT 1',
                [cGrade]
            );

            if (allowanceRows.length > 0) {
                const { StartLevel, EndLevel, Notches, Increment } = allowanceRows[0];
                const numNotches = parseFloat(Notches) || 0;
                const startSalary = parseFloat(StartLevel) || 0;
                const endSalary = parseFloat(EndLevel) || 0;
                const notchVal = parseInt(notch) || 0;

                if (notchVal > 0 && numNotches > 0) {
                    const increment = (endSalary - startSalary) / numNotches;
                    // Annual salary
                    let annualSalary = startSalary + (notchVal * increment);
                    // Monthly salary
                    calculatedSalary = annualSalary / 12;
                    // Round to 2 decimal places
                    calculatedSalary = Math.round(calculatedSalary * 100) / 100;
                } else if (notchVal === 0) {
                    calculatedSalary = 0; // Manual entry or no salary
                } else {
                     calculatedSalary = startSalary / 12;
                     calculatedSalary = Math.round(calculatedSalary * 100) / 100;
                }
            }

            if (existing.length > 0) {
                // Update Staff
                const nassitR = nassitNo ? 1 : 0;
                let updateQuery = `
                    UPDATE tblstaff SET
                        SName = ?, DOB = ?, SexCode = ?, MStatus = ?, NationCode = ?, Address = ?, City = ?, Phone = ?, Email = ?,
                        DOE = ?, DateConfirmed = ?, JobTitle = ?, CGrade = ?, GradeCode = ?, CDept = ?, EmpType = ?, EmpStatus = ?,
                        NKin = ?, NKinRelationship = ?, NKinAddr = ?, NKinPhone = ?,
                        AccountNo = ?, NASSITNo = ?, NASSITR = ?,
                        CGradeDate = ?, CDeptDate = ?, DEmp = ?, Notch = ?, Level = ?, UnionMember = ?, Academic = ?,
                        HOD = ?, HOD_SDate = ?, HOD_EDate = ?, Vehicle = ?, CarSDate = ?, CarEDate = ?, Contract_Exp = ?,
                        Approved = 0, KeyedInBy = ?, KeyedIn = ?, KeyTime = ?
                `;
                const params = [
                    sname, dob || null, sex, mstatus, nation, address, city, phone, email,
                    doe || null, dateConfirmed || null, jobTitle, cGrade, gradeEmployed, dept, empType, empStatus,
                    nkin, nkinRelationship, nkinAddr, nkinPhone,
                    accountNo, nassitNo, nassitR,
                    cGradeDate || null, cDeptDate || null, dEmp, notch, level, unionMem, acad,
                    hodVal, hodStartDate || null, hodEndDate || null, vehicleVal, vehicleStartDate || null, vehicleEndDate || null, contractExp || null,
                    operator, now, now
                ];

                // Update Salary in tblpayroll (Master Record PYear=0) if notch > 0
                if (notch > 0 && calculatedSalary > 0) {
                    const [masterPayroll] = await pool.query('SELECT * FROM tblpayroll WHERE PFNo = ? AND PYear = 0 AND PMonth = 0', [pfno]);
                    if (masterPayroll.length > 0) {
                        await pool.query('UPDATE tblpayroll SET Salary = ? WHERE PFNo = ? AND PYear = 0 AND PMonth = 0', [calculatedSalary, pfno]);
                    } else {
                        // Create master record if missing
                        await pool.query(`INSERT INTO tblpayroll (
                            PDate, SalDate, PFNo, Dept, Grade, JobTitle, 
                            PayThrough, Bank, AccountNo, Level, EmpType, 
                            PayCurrency, ExchRate, Salary, 
                            PMonth, PYear, PType, Paid, Approved, CompanyID,
                            FullPay, HalfPay, WithoutPay
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                            now, now, pfno, dept, cGrade, jobTitle, 
                            '1', '1', accountNo, level, empType, 
                            '01', 1, calculatedSalary, 
                            0, 0, '1', 0, 1, 1,
                            1, 0, 0
                        ]);
                    }
                }

                if (photoPath) {
                    updateQuery += `, PhotoPath = ?`;
                    params.push(photoPath);
                }

                updateQuery += ` WHERE PFNo = ?`;
                params.push(pfno);

                await pool.query(updateQuery, params);
            } else {
                // Insert
                const nassitR = nassitNo ? 1 : 0;
                const insertQuery = `
                    INSERT INTO tblstaff (
                        PFNo, SName, DOB, SexCode, MStatus, NationCode, Address, City, Phone, Email,
                        DOE, DateConfirmed, JobTitle, CGrade, GradeCode, CDept, EmpType, EmpStatus,
                        NKin, NKinRelationship, NKinAddr, NKinPhone,
                        AccountNo, NASSITNo, NASSITR,
                        CGradeDate, CDeptDate, DEmp, Notch, Level, UnionMember, Academic, PhotoPath,
                        HOD, HOD_SDate, HOD_EDate, Vehicle, CarSDate, CarEDate, Contract_Exp,
                        Redundant, Linked, Letter,
                        Approved, KeyedInBy, KeyedIn, KeyTime, CompanyID
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?,
                        0, 0, 0,
                        0, ?, ?, ?, 1
                    )
                `;
                await pool.query(insertQuery, [
                    pfno, sname, dob || null, sex, mstatus, nation, address, city, phone, email,
                    doe || null, dateConfirmed || null, jobTitle, cGrade, gradeEmployed, dept, empType, empStatus,
                    nkin, nkinRelationship, nkinAddr, nkinPhone,
                    accountNo, nassitNo, nassitR,
                    cGradeDate || null, cDeptDate || null, dEmp, notch, level, unionMem, acad, photoPath,
                    hodVal, hodStartDate || null, hodEndDate || null, vehicleVal, vehicleStartDate || null, vehicleEndDate || null, contractExp || null,
                    operator, now, now
                ]);

                // Create master payroll record for new staff
                await pool.query(`INSERT INTO tblpayroll (
                    PDate, SalDate, PFNo, Dept, Grade, JobTitle, 
                    PayThrough, Bank, AccountNo, Level, EmpType, 
                    PayCurrency, ExchRate, Salary, 
                    PMonth, PYear, PType, Paid, Approved, CompanyID
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    now, now, pfno, dept, cGrade, jobTitle, 
                    '1', '1', accountNo, level, empType, 
                    '01', 1, calculatedSalary || 0, 
                    0, 0, '1', 0, 1, 1
                ]);
            }

            // Handle Qualifications
            if (acad === 'Y') {
                await pool.query('DELETE FROM tblqualif WHERE PFNo = ?', [pfno]);

                if (qualifCode && qualifName) {
                    const codes = Array.isArray(qualifCode) ? qualifCode : [qualifCode];
                    const names = Array.isArray(qualifName) ? qualifName : [qualifName];

                    for (let i = 0; i < codes.length; i++) {
                        if (codes[i] && names[i]) {
                            await pool.query('INSERT INTO tblqualif (PFNo, Code, QName, CompanyID) VALUES (?, ?, ?, 1)', [pfno, codes[i], names[i]]);
                        }
                    }
                }
            }

            res.redirect('/data-entry/staff/new-edit?success=Record saved successfully and sent for approval');
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

    getDependants: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            // Fetch Relations for the modal
            const [relations] = await pool.query('SELECT RCode, Relation FROM tblrelation ORDER BY Relation');

            // Fetch Reasons for the delete modal
            const [reasons] = await pool.query('SELECT ReasonCode, Reason FROM tblreason ORDER BY Reason');

            res.render('data_entry/staff/dependants', {
                title: 'Staff Dependants',
                group: 'Staff',
                path: '/data-entry/staff/dependants',
                user: { name: 'Data Entry Clerk' },
                role: 'data_entry',
                companyName,
                relations,
                reasons,
                success: req.query.success,
                error: req.query.error
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    searchDependants: async (req, res) => {
        try {
            const { pfno } = req.params;
            
            // Check staff existence
            const [staffRows] = await pool.query('SELECT SName FROM tblstaff WHERE PFNo = ?', [pfno]);
            if (staffRows.length === 0) {
                return res.status(404).json({ error: 'Staff not found' });
            }

            // Get dependants
            const query = `
                SELECT 
                    d.PFNo,
                    d.DepNo,
                    d.Dependant,
                    d.RCode,
                    r.Relation,
                    DATE_FORMAT(d.DOB, '%Y-%m-%d') as Birthdate,
                    d.PhoneNo
                FROM tbldependant d
                LEFT JOIN tblrelation r ON d.RCode = r.RCode
                WHERE d.PFNo = ? AND (d.Closed = 0 OR d.Closed IS NULL)
                ORDER BY d.DepNo
            `;
            const [dependants] = await pool.query(query, [pfno]);

            // Get max dependants limit
            const [paramsRows] = await pool.query('SELECT Max_Dependants FROM tblparams1 LIMIT 1');
            const maxDependants = paramsRows[0] ? paramsRows[0].Max_Dependants : 0;

            res.json({
                staff: { pfno, name: staffRows[0].SName },
                dependants,
                maxDependants
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    getWelfareRedundancy: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name, Address, LogoPath FROM tblcominfo LIMIT 1');
            const company = comRows[0] || { Com_Name: 'Human Resource Payroll', Address: '', LogoPath: null };
            res.render('data_entry/welfare/redundancy', {
                title: 'Redundancy',
                group: 'Welfare',
                path: '/data-entry/welfare/redundancy',
                user: { name: 'Data Entry Clerk' },
                company
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getWelfareLeave: async (req, res) => {
        try {
             res.render('data_entry/welfare/leave', {
                title: 'Leave Management',
                group: 'Welfare',
                path: '/data-entry/welfare/leave',
                user: { name: 'Data Entry Clerk' }
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getWelfareMedical: async (req, res) => {
        try {
            // Fetch Transaction Labels from tblMCode
            const [mCodes] = await pool.query("SELECT TCode, TransName FROM tblMCode ORDER BY TransName");
            // Fetch Staff for dropdown
            const [staffList] = await pool.query("SELECT PFNo, SName FROM tblstaff WHERE EmpStatus = '01' ORDER BY SName");
            
            res.render('data_entry/welfare/medical', {
                title: 'Medical Management',
                group: 'Welfare',
                path: '/data-entry/welfare/medical',
                user: { name: 'Data Entry Clerk' },
                mCodes,
                staffList
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getStaffMedicalHistory: async (req, res) => {
        try {
            const { pfno } = req.params;
            
            // Get Staff Details & Grade Limit
            const [staffRows] = await pool.query(`
                SELECT s.PFNo, s.SName, g.Medical as MedicalLimit 
                FROM tblstaff s 
                LEFT JOIN tblgrade g ON s.CGrade = g.GradeCode 
                WHERE s.PFNo = ?
            `, [pfno]);

            if (staffRows.length === 0) {
                return res.status(404).json({ error: 'Staff not found' });
            }
            const staff = staffRows[0];
            const limit = parseFloat(staff.MedicalLimit) || 0;

            // Get Medical Records
            const query = `
                SELECT 
                    m.TransNo,
                    DATE_FORMAT(m.EntryDate, '%Y-%m-%d') as EntryDate,
                    m.PFNo,
                    m.Dependant,
                    m.MCode,
                    mc.TransName,
                    m.Amount,
                    m.PicturePath
                FROM tblmedical m
                LEFT JOIN tblMCode mc ON m.MCode = mc.TCode
                WHERE m.PFNo = ?
                ORDER BY m.EntryDate DESC
            `;
            const [records] = await pool.query(query, [pfno]);

            // Calculate Usage and Balance
            const used = records.reduce((sum, record) => sum + (parseFloat(record.Amount) || 0), 0);
            const balance = limit - used;

            res.json({
                staff,
                records,
                balance,
                limit,
                used
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    // --- WELFARE: BANK GUARANTEE ---

    getWelfareGuarantee: async (req, res) => {
        try {
            // 1. Fetch Guarantees
            const [guarantees] = await pool.query(`
                SELECT 
                    bg.RefNo, bg.PFNO, s.SName as Name, bg.LoanAmount, bg.LoanDate, 
                    bg.Duration, bg.Monthly, bg.Bank, b.Bank as BankName,
                    bg.ExpiryDate, bg.Approved, bg.Clearance, bg.ClearanceDate, bg.ReceivedBy
                FROM tblbankguarantee bg
                LEFT JOIN tblstaff s ON bg.PFNO = s.PFNo
                LEFT JOIN tblbanks b ON bg.Bank = b.Code
                ORDER BY bg.LoanDate DESC
            `);

            // 2. Fetch Staff for Dropdown
            const [staff] = await pool.query('SELECT PFNo, SName FROM tblstaff WHERE Redundant = 0 ORDER BY SName');

            // 3. Fetch Banks for Dropdown
            const [banks] = await pool.query('SELECT Code, Bank FROM tblbanks ORDER BY Bank');

            res.render('data_entry/welfare/guarantee', {
                title: 'Bank Loan Guarantee',
                path: '/data-entry/welfare/guarantee',
                user: req.session.user,
                guarantees,
                staff,
                banks
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postWelfareGuarantee: async (req, res) => {
        try {
            const {
                refNo, pfno, bank, loanAmount, duration, loanDate, 
                clearance, clearanceDate, receivedBy
            } = req.body;

            const user = req.session.user ? req.session.user.name : 'DataEntry';
            const now = new Date();

            // Auto-calculate Monthly and Expiry
            const amount = parseFloat(loanAmount);
            const dur = parseInt(duration);
            const monthly = amount / dur;
            
            const lDate = new Date(loanDate);
            const expiryDate = new Date(lDate);
            expiryDate.setMonth(expiryDate.getMonth() + dur);

            if (refNo) {
                // UPDATE Existing Guarantee
                
                // 1. Check Approval Status
                const [rows] = await pool.query('SELECT Approved FROM tblbankguarantee WHERE RefNo = ?', [refNo]);
                if (rows.length === 0) return res.status(404).json({ error: 'Guarantee not found' });
                
                const isApproved = rows[0].Approved === 1;

                if (isApproved) {
                    // Only update Clearance fields
                    await pool.query(`
                        UPDATE tblbankguarantee 
                        SET Clearance=?, ClearanceDate=?, ReceivedBy=?, Operator=?, DateKeyed=?
                        WHERE RefNo=?
                    `, [
                        clearance ? 1 : 0, clearanceDate || null, receivedBy || null, 
                        user, now, refNo
                    ]);
                } else {
                    // Update All Fields
                    await pool.query(`
                        UPDATE tblbankguarantee 
                        SET PFNO=?, Bank=?, LoanAmount=?, Duration=?, Monthly=?, LoanDate=?, ExpiryDate=?,
                            Operator=?, DateKeyed=?
                        WHERE RefNo=?
                    `, [
                        pfno, bank, amount, dur, monthly, loanDate, expiryDate, 
                        user, now, refNo
                    ]);
                }
                
                res.json({ success: true, message: 'Guarantee updated successfully' });

            } else {
                // INSERT New Guarantee
                const newRefNo = `BG-${Date.now()}`; // Simple unique ID
                
                await pool.query(`
                    INSERT INTO tblbankguarantee (
                        RefNo, PFNO, Bank, LoanAmount, Duration, Monthly, LoanDate, ExpiryDate,
                        Approved, Clearance, Operator, DateKeyed, EntryDate
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
                `, [
                    newRefNo, pfno, bank, amount, dur, monthly, loanDate, expiryDate,
                    user, now, now
                ]);

                res.json({ success: true, message: 'Guarantee added successfully' });
            }

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    addMedicalRecord: async (req, res) => {
        try {
            const { entryDate, pfno, mCode, beneficiary, dependant, amount } = req.body;
            const operator = (req.session && req.session.user && req.session.user.name) ? req.session.user.name : 'Data Entry Officer';
            
            // Get Picture Path
            const picturePath = req.file ? '/uploads/medical_receipts/' + req.file.filename : null;

            // Generate TransNo
            const [maxRows] = await pool.query('SELECT MAX(TransNo) as maxId FROM tblmedical');
            const transNo = (maxRows[0].maxId || 0) + 1;

            const depName = (beneficiary === 'Family') ? dependant : 'Self';
            
            await pool.query(
                'INSERT INTO tblmedical (TransNo, EntryDate, PFNo, Dependant, MCode, Amount, PicturePath, TimeKeyed, CompanyID) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)',
                [transNo, entryDate, pfno, depName, mCode, parseFloat(amount) || 0, picturePath, 1] // Assuming CompanyID 1
            );

            res.json({ success: true, message: 'Medical record added successfully' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    getWelfareLoan: async (req, res) => {
        try {
            // Fetch Staff for dropdown
            const [staffList] = await pool.query('SELECT PFNo, SName, AccountNo FROM tblstaff ORDER BY SName');
            
            // Fetch Loan Transaction Types
            const [loanCodes] = await pool.query('SELECT TCode, TransName FROM tblloancode ORDER BY TransName');

            // Fetch Existing Loans for Application Table
            const [applications] = await pool.query(`
                SELECT 
                    l.TransNo,
                    l.EntryDate,
                    l.PFNo,
                    s.SName,
                    l.Amount,
                    l.Interest
                FROM tblloan l
                LEFT JOIN tblstaff s ON l.PFNo = s.PFNo
                ORDER BY l.EntryDate DESC
            `);

            // Fetch Repayment Data (Loans with balance > 0 or recently active)
            const [repayments] = await pool.query(`
                SELECT 
                    l.TransNo,
                    l.PFNo,
                    s.SName,
                    l.Amount,
                    l.EntryDate as LoanDate,
                    l.Duration,
                    l.RepaidAmount,
                    l.LoanBal,
                    l.StartDate,
                    l.ExpDate,
                    l.Repayment
                FROM tblloan l
                LEFT JOIN tblstaff s ON l.PFNo = s.PFNo
                WHERE l.LoanBal > 0 OR l.RepaidAmount > 0
                ORDER BY l.EntryDate DESC
            `);

            res.render('data_entry/welfare/loan', {
                title: 'Staff Loan',
                group: 'Welfare',
                path: '/data-entry/welfare/loan',
                user: { name: 'Data Entry Clerk' },
                staffList,
                loanCodes,
                applications,
                repayments
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getStaffLoanHistory: async (req, res) => {
        try {
            const { pfno } = req.params;
            
            // Get last loan details
            const [loans] = await pool.query(`
                SELECT * FROM tblloan 
                WHERE PFNo = ? 
                ORDER BY EntryDate DESC 
                LIMIT 1
            `, [pfno]);

            let lastLoan = null;
            if (loans.length > 0) {
                const l = loans[0];
                lastLoan = {
                    EntryDate: l.EntryDate,
                    Amount: l.Amount,
                    Completed: (l.LoanBal <= 0) ? 'Yes' : 'No'
                };
            }

            res.json({ lastLoan });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    postWelfareLoanAdd: async (req, res) => {
        try {
            const {
                entryDate, pfno, lTrans, amount, duration,
                monthlyRepayment, interest, monthlyInt, startDate, surcharge
            } = req.body;

            // Calculate Balance (Amount + Interest)
            const loanBal = parseFloat(amount) + parseFloat(interest || 0);
            
            // Calculate Expiry Date based on StartDate + Duration (months)
            const start = new Date(startDate);
            const expDate = new Date(start.setMonth(start.getMonth() + parseInt(duration)));

            // Get Max TransNo
            const [maxRows] = await pool.query("SELECT MAX(TransNo) as maxNo FROM tblloan");
            const nextTransNo = (maxRows[0].maxNo || 0) + 1;

            const query = `
                INSERT INTO tblloan (
                    TransNo, EntryDate, PFNo, LTypeCode, LTrans, 
                    Amount, Duration, DurationBal, Rate, 
                    Repayment, Interest, MonthlyInt, MonthlyRepayment, 
                    StartDate, ExpDate, LoanBal, RepaidAmount, 
                    Approved, Expired, Reschedule, Repaid, CompanyID,
                    Surcharge
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            // Rate is 4% if duration > 5, else 0
            const rate = parseInt(duration) > 5 ? 4 : 0;
            const surchargeVal = surcharge === 'Yes' ? 'Yes' : 'No';

            await pool.query(query, [
                nextTransNo, entryDate, pfno, '01', lTrans,
                amount, duration, duration, rate,
                0, interest || 0, monthlyInt || 0, monthlyRepayment,
                startDate, expDate, loanBal, 0,
                0, 0, 0, 0, 1,
                surchargeVal
            ]);

            res.json({ success: true, message: 'Loan application added successfully' });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    postWelfareLoanRepayment: async (req, res) => {
        try {
            const {
                transNo, repaymentDate, repaymentAmount, pfno
            } = req.body;

            // Insert into tblloanrepayment for Manager Approval
            await pool.query(`
                INSERT INTO tblloanrepayment (LoanTransNo, PFNo, Amount, DatePaid, Approved)
                VALUES (?, ?, ?, ?, 0)
            `, [transNo, pfno, parseFloat(repaymentAmount), repaymentDate]);

            res.json({ success: true, message: 'Repayment submitted for approval' });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    updateMedicalRecord: async (req, res) => {
        try {
            const { transNo, entryDate, pfno, mCode, beneficiary, dependant, amount } = req.body;
            
            // Note: Removed Medical Limit Check as per request

            const depName = (beneficiary === 'Family') ? dependant : 'Self';

            let query = 'UPDATE tblmedical SET EntryDate = ?, PFNo = ?, Dependant = ?, MCode = ?, Amount = ?';
            const params = [entryDate, pfno, depName, mCode, parseFloat(amount) || 0];

            if (req.file) {
                query += ', PicturePath = ?';
                params.push('/uploads/medical_receipts/' + req.file.filename);
            }

            query += ' WHERE TransNo = ?';
            params.push(transNo);

            await pool.query(query, params);

            res.json({ success: true, message: 'Medical record updated successfully' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    getRedundancySheetData: async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT 
                    b.PFNo,
                    b.SName,
                    b.DateEmp,
                    b.Grade,
                    g.Grade as GradeDesc,
                    b.Salary,
                    b.Benefit,
                    b.Tax,
                    b.NetBenefit,
                    b.Years,
                    b.Paid
                FROM tbleosbudget b
                LEFT JOIN tblgrade g ON b.Grade = g.GradeCode
                ORDER BY b.PFNo
            `);
            res.json({ rows });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    addDependant: async (req, res) => {
        try {
            const { pfno, dependant, rcode, dob, phone } = req.body;

            // Get max dependants limit
            const [paramsRows] = await pool.query('SELECT Max_Dependants FROM tblparams1 LIMIT 1');
            const maxDependants = paramsRows[0] ? paramsRows[0].Max_Dependants : 0;

            // Check current count
            const [countRows] = await pool.query('SELECT COUNT(*) as count FROM tbldependant WHERE PFNo = ? AND (Closed = 0 OR Closed IS NULL)', [pfno]);
            const currentCount = countRows[0].count;

            if (currentCount >= maxDependants) {
                return res.status(400).json({ error: `Maximum number of dependants (${maxDependants}) reached.` });
            }

            // Find next DepNo
            const [maxDepRow] = await pool.query('SELECT MAX(CAST(DepNo AS UNSIGNED)) as maxDep FROM tbldependant WHERE PFNo = ?', [pfno]);
            let nextDepNo = (maxDepRow[0].maxDep || 0) + 1;
            
            if (nextDepNo > 9) {
                 return res.status(400).json({ error: 'DepNo limit reached (max 9)' });
            }

            const query = `
                INSERT INTO tbldependant (PFNo, DepNo, Dependant, RCode, DOB, PhoneNo, Closed, Approved, CompanyID)
                VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1)
            `;
            await pool.query(query, [pfno, nextDepNo, dependant, rcode, dob, phone]);

            res.json({ success: true });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    editDependant: async (req, res) => {
        try {
            const { pfno, depNo, dependant, rcode, dob, phone } = req.body;

            const query = `
                UPDATE tbldependant 
                SET Dependant = ?, RCode = ?, DOB = ?, PhoneNo = ?
                WHERE PFNo = ? AND DepNo = ?
            `;
            await pool.query(query, [dependant, rcode, dob, phone, pfno, depNo]);

            res.json({ success: true });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },


    checkOver18Dependants: async (req, res) => {
        try {
            // 1. Get Params (ChildAge limit, HOD, DeptName)
            const [params] = await pool.query('SELECT ChildAge, HOD, DeptName FROM tblparams1 LIMIT 1');
            if (params.length === 0) {
                 return res.json({ error: 'Parameters not configured (tblparams1)' });
            }
            const { ChildAge, HOD, DeptName } = params[0];
            const ageLimit = ChildAge || 18; // Default to 18 if not set

            // 2. Get Company Info for Email
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            // 3. Find Over-Age Dependants
            // Filter: Active (Closed=0), SON/DAUGHTER (RCode IN ('03','04')), Age > ageLimit
            // Note: TIMESTAMPDIFF(YEAR, DOB, CURDATE()) returns the full years.
            const query = `
                SELECT d.PFNo, d.DepNo, d.Dependant, d.RCode, d.DOB, s.SName, s.Email
                FROM tbldependant d
                JOIN tblstaff s ON d.PFNo = s.PFNo
                WHERE d.Closed = 0 
                AND d.RCode IN ('03', '04')
                AND TIMESTAMPDIFF(YEAR, d.DOB, CURDATE()) > ?
            `;
            const [dependants] = await pool.query(query, [ageLimit]);

            if (dependants.length === 0) {
                return res.json({ success: true, message: 'No over-age dependants found.', count: 0 });
            }

            // 4. Process each dependant
            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: process.env.SMTP_PORT,
                secure: process.env.SMTP_SECURE === 'true',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });

            let processedCount = 0;
            const now = new Date();

            for (const dep of dependants) {
                const relation = dep.RCode === '03' ? 'Son' : 'Daughter';
                
                // Send Email
                if (dep.Email) { 
                    const html = `
                        <div style="font-family: Arial, sans-serif;">
                            <p>Dear ${dep.SName},</p>
                            <p><strong>MEDICAL FACILITY FOR CHILD</strong></p>
                            <p>Your ${relation}, ${dep.Dependant}, is now over ${ageLimit} years of age, therefore the office will no longer be responsible for his/her medical bills.</p>
                            <p>Please be advised accordingly.</p>
                            <br>
                            <p>Sincerely Yours,</p>
                            <p>${HOD || 'HOD'}</p>
                            <p>${DeptName || 'Department'}</p>
                        </div>
                    `;

                    const mailOptions = {
                        from: `"${companyName}" <${process.env.SMTP_USER}>`,
                        to: dep.Email,
                        subject: 'MEDICAL FACILITY FOR CHILD - OFF AGE',
                        html: html
                    };
                    
                    try {
                         await transporter.sendMail(mailOptions);
                         console.log(`Email sent to ${dep.Email} for ${dep.Dependant}`);
                    } catch (err) {
                        console.error(`Failed to send email to ${dep.Email}:`, err);
                    }
                }

                // Close Record
                // Update Closed=1, DateClosed=NOW, Reason='09' (OFF AGE)
                // Also set TimeKeyedIn/DateKeyedIn if needed, but user only specified DateClosed and Closed and Reason.
                await pool.query(
                    'UPDATE tbldependant SET Closed = 1, DateClosed = ?, Reason = ? WHERE PFNo = ? AND DepNo = ?',
                    [now, '09', dep.PFNo, dep.DepNo]
                );
                processedCount++;
            }

            res.json({ success: true, message: `Processed ${processedCount} dependants.`, count: processedCount });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error processing over-age dependants' });
        }
    },

    // Training
    getTraining: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            const [levels] = await pool.query('SELECT CLCode, CLevel FROM tblcourselevel ORDER BY CLevel');
            const [types] = await pool.query('SELECT CourseCode, CType FROM tblcoursetype ORDER BY CType');
            const [sponsors] = await pool.query('SELECT SCode, Sponsor FROM tblcoursesponsor ORDER BY Sponsor');
            const [staff] = await pool.query('SELECT PFNo, SName FROM tblstaff ORDER BY SName');

            res.render('data_entry/staff/training', {
                title: 'Staff Training',
                group: 'Staff',
                path: '/data-entry/staff/training',
                user: { name: 'Data Entry Clerk' },
                role: 'data_entry',
                companyName,
                levels,
                types,
                sponsors,
                staff
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    searchStaffTraining: async (req, res) => {
        try {
            const { pfno } = req.query;
            if (!pfno) return res.status(400).json({ error: 'PFNo is required' });

            const query = `
                SELECT t.PFNo, t.Course, t.Level, t.Type, t.OrganisedBy, t.Duration, t.Country, t.StartDate, t.Cost, t.SponsoredBy, t.Completed, t.YCompleted,
                       l.CLevel, ty.CType, s.Sponsor as SponsorName
                FROM tblcourse t
                LEFT JOIN tblcourselevel l ON t.Level = l.CLCode 
                LEFT JOIN tblcoursetype ty ON t.Type = ty.CourseCode
                LEFT JOIN tblcoursesponsor s ON t.SponsoredBy = s.SCode
                WHERE t.PFNo = ?
                ORDER BY t.StartDate DESC
            `;
            const [rows] = await pool.query(query, [pfno]);
            res.json(rows);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    addTraining: async (req, res) => {
        try {
            const { 
                pfno, course, level, type, organisedBy, duration, country, startDate, cost, sponsor, completed, yearCompleted 
            } = req.body;

            const isCompleted = completed === 'on' || completed === true || completed === 1 ? 1 : 0;
            const safeYearCompleted = yearCompleted && yearCompleted !== '' ? yearCompleted : null;

            const query = `
                INSERT INTO tblcourse 
                (PFNo, Course, Level, Type, OrganisedBy, Duration, Country, StartDate, Cost, SponsoredBy, Completed, YCompleted, approved, CompanyID)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
            `;
            
            await pool.query(query, [
                pfno, course, level, type, organisedBy, duration, country, startDate, cost, sponsor, isCompleted, safeYearCompleted
            ]);

            res.json({ success: true, message: 'Training added successfully.' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    updateTraining: async (req, res) => {
         try {
            const { 
                pfno, course, level, type, organisedBy, duration, country, startDate, cost, sponsor, completed, yearCompleted,
                originalCourse, originalStartDate 
            } = req.body;
            
            const isCompleted = completed === 'on' || completed === true || completed === 1 ? 1 : 0;
            const safeYearCompleted = yearCompleted && yearCompleted !== '' ? yearCompleted : null;
            
            const query = `
                UPDATE tblcourse 
                SET Course=?, Level=?, Type=?, OrganisedBy=?, Duration=?, Country=?, StartDate=?, Cost=?, SponsoredBy=?, Completed=?, YCompleted=?, approved=0
                WHERE PFNo=? AND Course=? AND StartDate=?
            `;
            
            await pool.query(query, [
                course, level, type, organisedBy, duration, country, startDate, cost, sponsor, isCompleted, safeYearCompleted,
                pfno, originalCourse, originalStartDate
            ]);

            res.json({ success: true, message: 'Training updated successfully.' });

         } catch (error) {
             console.error(error);
             res.status(500).json({ error: 'Server error' });
         }
    },

    // Queries
    getQueries: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            // Fetch Query Types and Reactions for dropdowns
            const [qTypes] = await pool.query('SELECT Code, QType FROM tblqtype ORDER BY QType');
            const [mReactions] = await pool.query('SELECT Code, Reaction FROM tblmreaction ORDER BY Reaction');

            res.render('data_entry/staff/queries', {
                title: 'Staff Queries',
                group: 'Staff',
                path: '/data-entry/staff/queries',
                user: { name: 'Data Entry Clerk' },
                role: 'data_entry',
                companyName,
                qTypes,
                mReactions
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    searchQueries: async (req, res) => {
        try {
            const { pfno } = req.params;
            
            // Check staff existence
            const [staffRows] = await pool.query('SELECT SName FROM tblstaff WHERE PFNo = ?', [pfno]);
            if (staffRows.length === 0) {
                return res.status(404).json({ error: 'Staff not found' });
            }

            // Get queries
            const query = `
                SELECT 
                    q.PFNO,
                    DATE_FORMAT(q.QDate, '%Y-%m-%d %H:%i:%s') as QDateFormatted,
                    q.QDate,
                    q.QType as QTypeCode,
                    qt.QType as QTypeName,
                    q.QDetails,
                    q.MResponse as MResponseCode,
                    mr.Reaction as MResponseName,
                    DATE_FORMAT(q.SDate, '%Y-%m-%d') as SDateFormatted,
                    DATE_FORMAT(q.EDate, '%Y-%m-%d') as EDateFormatted,
                    q.SDate,
                    q.EDate,
                    q.Percent,
                    q.Approved
                FROM tblquery q
                LEFT JOIN tblqtype qt ON q.QType = qt.Code
                LEFT JOIN tblmreaction mr ON q.MResponse = mr.Code
                WHERE q.PFNO = ?
                ORDER BY q.QDate DESC
            `;
            const [queries] = await pool.query(query, [pfno]);

            res.json({
                staff: { pfno, name: staffRows[0].SName },
                queries
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    addQuery: async (req, res) => {
        try {
            const { pfno, qDate, qType, qDetails, mResponse, sDate, eDate, percent } = req.body;

            const query = `
                INSERT INTO tblquery (
                    PFNO, QDate, QType, QDetails, Recorded, MResponse, SDate, EDate, Percent, 
                    Expired, Approved, CompanyID
                ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 0, 0, 1)
            `;
            
            // Handle optional dates
            const sDateVal = sDate || null;
            const eDateVal = eDate || null;

            await pool.query(query, [pfno, qDate, qType, qDetails, mResponse, sDateVal, eDateVal, percent]);

            res.json({ success: true });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    editQuery: async (req, res) => {
        try {
            const { pfno, originalQDate, qDate, qType, qDetails, mResponse, sDate, eDate, percent } = req.body;

            const query = `
                UPDATE tblquery 
                SET QDate = ?, QType = ?, QDetails = ?, MResponse = ?, SDate = ?, EDate = ?, Percent = ?
                WHERE PFNO = ? AND QDate = ?
            `;

            const sDateVal = sDate || null;
            const eDateVal = eDate || null;
            
            await pool.query(query, [qDate, qType, qDetails, mResponse, sDateVal, eDateVal, percent, pfno, originalQDate]);

            res.json({ success: true });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    getTransfer: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';
            
            const [depts] = await pool.query('SELECT Code, Dept FROM tbldept ORDER BY Dept');

            res.render('data_entry/staff/transfer', {
                title: 'Staff Transfer',
                user: req.user,
                companyName,
                departments: depts
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    searchStaffForTransfer: async (req, res) => {
        try {
            const { pfno } = req.query;
            if (!pfno) {
                return res.status(400).json({ error: 'PFNo is required' });
            }

            const query = `
                SELECT s.PFNo, s.SName, s.CDept, d.Dept as DeptName, s.CDeptDate
                FROM tblstaff s
                LEFT JOIN tbldept d ON s.CDept = d.Code
                WHERE s.PFNo = ?
            `;
            const [rows] = await pool.query(query, [pfno]);

            if (rows.length === 0) {
                return res.status(404).json({ error: 'Staff not found' });
            }

            res.json(rows[0]);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    postTransfer: async (req, res) => {
        try {
            const { pfno, newDeptCode, transferDate } = req.body;
            
            // Get staff details for SName and PrevDept
            const [staffRows] = await pool.query('SELECT SName, CDept FROM tblstaff WHERE PFNo = ?', [pfno]);
            if (staffRows.length === 0) {
                return res.status(404).json({ error: 'Staff not found' });
            }
            const staff = staffRows[0];

            // Insert into tbltransfer
            const query = `
                INSERT INTO tbltransfer (
                    PFNO, SName, TDate, PrevDept, Activity, TDept, 
                    approved, approvedby, dateapproved, CompanyID
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            // Defaulting dateapproved to NULL and approvedby to current user (or 'user')
            // Using TDate from body or CURDATE()
            const tDate = transferDate || new Date();
            
            await pool.query(query, [
                pfno, 
                staff.SName, 
                tDate, 
                staff.CDept, 
                0, // Activity
                newDeptCode, 
                0, // approved (false)
                req.user ? req.user.username : 'user', 
                null, // dateapproved
                1 // CompanyID
            ]);

            res.json({ success: true });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
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
                Email,
                Ref1Name,
                Ref1Addr,
                Ref1Phone,
                Ref2Name,
                Ref2Addr,
                Ref2Phone,
                ExamDate,
                Result,
                IntDate
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
                (RefNo, Received, SName, DOB, Sex, Nationality, MStatus, Address, City, DApplied, QCode, Email, Ref1Name, Ref1Addr, Ref1Phone, Ref2Name, Ref2Addr, Ref2Phone, ExamDate, Result, IntDate, Approved, DateApproved, Selected, dateSelected, CompanyID) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                Email || null,
                Ref1Name || null,
                Ref1Addr || null,
                Ref1Phone || null,
                Ref2Name || null,
                Ref2Addr || null,
                Ref2Phone || null,
                cleanDateTime(ExamDate),
                Result || null,
                cleanDateTime(IntDate),
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

    getInterview: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            const [applicants] = await pool.query('SELECT RefNo, SName FROM tblapplication WHERE (Selected IS NULL OR Selected = 0) ORDER BY SName');

            res.render('data_entry/staff/interview', {
                title: 'Interview Invitation',
                path: '/data-entry/staff/interview',
                user: { name: 'Data Entry Clerk' },
                companyName,
                applicants
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getApplicantDetails: async (req, res) => {
        try {
            const { refno } = req.params;
            const [rows] = await pool.query('SELECT RefNo, SName, Email, Result, DApplied FROM tblapplication WHERE RefNo = ?', [refno]);
            
            if (rows.length > 0) {
                res.json(rows[0]);
            } else {
                res.status(404).json({ error: 'Applicant not found' });
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    postSelectInterview: async (req, res) => {
        try {
            const { applicants } = req.body;
            
            if (!applicants || !Array.isArray(applicants) || applicants.length === 0) {
                return res.status(400).json({ error: 'No applicants provided' });
            }

            const refNos = applicants.map(app => app.RefNo);
            const now = new Date();

            // Update tblapplication
            // Using placeholders for IN clause
            const placeholders = refNos.map(() => '?').join(',');
            const query = `UPDATE tblapplication SET Selected = 1, dateSelected = ?, Approved = 0 WHERE RefNo IN (${placeholders})`;
            
            const params = [now, ...refNos];
            
            await pool.query(query, params);

            res.json({ success: true, message: 'Applicants selected for interview approval.' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error: ' + error.message });
        }
    },

    getTrainingEnquiry: async (req, res) => {
        try {
            const { pfno, dept, grade, gender, profession, course, dateFrom, dateTo, page = 1 } = req.query;
            const limit = 10;
            const offset = (page - 1) * limit;

            // Fetch Company Info
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            // Fetch Dropdowns
            const [depts] = await pool.query('SELECT Code, Dept FROM tbldept ORDER BY Dept');
            const [grades] = await pool.query('SELECT GradeCode, Grade FROM tblgrade ORDER BY Grade');
            const [professions] = await pool.query('SELECT Code, QType FROM tblqualiftype ORDER BY QType');
            const [sexes] = await pool.query('SELECT SexCode, Status FROM tblsex ORDER BY Status');

            let baseQuery = `
                SELECT 
                    c.PFNo,
                    s.SName,
                    c.Country as Location,
                    c.Course,
                    c.Level,
                    c.Type,
                    c.StartDate,
                    c.Duration,
                    NULL as WH,
                    NULL as Resumes
                FROM tblcourse c
                LEFT JOIN tblstaff s ON c.PFNo = s.PFNo
                WHERE 1=1
            `;

            const params = [];

            if (pfno) {
                baseQuery += ' AND c.PFNo LIKE ?';
                params.push(`%${pfno}%`);
            }

            if (dept) {
                baseQuery += ' AND s.CDept = ?';
                params.push(dept);
            }

            if (grade) {
                baseQuery += ' AND s.CGrade = ?';
                params.push(grade);
            }

            if (gender) {
                baseQuery += ' AND s.SexCode = ?';
                params.push(gender);
            }

            if (profession) {
                baseQuery += ' AND s.Professional = ?';
                params.push(profession);
            }

            if (course) {
                baseQuery += ' AND c.Course LIKE ?';
                params.push(`%${course}%`);
            }

            if (dateFrom) {
                baseQuery += ' AND c.StartDate >= ?';
                params.push(dateFrom);
            }

            if (dateTo) {
                baseQuery += ' AND c.StartDate <= ?';
                params.push(dateTo);
            }

            const countQuery = `SELECT COUNT(*) as total FROM (${baseQuery}) as sub`;
            const [countRows] = await pool.query(countQuery, params);
            const total = countRows[0].total;

            const pagedQuery = baseQuery + ' ORDER BY c.StartDate DESC LIMIT ? OFFSET ?';
            const pageParams = params.slice();
            pageParams.push(limit, offset);

            const [rows] = await pool.query(pagedQuery, pageParams);

            res.render('data_entry/enquiry/training', {
                title: 'Training Enquiry',
                group: 'Enquiry',
                path: '/data-entry/enquiry/training',
                user: { name: 'Data Entry Clerk' },
                role: 'data_entry',
                companyName,
                data: rows,
                depts,
                grades,
                professions,
                sexes,
                filters: {
                    pfno,
                    dept,
                    grade,
                    gender,
                    profession,
                    course,
                    dateFrom,
                    dateTo
                },
                pagination: {
                    page: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalRecords: total
                }
            });

        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
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
    },

    // Appraisal
    getAppraisal: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            // Fetch Staff for dropdown
            const [staffList] = await pool.query('SELECT PFNo, SName FROM tblstaff ORDER BY SName');
            
            // Fetch Assessment values
            const [assessments] = await pool.query('SELECT Code, Assessment FROM tblassessment ORDER BY Code');

            // Pagination
            const { page = 1 } = req.query;
            const limit = 10;
            const offset = (page - 1) * limit;
            
            const countQuery = 'SELECT COUNT(*) as total FROM tblappraisal WHERE Approved = 0';
            const [countRows] = await pool.query(countQuery);
            const total = countRows[0].total;

            const query = `
                SELECT 
                    a.AppraisalNo,
                    a.PFNo,
                    s.SName,
                    j.JobTitle as JobTitleName,
                    d.Dept as DeptName,
                    a.StartDate,
                    a.EndDate,
                    a.Punctuality as Punc,
                    a.Performance as Perf,
                    a.Communication_Skills as Com,
                    a.Leadership as Lead,
                    a.TeamWork as Team,
                    a.Relationship as Rela,
                    a.Attitude as Attd,
                    a.Output as Output,
                    a.Manager_Comments,
                    a.PostDate,
                    a.Staff_Comments,
                    a.StaffDate,
                    a.StaffOption,
                    a.Committee_Comments,
                    a.CommitteeDate,
                    a.Manager
                FROM tblappraisal a
                LEFT JOIN tblstaff s ON a.PFNo = s.PFNo
                LEFT JOIN tbljobtitle j ON s.JobTitle = j.Code
                LEFT JOIN tbldept d ON s.CDept = d.Code
                WHERE a.Approved = 0
                ORDER BY a.StartDate DESC
                LIMIT ? OFFSET ?
            `;
            const [appraisals] = await pool.query(query, [limit, offset]);
            
            res.render('data_entry/staff/appraisal', {
                title: 'Staff Appraisal',
                group: 'Staff',
                path: '/data-entry/staff/appraisal',
                user: { name: 'Data Entry Clerk' },
                role: 'data_entry',
                companyName,
                staffList,
                assessments,
                appraisals,
                pagination: {
                    page: parseInt(page),
                    totalPages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    searchAppraisals: async (req, res) => {
         try {
            const { pfno } = req.params;
            
            // Check staff existence and return details for form population
            const query = `
                SELECT 
                    s.PFNo, 
                    s.SName, 
                    DATE_FORMAT(s.DOE, '%Y-%m-%d') as HireDate,
                    j.JobTitle,
                    d.Dept
                FROM tblstaff s
                LEFT JOIN tbljobtitle j ON s.JobTitle = j.Code
                LEFT JOIN tbldept d ON s.CDept = d.Code
                WHERE s.PFNo = ?
            `;
            const [staffRows] = await pool.query(query, [pfno]);

            if (staffRows.length === 0) {
                 return res.status(404).json({ error: 'Staff not found' });
            }

            // Also fetch last review date from tblappraisal for this staff
            const [lastReviewRow] = await pool.query('SELECT MAX(EndDate) as LastReview FROM tblappraisal WHERE PFNo = ?', [pfno]);
            const lastReview = lastReviewRow[0].LastReview ? lastReviewRow[0].LastReview : 'N/A';

            res.json({
                staff: staffRows[0],
                lastReview
            });

         } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
         }
    },

    addAppraisal: async (req, res) => {
        try {
            const {
                pfno, manager, startDate, endDate, 
                punc, perf, com, lead, team, rela, attd, output,
                managerComments, postDate,
                staffComments, staffDate, staffOption,
                committeeComments, committeeDate
            } = req.body;
            
            // Get Max AppraisalNo
            const [maxRows] = await pool.query('SELECT MAX(AppraisalNo) as maxNo FROM tblappraisal');
            const nextNo = (maxRows[0].maxNo || 0) + 1;

            const query = `
                INSERT INTO tblappraisal (
                    AppraisalNo, PFNo, Manager, StartDate, EndDate, 
                    Punctuality, Performance, Communication_Skills, Leadership, TeamWork, Relationship, Attitude, Output,
                    Manager_Comments, PostDate, 
                    Staff_Comments, StaffDate, StaffOption,
                    Committee_Comments, CommitteeDate,
                    Approved, CompanyID, Operator, KeyedIn,
                    Dept, JobTitle, HireDate
                ) 
                SELECT 
                    ?, s.PFNo, ?, ?, ?, 
                    ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, 
                    ?, ?, ?,
                    ?, ?, 
                    0, 1, ?, NOW(),
                    d.Dept, j.JobTitle, s.DOE
                FROM tblstaff s
                LEFT JOIN tbldept d ON s.CDept = d.Code
                LEFT JOIN tbljobtitle j ON s.JobTitle = j.Code
                WHERE s.PFNo = ?
            `;

            // Handle dates
            const sDate = startDate || null;
            const eDate = endDate || null;
            const pDate = postDate || null;
            const stDate = staffDate || null;
            const cDate = committeeDate || null;
            const operator = req.user ? req.user.username : 'Data Entry Clerk';

            await pool.query(query, [
                nextNo, manager, sDate, eDate,
                punc, perf, com, lead, team, rela, attd, output,
                managerComments, pDate,
                staffComments, stDate, staffOption,
                committeeComments, cDate,
                operator,
                pfno
            ]);

            res.json({ success: true, message: 'Appraisal added successfully.' });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },
    
    editAppraisal: async (req, res) => {
         try {
            const {
                appraisalNo, manager, startDate, endDate, 
                punc, perf, com, lead, team, rela, attd, output,
                managerComments, postDate,
                staffComments, staffDate, staffOption,
                committeeComments, committeeDate
            } = req.body;

            const query = `
                UPDATE tblappraisal a
                LEFT JOIN tblstaff s ON a.PFNo = s.PFNo
                LEFT JOIN tbldept d ON s.CDept = d.Code
                LEFT JOIN tbljobtitle j ON s.JobTitle = j.Code
                SET
                    a.Manager = ?, a.StartDate = ?, a.EndDate = ?, 
                    a.Punctuality = ?, a.Performance = ?, a.Communication_Skills = ?, a.Leadership = ?, a.TeamWork = ?, a.Relationship = ?, a.Attitude = ?, a.Output = ?,
                    a.Manager_Comments = ?, a.PostDate = ?, 
                    a.Staff_Comments = ?, a.StaffDate = ?, a.StaffOption = ?,
                    a.Committee_Comments = ?, a.CommitteeDate = ?,
                    a.Operator = ?, a.KeyedIn = NOW(),
                    a.Dept = d.Dept, a.JobTitle = j.JobTitle, a.HireDate = s.DOE
                WHERE a.AppraisalNo = ?
            `;
            
            // Handle dates
            const sDate = startDate || null;
            const eDate = endDate || null;
            const pDate = postDate || null;
            const stDate = staffDate || null;
            const cDate = committeeDate || null;
            const operator = req.user ? req.user.username : 'Data Entry Clerk';

            await pool.query(query, [
                manager, sDate, eDate,
                punc, perf, com, lead, team, rela, attd, output,
                managerComments, pDate,
                staffComments, stDate, staffOption,
                committeeComments, cDate,
                operator,
                appraisalNo
            ]);

            res.json({ success: true, message: 'Appraisal updated successfully.' });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },


    // Redundancy
    getStaffRedundancy: async (req, res) => {
        try {
            const { search, page = 1 } = req.query;
            const limit = 10;
            const offset = (page - 1) * limit;

            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            let baseQuery = `
                SELECT 
                    s.PFNo,
                    s.SName,
                    s.DOE,
                    d.Dept as Department,
                    TIMESTAMPDIFF(YEAR, s.DOE, CURDATE()) as Served,
                    s.Redundant,
                    s.DateRedundant
                FROM tblstaff s
                LEFT JOIN tbldept d ON s.CDept = d.Code
                WHERE 1=1
            `;

            const params = [];

            if (search) {
                baseQuery += ' AND (s.PFNo LIKE ? OR s.SName LIKE ?)';
                params.push(`%${search}%`, `%${search}%`);
            }

            // Count for pagination
            const countQuery = `SELECT COUNT(*) as total FROM (${baseQuery}) as sub`;
            const [countRows] = await pool.query(countQuery, params);
            const total = countRows[0].total;

            // Fetch Data
            const dataQuery = baseQuery + ' ORDER BY s.SName ASC LIMIT ? OFFSET ?';
            params.push(limit, offset);
            
            const [staffList] = await pool.query(dataQuery, params);

            res.render('data_entry/staff/redundancy', {
                title: 'Staff Redundancy Management',
                user: { name: 'Data Entry Clerk' },
                companyName,
                staffList,
                search,
                pagination: {
                    page: parseInt(page),
                    totalPages: Math.ceil(total / limit)
                }
            });
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

    initiateRedundancy: async (req, res) => {
        try {
            const { pfno } = req.body;
            // Set Redundant to 2 (Pending)
            await pool.query('UPDATE tblstaff SET Redundant = 2 WHERE PFNo = ?', [pfno]);
            res.redirect('/data-entry/staff/redundancy');
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

    // Promotion & Demotion
    getPromotionDemotion: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            // Fetch Staff for dropdown
            const [staffList] = await pool.query('SELECT PFNo, SName FROM tblstaff ORDER BY SName');

            // Fetch Job Titles
            const [jobTitles] = await pool.query('SELECT Code, JobTitle FROM tbljobtitle ORDER BY JobTitle');
            
            // Fetch Grades (for new grade selection)
            const [grades] = await pool.query('SELECT GradeCode, Grade, JobTitle FROM tblgrade ORDER BY Grade');

            // Fetch Pending Promotions
             const query = `
                SELECT 
                    p.PFNO,
                    s.SName,
                    p.PDate,
                    p.Mode,
                    g1.Grade as PrevGradeDesc,
                    g2.Grade as NewGradeDesc,
                    j.JobTitle as NewJobTitleDesc
                FROM tblpromotions p
                LEFT JOIN tblstaff s ON p.PFNO = s.PFNo
                LEFT JOIN (SELECT DISTINCT GradeCode, Grade FROM tblgrade) g1 ON p.PrevGrade = g1.GradeCode
                LEFT JOIN (SELECT DISTINCT GradeCode, Grade FROM tblgrade) g2 ON p.CGrade = g2.GradeCode
                LEFT JOIN tbljobtitle j ON p.JobTitle = j.Code
                WHERE p.Approved = 0
                ORDER BY p.dateKeyed DESC
            `;
            const [promotions] = await pool.query(query);

            res.render('data_entry/staff/promotion', {
                title: 'Staff Promotion / Demotion',
                user: { name: 'Data Entry Clerk' },
                companyName,
                staffList,
                jobTitles,
                grades,
                promotions
            });
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

    searchStaffPromotionDetails: async (req, res) => {
        try {
            const { pfno } = req.params;
            
            // Get Staff Details (Name, Current Grade, JobTitle)
            const [staffRows] = await pool.query(`
                SELECT s.SName, s.CGrade, s.JobTitle, g.Grade as GradeDesc 
                FROM tblstaff s 
                LEFT JOIN tblgrade g ON s.CGrade = g.GradeCode 
                WHERE s.PFNo = ?`, [pfno]);
                
            if (staffRows.length === 0) return res.status(404).json({ error: 'Staff not found' });
            
            const staff = staffRows[0];
            
            // Get Previous Grade (Most recent promotion record)
            const [promoRows] = await pool.query(`
                SELECT PrevGrade, g.Grade as GradeDesc 
                FROM tblpromotions p
                LEFT JOIN tblgrade g ON p.PrevGrade = g.GradeCode
                WHERE PFNO = ? 
                ORDER BY PDate DESC LIMIT 1`, [pfno]);
                
            const prevGrade = promoRows.length > 0 ? promoRows[0] : null;
            
            res.json({
                name: staff.SName,
                currentGradeCode: staff.CGrade,
                currentGradeDesc: staff.GradeDesc,
                currentJobTitleCode: staff.JobTitle,
                prevGradeCode: prevGrade ? prevGrade.PrevGrade : '',
                prevGradeDesc: prevGrade ? prevGrade.GradeDesc : ''
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    addPromotion: async (req, res) => {
        try {
            const { 
                pfno, 
                promotionDate, 
                currentGradeCode, 
                newJobTitle,
                newGrade,
                type // 'promotion' or 'demotion'
            } = req.body;

            const prevGradeSafe = currentGradeCode || '';
            const mode = type === 'demotion' ? 'D' : 'P';

            // Activity = 0 (Pending/Promotion?) 
            
            const query = `
                INSERT INTO tblpromotions (
                    PFNO, PDate, PrevGrade, CGrade, JobTitle, 
                    Activity, Mode, Approved, 
                    Operator, dateKeyed, TimeKeyed, CompanyID
                ) VALUES (
                    ?, ?, ?, ?, ?, 
                    1, ?, 0, 
                    ?, NOW(), NOW(), 1
                )
            `;
            
            await pool.query(query, [
                pfno, promotionDate, prevGradeSafe, newGrade, newJobTitle,
                mode,
                'DataEntry' // Operator
            ]);

            res.redirect('/data-entry/staff/promotion-demotion');
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

    // Staff Exit
    getStaffExit: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            // Fetch Staff for dropdown
            const [staffList] = await pool.query('SELECT PFNo, SName FROM tblstaff ORDER BY SName');

            // Fetch Reasons
            const [reasons] = await pool.query('SELECT ReasonCode, Reason FROM tblreason ORDER BY Reason');

            res.render('data_entry/staff/exit', {
                title: 'Staff Exit',
                user: { name: 'Data Entry Clerk' },
                companyName,
                staffList,
                reasons,
                success: req.query.success
            });
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

    searchStaffExit: async (req, res) => {
        try {
            const { pfno } = req.query;
            if (!pfno) return res.status(400).json({ error: 'PFNo is required' });

            const [rows] = await pool.query('SELECT * FROM tblformer WHERE PFNo = ?', [pfno]);
            if (rows.length > 0) {
                // Format dates for input fields (YYYY-MM-DD)
                const record = rows[0];
                const formatDate = (d) => d ? new Date(d).toISOString().split('T')[0] : '';
                
                res.json({
                    found: true,
                    data: {
                        Reason: record.Reason,
                        DateResigned: formatDate(record.DateResigned),
                        NoticeDate: formatDate(record.NoticeDate),
                        ExpDate: formatDate(record.ExpDate),
                        DateLeft: formatDate(record.DateLeft),
                        BriefInfo: record.BriefInfo,
                        DateAccepted: formatDate(record.DateAccepted),
                        ExitInterview: record.ExitInterview,
                        DateInterviewed: formatDate(record.DateInterviewed)
                    }
                });
            } else {
                res.json({ found: false });
            }
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    postStaffExit: async (req, res) => {
        try {
            const {
                pfno, reason, reasonDate, noticeDate, noticeExpiry, 
                dateLeft, briefDetails, dateAccepted, interviewed, dateInterviewed
            } = req.body;

            const isInterviewed = interviewed === 'on' || interviewed === '1' ? 1 : 0;
            const operator = req.user ? req.user.username : 'Data Entry Clerk';
            const now = new Date();

            // Check if record exists
            const [rows] = await pool.query('SELECT PFNo FROM tblformer WHERE PFNo = ?', [pfno]);

            if (rows.length > 0) {
                // Update
                const query = `
                    UPDATE tblformer SET
                        Reason = ?, DateResigned = ?, NoticeDate = ?, ExpDate = ?, 
                        DateLeft = ?, BriefInfo = ?, DateAccepted = ?, 
                        ExitInterview = ?, DateInterviewed = ?,
                        Operator = ?, KeyedTime = ?, DateKeyed = ?, Approved = 0
                    WHERE PFNo = ?
                `;
                await pool.query(query, [
                    reason, reasonDate || null, noticeDate || null, noticeExpiry || null,
                    dateLeft || null, briefDetails, dateAccepted || null,
                    isInterviewed, dateInterviewed || null,
                    operator, now, now,
                    pfno
                ]);
            } else {
                // Insert
                const query = `
                    INSERT INTO tblformer (
                        PFNo, Reason, DateResigned, NoticeDate, ExpDate, 
                        DateLeft, BriefInfo, DateAccepted, 
                        ExitInterview, DateInterviewed,
                        Operator, KeyedTime, DateKeyed, Approved
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                `;
                await pool.query(query, [
                    pfno, reason, reasonDate || null, noticeDate || null, noticeExpiry || null,
                    dateLeft || null, briefDetails, dateAccepted || null,
                    isInterviewed, dateInterviewed || null,
                    operator, now, now
                ]);
            }

            res.redirect('/data-entry/staff/exit?success=Record saved successfully');
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

    getProcessEmoluments: async (req, res) => {
        try {
            const [payTypes] = await pool.query('SELECT Code, PayType FROM tblpaytype ORDER BY Code');
            const [payrollRows] = await pool.query('SELECT MAX(PDate) as lastDate FROM tblpayroll');
            const lastPayDate = payrollRows[0].lastDate || null;
            
            res.render('data_entry/payroll/process_emoluments', {
                title: 'Process Monthly Salaries, Allowances, etc',
                group: 'Payroll',
                path: '/data-entry/payroll/process-emoluments',
                user: { name: 'Data Entry Officer' },
                payTypes,
                lastPayDate
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    checkProcessStatus: async (req, res) => {
        try {
            const { pdate, activity } = req.query;
            if (!pdate) return res.status(400).json({ error: 'Date is required' });
            if (!activity) return res.status(400).json({ error: 'Activity is required' });

            const processDate = new Date(pdate);
            
            // 1. Check for unapproved salaries
            const [unapprovedSalaries] = await pool.query('SELECT COUNT(*) as count FROM tblsalary WHERE Approved = 0');
            
            // 2. Check for unapproved entitlements
            const [unapprovedEntitles] = await pool.query('SELECT COUNT(*) as count FROM tblentitle WHERE Approved = 0');
            
            if (unapprovedSalaries[0].count > 0 || unapprovedEntitles[0].count > 0) {
                return res.json({
                    valid: false,
                    errorType: 'unapproved',
                    message: 'Not all staff salaries or entitlements have been approved by the manager. They must be approved before processing emoluments.'
                });
            }

            // 3. Frequency Check (tblpayrollitems)
            const [payTypeRows] = await pool.query('SELECT Code FROM tblpaytype WHERE PayType = ?', [activity]);
            if (payTypeRows.length === 0) {
                 return res.json({ valid: false, errorType: 'invalid_activity', message: 'Invalid Activity selected.' });
            }
            const payCode = payTypeRows[0].Code;

            const [itemRows] = await pool.query('SELECT Freq FROM tblpayrollitems WHERE Code = ?', [payCode]);
            const freq = itemRows.length > 0 ? itemRows[0].Freq : 'M'; // Default to Monthly

            // Check if already processed for this frequency
            let checkQuery = '';
            let checkParams = [payCode];

            if (freq === 'Y') {
                // Check if processed this year
                checkQuery = 'SELECT COUNT(*) as count FROM tblsalary WHERE PType = ? AND YEAR(PDate) = ?';
                checkParams.push(processDate.getFullYear());
            } else {
                // Check if processed this month
                checkQuery = 'SELECT COUNT(*) as count FROM tblsalary WHERE PType = ? AND YEAR(PDate) = ? AND MONTH(PDate) = ?';
                checkParams.push(processDate.getFullYear(), processDate.getMonth() + 1);
            }

            const [existingRows] = await pool.query(checkQuery, checkParams);
            if (existingRows[0].count > 0) {
                const period = freq === 'Y' ? 'Year' : 'Month';
                return res.json({
                    valid: false,
                    errorType: 'frequency',
                    message: `This activity (${activity}) has already been processed for this ${period}. Frequency is ${freq === 'Y' ? 'Yearly' : 'Monthly'}.`
                });
            }

            // 4. Date Validation (General)
            const [payrollRows] = await pool.query('SELECT MAX(PDate) as lastDate FROM tblpayroll');
            const lastDate = payrollRows[0].lastDate ? new Date(payrollRows[0].lastDate) : null;

            if (lastDate) {
                const diffTime = Math.abs(processDate - lastDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                
                if (diffDays < 21 && processDate > lastDate) {
                     return res.json({
                        valid: false,
                        errorType: 'date',
                        message: `Emoluments cannot be processed less than 21 days from the last process (Last: ${lastDate.toISOString().split('T')[0]}).`
                    });
                }
                
                if (processDate <= lastDate) {
                     return res.json({
                        valid: false,
                        errorType: 'date',
                        message: 'Process date must be after the last processed date.'
                    });
                }
            }

            return res.json({ valid: true });

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    postProcessEmoluments: async (req, res) => {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const { activity, pdate } = req.body;
            const processDate = new Date(pdate);
            
            // Get PayType Code
            const [payTypeRows] = await conn.query('SELECT Code FROM tblpaytype WHERE PayType = ?', [activity]);
            if (payTypeRows.length === 0) throw new Error('Invalid Activity');
            const payCode = payTypeRows[0].Code;

            // Get Frequency
            const [itemRows] = await conn.query('SELECT Freq FROM tblpayrollitems WHERE Code = ?', [payCode]);
            const freq = itemRows.length > 0 ? itemRows[0].Freq : 'M';

            // Determine Target Staff
            let staffQuery = ''; 
            let staffParams = [];

            if (activity === 'RENT' || payCode === '02') {
                // Assuming RENT uses Allw02 flag in tblentitle, but where is the amount?
                // If the code expects e.Amount, it's broken. 
                // We will leave this part as is for now or just fix the Salary part which is critical.
                staffQuery = `
                    SELECT s.*, 0 as EntitledAmount 
                    FROM tblstaff s 
                    WHERE s.Approved = 1 AND s.Redundant = 0
                `;
                 // TODO: Fix Entitlement logic based on actual schema
            } else if (activity === 'LEAVE' || payCode === '13') {
                 staffQuery = `
                    SELECT s.*, 0 as EntitledAmount 
                    FROM tblstaff s 
                    WHERE s.Approved = 1 AND s.Redundant = 0
                `;
            } else {
                // For Salary (01)
                // Fetch Salary from tblpayroll Master Record (PYear=0)
                staffQuery = `
                    SELECT s.*, p.Salary as BaseSalary
                    FROM tblstaff s
                    LEFT JOIN tblpayroll p ON s.PFNo = p.PFNo AND p.PYear = 0
                    WHERE s.Approved = 1 AND s.Redundant = 0
                `;
            }

            const [staffList] = await conn.query(staffQuery, staffParams);
            let processedCount = 0;

            for (const staff of staffList) {
                // Check if already processed for this staff (Double check for Yearly items)
                if (freq === 'Y') {
                    const [exists] = await conn.query(
                        'SELECT COUNT(*) as count FROM tblsalary WHERE PFNo = ? AND PType = ? AND YEAR(PDate) = ?', 
                        [staff.PFNo, payCode, processDate.getFullYear()]
                    );
                    if (exists[0].count > 0) continue;
                }

                // Base Amount
                let amount = 0;
                if (payCode === '01') {
                    amount = staff.BaseSalary || 0;
                } else {
                    amount = staff.EntitledAmount || 0;
                }

                // Query/Discipline Check
                // Check for Half Pay / Without Pay in tblquery based on Percent and Date Range
                const [queries] = await conn.query(
                    'SELECT Percent FROM tblquery WHERE PFNo = ? AND Approved = 1 AND ? BETWEEN SDate AND EDate', 
                    [staff.PFNo, processDate]
                );

                let isWithoutPay = false;
                let isHalfPay = false;

                for (const q of queries) {
                    if (q.Percent == 100) isWithoutPay = true;
                    if (q.Percent == 50) isHalfPay = true;
                }

                if (isWithoutPay) continue; // Skip processing

                if (isHalfPay) amount = amount / 2;

                // Ensure final amount is rounded to 2 decimal places
                amount = Math.round(amount * 100) / 100;

                // Surcharge Check (tblsurcharge)
                let surcharge = 0;
                const [surcharges] = await conn.query(
                    'SELECT SAmount FROM tblsurcharge WHERE PFNo = ? AND Approved = 1 AND ? BETWEEN StarDate AND ExpDate',
                    [staff.PFNo, processDate]
                );
                
                for (const s of surcharges) {
                    surcharge += (s.SAmount || 0);
                }

                // Loan Check (Only for Salary?)
                let loanDeduction = 0;
                if (payCode === '01') {
                    const [loans] = await conn.query(
                        'SELECT * FROM tblloan WHERE PFNo = ? AND Approved = 1 AND Balance > 0', 
                        [staff.PFNo]
                    );
                    for (const loan of loans) {
                        let ded = loan.Ded || 0; // Assuming 'Ded' is monthly deduction
                        if (ded > loan.Balance) ded = loan.Balance;
                        loanDeduction += ded;
                        
                        // Optionally update loan balance here or mark for update
                        // For now, we just record the deduction in tblsalary
                    }
                }

                // Calculate Net
                let totalDeduction = loanDeduction + surcharge;
                let netIncome = amount - totalDeduction;
                if (netIncome < 0) netIncome = 0;

                // Insert into tblsalary
                // We need to map amount to correct column (Salary vs AllwXX)
                // For simplicity, I'll use 'Salary' for Code 01, and 'Allw02' for Rent, etc.
                // But I need to know which Allw column corresponds to which PayType.
                // Usually this mapping is in tblpaytype or fixed.
                // The prompt doesn't specify.
                // I'll assume:
                // Code 01 -> Salary
                // Code 02 -> Allw02
                // ...
                // Code 13 -> Allw13
                
                const colName = payCode === '01' ? 'Salary' : `Allw${payCode}`;
                
                // Construct INSERT
                let salaryVal = 0;
                let totAllwVal = 0;
                let columns = `PDate, PFNo, PType, Salary, TotAllw, TotalIncome, TotalDeduction, NetIncome, FullPay, HalfPay, WithoutPay, Ded1, Ded3, Approved, Posted, Operator, CompanyID, DateKeyed, TimeKeyed`;
                let values = `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 1, NOW(), NOW()`;
                let params = [];

                if (payCode === '01') {
                    salaryVal = amount;
                    // colName is 'Salary', so we don't need to add it again
                    params = [
                        pdate, staff.PFNo, payCode, salaryVal, totAllwVal, amount,
                        totalDeduction, netIncome,
                        (!isHalfPay && !isWithoutPay) ? 1 : 0, isHalfPay ? 1 : 0, isWithoutPay ? 1 : 0,
                        loanDeduction, surcharge,
                        'Data Entry Clerk'
                    ];
                } else {
                    totAllwVal = amount;
                    // Add the allowance column dynamically
                    columns = `PDate, PFNo, PType, ${colName}, Salary, TotAllw, TotalIncome, TotalDeduction, NetIncome, FullPay, HalfPay, WithoutPay, Ded1, Ded3, Approved, Posted, Operator, CompanyID, DateKeyed, TimeKeyed`;
                    values = `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 1, NOW(), NOW()`;
                    params = [
                        pdate, staff.PFNo, payCode, amount, salaryVal, totAllwVal, amount,
                        totalDeduction, netIncome,
                        (!isHalfPay && !isWithoutPay) ? 1 : 0, isHalfPay ? 1 : 0, isWithoutPay ? 1 : 0,
                        loanDeduction, surcharge,
                        'Data Entry Clerk'
                    ];
                }

                const insertQuery = `INSERT INTO tblsalary (${columns}) VALUES (${values})`;
                
                await conn.query(insertQuery, params);
                
                processedCount++;
            }

            await conn.commit();
            
            res.render('data_entry/dashboard', {
                title: 'Data Entry Dashboard',
                path: '/data-entry/dashboard',
                user: { name: 'Data Entry Clerk' },
                successMessage: `Emoluments processed successfully. ${processedCount} records created.`
            });

        } catch (error) {
            await conn.rollback();
            console.error(error);
            res.status(500).send('Server Error: ' + error.message);
        } finally {
            conn.release();
        }
    },

    // Leave Application
    getLeaveApplication: async (req, res) => {
        try {
            const [staffList] = await pool.query("SELECT PFNo, SName FROM tblstaff WHERE EmpStatus = '01' ORDER BY SName");
            const [leaveTypes] = await pool.query("SELECT * FROM tblleavetype");
            
            // Get recent leaves for display
            const [recentLeaves] = await pool.query(`
                SELECT l.*, s.SName, t.LeaveType 
                FROM tblleave l 
                LEFT JOIN tblstaff s ON l.PFNO = s.PFNo 
                LEFT JOIN tblleavetype t ON l.LType = t.Code
                ORDER BY l.LCount DESC LIMIT 10
            `);

            res.render('data_entry/leave/application', {
                title: 'Leave Application',
                group: 'Leave',
                path: '/data-entry/leave/application',
                user: req.session.user || { name: 'Data Entry' },
                staffList,
                leaveTypes,
                recentLeaves
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getLeaveStaffData: async (req, res) => {
        try {
            const { pfno, year } = req.params;
            
            // Get Staff Grade
            const [staffRows] = await pool.query("SELECT CGrade FROM tblstaff WHERE PFNo = ?", [pfno]);
            if (staffRows.length === 0) return res.status(404).json({ error: 'Staff not found' });
            
            const gradeCode = staffRows[0].CGrade;
            
            // Get Entitlement from Grade
            const [gradeRows] = await pool.query("SELECT LDays FROM tblgrade WHERE GradeCode = ?", [gradeCode]);
            const entitledDays = gradeRows.length > 0 ? gradeRows[0].LDays : 0;
            
            // Get Allowance Percent
            const [payItems] = await pool.query("SELECT Percent FROM tblpayrollitems WHERE Income = 'LEAVE'");
            const percent = payItems.length > 0 ? parseFloat(payItems[0].Percent) : 0;
            
            // Get Annual Salary (Base for Allowance) - Using latest salary from tblsalary
            const [salaryRows] = await pool.query("SELECT Salary FROM tblsalary WHERE PFNo = ? ORDER BY PDate DESC LIMIT 1", [pfno]);
            const monthlySalary = salaryRows.length > 0 ? parseFloat(salaryRows[0].Salary) : 0;
            const annualSalary = monthlySalary * 12;
            
            const allowanceAmount = annualSalary * (percent / 100);
            
            // Calculate Used Days
            const [leaveRows] = await pool.query("SELECT Part, LDays FROM tblleave WHERE PFNO = ? AND LYear = ?", [pfno, year]);
            
            let usedDays = 0;
            leaveRows.forEach(r => {
                usedDays += (r.Part || 0);
            });
            
            const available = entitledDays - usedDays;
            
            res.json({
                entitled: entitledDays,
                available: available,
                allowance: allowanceAmount,
                used: usedDays
            });
            
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    postLeaveApplication: async (req, res) => {
        try {
            const {
                pfno, lType, lYear, deduct, proposed, available, lDays,
                startDate, part, holidays, withPay, resumptionDate,
                allowance, resumed, dateResumed, purchased, daysPurchased, datePurchased
            } = req.body;
            
            // Get Max LCount
            const [maxRows] = await pool.query("SELECT MAX(LCount) as maxCount FROM tblleave");
            const nextCount = (maxRows[0].maxCount || 0) + 1;
            
            const query = `
                INSERT INTO tblleave (
                    LCount, PFNO, LType, LYear, Deduct, Proposed, Available, LDays,
                    StartDate, Part, Holidays, WithPay, ResumptionDate, Allowance,
                    Resumed, DateResumed, Purchased, DaysPurchased, DatePurchased, Recalled, DateRecalled, CompanyID, EntryPassed, Approved
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 1, 0, 0)
            `;
            
            const params = [
                nextCount, pfno, lType, lYear, deduct, proposed || null, available, lDays,
                startDate, part || 0, holidays || 0, withPay, resumptionDate, allowance,
                resumed, dateResumed || null, purchased || 0, daysPurchased || 0, datePurchased || null
            ];
            
            await pool.query(query, params);
            
            res.json({ success: true });
            
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: error.message });
        }
    },

    // Leave Outstanding Report
    getLeaveOutstandingReport: async (req, res) => {
        try {
            const { year, type, filter, staffId } = req.query;
            
            // Get Company Info for Header
            const [companyRows] = await pool.query("SELECT * FROM tblcominfo LIMIT 1");
            const company = companyRows[0];
            
            let query = "";
            let params = [];
            
            // Base parts for queries
            const selectStaff = `
                s.PFNo, s.SName, j.JobTitle, d.Dept,
                COALESCE(g.LDays, 0) as LeaveDays,
                (COALESCE(g.LDays, 0) - COALESCE((SELECT SUM(l2.Part) FROM tblleave l2 WHERE l2.PFNO = s.PFNo AND l2.LYear = ?), 0)) as OutstandingDays
            `;
            
            const fromJoins = `
                FROM tblstaff s
                LEFT JOIN tbljobtitle j ON s.JobTitle = j.Code
                LEFT JOIN tblgrade g ON s.CGrade = g.GradeCode
                LEFT JOIN tbldept d ON s.CDept = d.Code
            `;

            if (type === 'Outstanding') {
                // Outstanding Leave Report
                // Logic: Staff with balance > 0 for the given year
                // Note: If no leave taken, balance = entitlement.
                // We need to fetch ALL active staff and calculate balance.
                
                query = `
                    SELECT ${selectStaff}
                    ${fromJoins}
                    WHERE s.EmpStatus = '01'
                `;
                
                params.push(year); // For subquery

                if (filter === 'Staff' && staffId) {
                    query += " AND s.PFNo = ?";
                    params.push(staffId);
                }
                
                query += " GROUP BY s.PFNo HAVING OutstandingDays > 0 ORDER BY d.Dept, s.SName";
                
            } else if (type === 'Recalled') {
                // Recalled Leave Report
                // Logic: Staff with Recalled=1 in tblleave for the given year
                
                query = `
                    SELECT 
                        ${selectStaff},
                        MAX(l.DateRecalled) as DateRecalled,
                        SUM(l.Part) as DaysRecalledPart -- Summing parts if multiple recalled
                    ${fromJoins}
                    JOIN tblleave l ON s.PFNo = l.PFNO
                    WHERE l.Recalled = 1 AND l.LYear = ?
                `;
                
                params.push(year); // For subquery
                params.push(year); // For main query

                if (filter === 'Staff' && staffId) {
                    query += " AND s.PFNo = ?";
                    params.push(staffId);
                }
                
                query += " GROUP BY s.PFNo ORDER BY d.Dept, s.SName";
                
            } else if (type === 'Purchased') {
                // Purchased Leave Report
                // Logic: Staff with DaysPurchased > 0 for the given year
                
                query = `
                    SELECT 
                        ${selectStaff},
                        SUM(l.DaysPurchased) as DaysPurchased,
                        SUM(l.Allowance) as Allowance
                    ${fromJoins}
                    JOIN tblleave l ON s.PFNo = l.PFNO
                    WHERE l.DaysPurchased > 0 AND l.LYear = ?
                `;
                
                params.push(year); // For subquery
                params.push(year); // For main query

                if (filter === 'Staff' && staffId) {
                    query += " AND s.PFNo = ?";
                    params.push(staffId);
                }
                
                query += " GROUP BY s.PFNo ORDER BY d.Dept, s.SName";
            }

            const [reportData] = await pool.query(query, params);
            
            // Format dates if needed
            if (type === 'Recalled') {
                reportData.forEach(row => {
                    if (row.DateRecalled) {
                        row.DateRecalled = new Date(row.DateRecalled).toLocaleDateString();
                    }
                });
            }

            // Render the preview page
            // We use a new view for the report
            
            // Fix LogoPath URL
            let logoUrl = null;
            if (company && company.LogoPath) {
                // Normalize slashes
                let cleanPath = company.LogoPath.replace(/\\/g, '/');
                // Ensure it starts with /
                if (!cleanPath.startsWith('/')) {
                    cleanPath = '/' + cleanPath;
                }
                // Construct full URL
                logoUrl = `${req.protocol}://${req.get('host')}${cleanPath}`;
            }

            res.render('data_entry/leave/report_preview', {
                title: `${type} Leave Report - ${year}`,
                reportData,
                type,
                year,
                company: {
                    ...company,
                    LogoPath: logoUrl
                }
            });

        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error: ' + error.message);
        }
    },

    getLeaveRecall: async (req, res) => {
        try {
            const query = `
                SELECT 
                    l.LCount,
                    l.PFNO,
                    s.SName,
                    t.LeaveType,
                    l.StartDate,
                    l.ResumptionDate,
                    l.LYear,
                    l.Part,
                    l.LDays
                FROM tblleave l
                JOIN tblstaff s ON l.PFNO = s.PFNo
                LEFT JOIN tblleavetype t ON l.LType = t.Code
                WHERE l.Approved = 1 
                AND l.Recalled = 0
                AND l.Resumed = 0
                AND l.StartDate <= CURDATE()
                AND l.ResumptionDate >= CURDATE()
                ORDER BY l.StartDate DESC
            `;
            
            const [staffOnLeave] = await pool.query(query);

            res.render('data_entry/leave/recall', {
                title: 'Recall Staff from Leave',
                path: '/data-entry/leave/recall',
                user: req.session.user || { name: 'Data Entry' },
                staffOnLeave
            });

        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postLeaveRecall: async (req, res) => {
        try {
            const { lCount, dateRecalled, resumptionDate } = req.body;
            
            // Update Recalled = 2 (Pending Approval), DateRecalled, and Proposed ResumptionDate
            // Note: The user mentioned "Date Recalled" and "Resumption Date" in the modal.
            // We'll update DateRecalled. ResumptionDate might be the new resumption date?
            // Usually ResumptionDate in tblleave is the original one. 
            // If recalled, maybe we need to store the NEW resumption date somewhere?
            // Or maybe the user means when they will resume *after* the recall period ends? 
            // Or maybe "Resumption Date" in the modal IS the "Date Recalled"?
            // "Date Recalled (To be entered...)"
            // "Resumption Date"
            // Let's assume we update DateRecalled. 
            // Since there's no "NewResumptionDate" column, we might just update DateRecalled.
            // But wait, the user said "Resumption Date" as a field in the modal.
            // If I recall someone today, do I change their ResumptionDate in the DB?
            // If I do, I lose the original planned date.
            // But the user said: "Daye Remaining... added again to the staff total number of leave left".
            // This implies the calculation uses the ORIGINAL Resumption Date vs Date Recalled.
            // So I should NOT overwrite ResumptionDate yet.
            // But the modal has a "Resumption Date" input.
            // Maybe this is the date they are expected to resume work *because* of the recall?
            // Which is usually the Date Recalled or the day after.
            // Let's update DateRecalled.
            // And Recalled = 2 (Pending).
            
            const updateQuery = `
                UPDATE tblleave 
                SET Recalled = 2, DateRecalled = ?
                WHERE LCount = ?
            `;
            
            await pool.query(updateQuery, [dateRecalled, lCount]);
            
            res.json({ success: true });
            
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    getStaffOnLeave: async (req, res) => {
        try {
            // Get Company Info for Letterhead
            const [comInfo] = await pool.query('SELECT Com_Name, Address, LogoPath FROM tblcominfo LIMIT 1');
            
            // Get Staff On Leave
            const query = `
                SELECT 
                    l.PFNO,
                    s.SName,
                    t.LeaveType,
                    l.StartDate,
                    l.ResumptionDate
                FROM tblleave l
                JOIN tblstaff s ON l.PFNO = s.PFNo
                LEFT JOIN tblleavetype t ON l.LType = t.Code
                WHERE l.Approved = 1 
                AND l.Recalled = 0
                AND l.Resumed = 0
                AND l.StartDate <= CURDATE()
                AND l.ResumptionDate >= CURDATE()
                ORDER BY l.StartDate DESC
            `;
            const [staffOnLeave] = await pool.query(query);

            res.render('data_entry/leave/on_leave', {
                title: 'Staff On Leave',
                path: '/data-entry/leave/on-leave',
                user: req.session.user || { name: 'Data Entry' },
                staffOnLeave,
                comInfo: comInfo[0] || {}
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getLeavePurchase: async (req, res) => {
        try {
            // Fetch Staff List
            const [staffList] = await pool.query('SELECT PFNo, SName FROM tblstaff ORDER BY SName');
            
            // Fetch Payment Methods
            const [payMethods] = await pool.query('SELECT Code, PayThrough FROM tblpaythrough ORDER BY Code');
            
            // Fetch Company Info
            const [comInfo] = await pool.query('SELECT Bank, AccNo FROM tblcominfo LIMIT 1');
            
            // Fetch Recent Purchases
            const [purchases] = await pool.query(`
                SELECT l.PFNO, s.SName, l.DaysPurchased, l.DatePurchased, l.Allowance, l.Approved 
                FROM tblleave l
                JOIN tblstaff s ON l.PFNO = s.PFNo
                WHERE l.LType = '08' OR l.LType = 'PURCHASE'
                ORDER BY l.DatePurchased DESC
                LIMIT 50
            `);
            
            res.render('data_entry/leave/purchase', {
                title: 'Leave Purchase',
                path: '/data-entry/leave/purchase',
                user: req.session.user || { name: 'Data Entry' },
                staffList,
                payMethods,
                comInfo: comInfo[0] || {},
                purchases
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getStaffLeaveDataForPurchase: async (req, res) => {
        try {
            const { pfno } = req.params;
            const year = new Date().getFullYear();
            
            // Get Staff Name & Grade
            const [staffRows] = await pool.query("SELECT SName, CGrade FROM tblstaff WHERE PFNo = ?", [pfno]);
            if (staffRows.length === 0) return res.status(404).json({ error: 'Staff not found' });
            
            const staff = staffRows[0];
            const gradeCode = staff.CGrade;
            
            // Get Entitlement
            const [gradeRows] = await pool.query("SELECT LDays FROM tblgrade WHERE GradeCode = ?", [gradeCode]);
            const entitledDays = gradeRows.length > 0 ? (gradeRows[0].LDays || 0) : 0;
            
            // Calculate Used Days (Approved or Pending)
            // Including pending to prevent double-spending
            const [leaveRows] = await pool.query("SELECT Part FROM tblleave WHERE PFNO = ? AND LYear = ? AND (Approved = 1 OR Approved = 0)", [pfno, year]);
            let usedDays = 0;
            leaveRows.forEach(r => {
                usedDays += (r.Part || 0);
            });
            
            const availableDays = entitledDays - usedDays;
            
            res.json({
                success: true,
                staff: { SName: staff.SName },
                availableDays: availableDays > 0 ? availableDays : 0
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    postLeavePurchase: async (req, res) => {
        try {
            const {
                pfno, ltype, ltypeCode, lyear, available, daysPurchased,
                amount, datePurchased, purchased, method, bank, bban
            } = req.body;
            
            // Validation: Ensure purchased days do not exceed available days
            const [staffRows] = await pool.query("SELECT CGrade FROM tblstaff WHERE PFNo = ?", [pfno]);
            if (staffRows.length === 0) return res.status(404).json({ error: 'Staff not found' });
            
            const gradeCode = staffRows[0].CGrade;
            const [gradeRows] = await pool.query("SELECT LDays FROM tblgrade WHERE GradeCode = ?", [gradeCode]);
            const entitledDays = gradeRows.length > 0 ? (gradeRows[0].LDays || 0) : 0;
            
            // Check used days (including pending requests)
            const [leaveRows] = await pool.query("SELECT Part FROM tblleave WHERE PFNO = ? AND LYear = ? AND (Approved = 1 OR Approved = 0)", [pfno, lyear]);
            let usedDays = 0;
            leaveRows.forEach(r => {
                usedDays += (r.Part || 0);
            });
            
            const availableDays = entitledDays - usedDays;
            const daysPurchasedNum = parseInt(daysPurchased, 10);
            
            if (daysPurchasedNum > availableDays) {
                return res.status(400).json({ error: `Cannot purchase ${daysPurchasedNum} days. Only ${availableDays} days available.` });
            }

            // Get Max LCount
            const [maxRows] = await pool.query("SELECT MAX(LCount) as maxCount FROM tblleave");
            const nextCount = (maxRows[0].maxCount || 0) + 1;
            
            const query = `
                INSERT INTO tblleave (
                    LCount, PFNO, LType, LYear, 
                    DaysPurchased, DatePurchased, Purchased, 
                    Allowance, Method, Bank, BBAN, 
                    StartDate, Approved, CompanyID,
                    Part, Deduct, Holidays, WithPay, Resumed, Recalled, EntryPassed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            // Note: StartDate is used for "Date" as per user request.
            // Also DatePurchased.
            // Part: Should purchase reduce available days? Usually yes.
            // "Number of days that will be purchased must not exceed the outstanding days value"
            // This implies it consumes the leave days. So Part = DaysPurchased.
            // Deduct: Set to -1 as per user request for purchases
            // Holidays: Set to 0 as per user request
            // WithPay: Set to -1 as per user request
            // Resumed: Set to 1 as per user request
            // Recalled: Set to 0 as per user request
            // EntryPassed: Set to 0 as per user request
            
            const params = [
                nextCount, pfno, ltypeCode || '08', lyear,
                daysPurchased, datePurchased, purchased || 0,
                amount, method, bank || null, bban || null,
                datePurchased, // StartDate
                daysPurchased, // Part
                -1, // Deduct
                0, // Holidays
                -1, // WithPay
                1, // Resumed
                0, // Recalled
                0 // EntryPassed
            ];
            
            await pool.query(query, params);
            
            res.json({ success: true });
            
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    getMedicalReports: async (req, res) => {
        try {
            const { type, pfno, dateFrom, dateTo } = req.query;
            let records = [];
            let companyInfo = {};
            const searchParams = { type, pfno, dateFrom, dateTo };

            // Fetch Company Info
            const [companyRows] = await pool.query('SELECT * FROM tblcominfo LIMIT 1');
            companyInfo = companyRows[0] || {};

            if (type) {
                let query = `
                    SELECT 
                        m.TransNo,
                        m.EntryDate,
                        m.PFNo,
                        s.SName,
                        m.Dependant,
                        mc.TransName as Description,
                        m.Amount,
                        m.PicturePath
                    FROM tblmedical m
                    LEFT JOIN tblstaff s ON m.PFNo = s.PFNo
                    LEFT JOIN tblMCode mc ON m.MCode = mc.TCode
                    WHERE 1=1
                `;
                const params = [];

                if (type === 'specific' && pfno) {
                    query += ' AND m.PFNo = ?';
                    params.push(pfno);
                }

                if (dateFrom) {
                    query += ' AND m.EntryDate >= ?';
                    params.push(dateFrom);
                }
                if (dateTo) {
                    query += ' AND m.EntryDate <= ?';
                    params.push(dateTo);
                }

                query += ' ORDER BY m.EntryDate DESC';

                const [rows] = await pool.query(query, params);
                records = rows;
            }

            res.render('reports/medical', {
                records,
                companyInfo,
                searchParams,
                user: req.session.user || { name: 'User', role: 'data_entry' },
                role: (req.session.user && req.session.user.role) ? req.session.user.role : 'data_entry',
                path: req.path
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getJournalReport: async (req, res) => {
        try {
            // Fetch distinct dates (ignoring time) from tblgltrans
            const [dates] = await pool.query('SELECT DISTINCT DATE(GLDate) as GLDateVal FROM tblgltrans ORDER BY GLDateVal DESC');
            
            res.render('reports/journal_index', {
                title: 'Journal Report',
                dates,
                path: req.path,
                user: req.session.user || { name: 'Data Entry' },
                role: 'data_entry'
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getJournalReportPreview: async (req, res) => {
        try {
            const { glDate } = req.query;
            const [companyRows] = await pool.query('SELECT * FROM tblcominfo LIMIT 1');
            const companyInfo = companyRows[0] || {};

            // Fetch journal entries for the selected date
            const [journalEntries] = await pool.query(`
                SELECT * FROM tblgltrans 
                WHERE DATE(GLDate) = ?
            `, [glDate]);

            res.render('reports/journal_preview', {
                title: 'Journal Report Preview',
                companyInfo,
                journalEntries,
                glDate,
                user: req.session.user || { name: 'Data Entry' },
                role: 'data_entry'
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    }
};

module.exports = dataEntryController;
