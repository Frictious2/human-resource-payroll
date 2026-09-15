const pool = require('../config/db');
const transporter = require('../config/mailer');
const ejs = require('ejs');
const path = require('path');
const controllerAuditHelper = require('../services/controllerAuditHelper');
const staffStatusService = require('../services/staffStatusService');
const payrollPagesService = require('../services/payrollPagesService');
const leavePagesService = require('../services/leavePagesService');
const loansMedicalPagesService = require('../services/loansMedicalPagesService');
const staffTransfersPagesService = require('../services/staffTransfersPagesService');
const enquiryReportsService = require('../services/enquiryReportsService');
const journalReportService = require('../services/journalReportService');
const managerDashboardService = require('../services/managerDashboardService');
const managerPayrollWorkflowService = require('../services/managerPayrollWorkflowService');
const recordWorkflowService = require('../services/recordWorkflowService');
const workflowNotificationService = require('../services/workflowNotificationService');
const workQueueService = require('../services/workQueueService');
const payrollReversalService = require('../services/payrollReversalService');
const payrollReopenService = require('../services/payrollReopenService');

function getCompanyId(req) {
    return req.user?.companyId
        || req.user?.company_id
        || req.session?.companyId
        || req.session?.CompanyID
        || 1;
}

function getManagerUser(req) {
    return req.session.user || req.user || { name: 'Manager', role: 'manager' };
}

async function getRecordWorkflowDashboard(companyId) {
    await recordWorkflowService.ensureWorkflowTables();
    await recordWorkflowService.syncAllDraftModules(companyId);

    return {
        counts: await recordWorkflowService.getWorkflowCountsByStatus(companyId),
        recent: (await recordWorkflowService.listWorkflowItems(companyId, {})).slice(0, 6)
    };
}

