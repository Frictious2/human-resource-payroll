const pool = require('../config/db');
const transporter = require('../config/mailer');
const ejs = require('ejs');
const path = require('path');

const managerController = {
  getDashboard: async (req, res) => {
    try {
        // 1. My Staff count
        const [staffRows] = await pool.query('SELECT COUNT(*) as count FROM tblstaff');
        const staffCount = staffRows[0].count;

        // 2. Pending Approvals
        // List of tables to check
        const tables = [
            'tblacting', 'tblapplication', 'tblappraisal', 'tblattendance', 
            'tblbankguarantee', 'tblbonus', 'tblbonusawards', 'tbldependant', 
            'tbldependanthistory', 'tblentitle'
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
            user: { name: 'Manager' },
            staffCount,
            pendingApprovals
        });
    } catch (error) {
        console.error('Dashboard Error:', error);
        res.render('manager/dashboard', { 
            title: 'Manager Dashboard',
            path: '/manager/dashboard',
            user: { name: 'Manager' },
            staffCount: 0,
            pendingApprovals: 0,
            error: 'Failed to load dashboard data'
        });
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
              SELECT s.PFNo, sf.SName, g.Grade AS GradeName, s.Salary, s.NetIncome, s.PDate
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
          await pool.query(
              `UPDATE tblsalary 
               SET Approved = ?, ApprovedBy = ?, DateApproved = ?, TimeApproved = ?
               WHERE PFNo = ? AND PDate = ?`,
              [status, user, now, now, pfno, pdate]
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
          // Fetch Company Info
          const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
          const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

          const query = `
              SELECT 
                  c.PFNo,
                  s.SName,
                  c.Course,
                  c.Duration,
                  c.Country,
                  c.StartDate,
                  sp.Sponsor as SponsorName,
                  c.Cost
              FROM tblcourse c
              JOIN tblstaff s ON c.PFNo = s.PFNo
              LEFT JOIN tblcoursesponsor sp ON c.SponsoredBy = sp.SCode
              WHERE c.approved = 0
              ORDER BY c.StartDate DESC
          `;
          
          const [rows] = await pool.query(query);

          res.render('manager/approve/training', {
              title: 'Approve Training',
              path: '/manager/approve/training',
              user: req.user || { name: 'Manager' },
              role: 'manager',
              companyName,
              trainings: rows
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

    // Staff Appraisal
    getApproveAppraisals: async (req, res) => {
        try {
            const [comRows] = await pool.query('SELECT Com_Name FROM tblcominfo LIMIT 1');
            const companyName = comRows[0] ? comRows[0].Com_Name : 'Human Resource Payroll';

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

            res.render('manager/approve/appraisals', {
                title: 'Approve Appraisals',
                group: 'Approve',
                path: '/manager/approve/appraisals',
                user: { name: 'Manager' },
                role: 'manager',
                companyName,
                appraisals: rows
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postApproveAppraisal: async (req, res) => {
        try {
            const { appraisalNo } = req.body;
            
            const query = `
                UPDATE tblappraisal 
                SET Approved = -1, ApprovedBy = ?, DateApproved = NOW()
                WHERE AppraisalNo = ?
            `;
            
            const [result] = await pool.query(query, [
                req.user ? req.user.username : 'manager', 
                appraisalNo
            ]);

            if (result.affectedRows === 0) {
                return res.json({ success: false, message: 'Appraisal not found or already approved.' });
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

            await pool.query(
                'UPDATE tblstaff SET Approved = ?, ApprovedBy = ?, DateApproved = ?, TimeApproved = ? WHERE PFNo = ?',
                [approvedStatus, user, now, now, pfno]
            );

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

            await pool.query(
                'UPDATE tblleave SET Approved = ?, ApprovedBy = ?, DateApproved = ?, TimeApproved = ? WHERE LCount = ?',
                [status, operator, now, now, id]
            );

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
                
                await pool.query(
                    'UPDATE tblleave SET Recalled = 1, Part = ? WHERE LCount = ?',
                    [finalPart, lCount]
                );
            } else {
                await pool.query(
                    'UPDATE tblleave SET Recalled = 0, DateRecalled = NULL WHERE LCount = ?',
                    [lCount]
                );
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

            await pool.query(
                'UPDATE tblleave SET Approved = ?, ApprovedBy = ?, DateApproved = ?, TimeApproved = ? WHERE LCount = ?',
                [status, user, now, now, lCount]
            );

            res.redirect('/manager/approve/leave-purchase');
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    }
};

module.exports = managerController;
