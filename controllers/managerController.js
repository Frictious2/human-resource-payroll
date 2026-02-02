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
                const [comRows] = await pool.query('SELECT Com_Name, Address, Logopath FROM tblcominfo LIMIT 1');
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

    getApproveActingAllowance: async (req, res) => {
  }
};

module.exports = managerController;