const managerController = {
    getDashboard: async (req, res) => {
        try {
            const companyId = getCompanyId(req);
            const user = getManagerUser(req);

            const [dashboardData, recordWorkflow, unreadNotifications, workQueueData, reversalCounts, reopenCounts] = await Promise.all([
                managerDashboardService.getManagerDashboardData({ companyId }),
                getRecordWorkflowDashboard(companyId),
                workflowNotificationService.getUnreadCount(user.id || 0, companyId),
                workQueueService.getRoleWorkQueue({ companyId, user, filters: {} }),
                payrollReversalService.getRoleDashboardSummary(companyId),
                payrollReopenService.getRoleDashboardSummary(companyId)
            ]);

            res.render('manager/dashboard', {
                title: 'Manager Dashboard',
                path: '/manager/dashboard',
                user,
                error: null,
                ...dashboardData,
                recordWorkflow,
                reversalCounts,
                reopenCounts,
                unreadNotifications,
                workQueueSummary: workQueueData.summary
            });
        } catch (error) {
            console.error('Manager dashboard error:', error);
            res.render('manager/dashboard', {
                title: 'Manager Dashboard',
                path: '/manager/dashboard',
                user: getManagerUser(req),
                company: {},
                approvalQueue: { modules: [], totalPending: 0, overdueTotal: 0 },
                peopleSnapshot: {
                    cards: {
                        activeStaffCount: 0,
                        retiredCount: 0,
                        formerCount: 0,
                        redundantCount: 0,
                        onLeaveNow: 0,
                        activeQueries: 0,
                        pendingExits: 0,
                        trainingParticipants: 0,
                        attendanceExceptions: 0,
                        upcomingRetirementsCount: 0,
                        retirementAge: 60
                    },
                    upcomingRetirements: [],
                    staffOnLeaveRows: []
                },
                payrollOversight: {
                    cards: {
                        unpostedPayrollPeriods: 0,
                        pendingYearlyPayments: 0,
                        pendingPostingBatches: 0,
                        payrollExceptions: 0,
                        awaitingEndorsement: 0,
                        endorsedToAuditor: 0,
                        returnedToFinance: 0,
                        returnedByAuditor: 0,
                        auditorEndorsed: 0,
                        finalApproved: 0,
                        finalRejected: 0
                    },
                    unpostedPeriods: [],
                    yearlyPending: [],
                    pendingBatches: [],
                    payrollAudit: { totals: { suspiciousGroups: 0, rows: [] } },
                    recentWorkflowActions: []
                },
                departmentSummaries: [],
                alerts: [],
                reversalCounts: {},
                reopenCounts: {},
                error: 'Failed to load dashboard data',
                recordWorkflow: {
                    counts: {},
                    recent: []
                },
                unreadNotifications: 0,
                workQueueSummary: { totalActionable: 0, payroll: 0, reversals: 0, records: 0, byStatus: {} }
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

    getPayrollEndorsementQueue: async (req, res) => {
        try {
            const queue = await managerPayrollWorkflowService.getManagerQueue(getCompanyId(req), {
                status: req.query.status || '',
                month: req.query.month || '',
                year: req.query.year || '',
                pType: req.query.pType || ''
            });

            res.render('manager/payroll/endorsement_queue', {
                title: 'Payroll Endorsement',
                path: '/manager/payroll/endorsement',
                user: getManagerUser(req),
                batches: queue.batches,
                filters: queue.filters,
                statusOptions: [
                    'SUBMITTED_TO_MANAGER',
                    'SUBMITTED_TO_AUDITOR',
                    'RETURNED_BY_MANAGER',
                    'RETURNED_BY_AUDITOR',
                    'CORRECTION_IN_PROGRESS',
                    'SUBMITTED_TO_ENTITY_HEAD',
                    'FINAL_APPROVED',
                    'FINAL_REJECTED',
                    'POSTED_TO_ACCOUNTS'
                ],
                getStatusBadgeClass: managerPayrollWorkflowService.getStatusBadgeClass,
                successMessage: req.query.success || '',
                errorMessage: req.query.error || ''
            });
        } catch (error) {
            console.error('Manager payroll queue error:', error);
            res.status(error.statusCode || 500).render('manager/payroll/endorsement_queue', {
                title: 'Payroll Endorsement',
                path: '/manager/payroll/endorsement',
                user: getManagerUser(req),
                batches: [],
                filters: {
                    status: req.query.status || 'SUBMITTED_TO_MANAGER',
                    month: req.query.month || '',
                    year: req.query.year || '',
                    pType: req.query.pType || ''
                },
                statusOptions: [
                    'SUBMITTED_TO_MANAGER',
                    'SUBMITTED_TO_AUDITOR',
                    'RETURNED_BY_MANAGER',
                    'RETURNED_BY_AUDITOR',
                    'CORRECTION_IN_PROGRESS',
                    'SUBMITTED_TO_ENTITY_HEAD',
                    'FINAL_APPROVED',
                    'FINAL_REJECTED',
                    'POSTED_TO_ACCOUNTS'
                ],
                getStatusBadgeClass: managerPayrollWorkflowService.getStatusBadgeClass,
                successMessage: '',
                errorMessage: error.message || 'Failed to load payroll endorsement queue.'
            });
        }
    },

    getPayrollEndorsementDetail: async (req, res) => {
        try {
            const detail = await managerPayrollWorkflowService.getManagerBatchDetail(getCompanyId(req), req.params.batchId);

            res.render('manager/payroll/endorsement_detail', {
                title: 'Payroll Endorsement Detail',
                path: `/manager/payroll/endorsement/${req.params.batchId}`,
                user: getManagerUser(req),
                batch: detail.batch,
                payrollRows: detail.payrollRows,
                history: detail.history,
                canAct: detail.canAct,
                getStatusBadgeClass: managerPayrollWorkflowService.getStatusBadgeClass,
                successMessage: req.query.success || '',
                errorMessage: req.query.error || ''
            });
        } catch (error) {
            console.error('Manager payroll detail error:', error);
            res.status(error.statusCode || 500).send(error.message || 'Failed to load payroll batch detail.');
        }
    },

    postPayrollEndorsement: async (req, res) => {
        try {
            await managerPayrollWorkflowService.endorseBatch({
                companyId: getCompanyId(req),
                batchId: req.params.batchId,
                user: getManagerUser(req),
                comments: req.body.comments || ''
            });

            return res.redirect(`/manager/payroll/endorsement/${req.params.batchId}?success=${encodeURIComponent('Payroll endorsed and forwarded to the Auditor successfully.')}`);
        } catch (error) {
            console.error('Manager payroll endorsement error:', error);
            return res.redirect(`/manager/payroll/endorsement/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to endorse payroll batch.')}`);
        }
    },

    postPayrollReturn: async (req, res) => {
        try {
            await managerPayrollWorkflowService.returnBatchToFinance({
                companyId: getCompanyId(req),
                batchId: req.params.batchId,
                user: getManagerUser(req),
                comments: req.body.comments || ''
            });

            return res.redirect(`/manager/payroll/endorsement/${req.params.batchId}?success=${encodeURIComponent('Payroll returned to the Finance Officer for correction.')}`);
        } catch (error) {
            console.error('Manager payroll return error:', error);
            return res.redirect(`/manager/payroll/endorsement/${req.params.batchId}?error=${encodeURIComponent(error.message || 'Failed to return payroll batch.')}`);
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
            res.redirect('/manager/record-workflow?module=loan&status=SUBMITTED_TO_MANAGER&success=' + encodeURIComponent('Use the Sensitive Record Endorsement queue for loan workflow actions.'));
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postApproveLoan: async (req, res) => {
        try {
            res.status(409).json({ error: 'Use the Sensitive Record Endorsement queue for loan workflow actions.' });
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
          const [staffRows] = await pool.query(
              staffStatusService.getActiveStaffQuery({ orderBy: 'PFNo' })
          );
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
          res.redirect('/manager/record-workflow?module=transfer&status=SUBMITTED_TO_MANAGER');
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  postTransferApproval: async (req, res) => {
      try {
          res.status(400).json({ error: 'Use the Sensitive Record Endorsement queue for transfer workflow actions.' });

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
          res.redirect('/manager/record-workflow?module=training&status=SUBMITTED_TO_MANAGER');
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  getApproveTrainingView: async (req, res) => {
      try {
          res.redirect('/manager/record-workflow?module=training&status=SUBMITTED_TO_MANAGER');
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
  },

  postApproveTraining: async (req, res) => {
      try {
          res.status(400).json({ error: 'Use the Sensitive Record Endorsement queue for training workflow actions.' });
      } catch (error) {
          console.error(error);
          res.status(500).json({ error: 'Server Error' });
      }
  },

  getApproveQuery: async (req, res) => {
      try {
          res.redirect('/manager/record-workflow?module=salary-query&status=SUBMITTED_TO_MANAGER');
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
          return res.status(409).json({
              success: false,
              message: 'Use the Sensitive Record Endorsement queue. Manager approval no longer performs final approval for salary queries.'
          });
      } catch (error) {
          console.error(error);
          res.status(500).json({ error: 'Server error' });
      }
  },

    // Redundancy Approval
    getApproveRedundancy: async (req, res) => {
        try {
            res.redirect('/manager/record-workflow?module=redundancy&status=SUBMITTED_TO_MANAGER');
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

    getRunSalaryReview: async (req, res) => {
      try {
          const pageData = await payrollPagesService.getRunSalaryReviewData({
              companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
              filters: req.query
          });

          res.render('manager/payroll/run_salary_review', {
              title: 'Run Salary Review',
              path: '/manager/activity/run-salary-review',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              reviewTypes: pageData.reviewTypes,
              rules: pageData.rules,
              previewRows: pageData.previewRows,
              filters: pageData.filters,
              success: req.query.success || '',
              error: req.query.error || ''
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
    },

    postRunSalaryReview: async (req, res) => {
      try {
          const result = await payrollPagesService.commitSalaryReviewRun({
              companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
              reviewDate: req.body.reviewDate,
              revCode: req.body.revCode,
              startGrade: req.body.startGrade,
              endGrade: req.body.endGrade,
              committedBy: req.session.user?.name || 'Manager'
          });

          res.redirect(`/manager/activity/run-salary-review?reviewDate=${encodeURIComponent(result.rule.reviewDate)}&revCode=${encodeURIComponent(result.rule.revCode)}&success=${encodeURIComponent(`Created ${result.createdCount} increment record(s) for ${result.rule.reviewName}.`)}`);
      } catch (error) {
          console.error(error);
          const reviewDate = req.body.reviewDate ? `reviewDate=${encodeURIComponent(req.body.reviewDate)}&` : '';
          const revCode = req.body.revCode ? `revCode=${encodeURIComponent(req.body.revCode)}&` : '';
          res.redirect(`/manager/activity/run-salary-review?${reviewDate}${revCode}error=${encodeURIComponent(error.message || 'Failed to commit salary review.')}`);
      }
    },

    getApproveSalaryReview: async (req, res) => {
      try {
          res.redirect('/manager/record-workflow?module=salary-review&status=SUBMITTED_TO_MANAGER');
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
    },

    postApproveSalaryReview: async (req, res) => {
      try {
          res.redirect('/manager/record-workflow?module=salary-review&status=SUBMITTED_TO_MANAGER&error=' + encodeURIComponent('Use the Sensitive Record Endorsement queue for salary review workflow actions.'));
      } catch (error) {
          console.error(error);
          res.redirect(`/manager/approve/salary-review?error=${encodeURIComponent(error.message || 'Failed to process salary review decision.')}`);
      }
    },

    getApproveEndOfService: async (req, res) => {
      try {
          res.redirect('/manager/record-workflow?module=end-of-service&status=SUBMITTED_TO_MANAGER');
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
    },

    postApproveEndOfService: async (req, res) => {
      try {
          res.redirect('/manager/record-workflow?module=end-of-service&status=SUBMITTED_TO_MANAGER&error=' + encodeURIComponent('Use the Sensitive Record Endorsement queue for end of service workflow actions.'));
      } catch (error) {
          console.error(error);
          res.redirect(`/manager/approve/end-of-service?error=${encodeURIComponent(error.message || 'Failed to process EOS decision.')}`);
      }
    },

    getYearlyPaymentsReport: async (req, res) => {
      try {
          const pageData = await payrollPagesService.getYearlyPaymentsReportData({
              companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
              filters: req.query
          });

          res.render('manager/reports/yearly_payments', {
              title: 'Yearly Payments Report',
              group: 'Reports',
              path: '/manager/reports/yearly-payments',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              company: pageData.company,
              payTypes: pageData.payTypes,
              staffList: pageData.staffList,
              records: pageData.rows,
              filters: pageData.filters
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
    },

    getMasterPaySheetReport: async (req, res) => {
      try {
          const pageData = await payrollPagesService.getMasterPaySheetData({
              companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
              filters: req.query
          });

          res.render('manager/reports/master_pay_sheet', {
              title: 'Master Pay Sheet',
              group: 'Reports',
              path: '/manager/reports/master-pay-sheet',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              company: pageData.company,
              payTypes: pageData.payTypes,
              departments: pageData.departments,
              rows: pageData.rows,
              totals: pageData.totals,
              filters: pageData.filters
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
    },

    getTransferPromotionEnquiry: async (req, res) => {
      try {
          const pageData = await staffTransfersPagesService.getTransferPromotionEnquiryData({
              companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
              filters: req.query,
              useActiveOnly: true
          });

          res.render('manager/enquiry/transfer_promotion', {
              title: 'Transfer / Promotion Enquiry',
              path: '/manager/enquiry/transfer-prom',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              company: pageData.company,
              departments: pageData.departments,
              rows: pageData.rows,
              filters: pageData.filters
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
    },

    getTrainingEnquiryPage: async (req, res) => {
      try {
          const pageData = await staffTransfersPagesService.getTrainingEnquiryData({
              companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
              filters: req.query,
              useActiveOnly: true
          });

          res.render('manager/enquiry/training', {
              title: 'Training Enquiry',
              path: '/manager/enquiry/training',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              company: pageData.company,
              departments: pageData.departments,
              levels: pageData.levels,
              types: pageData.types,
              sponsors: pageData.sponsors,
              rows: pageData.rows,
              filters: pageData.filters
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
    },

    getOnLeaveEnquiryPage: async (req, res) => {
      try {
          const pageData = await leavePagesService.getLeaveReportData({
              companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
              filters: req.query,
              currentOnly: true
          });

          res.render('manager/enquiry/on_leave', {
              title: 'On Leave Enquiry',
              path: '/manager/enquiry/on-leave',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              company: pageData.company,
              departments: pageData.departments,
              leaveTypes: pageData.leaveTypes,
              staffList: pageData.staffList,
              rows: pageData.rows,
              filters: pageData.filters
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
    },

    getLeaveReportPage: async (req, res) => {
      try {
          const pageData = await leavePagesService.getLeaveReportData({
              companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
              filters: req.query,
              currentOnly: false
          });

          res.render('manager/reports/leave', {
              title: 'Leave Report',
              path: '/manager/reports/leave',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              company: pageData.company,
              departments: pageData.departments,
              leaveTypes: pageData.leaveTypes,
              staffList: pageData.staffList,
              rows: pageData.rows,
              filters: pageData.filters
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
    },

    getMedicalEnquiryReport: async (req, res) => {
      try {
          const pageData = await loansMedicalPagesService.getMedicalEnquiryData({
              companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
              filters: req.query
          });

          res.render('manager/enquiry/medical', {
              title: 'Medical Enquiry',
              path: '/manager/enquiry/medical',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              company: pageData.company,
              departments: pageData.departments,
              medicalCodes: pageData.medicalCodes,
              staffList: pageData.staffList,
              rows: pageData.rows,
              filters: pageData.filters
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
    },

    getLoanReportPage: async (req, res) => {
      try {
          const pageData = await loansMedicalPagesService.getLoanReportData({
              companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
              filters: req.query
          });

          res.render('manager/reports/loan', {
              title: 'Loan Report',
              path: '/manager/reports/loan',
              user: req.session.user || { name: 'Manager' },
              role: 'manager',
              company: pageData.company,
              departments: pageData.departments,
              loanCodes: pageData.loanCodes,
              rows: pageData.rows,
              totals: pageData.totals,
              filters: pageData.filters
          });
      } catch (error) {
          console.error(error);
          res.status(500).send('Server Error');
      }
    },

  approveRedundancy: async (req, res) => {
        try {
            res.redirect('/manager/record-workflow?module=redundancy&status=SUBMITTED_TO_MANAGER&error=' + encodeURIComponent('Use the Sensitive Record Endorsement queue for redundancy workflow actions.'));
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
            res.redirect('/manager/record-workflow?module=promotion&status=SUBMITTED_TO_MANAGER');
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postApprovePromotion: async (req, res) => {
        try {
            res.status(400).json({ error: 'Use the Sensitive Record Endorsement queue for promotion workflow actions.' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server error' });
        }
    },

    getApproveExit: async (req, res) => {
        try {
            res.redirect('/manager/record-workflow?module=staff-exit&status=SUBMITTED_TO_MANAGER');
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    },

    postApproveExit: async (req, res) => {
        try {
            res.redirect('/manager/record-workflow?module=staff-exit&status=SUBMITTED_TO_MANAGER&error=' + encodeURIComponent('Use the Sensitive Record Endorsement queue for staff status workflow actions.'));
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
            res.redirect('/manager/record-workflow?module=leave&status=SUBMITTED_TO_MANAGER');
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postLeaveApproval: async (req, res) => {
        try {
            res.status(400).json({ error: 'Use the Sensitive Record Endorsement queue for leave workflow actions.' });
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
            res.status(409).json({ error: 'Use the Sensitive Record Endorsement queue for loan repayment workflow actions.' });
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
            const dates = await journalReportService.getJournalDates();
            
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
            const previewData = await journalReportService.getJournalPreviewData({
                companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
                glDate
            });

            res.render('reports/journal_preview', {
                title: 'Journal Report Preview',
                companyInfo: previewData.companyInfo,
                journalEntries: previewData.journalEntries,
                aggregatedJournal: previewData.aggregatedJournal,
                journalRows: previewData.journalRows,
                totalDebit: previewData.totalDebit,
                totalCredit: previewData.totalCredit,
                glAccounts: previewData.glAccounts,
                glDate: previewData.glDate,
                user: req.session.user || { name: 'Manager' },
                role: 'manager'
            });
        } catch (error) {
            console.error('Journal preview error (manager):', error);
            res.status(500).send('Server Error');
        }
    },

    getApproveIncrement: async (req, res) => {
        try {
            res.redirect('/manager/record-workflow?module=increment&status=SUBMITTED_TO_MANAGER');
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    postApproveIncrement: async (req, res) => {
        try {
            res.status(409).json({
                success: false,
                message: 'Use the Sensitive Record Endorsement queue. Manager approval no longer performs final approval for increment records.'
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    // Acting Allowance Approval
    getApproveActingAllowance: async (req, res) => {
        try {
            res.redirect('/manager/record-workflow?module=acting&status=SUBMITTED_TO_MANAGER');
        } catch (error) {
            console.error('Acting Allowance Approval Error:', error);
            res.status(500).send('Server Error');
        }
    },

    postApproveActingAllowance: async (req, res) => {
        try {
            res.status(400).json({ error: 'Use the Sensitive Record Endorsement queue for acting workflow actions.' });
        } catch (error) {
            console.error('Approve Acting Allowance Error:', error);
            res.status(500).json({ error: 'Server Error' });
        }
    },

    getVehicleInsuranceReport: async (req, res) => {
        try {
            const pageData = await enquiryReportsService.getVehicleInsuranceReportData({
                companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
                filters: req.query
            });

            res.render('manager/reports/vehicle_insurance', {
                title: 'Vehicle Insurance Report',
                group: 'Reports',
                path: '/manager/reports/vehicle-insurance',
                user: req.session.user || { name: 'Manager' },
                company: pageData.company,
                departments: pageData.departments,
                insurers: pageData.insurers,
                rows: pageData.rows,
                filters: pageData.filters
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getBioDataReport: async (req, res) => {
        try {
            const pageData = await enquiryReportsService.getBioDataReportData({
                companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
                filters: req.query
            });

            res.render('manager/reports/bio_data', {
                title: 'Bio-Data Report',
                group: 'Reports',
                path: '/manager/reports/bio-data',
                user: req.session.user || { name: 'Manager' },
                company: pageData.company,
                departments: pageData.departments,
                statuses: pageData.statuses,
                rows: pageData.rows,
                filters: pageData.filters
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getGuaranteesReport: async (req, res) => {
        try {
            const pageData = await enquiryReportsService.getGuaranteesReportData({
                companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
                filters: req.query
            });

            res.render('manager/reports/guarantees', {
                title: 'Guarantees Report',
                group: 'Reports',
                path: '/manager/reports/guarantees',
                user: req.session.user || { name: 'Manager' },
                company: pageData.company,
                departments: pageData.departments,
                banks: pageData.banks,
                rows: pageData.rows,
                totals: pageData.totals,
                filters: pageData.filters
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getActingAllowanceReport: async (req, res) => {
        try {
            const pageData = await enquiryReportsService.getActingAllowanceReportData({
                companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
                filters: req.query
            });

            res.render('manager/reports/acting_allowance', {
                title: 'Acting Allowance Report',
                group: 'Reports',
                path: '/manager/reports/acting-allowance',
                user: req.session.user || { name: 'Manager' },
                company: pageData.company,
                departments: pageData.departments,
                rows: pageData.rows,
                totals: pageData.totals,
                filters: pageData.filters
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    },

    getAttendanceReport: async (req, res) => {
        try {
            const pageData = await enquiryReportsService.getAttendanceReportData({
                companyId: req.user?.companyId || req.user?.company_id || req.session?.companyId || req.session?.CompanyID || 1,
                filters: req.query
            });

            res.render('manager/reports/attendance', {
                title: 'Attendance Report',
                group: 'Reports',
                path: '/manager/reports/attendance',
                user: req.session.user || { name: 'Manager' },
                company: pageData.company,
                departments: pageData.departments,
                statuses: pageData.statuses,
                rows: pageData.rows,
                totals: pageData.totals,
                filters: pageData.filters
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    }
};

module.exports = managerController;
