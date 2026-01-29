const pool = require('../config/db');

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
  }
};

module.exports = managerController;
