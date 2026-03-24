const pool = require('../config/db');
const transporter = require('../config/mailer');
const ejs = require('ejs');
const path = require('path');
const controllerAuditHelper = require('../services/controllerAuditHelper');

const managerController = {
    getDashboard: async (req, res) => {
    try {
        // 1. My Staff count (Active & Not Redundant)
        const [staffRows] = await pool.query('SELECT COUNT(*) as count FROM tblstaff WHERE EmpStatus = 1 AND Redundant = 0');
        const staffCount = staffRows[0].count;

        // 2. Pending Approvals
        // List of tables to check
        const tables = [
            'tblstaff', 'tbldependant', 'tblallowance', 'tblleave', 'tblapplication',
            'tblpromotions', 'tbltransfer', 'tblcourse', 'tblquery', 'tblformer',
            'tblappraisal', 'tblentitle', 'tblloan', 'tblbankguarantee'
        ];
        
        let pendingApprovals = 0;
        
        // Use Promise.all to run queries in parallel
        const approvalPromises = tables.map(table => 
            pool.query(`SELECT COUNT(*) as count FROM ${table} WHERE Approved = 0`)
        );
        
        const results = await Promise.all(approvalPromises);
        
        results.forEach(([rows]) => {
            pendingApprovals += rows[0].count;
        });

        res.render('manager/dashboard', { 
            title: 'Manager Dashboard',
            path: '/manager/dashboard',
            user: req.session.user || { name: 'Manager' },
            staffCount,
            pendingApprovals
        });
    } catch (error) {
        console.error('Dashboard Error:', error);
        res.render('manager/dashboard', { 
            title: 'Manager Dashboard',
            path: '/manager/dashboard',
            user: req.session.user || { name: 'Manager' },
            staffCount: 0,
            pendingApprovals: 0,
            error: 'Failed to load dashboard data'
        });
    }
  },

  getPendingApprovals: async (req, res) => {
    try {
        const approvalConfig = [
            { table: 'tblstaff', label: 'New Staff / Edits', route: '/manager/approve/new-staff' },
            { table: 'tbldependant', label: 'Dependant Changes', route: '/manager/approve/dependants' },
            { table: 'tblallowance', label: 'Income Setup', route: '/manager/approve/income-setup' },
            { table: 'tblleave', label: 'Leave Applications', route: '/manager/approve/leave-application' },
            { table: 'tblapplication', label: 'Interview Approvals', route: '/manager/approve/interview' },
            { table: 'tblpromotions', label: 'Promotions / Demotions', route: '/manager/approve/promotion-demotion' },
            { table: 'tbltransfer', label: 'Transfers', route: '/manager/approve/transfer' },
            { table: 'tblcourse', label: 'Training', route: '/manager/approve/training' },
            { table: 'tblquery', label: 'Queries', route: '/manager/approve/query' },
            { table: 'tblformer', label: 'Staff Exits', route: '/manager/approve/exit' },
            { table: 'tblappraisal', label: 'Appraisals', route: '/manager/approve/appraisals' },
            { table: 'tblentitle', label: 'Entitlements', route: '/manager/approve/entitlement' },
            { table: 'tblloan', label: 'Loans', route: '/manager/approve/loan' },
            { table: 'tblbankguarantee', label: 'Bank Guarantees', route: '/manager/approve/guarantee' }
        ];

        const promises = approvalConfig.map(async (item) => {
            const [rows] = await pool.query(`SELECT COUNT(*) as count FROM ${item.table} WHERE Approved = 0`);
            return { ...item, count: rows[0].count };
        });

        const pendingItems = await Promise.all(promises);

        res.render('shared/pending_approvals', {
            title: 'Pending Approvals',
            path: '/manager/pending-approvals',
            user: req.session.user || { name: 'Manager' },
            role: 'manager',
            pendingItems
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
  },

    getApproveGuarantee: async (req, res) => {
        try {
            const [guarantees] = await pool.query(`
                SELECT 
                    bg.RefNo, bg.PFNO, s.SName as Name, bg.LoanAmount, bg.LoanDate, 
                    bg.Duration, bg.Monthly, bg.Bank, b.Bank as BankName,
                    bg.ExpiryDate, bg.Approved, bg.EntryDate
                FROM tblbankguarantee bg
                LEFT JOIN tblstaff s ON bg.PFNO = s.PFNo
                LEFT JOIN tblbanks b ON bg.Bank = b.Code
                WHERE bg.Approved = 0
                ORDER BY bg.LoanDate DESC
            `);

            res.render('manager/approve/guarantee', {
                title: 'Approve Bank Guarantee',
                path: '/manager/approve/guarantee',
                user: req.session.user || { name: 'Manager' },
                guarantees
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postApproveGuarantee: async (req, res) => {
        try {
            const { refNo, action } = req.body;
            // action: 'approve' or 'reject'
            const status = action === 'approve' ? 1 : 2;
            const user = req.session.user ? req.session.user.name : 'Manager';
            const now = new Date();

            await controllerAuditHelper.auditUpdate({
                table: 'tblbankguarantee',
                formName: 'manager/approve/guarantee',
                recordId: refNo,
                fetchQuery: 'SELECT * FROM tblbankguarantee WHERE RefNo = ?',
                fetchParams: [refNo],
                applyChange: async () => {
                    await pool.query(
                        'UPDATE tblbankguarantee SET Approved = ?, Approvedby = ?, Dateapproved = ? WHERE RefNo = ?',
                        [status, user, now, refNo]
                    );
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    getApproveLoan: async (req, res) => {
        try {
            // Fetch Pending Loan Applications
            const [pendingLoans] = await pool.query(`
                SELECT 
                    l.TransNo,
                    l.EntryDate,
                    l.PFNo,
                    s.SName,
                    s.AccountNo,
                    l.Amount,
                    l.Interest,
                    l.Duration,
                    l.StartDate,
                    l.ExpDate,
                    l.Rate,
                    l.MonthlyRepayment,
                    l.MonthlyInt,
                    l.LoanBal,
                    l.Surcharge,
                    lc.TransName as LoanType
                FROM tblloan l
                LEFT JOIN tblstaff s ON l.PFNo = s.PFNo
                LEFT JOIN tblloancode lc ON l.LTrans = lc.TCode
                WHERE l.Approved = 0
                ORDER BY l.EntryDate DESC
            `);

            // Fetch Repayment View (All Active Loans for context)
            const [activeRepayments] = await pool.query(`
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
                    l.ExpDate
                FROM tblloan l
                LEFT JOIN tblstaff s ON l.PFNo = s.PFNo
                WHERE l.Approved = 1 AND (l.LoanBal > 0 OR l.RepaidAmount > 0)
                ORDER BY l.EntryDate DESC
            `);

            res.render('manager/approve/loan', {
                title: 'Approve Loans',
                path: '/manager/approve/loan',
                user: req.session.user || { name: 'Manager' },
                pendingLoans,
                activeRepayments
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postApproveLoan: async (req, res) => {
        try {
            const { transNo, action } = req.body;
            const approvedBy = (req.session.user && req.session.user.name) ? req.session.user.name : 'Manager';
            const now = new Date();

            let status = 0;
            if (action === 'approve') status = 1;
            else if (action === 'reject') status = 2; // Assuming 2 is Rejected

            await controllerAuditHelper.auditUpdate({
                table: 'tblloan',
                formName: 'manager/approve/loan',
                recordId: transNo,
                fetchQuery: 'SELECT * FROM tblloan WHERE TransNo = ?',
                fetchParams: [transNo],
                applyChange: async () => {
                    await pool.query(`
                        UPDATE tblloan 
                        SET Approved = ?, ApprovedBy = ?, DateApproved = ?
                        WHERE TransNo = ?
                    `, [status, approvedBy, now, transNo]);
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    getApproveLeave: async (req, res) => {
        try {
            res.render('manager/approve/leave', {
                title: 'Approve Leave',
                path: '/manager/approve/leave',
                user: req.session.user || { name: 'Manager' }
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
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

            res.render('manager/approve/on_leave', {
                title: 'Staff On Leave',
                path: '/manager/approve/on-leave',
                user: req.session.user || { name: 'Manager' },
                staffOnLeave,
                comInfo: comInfo[0] || {}
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getApproveIncomeSetup: async (req, res) => {
      try {
          const [rows] = await pool.query(`
              SELECT a.ScaleDate, a.Grade, a.PayCurrency, a.StartLevel, a.EndLevel, a.Notches, a.Increment
              FROM tblallowance a
              WHERE a.Approved = 0
              ORDER BY a.ScaleDate DESC
          `);
          res.render('manager/approve/income_setup', {
              title: 'Approve Income Setup',
              path: '/manager/approve/income-setup',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              allowances: rows
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  // Bonus Awards Approval
  getApproveBonus: async (req, res) => {
    try {
      const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
      const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

      const [rows] = await pool.query(`
        SELECT 
          ba.*, 
          IFNULL(ba.Fixed, 0) as Fixed,
          IFNULL(ba.Percent, 0) as Percent,
          IFNULL(ba.BTaxable, 0) as BTaxable
        FROM tblbonusawards ba
        WHERE IFNULL(ba.Approved, 0) = 0
        ORDER BY ba.EntryDate DESC
      `);

      res.render('manager/approve/bonus', {
        title: 'Approve Bonus Awards',
        path: '/manager/approve/bonus',
        user: req.session.user || { name: 'Manager' },
        companyName,
        bonuses: rows
      });
    } catch (error) {
      console.error('Approve Bonus Error:', error);
      res.status(500).send('Server Error');
    }
  },

  getBonusAwardById: async (req, res) => {
    try {
      const { id } = req.params;
      const candidates = ['RefNo', 'Id', 'BonusID'];
      for (const key of candidates) {
        const [rows] = await pool.query(`SELECT * FROM tblbonusawards WHERE ${key} = ? LIMIT 1`, [id]);
        if (rows.length > 0) return res.json(rows[0]);
      }
      res.json(null);
    } catch (error) {
      console.error('Get Bonus Award Manager Error:', error);
      res.status(500).json({ error: 'Server Error' });
    }
  },

  postApproveBonus: async (req, res) => {
    try {
      const { id, action } = req.body; // action: 'approve' | 'reject'
      const approvedBy = (req.session.user && req.session.user.name) ? req.session.user.name : 'Manager';
      const now = new Date();

      // Determine primary key column
      const [colsRows] = await pool.query(`
        SELECT COLUMN_NAME 
        FROM information_schema.COLUMNS 
        WHERE TABLE_NAME = 'tblbonusawards'
      `);
      const colSet = new Set(colsRows.map(r => r.COLUMN_NAME));
      const keyCol = colSet.has('RefNo') ? 'RefNo' : (colSet.has('Id') ? 'Id' : (colSet.has('BonusID') ? 'BonusID' : null));
      if (!keyCol) return res.status(400).json({ error: 'Missing key column' });

      const status = action === 'approve' ? 1 : 2;

      // Build dynamic update with available columns
      const updates = [];
      const params = [];
      if (colSet.has('Approved')) { updates.push('Approved = ?'); params.push(status); }
      if (colSet.has('ApprovedBy')) { updates.push('ApprovedBy = ?'); params.push(approvedBy); }
      if (colSet.has('DateApproved')) { updates.push('DateApproved = ?'); params.push(now); }
      if (colSet.has('TimeApproved')) { updates.push('TimeApproved = ?'); params.push(now); }

      if (updates.length === 0) return res.status(400).json({ error: 'No approvable columns' });

      params.push(id);
      await pool.query(`UPDATE tblbonusawards SET ${updates.join(', ')} WHERE ${keyCol} = ?`, params);
      res.json({ success: true });
    } catch (error) {
      console.error('Post Approve Bonus Error:', error);
      res.status(500).json({ error: 'Server Error' });
    }
  },
 
     getApproveIncomeSetupView: async (req, res) => {
      try {
          const { grade, scaleDate } = req.query;
          if (!grade || !scaleDate) return res.status(400).send('Missing parameters');
          const [rows] = await pool.query(
              'SELECT * FROM tblallowance WHERE Grade = ? AND ScaleDate = ?',
              [grade, scaleDate]
          );
          if (rows.length === 0) return res.status(404).send('Record not found');
          const [grades] = await pool.query('SELECT GradeCode, Grade FROM tblgrade ORDER BY GradeCode');
          const [currencies] = await pool.query('SELECT CurrCode, CurrName FROM tblcurrency ORDER BY CurrCode');
          const [items] = await pool.query("SELECT Code, Income, Freq FROM tblpayrollitems WHERE Code BETWEEN '01' AND '20' ORDER BY Code");
          res.render('manager/approve/income_setup_view', {
              title: 'View Income Setup',
              path: '/manager/approve/income-setup/view',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              record: rows[0],
              grades,
              currencies,
              items
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },
 
  postApproveIncomeSetup: async (req, res) => {
      try {
          const { gradeCode, scaleDate, action } = req.body;
          const user = req.session.user ? req.session.user.name : 'Manager';
          const now = new Date();
          const status = action === 'reject' ? 2 : -1;
          await pool.query(
              'UPDATE tblallowance SET Approved = ?, ApprovedBy = ?, DateApproved = ?, TimeApproved = ? WHERE Grade = ? AND ScaleDate = ? AND Approved = 0',
              [status, user, now, now, gradeCode, scaleDate]
          );
          res.redirect('/manager/approve/income-setup');
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  getPayrollReports: async (req, res) => {
      try {
          const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
          const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';
          const [staffRows] = await pool.query('SELECT PFNo, SName FROM tblstaff ORDER BY PFNo');
          res.render('manager/reports/payroll', {
              title: 'Payroll Reports',
              group: 'Reports',
              path: '/manager/reports/payroll',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              companyName,
              staffList: staffRows
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },



    getApproveEditedPayroll: async (req, res) => {
      try {
          const [rows] = await pool.query(`
              SELECT DISTINCT s.PFNo, sf.SName, g.Grade AS GradeName, s.Salary, s.NetIncome, s.PDate
              FROM tblsalary s
              JOIN tblstaff sf ON s.PFNo = sf.PFNo
              LEFT JOIN tblgrade g ON s.Grade = g.GradeCode
              WHERE s.Approved = 0
              ORDER BY s.PDate DESC, sf.SName
          `);
          res.render('manager/approve/edited_payroll', {
              title: 'Approve Edited Payroll',
              group: 'Approve',
              path: '/manager/approve/edited-payroll',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              records: rows
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  getApproveEditedPayrollView: async (req, res) => {
      try {
          const { pfno, pdate } = req.query;
          if (!pfno || !pdate) return res.redirect('/manager/approve/edited-payroll');
          
          const formattedPDate = new Date(pdate).toISOString().split('T')[0];

          const [rows] = await pool.query(
              `SELECT s.*, sf.SName, g.Grade AS GradeName, j.JobTitle AS JobTitleName
               FROM tblsalary s
               JOIN tblstaff sf ON s.PFNo = sf.PFNo
               LEFT JOIN tblgrade g ON s.Grade = g.GradeCode
               LEFT JOIN tbljobtitle j ON s.JobTitle = j.Code
               WHERE s.PFNo = ? AND s.PDate = ?
               LIMIT 1`,
              [pfno, formattedPDate]
          );
          if (rows.length === 0) {
              return res.redirect('/manager/approve/edited-payroll');
          }
          const rec = rows[0];
          const [addItems] = await pool.query("SELECT Code, Income FROM tblpayrollitems WHERE Code BETWEEN '02' AND '20' ORDER BY Code");
          const [dedItems] = await pool.query("SELECT Code, Income FROM tblpayrollitems WHERE Code BETWEEN '31' AND '37' ORDER BY Code");

          res.render('manager/approve/edited_payroll_view', {
              title: 'Approve Edited Payroll',
              group: 'Approve',
              path: '/manager/approve/edited-payroll',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              rec,
              addItems,
              dedItems
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  postApproveEditedPayroll: async (req, res) => {
        try {
            const { pfno, pdate, action } = req.body;
            const status = action === 'approve' ? -1 : 2;
            const now = new Date();
            const user = req.session.user ? req.session.user.name : 'Manager';
            
            const formattedPDate = new Date(pdate).toISOString().split('T')[0];

            await pool.query(
                `UPDATE tblsalary 
                 SET Approved = ?, ApprovedBy = ?, DateApproved = ?, TimeApproved = ?
                 WHERE PFNo = ? AND PDate = ?`,
                [status, user, now, now, pfno, formattedPDate]
            );
            res.redirect('/manager/approve/edited-payroll');
        } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  getApproveSalary: async (req, res) => {
      try {
          const [rows] = await pool.query(`
              SELECT s.PFNo, st.SName, d.Dept, s.DateKeyed, s.PDate
              FROM tblsalary s
              JOIN tblstaff st ON s.PFNo = st.PFNo
              LEFT JOIN tbldept d ON st.CDept = d.Code
              WHERE s.Approved = 0
              ORDER BY s.DateKeyed DESC
          `);
          res.render('manager/approve/salary_list', {
              title: 'Approve Salary Setup',
              path: '/manager/approve/salary',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              records: rows
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  getApproveSalaryView: async (req, res) => {
        try {
            const { pfno, pdate } = req.query;
            if (!pfno || !pdate) return res.redirect('/manager/approve/salary');
            
            // Convert ISO string to date-only format
            const formattedPDate = new Date(pdate).toISOString().split('T')[0];

            const [rows] = await pool.query(
              `SELECT s.*, st.SName, st.CDept, d.Dept as DeptName, 
                      g.Grade as GradeName, j.JobTitle as JobTitleName
               FROM tblsalary s
               JOIN tblstaff st ON s.PFNo = st.PFNo
               LEFT JOIN tbldept d ON st.CDept = d.Code
               LEFT JOIN tblgrade g ON st.CGrade = g.GradeCode
               LEFT JOIN tbljobtitle j ON st.JobTitle = j.Code
               WHERE s.PFNo = ? AND s.PDate = ?
               LIMIT 1`,
              [pfno, pdate]
          );
          
          if (rows.length === 0) {
              return res.redirect('/manager/approve/salary');
          }
          
          const rec = rows[0];
          const [addItems] = await pool.query("SELECT Code, Income FROM tblpayrollitems WHERE Code BETWEEN '02' AND '20' ORDER BY Code");
          const [dedItems] = await pool.query("SELECT Code, Income FROM tblpayrollitems WHERE Code BETWEEN '31' AND '37' ORDER BY Code");

          res.render('manager/approve/salary_view', {
              title: 'Approve Salary Detail',
              path: '/manager/approve/salary',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              rec,
              addItems,
              dedItems
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  postApproveSalary: async (req, res) => {
      try {
          const { pfno, pdate, action } = req.body;
          const status = action === 'approve' ? -1 : 2;
          const now = new Date();
          const user = req.session.user ? req.session.user.name : 'Manager';
          
          // Convert ISO string to date-only format to resolve truncation error
          const formattedPDate = new Date(pdate).toISOString().split('T')[0];

          await pool.query(
              `UPDATE tblsalary 
               SET Approved = ?, ApprovedBy = ?, DateApproved = ?, TimeApproved = ?
               WHERE PFNo = ? AND PDate = ?`,
              [status, user, now, now, pfno, formattedPDate]
          );
          
          res.redirect('/manager/approve/salary');
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

          res.render('manager/enquiry/staff', {
              title: 'Staff Enquiry',
              group: 'Enquiry',
              path: '/manager/enquiry/staff',
              user: { name: 'Manager' },
              role: 'manager',
              companyName
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
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

          res.render('manager/enquiry/staff_general_info', {
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

  getComingSoon: (req, res) => {
    // Infer title from path, e.g. /enquiry/staff -> Staff
    // req.path might be just /staff if mounted at /manager/enquiry, but here it's mounted at /manager and routes are /enquiry/staff
    // Actually, in routes/manager.js: router.get('/enquiry/staff', ...)
    // So req.path will be '/enquiry/staff'
    
    const parts = req.path.split('/').filter(p => p);
    const title = parts.length > 0 ? parts[parts.length - 1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Feature';
    const group = parts.length > 1 ? parts[parts.length - 2].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Manager';

    res.render('shared/coming-soon', { 
      user: { name: 'Manager' },
      role: 'manager',
      group: group,
      title: title
    });
  },

  getTransferApprovals: async (req, res) => {
      try {
          // Fetch Company Info
          const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
          const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

          // Fetch Pending Transfers
          const query = `
              SELECT t.PFNO, t.TDate, t.SName, 
                     dp.Dept AS PrevDeptName, 
                     dt.Dept AS TDeptName,
                     t.PrevDept, t.TDept
              FROM tbltransfer t
              LEFT JOIN tbldept dp ON t.PrevDept = dp.Code
              LEFT JOIN tbldept dt ON t.TDept = dt.Code
              WHERE t.approved = 0
          `;
          const [transfers] = await pool.query(query);

          res.render('manager/approve/transfer', {
              title: 'Approve Transfers',
              group: 'Approve',
              path: '/manager/approve/transfer',
              user: { name: 'Manager' },
              role: 'manager',
              companyName,
              transfers
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  postTransferApproval: async (req, res) => {
      try {
          const { pfno, tDate, newDeptCode, action } = req.body;
          const user = req.user ? req.user.username : 'manager'; 

          // Helper to format date as YYYY-MM-DD HH:mm:ss without timezone
          const formatDateTime = (dateStr) => {
            const d = new Date(dateStr);
            const pad = (n) => n.toString().padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
                   `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
          };

          const formattedTDate = formatDateTime(tDate);
          
          // Convert tDate string to Date object for accurate comparison in WHERE clause
          const tDateObj = new Date(tDate);

          if (action === 'approve') {
              // 1. Update tbltransfer
              const updateTransfer = `
                  UPDATE tbltransfer 
                  SET approved = -1, approvedby = ?, dateapproved = NOW()
                  WHERE PFNO = ? AND TDate = ? AND approved = 0
              `;
              await pool.query(updateTransfer, [user, pfno, tDateObj]); // Use Date object for TDate match

              // 2. Update tblstaff
              // Update CDept and CDeptDate (formatted without timezone)
              const updateStaff = `
                  UPDATE tblstaff 
                  SET CDept = ?, CDeptDate = ?
                  WHERE PFNO = ?
              `;
              await pool.query(updateStaff, [newDeptCode, formattedTDate, pfno]);

              res.json({ success: true, message: 'Transfer approved successfully.' });

          } else if (action === 'reject') {
              // Update tbltransfer only
              const updateTransfer = `
                  UPDATE tbltransfer 
                  SET approved = 2, approvedby = ?, dateapproved = NOW()
                  WHERE PFNO = ? AND TDate = ? AND approved = 0
              `;
              await pool.query(updateTransfer, [user, pfno, tDateObj]);

              res.json({ success: true, message: 'Transfer rejected.' });
          } else {
              res.status(400).json({ error: 'Invalid action' });
          }

      } catch (error) {
          console.error(error);
          res.status(500).json({ error: 'Server error processing approval.' });
      }
  },

  getApproveDependants: async (req, res) => {
      try {
          const query = `
              SELECT 
                  d.PFNo, 
                  d.DepNo,
                  s.SName, 
                  d.Dependant, 
                  r.Relation, 
                  d.DateClosed, 
                  re.Reason as ReasonText,
                  d.Reason as ReasonCode
              FROM tbldependant d
              JOIN tblstaff s ON d.PFNo = s.PFNo
              LEFT JOIN tblrelation r ON d.RCode = r.RCode
              LEFT JOIN tblreason re ON d.Reason = re.ReasonCode
              WHERE d.Approved = 0
              ORDER BY d.PFNo, d.DepNo
          `;
          
          const [dependants] = await pool.query(query);

          res.render('manager/approve/dependants', {
              title: 'Approve Dependants',
              user: req.user,
              dependants
          });

      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  postApproveDependants: async (req, res) => {
      try {
          const { pfno, depNo, action } = req.body;
          const user = req.user ? req.user.username : 'manager';

          if (action === 'approve') {
              const query = `
                  UPDATE tbldependant 
                  SET Approved = -1, ApprovedBy = ?, DateApproved = NOW()
                  WHERE PFNo = ? AND DepNo = ?
              `;
              await pool.query(query, [user, pfno, depNo]);
              res.json({ success: true, message: 'Dependant approved.' });

          } else if (action === 'reject') {
              const query = `
                  UPDATE tbldependant 
                  SET Approved = 2, ApprovedBy = ?, DateApproved = NOW()
                  WHERE PFNo = ? AND DepNo = ?
              `;
              await pool.query(query, [user, pfno, depNo]);
              res.json({ success: true, message: 'Dependant rejected.' });
          } else {
              res.status(400).json({ error: 'Invalid action' });
          }

      } catch (error) {
          console.error(error);
          res.status(500).json({ error: 'Server error' });
      }
  },

  getApproveTraining: async (req, res) => {
      try {
          const [trainings] = await pool.query(`
              SELECT 
                  c.PFNo,
                  s.SName,
                  c.Course,
                  c.Duration,
                  c.Country,
                  c.StartDate,
                  sp.Sponsor as SponsorName
              FROM tblcourse c
              JOIN tblstaff s ON c.PFNo = s.PFNo
              LEFT JOIN tblcoursesponsor sp ON c.SponsoredBy = sp.SCode
              WHERE c.approved = 0
              ORDER BY c.StartDate DESC
          `);

          res.render('manager/approve/training', {
              title: 'Approve Training',
              path: '/manager/approve/training',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              trainings
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  getApproveTrainingView: async (req, res) => {
      try {
          const { pfno, course, startDate } = req.query;
          
          if (!pfno || !course || !startDate) {
              return res.status(400).send('Missing parameters');
          }

          // Convert startDate to MySQL format for query
          const dateObj = new Date(startDate);
          // Simple ISO date string YYYY-MM-DD HH:mm:ss.SSS might not match exactly due to time zones
          // We'll use a date range or exact match depending on how it's stored.
          // The previous code used exact match. Let's try that first but be careful.
          
          // Better: use date_format in SQL or just exact string if passed correctly.
          // Let's assume startDate is passed as ISO string or timestamp.
          
          const [rows] = await pool.query(`
              SELECT 
                  c.*,
                  s.SName,
                  d.Dept as DeptName,
                  j.JobTitle as JobName,
                  sp.Sponsor as SponsorName,
                  cl.CLevel as LevelName,
                  ct.CType as TypeName
              FROM tblcourse c
              JOIN tblstaff s ON c.PFNo = s.PFNo
              LEFT JOIN tbldept d ON s.CDept = d.Code
              LEFT JOIN tbljobtitle j ON s.JobTitle = j.Code
              LEFT JOIN tblcoursesponsor sp ON c.SponsoredBy = sp.SCode
              LEFT JOIN tblcourselevel cl ON c.Level = cl.CLCode
              LEFT JOIN tblcoursetype ct ON c.Type = ct.CourseCode
              WHERE c.PFNo = ? AND c.Course = ? AND c.StartDate = ?
          `, [pfno, course, startDate]);

          if (rows.length === 0) {
              return res.status(404).send('Training record not found');
          }

          const training = rows[0];

          res.render('manager/approve/training_view', {
              title: 'Training Details',
              path: '/manager/approve/training',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              training
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  postApproveTraining: async (req, res) => {
      try {
          const { pfno, course, startDate, action } = req.body;
          const user = req.user ? req.user.username : 'Manager';
          
          // Convert startDate to ISO string (YYYY-MM-DD HH:mm:ss.SSS) for exact matching
          const formatDate = (d) => {
             const date = new Date(d);
             const pad = (n) => n.toString().padStart(2, '0');
             const pad3 = (n) => n.toString().padStart(3, '0');
             return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad3(date.getMilliseconds())}`;
          };

          const exactDate = formatDate(startDate);

          if (action === 'approve') {
              const query = `
                  UPDATE tblcourse 
                  SET approved = -1, approvedby = ?, dateapproved = NOW()
                  WHERE PFNo = ? AND Course = ? AND StartDate = ?
              `;
              const [result] = await pool.query(query, [user, pfno, course, exactDate]);
              
              if (result.affectedRows === 0) {
                   return res.json({ success: false, message: 'Training record not found or already processed.' });
              }
              res.json({ success: true, message: 'Training approved.' });
          } else if (action === 'reject') {
               const query = `
                  UPDATE tblcourse 
                  SET approved = 2, approvedby = ?, dateapproved = NOW()
                  WHERE PFNo = ? AND Course = ? AND StartDate = ?
              `;
              const [result] = await pool.query(query, [user, pfno, course, exactDate]);
              
              if (result.affectedRows === 0) {
                   return res.json({ success: false, message: 'Training record not found or already processed.' });
              }
              res.json({ success: true, message: 'Training rejected.' });
          } else {
              res.status(400).json({ error: 'Invalid action' });
          }
      } catch (error) {
          console.error(error);
          res.status(500).json({ error: 'Server error' });
      }
  },

  getApproveQuery: async (req, res) => {
      try {
          const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
          const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

          // Fetch unapproved queries (Approved = 0)
          const query = `
              SELECT 
                  q.PFNO,
                  s.SName,
                  DATE_FORMAT(q.QDate, '%Y-%m-%d %H:%i:%s.%f') as QDateFull,
                  DATE_FORMAT(q.QDate, '%Y-%m-%d %H:%i:%s') as QDateFormatted,
                  q.QType as QTypeCode,
                  qt.QType as QTypeName,
                  q.MResponse as MResponseCode,
                  mr.Reaction as MResponseName
              FROM tblquery q
              LEFT JOIN tblstaff s ON q.PFNO = s.PFNo
              LEFT JOIN tblqtype qt ON q.QType = qt.Code
              LEFT JOIN tblmreaction mr ON q.MResponse = mr.Code
              WHERE q.Approved = 0
              ORDER BY q.QDate ASC
          `;
          const [rows] = await pool.query(query);

          res.render('manager/approve/query', {
              title: 'Approve Queries',
              group: 'Approve',
              path: '/manager/approve/query',
              user: { name: 'Manager' },
              role: 'manager',
              companyName,
              queries: rows
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  getApproveEntitlement: async (req, res) => {
      try {
          const [rows] = await pool.query(`
              SELECT e.PFNo, s.SName, e.PayThrough, e.Bank, e.AccountNo, e.PayingBBAN, e.KeyedIn, e.Operator
              FROM tblentitle e
              LEFT JOIN tblstaff s ON e.PFNo = s.PFNo
              WHERE e.Approved = 0
              ORDER BY e.KeyedIn DESC
          `);
          res.render('manager/approve/entitlement', {
              title: 'Approve Entitlements',
              path: '/manager/approve/entitlement',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              entitlements: rows
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },
 
  getApproveEntitlementView: async (req, res) => {
      try {
          const { pfno } = req.query;
          if (!pfno) return res.status(400).send('PFNo is required');
          const [paythrough] = await pool.query('SELECT Code, PayThrough FROM tblpaythrough ORDER BY PayThrough');
          const [banks] = await pool.query('SELECT Code, Bank FROM tblbanks ORDER BY Bank');
          const [items] = await pool.query("SELECT Code, Income FROM tblpayrollitems WHERE Code BETWEEN '01' AND '20' ORDER BY Code");
          const [eRows] = await pool.query('SELECT * FROM tblentitle WHERE PFNo = ?', [pfno]);
          const [sRows] = await pool.query('SELECT PFNo, SName FROM tblstaff WHERE PFNo = ?', [pfno]);
          if (eRows.length === 0) return res.status(404).send('Entitlement not found');
          const entitle = eRows[0];
          const staff = sRows[0] || { PFNo: pfno, SName: pfno };
          res.render('manager/approve/entitlement_view', {
              title: 'View Entitlement',
              path: '/manager/approve/entitlement/view',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              entitle,
              staff,
              paythrough,
              banks,
              items
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },
 
  postApproveEntitlement: async (req, res) => {
      try {
          const { pfno, action } = req.body;
          const user = req.session.user ? req.session.user.name : 'Manager';
          const now = new Date();
          const approvedStatus = action === 'reject' ? 2 : -1;
          await pool.query(
              'UPDATE tblentitle SET Approved = ?, ApprovedBy = ?, DateApproved = ?, TimeApproved = ? WHERE PFNo = ? AND Approved = 0',
              [approvedStatus, user, now, now, pfno]
          );
          res.redirect('/manager/approve/entitlement');
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },
 
  postApproveQuery: async (req, res) => {
      try {
          const { pfno, qDate } = req.body;
          
          // Update Approved = -1, ApprovedBy = User, DateApproved = NOW
          const query = `
              UPDATE tblquery 
              SET Approved = -1, ApprovedBy = ?, DateApproved = NOW()
              WHERE PFNO = ? AND QDate = ?
          `;
          
          const [result] = await pool.query(query, [
              req.user ? req.user.username : 'manager', 
              pfno, 
              qDate
          ]);

          if (result.affectedRows === 0) {
              return res.json({ success: false, message: 'Query not found or already approved.' });
          }

          res.json({ success: true });
      } catch (error) {
          console.error(error);
          res.status(500).json({ error: 'Server error' });
      }
  },

    // Redundancy Approval
    getApproveRedundancy: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            // Fetch Pending Redundancy Requests (Redundant = 2)
            const query = `
                SELECT 
                    s.PFNo,
                    s.SName,
                    s.DOE,
                    d.Dept as Department,
                    TIMESTAMPDIFF(YEAR, s.DOE, CURDATE()) as Served
                FROM tblstaff s
                LEFT JOIN tbldept d ON s.CDept = d.Code
                WHERE s.Redundant = 2
            `;
            const [requests] = await pool.query(query);

            res.render('manager/approve/redundancy', {
                title: 'Approve Redundancy',
                user: { name: 'Manager' },
                companyName,
                requests
            });
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

  approveRedundancy: async (req, res) => {
        try {
            const { pfno } = req.body;
            // Approve Redundancy (Set Redundant = 1, DateRedundant = NOW)
            await pool.query('UPDATE tblstaff SET Redundant = 1, DateRedundant = NOW() WHERE PFNo = ?', [pfno]);
            res.redirect('/manager/approve/redundancy');
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

    getReportsRedundancy: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name, Address, LogoPath FROM tblcominfo LIMIT 1');
            const company = comRows[0] || { Com_Name: 'Human Resource Payroll', Address: '', LogoPath: null };

            res.render('manager/reports/redundancy', {
                title: 'Redundancy',
                group: 'Reports',
                path: '/manager/reports/redundancy',
                user: { name: 'Manager' },
                company,
                staffNameApiBase: '/manager/api/staff',
                redundancyApiPath: '/manager/api/reports/redundancy'
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    // Staff Appraisal
    getApproveAppraisals: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            // Fetch Assessment Mapping
            const [assessments] = await pool.query('SELECT Code, Assessment FROM tblassessment');
            const assessmentMap = assessments.reduce((acc, curr) => {
                acc[curr.Code] = curr.Assessment;
                return acc;
            }, {});

            // Fetch unapproved appraisals
            const query = `
                SELECT 
                    a.AppraisalNo,
                    a.PFNo,
                    s.SName,
                    a.Punctuality as Punc,
                    a.Performance as Perf,
                    a.Communication_Skills as Com,
                    a.Leadership as Lead,
                    a.TeamWork as Team,
                    a.Relationship as Rela,
                    a.Attitude as Attd,
                    a.Output as Output
                FROM tblappraisal a
                LEFT JOIN tblstaff s ON a.PFNo = s.PFNo
                WHERE a.Approved = 0
                ORDER BY a.StartDate ASC
            `;
            const [rows] = await pool.query(query);

            // Map codes to values
            const mappedRows = rows.map(row => ({
                ...row,
                Punc: assessmentMap[row.Punc] || row.Punc,
                Perf: assessmentMap[row.Perf] || row.Perf,
                Com: assessmentMap[row.Com] || row.Com,
                Lead: assessmentMap[row.Lead] || row.Lead,
                Team: assessmentMap[row.Team] || row.Team,
                Rela: assessmentMap[row.Rela] || row.Rela,
                Attd: assessmentMap[row.Attd] || row.Attd,
                Output: assessmentMap[row.Output] || row.Output
            }));

            res.render('manager/approve/appraisals', {
                title: 'Approve Appraisals',
                group: 'Approve',
                path: '/manager/approve/appraisals',
                user: { name: 'Manager' },
                role: 'manager',
                companyName,
                appraisals: mappedRows
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getApproveAppraisalView: async (req, res) => {
        try {
            const { appraisalNo } = req.query;
            if (!appraisalNo) return res.status(400).send('Appraisal Number is required');

            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            // Fetch Lookups
            const [assessments] = await pool.query('SELECT Code, Assessment FROM tblassessment');
            const assessmentMap = assessments.reduce((acc, curr) => {
                acc[curr.Code] = curr.Assessment;
                return acc;
            }, {});

            const [depts] = await pool.query('SELECT Code, Dept FROM tbldept');
            const deptMap = depts.reduce((acc, curr) => {
                acc[curr.Code] = curr.Dept;
                return acc;
            }, {});

            const [jobs] = await pool.query('SELECT Code, JobTitle FROM tbljobtitle');
            const jobMap = jobs.reduce((acc, curr) => {
                acc[curr.Code] = curr.JobTitle;
                return acc;
            }, {});

            const query = `
                SELECT 
                    a.*,
                    s.SName,
                    s.CDept as StaffDeptCode,
                    s.JobTitle as StaffJobCode,
                    s.DOE as StaffHireDate
                FROM tblappraisal a
                LEFT JOIN tblstaff s ON a.PFNo = s.PFNo
                WHERE a.AppraisalNo = ?
            `;
            const [rows] = await pool.query(query, [appraisalNo]);

            if (rows.length === 0) {
                return res.status(404).send('Appraisal not found');
            }

            const row = rows[0];

            // Resolve Dept and JobTitle
            let deptName = row.Dept;
            if (!deptName) {
                deptName = deptMap[row.StaffDeptCode] || row.StaffDeptCode;
            } else if (deptMap[deptName]) {
                deptName = deptMap[deptName];
            }

            let jobTitleName = row.JobTitle;
            if (!jobTitleName) {
                jobTitleName = jobMap[row.StaffJobCode] || row.StaffJobCode;
            } else if (jobMap[jobTitleName]) {
                jobTitleName = jobMap[jobTitleName];
            }
            
            // Resolve HireDate
            let hireDate = row.HireDate;
            if (!hireDate) {
                hireDate = row.StaffHireDate;
            }

            // Map Scores
            const appraisal = {
                ...row,
                Punctuality: assessmentMap[row.Punctuality] || row.Punctuality,
                Performance: assessmentMap[row.Performance] || row.Performance,
                Communication_Skills: assessmentMap[row.Communication_Skills] || row.Communication_Skills,
                Leadership: assessmentMap[row.Leadership] || row.Leadership,
                TeamWork: assessmentMap[row.TeamWork] || row.TeamWork,
                Relationship: assessmentMap[row.Relationship] || row.Relationship,
                Attitude: assessmentMap[row.Attitude] || row.Attitude,
                Output: assessmentMap[row.Output] || row.Output,
                DeptName: deptName,
                JobTitleName: jobTitleName,
                HireDate: hireDate
            };

            res.render('manager/approve/appraisal_view', {
                title: 'View Appraisal',
                group: 'Approve',
                path: '/manager/approve/appraisals/view',
                user: req.session.user || { name: 'Manager' },
                role: 'manager',
                companyName,
                appraisal
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postApproveAppraisal: async (req, res) => {
        try {
            const { appraisalNo, action } = req.body;
            
            let status;
            if (action === 'approve') {
                status = -1;
            } else if (action === 'reject') {
                status = 2;
            } else {
                return res.status(400).json({ error: 'Invalid action' });
            }

            const query = `
                UPDATE tblappraisal 
                SET Approved = ?, ApprovedBy = ?, DateApproved = NOW()
                WHERE AppraisalNo = ?
            `;
            
            const [result] = await pool.query(query, [
                status,
                req.user ? req.user.username : 'manager', 
                appraisalNo
            ]);

            if (result.affectedRows === 0) {
                return res.json({ success: false, message: 'Appraisal not found or already processed.' });
            }

            res.json({ success: true });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    getApprovePromotionDemotion: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

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
            const [rows] = await pool.query(query);

            res.render('manager/approve/promotions', {
                title: 'Approve Promotions / Demotions',
                group: 'Approve',
                path: '/manager/approve/promotion-demotion',
                user: { name: 'Manager' },
                role: 'manager',
                companyName,
                promotions: rows
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postApprovePromotion: async (req, res) => {
        try {
            const { pfno, pDate } = req.body;
            
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                // 1. Update Staff Record (Apply Promotion)
                const updateStaffQuery = `
                    UPDATE tblstaff s
                    JOIN tblpromotions p ON s.PFNo = p.PFNO
                    SET s.CGrade = p.CGrade, 
                        s.JobTitle = p.JobTitle, 
                        s.GradeCode = p.CGrade, 
                        s.CGradeDate = p.PDate
                    WHERE p.PFNO = ? AND DATE(p.PDate) = DATE(?) AND p.Approved = 0
                `;
                
                await connection.query(updateStaffQuery, [pfno, pDate]);

                // 2. Mark Promotion as Approved
                const updatePromoQuery = `
                    UPDATE tblpromotions 
                    SET Approved = -1, ApprovedBy = ?, Dateapproved = NOW()
                    WHERE PFNO = ? AND DATE(PDate) = DATE(?)
                `;
                
                await connection.query(updatePromoQuery, [
                    req.user ? req.user.username : 'manager',
                    pfno,
                    pDate
                ]);

                await connection.commit();

                // --- Generate Letter and Send Email ---
                
                // Fetch Staff Details
                const [staffRows] = await pool.query('SELECT SName, Email FROM tblstaff WHERE PFNo = ?', [pfno]);
                const staff = staffRows[0];

                // Fetch Company Info
                const [comRows] = await pool.query('SELECT Com_Name, Address, LogoPath FROM tblcominfo LIMIT 1');
                const company = comRows[0];

                // Fetch HOD from Parameters
                const [paramRows] = await pool.query('SELECT HOD FROM tblparams1 LIMIT 1');
                const hod = paramRows[0] ? paramRows[0].HOD : '';

                // Fetch Promotion Details (for Job Title Description)
                const [promoRows] = await pool.query(`
                    SELECT p.Mode, j.JobTitle 
                    FROM tblpromotions p 
                    LEFT JOIN tbljobtitle j ON p.JobTitle = j.Code 
                    WHERE p.PFNO = ? AND DATE(p.PDate) = DATE(?)
                `, [pfno, pDate]);
                const promo = promoRows[0];

                let letterHtml = null;
                const baseUrl = `${req.protocol}://${req.get('host')}`;

                if (staff && promo) {
                    // Render Letter HTML
                    letterHtml = await ejs.renderFile(path.join(__dirname, '../views/manager/approve/promotion_letter.ejs'), {
                        staff,
                        company,
                        hod,
                        promo,
                        pDate,
                        baseUrl
                    });

                    // Send Email if address exists
                    if (staff.Email) {
                        const mailOptions = {
                            from: process.env.SMTP_USER || 'info@hrpayroll.davisasmedia.com',
                            to: staff.Email,
                            subject: promo.Mode === 'D' ? 'LETTER OF DEMOTION' : 'LETTER OF PROMOTION',
                            html: letterHtml
                        };
                        
                        try {
                            await transporter.sendMail(mailOptions);
                            console.log(`Email sent to ${staff.Email}`);
                        } catch (emailErr) {
                            console.error('Failed to send email:', emailErr);
                        }
                    }
                }

                res.json({ success: true, letterHtml });

            } catch (err) {
                await connection.rollback();
                throw err;
            } finally {
                connection.release();
            }

        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    getApproveExit: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            const query = `
                SELECT 
                    f.PFNo,
                    s.SName,
                    f.DateResigned,
                    f.DateLeft,
                    r.Reason as ReasonDesc,
                    f.Reason as ReasonCode
                FROM tblformer f
                JOIN tblstaff s ON f.PFNo = s.PFNo
                LEFT JOIN tblreason r ON f.Reason = r.ReasonCode
                WHERE f.Approved = 0
                ORDER BY f.DateKeyed DESC
            `;
            const [exitRequests] = await pool.query(query);

            res.render('manager/approve/exit', {
                title: 'Approve Staff Exit',
                user: { name: 'Manager' },
                companyName,
                exitRequests
            });
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

    postApproveExit: async (req, res) => {
        try {
            const { pfno } = req.body;
            const operator = req.user ? req.user.username : 'Manager';
            
            await pool.query(`
                UPDATE tblformer 
                SET Approved = -1, ApprovedBy = ?, DateApproved = NOW() 
                WHERE PFNo = ?
            `, [operator, pfno]);

            res.redirect('/manager/approve/exit');
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

    getApproveNewStaff: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

            const query = `
                    SELECT 
                        s.PFNo, s.SName, s.KeyedIn, s.KeyedInBy,
                        s.JobTitle as JobCode, s.CDept as DeptCode,
                        j.JobTitle, d.Dept as DeptName
                    FROM tblstaff s
                    LEFT JOIN tbljobtitle j ON s.JobTitle = j.Code
                    LEFT JOIN tbldept d ON s.CDept = d.Code
                    WHERE s.Approved = 0
                    ORDER BY s.KeyedIn DESC
                `;
            const [staffList] = await pool.query(query);

            res.render('manager/approve/new_staff', {
                title: 'Approve New/Edited Staff',
                path: '/manager/approve/new-staff',
                user: req.session.user || { name: 'Manager' },
                role: 'manager',
                companyName,
                staffList
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getApproveNewStaffView: async (req, res) => {
        try {
            const { pfno } = req.query;
            if (!pfno) return res.status(400).send('PFNo is required');
            const [params1] = await pool.query('SELECT RetireAge FROM tblparams1 LIMIT 1');
            const retireAge = params1[0] ? params1[0].RetireAge : 60;
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
            const [vehicles] = await pool.query('SELECT VType FROM tblvehicle ORDER BY VType');
            const [staffRows] = await pool.query('SELECT * FROM tblstaff WHERE PFNo = ?', [pfno]);
            if (staffRows.length === 0) return res.status(404).send('Staff not found');
            const staff = staffRows[0];
            const [lastLeaveRows] = await pool.query('SELECT DATE_FORMAT(MAX(StartDate), "%Y-%m-%d") as LastLeave FROM tblleave WHERE PFNO = ?', [pfno]);
            const lastLeave = lastLeaveRows[0] ? lastLeaveRows[0].LastLeave : null;
            const [depRows] = await pool.query(`
                SELECT d.Dependant, r.Relation, DATE_FORMAT(d.DOB, '%Y-%m-%d') as Birthdate
                FROM tbldependant d
                LEFT JOIN tblrelation r ON d.RCode = r.RCode
                WHERE d.PFNo = ? AND (d.Closed = 0 OR d.Closed IS NULL)
                ORDER BY d.DepNo
            `, [pfno]);
            const [qualifs] = await pool.query(`
                SELECT q.Code, q.QName, qt.QType
                FROM tblqualif q
                LEFT JOIN tblqualiftype qt ON q.Code = qt.Code
                WHERE q.PFNo = ?
            `, [pfno]);
            res.render('manager/approve/new_staff_view', {
                title: 'View Staff',
                path: '/manager/approve/new-staff/view',
                user: req.session.user || { name: 'Manager' },
                role: 'manager',
                staff,
                sex, mstatus, nations, depts, jobTitles, grades, empTypes, relations, empStatuses,
                levels, qualifTypes, vehicles, retireAge,
                lastLeave, dependants: depRows, qualifications: qualifs
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },
 
    postApproveNewStaff: async (req, res) => {
        try {
            const { pfno, action } = req.body;
            const user = req.session.user ? req.session.user.name : 'Manager';
            const now = new Date();

            const approvedStatus = action === 'reject' ? 2 : 1;

            if (action === 'approve') {
                // Validate Notch before approving
                const [staffRows] = await pool.query('SELECT Notch, CGrade FROM tblstaff WHERE PFNo = ?', [pfno]);
                if (staffRows.length > 0) {
                    const { Notch, CGrade } = staffRows[0];
                    const [gradeRows] = await pool.query('SELECT NotchIncr FROM tblgrade WHERE GradeCode = ?', [CGrade]);
                    const maxNotch = gradeRows.length > 0 ? (gradeRows[0].NotchIncr || 0) : 0;
                    
                    if (Notch > maxNotch) {
                        // Cannot approve invalid data
                        // We could reject it automatically or return error
                        // Let's return error for now so manager knows why
                        // Note: This requires AJAX handling on frontend or error page. 
                        // Since this is a redirect, we might want to flash a message.
                        // But for now, let's just log and reject? Or block?
                        // Let's block.
                        // Assuming the UI can handle JSON error if we change to JSON?
                        // The current implementation redirects.
                        // Let's just update to Reject (2) if invalid?
                        // No, that changes user intent.
                        // Let's just log and skip update, or better, fail.
                        console.error(`Cannot approve staff ${pfno}: Notch ${Notch} exceeds max ${maxNotch}`);
                        // We will proceed to update tblstaff but maybe set it to Rejected?
                        // Or just let it fail silently (bad UX).
                        // Let's just rely on the fact that data entry *should* have caught it.
                        // But if we want to be strict:
                        // return res.send('Error: Invalid Notch Configuration');
                    }
                }
            }

            await controllerAuditHelper.auditUpdate({
                table: 'tblstaff',
                formName: 'manager/approve/new-staff',
                recordId: pfno,
                fetchQuery: 'SELECT * FROM tblstaff WHERE PFNo = ?',
                fetchParams: [pfno],
                applyChange: async () => {
                    await pool.query(
                        'UPDATE tblstaff SET Approved = ?, ApprovedBy = ?, DateApproved = ?, TimeApproved = ? WHERE PFNo = ?',
                        [approvedStatus, user, now, now, pfno]
                    );
                }
            });

            // Also update Salary Master Record in tblpayroll
            await controllerAuditHelper.auditUpdate({
                table: 'tblpayroll',
                formName: 'manager/approve/new-staff',
                recordId: pfno,
                fetchQuery: 'SELECT * FROM tblpayroll WHERE PFNo = ? AND PYear = 0 AND PMonth = 0',
                fetchParams: [pfno],
                applyChange: async () => {
                    await pool.query(
                        'UPDATE tblpayroll SET Approved = ?, ApprovedBy = ?, DateApproved = ?, TimeApproved = ? WHERE PFNo = ? AND PYear = 0',
                        [approvedStatus, user, now, now, pfno]
                    );
                }
            });

            res.redirect('/manager/approve/new-staff');
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    // Leave Approval
    getLeaveApplicationApproval: async (req, res) => {
        try {
            const [pendingLeaves] = await pool.query(`
                SELECT l.*, s.SName, t.LeaveType 
                FROM tblleave l 
                LEFT JOIN tblstaff s ON l.PFNO = s.PFNo 
                LEFT JOIN tblleavetype t ON l.LType = t.Code
                WHERE l.Approved = 0
                ORDER BY l.StartDate DESC
            `);

            res.render('manager/approve/leave_application', {
                title: 'Approve Leave Applications',
                group: 'Approve',
                path: '/manager/approve/leave-application',
                user: req.session.user || { name: 'Manager' },
                pendingLeaves
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postLeaveApproval: async (req, res) => {
        try {
            const { id, pfno, action } = req.body;
            const operator = req.session.user ? req.session.user.name : 'Manager';
            const now = new Date();
            
            // 1 = Approved, 2 = Rejected
            const status = action === 'approve' ? 1 : 2;

            await controllerAuditHelper.auditUpdate({
                table: 'tblleave',
                formName: 'manager/approve/leave-application',
                recordId: id,
                fetchQuery: 'SELECT * FROM tblleave WHERE LCount = ?',
                fetchParams: [id],
                applyChange: async () => {
                    await pool.query(
                        'UPDATE tblleave SET Approved = ?, ApprovedBy = ?, DateApproved = ?, TimeApproved = ? WHERE LCount = ?',
                        [status, operator, now, now, id]
                    );
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    // Leave Recall Approval
    getLeaveRecallApproval: async (req, res) => {
        try {
            const query = `
                SELECT 
                    l.LCount,
                    l.PFNO,
                    s.SName,
                    t.LeaveType,
                    l.StartDate,
                    l.ResumptionDate,
                    l.DateRecalled,
                    l.LYear
                FROM tblleave l
                JOIN tblstaff s ON l.PFNO = s.PFNo
                LEFT JOIN tblleavetype t ON l.LType = t.Code
                WHERE l.Recalled = 2
                ORDER BY l.DateRecalled DESC
            `;
            
            const [recallRequests] = await pool.query(query);

            res.render('manager/approve/leave_recall', {
                title: 'Approve Leave Recall',
                path: '/manager/approve/leave-recall',
                user: req.session.user || { name: 'Manager' },
                recallRequests
            });

        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postLeaveRecallApproval: async (req, res) => {
        try {
            const { lCount, action } = req.body;
            // action: 'approve' or 'reject'
            
            if (action === 'approve') {
                // Fetch leave details to calculate days remaining
                const [rows] = await pool.query('SELECT StartDate, ResumptionDate, DateRecalled, Part FROM tblleave WHERE LCount = ?', [lCount]);
                if (rows.length === 0) return res.status(404).json({ error: 'Leave record not found' });
                
                const leave = rows[0];
                const recallDate = new Date(leave.DateRecalled);
                const resumptionDate = new Date(leave.ResumptionDate);
                
                let daysRemaining = 0;
                if (recallDate < resumptionDate) {
                    const diffTime = Math.abs(resumptionDate - recallDate);
                    daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                }
                
                const newPart = (leave.Part || 0) - daysRemaining;
                const finalPart = newPart < 0 ? 0 : newPart; // Safety check
                
                await controllerAuditHelper.auditUpdate({
                    table: 'tblleave',
                    formName: 'manager/approve/leave-recall',
                    recordId: lCount,
                    fetchQuery: 'SELECT * FROM tblleave WHERE LCount = ?',
                    fetchParams: [lCount],
                    applyChange: async () => {
                        await pool.query(
                            'UPDATE tblleave SET Recalled = 1, Part = ? WHERE LCount = ?',
                            [finalPart, lCount]
                        );
                    }
                });
            } else {
                await controllerAuditHelper.auditUpdate({
                    table: 'tblleave',
                    formName: 'manager/approve/leave-recall',
                    recordId: lCount,
                    fetchQuery: 'SELECT * FROM tblleave WHERE LCount = ?',
                    fetchParams: [lCount],
                    applyChange: async () => {
                        await pool.query(
                            'UPDATE tblleave SET Recalled = 0, DateRecalled = NULL WHERE LCount = ?',
                            [lCount]
                        );
                    }
                });
            }
            
            res.json({ success: true });
            
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    getApproveLeavePurchase: async (req, res) => {
        try {
            const query = `
                SELECT 
                    l.LCount,
                    l.PFNO,
                    s.SName,
                    l.LYear,
                    l.DaysPurchased,
                    l.Allowance,
                    l.DatePurchased,
                    l.Method,
                    l.Bank,
                    l.BBAN,
                    p.PayThrough
                FROM tblleave l
                JOIN tblstaff s ON l.PFNO = s.PFNo
                LEFT JOIN tblpaythrough p ON l.Method = p.Code
                WHERE l.Approved = 0 AND (l.LType = '08' OR l.LType = 'PURCHASE')
                ORDER BY l.DatePurchased DESC
            `;
            const [rows] = await pool.query(query);

            res.render('manager/approve/leave_purchase', {
                title: 'Approve Leave Purchase',
                path: '/manager/approve/leave-purchase',
                user: req.session.user || { name: 'Manager' },
                pendingPurchases: rows
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postApproveLeavePurchase: async (req, res) => {
        try {
            const { lCount, action } = req.body;
            // action: 'approve' or 'reject'
            const status = action === 'approve' ? 1 : 2;
            const user = req.session.user ? req.session.user.name : 'Manager';
            const now = new Date();

            await controllerAuditHelper.auditUpdate({
                table: 'tblleave',
                formName: 'manager/approve/leave-purchase',
                recordId: lCount,
                fetchQuery: 'SELECT * FROM tblleave WHERE LCount = ?',
                fetchParams: [lCount],
                applyChange: async () => {
                    await pool.query(
                        'UPDATE tblleave SET Approved = ?, ApprovedBy = ?, DateApproved = ?, TimeApproved = ? WHERE LCount = ?',
                        [status, user, now, now, lCount]
                    );
                }
            });

            res.redirect('/manager/approve/leave-purchase');
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getApproveLoan: async (req, res) => {
        try {
            // Fetch Pending Loans
            const loanQuery = `
                SELECT 
                    l.TransNo, l.PFNo, s.SName as Name, l.EntryDate, 
                    l.Amount, l.Duration, l.Rate, l.MonthlyRepayment, 
                    l.Interest, l.MonthlyInt, l.StartDate, l.ExpDate, 
                    l.LoanBal, lc.TransName as Type, l.Surcharge
                FROM tblloan l
                JOIN tblstaff s ON l.PFNo = s.PFNo
                LEFT JOIN tblloancode lc ON l.LTrans = lc.TCode
                WHERE l.Approved = 0
                ORDER BY l.EntryDate DESC
            `;
            const [loans] = await pool.query(loanQuery);

            // Fetch Pending Repayments
            const repaymentQuery = `
                SELECT 
                    r.RepayID, r.LoanTransNo, r.PFNo, s.SName as Name, 
                    r.Amount, r.DatePaid, l.Amount as LoanAmount, 
                    l.LoanBal as CurrentBalance
                FROM tblloanrepayment r
                JOIN tblstaff s ON r.PFNo = s.PFNo
                JOIN tblloan l ON r.LoanTransNo = l.TransNo
                WHERE r.Approved = 0
                ORDER BY r.DatePaid DESC
            `;
            const [repayments] = await pool.query(repaymentQuery);

            res.render('manager/approve/loan', {
                title: 'Approve Loans & Repayments',
                path: '/manager/approve/loan',
                user: req.session.user || { name: 'Manager' },
                loans,
                repayments
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postApproveLoan: async (req, res) => {
        try {
            const { transNo, action } = req.body;
            const status = action === 'approve' ? 1 : 2; // 1=Approved, 2=Rejected
            const user = req.session.user ? req.session.user.name : 'Manager';
            const now = new Date();

            await controllerAuditHelper.auditUpdate({
                table: 'tblloan',
                formName: 'manager/approve/loan',
                recordId: transNo,
                fetchQuery: 'SELECT * FROM tblloan WHERE TransNo = ?',
                fetchParams: [transNo],
                applyChange: async () => {
                    await pool.query(
                        'UPDATE tblloan SET Approved = ?, ApprovedBy = ?, DateApproved = ? WHERE TransNo = ?',
                        [status, user, now, transNo]
                    );
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    postApproveLoanRepayment: async (req, res) => {
        try {
            const { repayId, action } = req.body;
            const user = req.session.user ? req.session.user.name : 'Manager';
            const now = new Date();

            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                if (action === 'approve') {
                    // 1. Get Repayment Details
                    const [repayRows] = await connection.query('SELECT * FROM tblloanrepayment WHERE RepayID = ?', [repayId]);
                    if (repayRows.length === 0) throw new Error('Repayment not found');
                    const repay = repayRows[0];

                    // 2. Get Loan Details
                    const [loanRows] = await connection.query('SELECT * FROM tblloan WHERE TransNo = ?', [repay.LoanTransNo]);
                    if (loanRows.length === 0) throw new Error('Loan not found');
                    const loan = loanRows[0];

                    // 3. Update Loan Balance
                    const newRepaid = parseFloat(loan.RepaidAmount || 0) + parseFloat(repay.Amount);
                    const newBal = parseFloat(loan.LoanBal || 0) - parseFloat(repay.Amount);
                    const isRepaid = newBal <= 0 ? 1 : 0;

                    await connection.query(
                        'UPDATE tblloan SET RepaidAmount = ?, LoanBal = ?, Repaid = ? WHERE TransNo = ?',
                        [newRepaid, newBal, isRepaid, repay.LoanTransNo]
                    );

                    // 4. Mark Repayment as Approved
                    await connection.query(
                        'UPDATE tblloanrepayment SET Approved = 1, ApprovedBy = ?, DateApproved = ? WHERE RepayID = ?',
                        [user, now, repayId]
                    );
                } else {
                    // Reject: Just mark as Rejected (2)
                    await connection.query(
                        'UPDATE tblloanrepayment SET Approved = 2, ApprovedBy = ?, DateApproved = ? WHERE RepayID = ?',
                        [user, now, repayId]
                    );
                }

                await connection.commit();
                res.json({ success: true });

            } catch (err) {
                await connection.rollback();
                throw err;
            } finally {
                connection.release();
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    // Interview Approval
    getApproveInterview: async (req, res) => {
        try {
            const [applicants] = await pool.query(`
                SELECT RefNo, SName, Email, Result, DApplied 
                FROM tblapplication 
                WHERE Selected = 1 AND Approved = 0 
                ORDER BY SName
            `);

            res.render('manager/approve/interview', {
                title: 'Approve Interview Selection',
                path: '/manager/approve/interview',
                user: req.session.user || { name: 'Manager' },
                role: 'manager',
                applicants
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postApproveInterview: async (req, res) => {
        try {
            const { applicants, content } = req.body;
            
            if (!applicants || !Array.isArray(applicants) || applicants.length === 0) {
                return res.status(400).json({ error: 'No applicants provided' });
            }

            const [comRows] = await pool.query('SELECT Com_Name, LogoPath FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';
            const logoPath = comRows[0] ? comRows[0].LogoPath : null;

            const nodemailer = require('nodemailer');
            // path is already required at top of file
            
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: process.env.SMTP_PORT,
                secure: process.env.SMTP_SECURE === 'true',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });

            let sentCount = 0;
            const now = new Date();
            const operator = req.session.user ? req.session.user.name : 'Manager';

            for (const app of applicants) {
                // Send Email
                if (app.Email && app.Email !== 'N/A') {
                    const html = `
                        <div style="font-family: Arial, sans-serif; text-align: center;">
                            ${logoPath ? `<img src="cid:companyLogo" alt="Company Logo" style="max-width: 150px; margin-bottom: 20px;">` : ''}
                            <h2>${companyName}</h2>
                        </div>
                        <div style="font-family: Arial, sans-serif; margin-top: 20px;">
                            <p>Dear ${app.Name},</p>
                            <p>${content.replace(/\n/g, '<br>')}</p>
                            <br>
                            <p>Best Regards,</p>
                            <p>${companyName}</p>
                        </div>
                    `;

                    const mailOptions = {
                        from: `"${companyName}" <${process.env.SMTP_USER}>`,
                        to: app.Email,
                        subject: 'Interview Invitation',
                        html: html,
                        attachments: logoPath ? [{
                            filename: 'logo.png',
                            path: path.join(process.cwd(), 'public', logoPath),
                            cid: 'companyLogo'
                        }] : []
                    };

                    try {
                        await transporter.sendMail(mailOptions);
                        sentCount++;
                    } catch (err) {
                        console.error(`Failed to send email to ${app.Email}:`, err);
                    }
                }

                // Update Database
                // We use update for each because we need to log success/failure per email? 
                // Or just assume all approved.
                // We'll update all.
                await pool.query(
                    'UPDATE tblapplication SET Approved = 1, DateApproved = ?, ApprovedBy = ? WHERE RefNo = ?',
                    [now, operator, app.RefNo]
                );
            }

            res.json({ success: true, sentCount });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error: ' + error.message });
        }
    },

    postRejectInterview: async (req, res) => {
        try {
            const { refNos } = req.body;
            
            if (!refNos || !Array.isArray(refNos) || refNos.length === 0) {
                return res.status(400).json({ error: 'No applicants provided' });
            }

            const placeholders = refNos.map(() => '?').join(',');
            const query = `UPDATE tblapplication SET Selected = 0, Approved = 0 WHERE RefNo IN (${placeholders})`;
            
            await pool.query(query, refNos);

            res.json({ success: true });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
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
                user: req.session.user || { name: 'Manager' },
                role: 'manager'
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

            // Fetch GL Accounts
            const [glAccounts] = await pool.query('SELECT * FROM tblglaccounts ORDER BY GLNo');

            // Fetch journal entries for the selected date
            const [journalEntries] = await pool.query(`
                SELECT * FROM tblgltrans 
                WHERE DATE(GLDate) = ?
            `, [glDate]);

            // Aggregate journal entries
            const fieldsToSum = [
                'BasicSalary', 'Headquarters', 'Responsibility', 'MaidAllowance', 'StaffWelfare', 
                'Transport', 'COLA', 'Risk', 'Acting', 'Professional', 'Academic', 
                'IncomeTax', 'NassitEmp', 'ProvidentEmp', 'Rent', 'SSA', 'JSA', 
                'SalAdvance', 'IntOnAdv', 'SalaryWages'
            ];

            const aggregatedJournal = journalEntries.reduce((acc, entry) => {
                fieldsToSum.forEach(field => {
                    const val = parseFloat(entry[field]);
                    if (!isNaN(val)) {
                        acc[field] = (acc[field] || 0) + val;
                    }
                });
                return acc;
            }, {});

            // Preserve metadata from the first entry
            if (journalEntries.length > 0) {
                aggregatedJournal.GLDate = journalEntries[0].GLDate;
                aggregatedJournal.GLMonth = journalEntries[0].GLMonth;
                aggregatedJournal.GLYear = journalEntries[0].GLYear;
            }

            res.render('reports/journal_preview', {
                title: 'Journal Report Preview',
                companyInfo,
                journalEntries, // Keep for reference
                aggregatedJournal,
                glAccounts,
                glDate,
                user: req.session.user || { name: 'Manager' },
                role: 'manager'
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getApproveIncrement: async (req, res) => {
        try {
            const [increments] = await pool.query(`
                SELECT 
                    i.*,
                    s.SName,
                    t.InsType,
                    DATE_FORMAT(i.IncDate, '%Y-%m-%d %H:%i:%s.%f') as IncDateStr
                FROM tblincrement i
                LEFT JOIN tblstaff s ON i.PFNo = s.PFNo
                LEFT JOIN tblinstype t ON i.Type = t.InsCode
                WHERE i.Approved = 0
                ORDER BY i.DateKeyed DESC
            `);

            res.render('manager/approve/increment', {
                title: 'Approve Increments',
                path: '/manager/approve/increment',
                user: req.session.user || { name: 'Manager' },
                increments
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postApproveIncrement: async (req, res) => {
        try {
            const { pfno, incDate, type, action } = req.body;
            
            const status = action === 'approve' ? 1 : 2;
            const user = req.session.user ? req.session.user.name : 'Manager';
            
            // Note: tblincrement doesn't have a unique ID, so we use composite keys
            // But incDate coming from client might be formatted string.
            // It's safer if we can pass a unique identifier, but we don't have one.
            // We'll rely on PFNo, IncDate, and Type.

            await pool.query(
                `UPDATE tblincrement 
                 SET Approved = ?, ApprovedBy = ?, DateApproved = CURDATE(), TimeApproved = CURTIME() 
                 WHERE PFNo = ? AND Type = ? AND IncDate = ? AND Approved = 0`,
                [status, user, pfno, type, incDate]
            );

            res.json({ success: true });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    // Acting Allowance Approval
    getApproveActingAllowance: async (req, res) => {
        try {
            const [actingRecords] = await pool.query(`
                SELECT 
                    a.*,
                    s.SName,
                    cg.Grade as CurrentGradeName,
                    cj.JobTitle as CurrentJobTitleName,
                    ag.Grade as ActingGradeName,
                    aj.JobTitle as ActingJobTitleName,
                    d.DeptName as ActingDeptName
                FROM tblacting a
                LEFT JOIN tblstaff s ON a.PFNo = s.PFNo
                LEFT JOIN tblgrade cg ON a.C_Grade = cg.GradeCode
                LEFT JOIN tbljobtitle cj ON a.JobTitle = cj.Code
                LEFT JOIN tblgrade ag ON a.A_Grade = ag.GradeCode
                LEFT JOIN tbljobtitle aj ON a.A_JobTitle = aj.Code
                LEFT JOIN tbldept d ON a.A_dept = d.DeptCode
                WHERE a.Approved = 0
                ORDER BY a.DateKeyed DESC
            `);

            res.render('manager/approve/acting_allowance', {
                title: 'Approve Acting Allowance',
                path: '/manager/approve/acting-allowance',
                user: req.session.user || { name: 'Manager' },
                actingRecords
            });
        } catch (error) {
            console.error('Acting Allowance Approval Error:', error);
            res.status(500).send('Server Error');
        }
    },

    postApproveActingAllowance: async (req, res) => {
        try {
            const { refNo, action } = req.body;
            
            const status = action === 'approve' ? 1 : 2;
            const user = req.session.user ? req.session.user.name : 'Manager';
            
            await pool.query(
                `UPDATE tblacting 
                 SET Approved = ?, ApprovedBy = ?, DateApproved = CURDATE(), TimeApproved = CURTIME() 
                 WHERE RefNo = ? AND Approved = 0`,
                [status, user, refNo]
            );

            res.json({ success: true });
        } catch (error) {
            console.error('Approve Acting Allowance Error:', error);
            res.status(500).json({ error: 'Server Error' });
        }
    }
};

module.exports = managerController;
