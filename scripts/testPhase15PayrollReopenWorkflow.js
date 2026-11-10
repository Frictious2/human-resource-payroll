require('./requireDisposableDatabase')();
const pool = require('../config/db');
const ProcessEmolumentsService = require('../services/processEmolumentsService');
const payrollWorkflowService = require('../services/payrollWorkflowService');
const managerPayrollWorkflowService = require('../services/managerPayrollWorkflowService');
const auditorPayrollWorkflowService = require('../services/auditorPayrollWorkflowService');
const entityHeadPayrollWorkflowService = require('../services/entityHeadPayrollWorkflowService');
const payrollGlPostingService = require('../services/payrollGlPostingService');
const payrollReversalService = require('../services/payrollReversalService');
const payrollReopenService = require('../services/payrollReopenService');
const workflowNotificationService = require('../services/workflowNotificationService');
const workQueueService = require('../services/workQueueService');

const TEST_COMPANY_ID = 2;
const TEST_MONTH = 11;
const TEST_YEAR = 2098;
const TEST_ACTIVITY = '01';
const TEST_PAYROLL_DATE = '2098-11-28';
const TEST_POSTING_DATE = new Date('2098-11-28T00:00:00Z');
const TEST_PASSWORD = 'Phase15A!Test';
const TEST_PASSWORD_HASH = '$2b$10$U1I9eQ4wP4nTgC2BkjP7u.OAzeh3Q3xYH9s8c2s6f2v0UGM8Q1V7e';
const TEST_USER_PREFIX = 'phase15a_';
const TEST_STAFF = [
    {
        pfno: '9301',
        staffName: 'Phase15A Staff One',
        deptCode: '01',
        gradeCode: '0800',
        jobTitleCode: '0802',
        level: '08',
        empType: '01',
        payCurrency: 'SLe',
        accountNo: '930100000000000001',
        salary: {
            basicSalary: 5000,
            allw02: 200,
            totalIncome: 5200,
            taxable: 5000,
            tax: 1000,
            nassitEmp: 250,
            nassitInst: 500,
            netIncome: 3950
        }
    },
    {
        pfno: '9302',
        staffName: 'Phase15A Staff Two',
        deptCode: '03',
        gradeCode: '0400',
        jobTitleCode: '0401',
        level: '04',
        empType: '02',
        payCurrency: 'SLe',
        accountNo: '930200000000000002',
        salary: {
            basicSalary: 7200,
            allw02: 350,
            allw03: 150,
            totalIncome: 7700,
            taxable: 7550,
            tax: 1700,
            nassitEmp: 360,
            nassitInst: 720,
            netIncome: 5640
        }
    }
];
const TEST_USERS = [
    { pfno: 99261, username: `${TEST_USER_PREFIX}finance`, fullName: 'Phase 15A Finance Officer', level: 'Finance Officer', role: 'finance-officer' },
    { pfno: 99262, username: `${TEST_USER_PREFIX}manager`, fullName: 'Phase 15A Manager', level: 'Manager', role: 'manager' },
    { pfno: 99263, username: `${TEST_USER_PREFIX}auditor`, fullName: 'Phase 15A Auditor', level: 'Auditor', role: 'auditor' },
    { pfno: 99264, username: `${TEST_USER_PREFIX}entity`, fullName: 'Phase 15A Entity Head', level: 'Entity Head', role: 'entity-head' }
];

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function buildUser(user) {
    return {
        id: user.pfno,
        PFNo: user.pfno,
        role: user.role,
        level: user.level,
        name: user.fullName,
        fullName: user.fullName,
        username: user.username,
        CompanyID: TEST_COMPANY_ID,
        companyId: TEST_COMPANY_ID,
        source: 'tblpassword'
    };
}

function normalizeDate(value) {
    if (!value) {
        return null;
    }
    return new Date(value).toISOString();
}

async function querySingle(connection, sql, params = []) {
    const [rows] = await connection.query(sql, params);
    return rows[0] || null;
}

async function ensureIndexes() {
    const [workflowIndexes] = await pool.query('SHOW INDEX FROM payroll_workflow_batches');
    const [glIndexes] = await pool.query('SHOW INDEX FROM payroll_gl_posting_batches');

    const workflowKeys = new Map();
    workflowIndexes.forEach((row) => {
        if (!workflowKeys.has(row.Key_name)) {
            workflowKeys.set(row.Key_name, []);
        }
        workflowKeys.get(row.Key_name).push(row.Column_name);
    });

    const glKeys = new Map();
    glIndexes.forEach((row) => {
        if (!glKeys.has(row.Key_name)) {
            glKeys.set(row.Key_name, []);
        }
        glKeys.get(row.Key_name).push(row.Column_name);
    });

    assert(!workflowKeys.has('uq_payroll_workflow_batch'), 'Legacy payroll_workflow_batches unique key is still active.');
    assert(!glKeys.has('uq_payroll_gl_posting_batches_company_activity_period'), 'Legacy payroll_gl_posting_batches unique key is still active.');
    assert((workflowKeys.get('uq_company_period_ptype_generation') || []).join(',') === 'CompanyID,PMonth,PYear,PType,GenerationNo', 'Generation-aware workflow key is missing or incorrect.');
    assert((glKeys.get('uq_company_activity_period_generation') || []).join(',') === 'company_id,activity_code,posting_month,posting_year,generation_no', 'Generation-aware GL key is missing or incorrect.');
}

async function cleanupTestData() {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        await connection.query(
            `DELETE FROM workflow_notifications
             WHERE CompanyID = ?
               AND (
                    RecipientUserID IN (${TEST_USERS.map(() => '?').join(', ')})
                    OR CreatedBy IN (${TEST_USERS.map(() => '?').join(', ')})
                    OR ActionURL LIKE ?
               )`,
            [
                TEST_COMPANY_ID,
                ...TEST_USERS.map((user) => user.pfno),
                ...TEST_USERS.map((user) => user.pfno),
                `%${TEST_ACTIVITY}%`
            ]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM payroll_reopen_actions
             WHERE ReopenRequestID IN (
                SELECT id FROM payroll_reopen_requests
                WHERE CompanyID = ?
                  AND PMonth = ?
                  AND PYear = ?
                  AND PType = ?
             )`,
            [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM payroll_reopen_requests
             WHERE CompanyID = ?
               AND PMonth = ?
               AND PYear = ?
               AND PType = ?`,
            [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM payroll_reversal_actions
             WHERE ReversalRequestID IN (
                SELECT id FROM payroll_reversal_requests
                WHERE CompanyID = ?
                  AND PMonth = ?
                  AND PYear = ?
                  AND PType = ?
             )`,
            [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM payroll_reversal_requests
             WHERE CompanyID = ?
               AND PMonth = ?
               AND PYear = ?
               AND PType = ?`,
            [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM payroll_workflow_actions
             WHERE CompanyID = ?
               AND PMonth = ?
               AND PYear = ?
               AND PType = ?`,
            [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM payroll_reversed_row_archive
             WHERE CompanyID = ?
               AND PMonth = ?
               AND PYear = ?
               AND PType = ?`,
            [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
        ).catch(() => {});

        await connection.query(
            `DELETE rl
             FROM payroll_gl_reversal_lines rl
             INNER JOIN payroll_gl_reversal_batches rb
                ON rb.id = rl.ReversalBatchID
             WHERE rb.CompanyID = ?
               AND rb.PMonth = ?
               AND rb.PYear = ?
               AND rb.PType = ?`,
            [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM payroll_gl_reversal_batches
             WHERE CompanyID = ?
               AND PMonth = ?
               AND PYear = ?
               AND PType = ?`,
            [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM payroll_gl_posting_lines
             WHERE posting_batch_id IN (
                SELECT id FROM payroll_gl_posting_batches
                WHERE company_id = ?
                  AND posting_month = ?
                  AND posting_year = ?
                  AND activity_code = ?
             )`,
            [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM payroll_gl_posting_batches
             WHERE company_id = ?
               AND posting_month = ?
               AND posting_year = ?
               AND activity_code = ?`,
            [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblexport
             WHERE CompanyID = ?
               AND TCode = ?
               AND YEAR(EntryDate) = ?
               AND MONTH(EntryDate) = ?`,
            [TEST_COMPANY_ID, TEST_ACTIVITY, TEST_YEAR, TEST_MONTH]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblpayroll
             WHERE CompanyID = ?
               AND PMonth = ?
               AND PYear = ?
               AND PType = ?`,
            [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM payroll_workflow_batches
             WHERE CompanyID = ?
               AND PMonth = ?
               AND PYear = ?
               AND PType = ?`,
            [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblloanrepyt
             WHERE CompanyID = ?
               AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
            [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblloan
             WHERE CompanyID = ?
               AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
            [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblmedical
             WHERE CompanyID = ?
               AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
            [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblsurcharge
             WHERE CompanyID = ?
               AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
            [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblincrement
             WHERE CompanyID = ?
               AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
            [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblacting
             WHERE CompanyID = ?
               AND PFNO IN (${TEST_STAFF.map(() => '?').join(', ')})`,
            [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblyearlypayments
             WHERE CompanyID = ?
               AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
            [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblleaveallowance
             WHERE PMonth = ?
               AND PYear = ?
               AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
            [TEST_MONTH, TEST_YEAR, ...TEST_STAFF.map((staff) => staff.pfno)]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblentitle
             WHERE CompanyID = ?
               AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
            [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblsalary
             WHERE CompanyID = ?
               AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
            [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblstaff
             WHERE CompanyID = ?
               AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
            [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM gl_account_mappings
             WHERE company_id = ?`,
            [TEST_COMPANY_ID]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblcominfo
             WHERE CompanyID = ?`,
            [TEST_COMPANY_ID]
        ).catch(() => {});

        await connection.query(
            `DELETE FROM tblpassword
             WHERE CompanyID = ?
               AND Username LIKE ?`,
            [TEST_COMPANY_ID, `${TEST_USER_PREFIX}%`]
        ).catch(() => {});

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function ensureSandboxSeed() {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const sourceComInfo = await querySingle(connection, 'SELECT * FROM tblcominfo WHERE CompanyID = 1 LIMIT 1');
        assert(sourceComInfo, 'Company 1 setup is required to seed the Phase 15A sandbox.');

        await connection.query(
            `INSERT INTO tblcominfo
                (CompanyID, Com_Name, TinNo, Address, Town, City, Country, AccNo, Phone, Bank, PayingBank, Logopath, Email, Manager, DateCreated, SubscriptionType, SubscriptionPlanType, NoOfStaffLeft, StaffCapacity)
             VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                Com_Name = VALUES(Com_Name),
                TinNo = VALUES(TinNo),
                Address = VALUES(Address),
                Town = VALUES(Town),
                City = VALUES(City),
                Country = VALUES(Country),
                AccNo = VALUES(AccNo),
                Phone = VALUES(Phone),
                Bank = VALUES(Bank),
                PayingBank = VALUES(PayingBank),
                Logopath = VALUES(Logopath),
                Email = VALUES(Email),
                Manager = VALUES(Manager)`,
            [
                TEST_COMPANY_ID,
                'Phase 15A Sandbox Company',
                sourceComInfo.TinNo,
                sourceComInfo.Address,
                sourceComInfo.Town,
                sourceComInfo.City,
                sourceComInfo.Country,
                '003002000000000015',
                sourceComInfo.Phone,
                sourceComInfo.Bank,
                sourceComInfo.PayingBank,
                sourceComInfo.Logopath,
                '',
                'Phase 15A Test Manager',
                sourceComInfo.DateCreated,
                sourceComInfo.SubscriptionType,
                sourceComInfo.SubscriptionPlanType,
                sourceComInfo.NoOfStaffLeft,
                sourceComInfo.StaffCapacity
            ]
        );

        await connection.query('DELETE FROM gl_account_mappings WHERE company_id = ?', [TEST_COMPANY_ID]);
        await connection.query(
            `INSERT INTO gl_account_mappings
                (company_id, activity_code, pay_component_code, gl_account_code, gl_account_name, entry_type, is_active, created_at, updated_at)
             SELECT ?, activity_code, pay_component_code, gl_account_code, gl_account_name, entry_type, is_active, NOW(), NOW()
             FROM gl_account_mappings
             WHERE company_id = 1
               AND activity_code = ?`,
            [TEST_COMPANY_ID, TEST_ACTIVITY]
        );

        for (const user of TEST_USERS) {
            await connection.query(
                `INSERT INTO tblpassword (PFNo, DateCreated, Level, Username, FullName, Pword, Email, CompanyID)
                 VALUES (?, NOW(), ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    Level = VALUES(Level),
                    Username = VALUES(Username),
                    FullName = VALUES(FullName),
                    Pword = VALUES(Pword),
                    Email = VALUES(Email),
                    CompanyID = VALUES(CompanyID)`,
                [user.pfno, user.level, user.username, user.fullName, TEST_PASSWORD_HASH, '', TEST_COMPANY_ID]
            );
        }

        for (const staff of TEST_STAFF) {
            const now = new Date('2026-07-16T10:00:00Z');
            await connection.query(
                `INSERT INTO tblstaff
                    (InstID, PFNo, SName, DOE, SexCode, EmpType, PayCurrency, GradeCode, CGrade, JobTitle, Level, DEmp, CDept, CDeptDate, EmpStatus, AccountNo, NASSITR, UnionMember, HOD, Vehicle, Redundant, Linked, Letter, KeyedIn, KeyedInBy, Approved, ApprovedBy, DateApproved, TimeApproved, CompanyID)
                 VALUES
                    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, NOW(), NOW(), ?)
                 ON DUPLICATE KEY UPDATE
                    SName = VALUES(SName),
                    DOE = VALUES(DOE),
                    EmpType = VALUES(EmpType),
                    PayCurrency = VALUES(PayCurrency),
                    GradeCode = VALUES(GradeCode),
                    CGrade = VALUES(CGrade),
                    JobTitle = VALUES(JobTitle),
                    Level = VALUES(Level),
                    DEmp = VALUES(DEmp),
                    CDept = VALUES(CDept),
                    CDeptDate = VALUES(CDeptDate),
                    EmpStatus = VALUES(EmpStatus),
                    AccountNo = VALUES(AccountNo),
                    NASSITR = VALUES(NASSITR),
                    Approved = VALUES(Approved),
                    ApprovedBy = VALUES(ApprovedBy),
                    CompanyID = VALUES(CompanyID)`,
                [
                    '0001',
                    staff.pfno,
                    staff.staffName,
                    '2020-01-01 00:00:00',
                    'M',
                    staff.empType,
                    staff.payCurrency,
                    staff.gradeCode,
                    staff.gradeCode,
                    staff.jobTitleCode,
                    staff.level,
                    staff.deptCode,
                    staff.deptCode,
                    '2020-01-01 00:00:00',
                    '01',
                    staff.accountNo,
                    1,
                    '0',
                    '0',
                    '0',
                    0,
                    0,
                    0,
                    'Phase15A Seeder',
                    1,
                    'Phase15A Seeder',
                    TEST_COMPANY_ID
                ]
            );

            const salary = staff.salary;
            const allw03 = salary.allw03 || 0;
            await connection.query('REPLACE INTO tblsalary SET ?', {
                PDate: '2098-10-31 00:00:00',
                PFNo: staff.pfno,
                Dept: staff.deptCode,
                Grade: staff.gradeCode,
                JobTitle: staff.jobTitleCode,
                PayThrough: '02',
                Bank: '03',
                Branch: '01',
                AccountNo: staff.accountNo,
                Level: staff.level,
                EmpType: staff.empType,
                PayCurrency: staff.payCurrency,
                ExchRate: '1',
                Annual: salary.basicSalary * 12,
                Salary: salary.basicSalary,
                Allw02: salary.allw02 || 0,
                Allw03: allw03,
                Allw04: 0,
                Allw05: 0,
                Allw06: 0,
                Allw07: 0,
                Allw08: 0,
                Allw09: 0,
                Allw10: 0,
                Allw11: 0,
                Allw12: 0,
                Allw13: 0,
                SDate: null,
                EDate: null,
                Allw14: 0,
                Allw15: 0,
                Allw16: 0,
                Allw17: 0,
                Allw18: 0,
                Allw19: 0,
                Allw20: 0,
                TotAllw: (salary.allw02 || 0) + allw03,
                TotalIncome: salary.totalIncome,
                Taxable: salary.taxable,
                Tax: salary.tax,
                NassitEmp: salary.nassitEmp,
                NassitInst: salary.nassitInst,
                GratEmp: 0,
                GratInst: 0,
                NetIncome: salary.netIncome,
                LoanCounter: 0,
                LoanRescheduled: '0',
                Ded1: 0,
                UnionDues: 0,
                Ded3: 0,
                Ded4: 0,
                Ded5: 0,
                MReaction: null,
                PayingBank: '03',
                PayingBBAN: `003002${staff.pfno}000000`,
                PType: TEST_ACTIVITY,
                SurchargeDate: null,
                TotalDeduction: salary.tax + salary.nassitEmp,
                Paid: 0,
                FullPay: 1,
                HalfPay: 0,
                Days: 30,
                WithoutPay: 0,
                Linked: 0,
                LinkedID: null,
                Operator: 'Phase15A Seeder',
                DateKeyed: now,
                TimeKeyed: now,
                Approved: 1,
                ApprovedBy: 'Phase15A Seeder',
                DateApproved: now,
                TimeApproved: now,
                Posted: 0,
                Letter: '0',
                CompanyID: TEST_COMPANY_ID
            });

            await connection.query(
                `INSERT INTO tblentitle
                    (PFNo, Salary, Allw02, Allw03, Allw04, Allw05, Allw06, Allw07, Allw08, Allw09, Allw10, Allw11, Allw12, Allw13, Allw14, Allw15, Allw16, Allw17, Allw18, Allw19, Allw20,
                     KeyedIn, Operator, TimeKeyed, ApprovedBy, Approved, DateApproved, TimeApproved, PayThrough, Bank, PayingBBAN, AccountNo, PayingBank, CompanyID)
                 VALUES
                    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     NOW(), ?, NOW(), ?, ?, NOW(), NOW(), ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    Salary = VALUES(Salary),
                    Allw02 = VALUES(Allw02),
                    Allw03 = VALUES(Allw03),
                    Approved = VALUES(Approved),
                    ApprovedBy = VALUES(ApprovedBy),
                    PayThrough = VALUES(PayThrough),
                    Bank = VALUES(Bank),
                    PayingBBAN = VALUES(PayingBBAN),
                    AccountNo = VALUES(AccountNo),
                    PayingBank = VALUES(PayingBank),
                    CompanyID = VALUES(CompanyID)`,
                [
                    staff.pfno,
                    1,
                    salary.allw02 ? 1 : 0,
                    salary.allw03 ? 1 : 0,
                    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    'Phase15A Seeder',
                    'Phase15A Seeder',
                    1,
                    '02',
                    '03',
                    `003002${staff.pfno}000000`,
                    staff.accountNo,
                    '03',
                    TEST_COMPANY_ID
                ]
            );
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function getWorkflowBatchByGeneration(generationNo) {
    return payrollWorkflowService.getWorkflowBatchByGeneration(
        TEST_COMPANY_ID,
        TEST_MONTH,
        TEST_YEAR,
        TEST_ACTIVITY,
        generationNo
    );
}

async function getWorkflowGenerations() {
    return payrollWorkflowService.listWorkflowBatchGenerations(
        TEST_COMPANY_ID,
        TEST_MONTH,
        TEST_YEAR,
        TEST_ACTIVITY
    );
}

async function getGenerationPayrollSummary(generationNo, batchId = null) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS rowCount,
                COALESCE(SUM(TotalIncome), 0) AS totalGross,
                COALESCE(SUM(Tax), 0) AS totalTax,
                COALESCE(SUM(COALESCE(NassitEmp, 0) + COALESCE(UnionDues, 0) + COALESCE(GratEmp, 0) + COALESCE(Ded1, 0) + COALESCE(Ded2, 0) + COALESCE(Ded3, 0) + COALESCE(Ded4, 0) + COALESCE(Ded5, 0) + COALESCE(Ded6, 0) + COALESCE(Ded7, 0)), 0) AS totalDeductions,
                COALESCE(SUM(NetIncome), 0) AS totalNet
         FROM tblpayroll
         WHERE CompanyID = ?
           AND PMonth = ?
           AND PYear = ?
           AND PType = ?`,
        [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY]
    );

    const batchDetail = batchId
        ? await payrollWorkflowService.getWorkflowBatchDetail(TEST_COMPANY_ID, batchId)
        : await getWorkflowBatchByGeneration(generationNo);
    const batch = batchDetail?.batch || batchDetail;

    return {
        generationNo,
        batchId: batch?.id || batchId || null,
        status: batch?.Status || null,
        rowCount: Number(rows[0]?.rowCount || 0),
        totalGross: Number(rows[0]?.totalGross || 0),
        totalTax: Number(rows[0]?.totalTax || 0),
        totalDeductions: Number(rows[0]?.totalDeductions || 0),
        totalNet: Number(rows[0]?.totalNet || 0),
        checksum: batch?.PayrollChecksum || null
    };
}

async function getArchiveSummary(originalWorkflowBatchId) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS rowCount
         FROM payroll_reversed_row_archive
         WHERE OriginalWorkflowBatchID = ?`,
        [originalWorkflowBatchId]
    );
    return {
        rowCount: Number(rows[0]?.rowCount || 0)
    };
}

async function getPostingBatch(generationNo) {
    return querySingle(
        pool,
        `SELECT *
         FROM payroll_gl_posting_batches
         WHERE company_id = ?
           AND posting_month = ?
           AND posting_year = ?
           AND activity_code = ?
           AND generation_no = ?
         LIMIT 1`,
        [TEST_COMPANY_ID, TEST_MONTH, TEST_YEAR, TEST_ACTIVITY, generationNo]
    );
}

async function getReversalBatch(requestId) {
    return querySingle(
        pool,
        `SELECT *
         FROM payroll_gl_reversal_batches
         WHERE ReversalRequestID = ?
         LIMIT 1`,
        [requestId]
    );
}

async function getReversalLineTotals(reversalBatchId) {
    const [rows] = await pool.query(
        `SELECT
            COALESCE(SUM(COALESCE(DebitAmount, 0)), 0) AS debitTotal,
            COALESCE(SUM(COALESCE(CreditAmount, 0)), 0) AS creditTotal,
            COUNT(*) AS lineCount
         FROM payroll_gl_reversal_lines
         WHERE ReversalBatchID = ?`,
        [reversalBatchId]
    );
    return {
        debitTotal: Number(rows[0]?.debitTotal || 0),
        creditTotal: Number(rows[0]?.creditTotal || 0),
        lineCount: Number(rows[0]?.lineCount || 0)
    };
}

async function getNotificationSnapshot(users) {
    const notifications = {};
    for (const user of users) {
        const actor = buildUser(user);
        notifications[user.role] = await workflowNotificationService.getNotificationSummary(actor, TEST_COMPANY_ID);
    }
    return notifications;
}

async function getQueueSnapshot(users) {
    const queues = {};
    for (const user of users) {
        const actor = buildUser(user);
        const queue = await workQueueService.getRoleWorkQueue({
            companyId: TEST_COMPANY_ID,
            user: actor
        });
        queues[user.role] = {
            total: Number(queue?.summary?.totalActionable || 0),
            firstItem: queue?.rows?.[0] || null
        };
    }
    return queues;
}

async function captureSideEffectState() {
    const [loanRepay] = await pool.query(
        `SELECT COUNT(*) AS total FROM tblloanrepyt WHERE CompanyID = ? AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
        [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
    );
    const [loans] = await pool.query(
        `SELECT COUNT(*) AS total FROM tblloan WHERE CompanyID = ? AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
        [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
    );
    const [medical] = await pool.query(
        `SELECT COUNT(*) AS total FROM tblmedical WHERE CompanyID = ? AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
        [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
    );
    const [surcharge] = await pool.query(
        `SELECT COUNT(*) AS total FROM tblsurcharge WHERE CompanyID = ? AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
        [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
    );
    const [increments] = await pool.query(
        `SELECT COUNT(*) AS total FROM tblincrement WHERE CompanyID = ? AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
        [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
    );
    const [leaveAllowance] = await pool.query(
        `SELECT COUNT(*) AS total FROM tblleaveallowance WHERE PMonth = ? AND PYear = ? AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
        [TEST_MONTH, TEST_YEAR, ...TEST_STAFF.map((staff) => staff.pfno)]
    );
    const [acting] = await pool.query(
        `SELECT COUNT(*) AS total FROM tblacting WHERE CompanyID = ? AND PFNO IN (${TEST_STAFF.map(() => '?').join(', ')})`,
        [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
    );
    const [yearly] = await pool.query(
        `SELECT COUNT(*) AS total FROM tblyearlypayments WHERE CompanyID = ? AND PFNo IN (${TEST_STAFF.map(() => '?').join(', ')})`,
        [TEST_COMPANY_ID, ...TEST_STAFF.map((staff) => staff.pfno)]
    );

    return {
        loanRepaymentRows: Number(loanRepay[0]?.total || 0),
        loanRows: Number(loans[0]?.total || 0),
        medicalRows: Number(medical[0]?.total || 0),
        surchargeRows: Number(surcharge[0]?.total || 0),
        incrementRows: Number(increments[0]?.total || 0),
        leaveAllowanceRows: Number(leaveAllowance[0]?.total || 0),
        actingRows: Number(acting[0]?.total || 0),
        yearlyPaymentRows: Number(yearly[0]?.total || 0)
    };
}

async function assertSideEffectsUnchanged(before, after, label) {
    assert(JSON.stringify(before) === JSON.stringify(after), `${label} changed payroll side-effect tables unexpectedly.`);
}

async function runLifecycle() {
    await payrollReversalService.ensureReversalTables();
    await payrollReopenService.ensureReopenTables();
    await workflowNotificationService.ensureNotificationTable();
    await ensureIndexes();
    await cleanupTestData();
    await ensureSandboxSeed();

    const financeUser = buildUser(TEST_USERS.find((user) => user.role === 'finance-officer'));
    const managerUser = buildUser(TEST_USERS.find((user) => user.role === 'manager'));
    const auditorUser = buildUser(TEST_USERS.find((user) => user.role === 'auditor'));
    const entityHeadUser = buildUser(TEST_USERS.find((user) => user.role === 'entity-head'));
    const users = [TEST_USERS[0], TEST_USERS[1], TEST_USERS[2], TEST_USERS[3]];

    const result = {
        testEnvironment: {
            companyId: TEST_COMPANY_ID,
            month: TEST_MONTH,
            year: TEST_YEAR,
            activityCode: TEST_ACTIVITY,
            payrollDate: TEST_PAYROLL_DATE,
            testUsers: TEST_USERS.map((user) => ({ pfno: user.pfno, role: user.role, username: user.username })),
            testStaff: TEST_STAFF.map((staff) => ({ pfno: staff.pfno, deptCode: staff.deptCode, gradeCode: staff.gradeCode, jobTitleCode: staff.jobTitleCode }))
        }
    };

    const baselineSideEffects = await captureSideEffectState();
    result.sideEffectsBefore = baselineSideEffects;

    const processResult1 = await ProcessEmolumentsService.processEmoluments({
        companyId: TEST_COMPANY_ID,
        activityCode: TEST_ACTIVITY,
        payrollDate: TEST_PAYROLL_DATE,
        processedByName: financeUser.name,
        processedByUser: financeUser,
        userRole: financeUser.role
    });
    assert(processResult1.workflowStatus === payrollWorkflowService.WORKFLOW_STATUSES.PROCESSED, 'Generation 1 should begin in PROCESSED status.');
    assert(processResult1.isCorrectionRun === false, 'Generation 1 should not be marked as a correction run.');

    const generation1 = await getWorkflowBatchByGeneration(1);
    assert(generation1, 'Generation 1 workflow batch was not created.');
    assert(Number(generation1.GenerationNo || 1) === 1, 'Generation 1 workflow batch should have GenerationNo = 1.');

    await payrollWorkflowService.transitionWorkflow({
        companyId: TEST_COMPANY_ID,
        pMonth: TEST_MONTH,
        pYear: TEST_YEAR,
        pType: TEST_ACTIVITY,
        action: payrollWorkflowService.WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER,
        user: financeUser,
        comments: 'Submitting sandbox payroll generation 1 to Manager.'
    });

    let managerQueue = await getQueueSnapshot([TEST_USERS[1]]);
    assert(managerQueue.manager.total > 0, 'Manager work queue should contain Generation 1 after Finance submission.');

    const generation1Manager = await getWorkflowBatchByGeneration(1);
    await managerPayrollWorkflowService.endorseBatch({
        companyId: TEST_COMPANY_ID,
        batchId: generation1Manager.id,
        user: managerUser,
        comments: 'Manager endorsed Generation 1.'
    });

    let auditorQueue = await getQueueSnapshot([TEST_USERS[2]]);
    assert(auditorQueue.auditor.total > 0, 'Auditor work queue should contain Generation 1 after Manager endorsement.');

    const generation1Auditor = await getWorkflowBatchByGeneration(1);
    await auditorPayrollWorkflowService.endorseBatch({
        companyId: TEST_COMPANY_ID,
        batchId: generation1Auditor.id,
        user: auditorUser,
        comments: 'Auditor endorsed Generation 1.'
    });

    let entityQueue = await getQueueSnapshot([TEST_USERS[3]]);
    assert(entityQueue['entity-head'].total > 0, 'Entity Head work queue should contain Generation 1 after Auditor endorsement.');

    const generation1Entity = await getWorkflowBatchByGeneration(1);
    await entityHeadPayrollWorkflowService.approveBatch({
        companyId: TEST_COMPANY_ID,
        batchId: generation1Entity.id,
        user: entityHeadUser,
        comments: 'Entity Head approved Generation 1.'
    });

    const posting1 = await payrollGlPostingService.postMonthlyPayrollToGL({
        companyId: TEST_COMPANY_ID,
        activityCode: TEST_ACTIVITY,
        postingDate: TEST_POSTING_DATE,
        postedBy: financeUser.id,
        postedByUser: financeUser
    });
    assert(posting1.workflowStatus === payrollWorkflowService.WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS, 'Generation 1 should post successfully.');

    const generation1Posted = await getWorkflowBatchByGeneration(1);
    const generation1Summary = await getGenerationPayrollSummary(1, generation1Posted.id);
    const generation1PostingBatch = await getPostingBatch(1);
    assert(generation1PostingBatch, 'Generation 1 GL posting batch should exist.');
    assert(Number(generation1PostingBatch.generation_no || 0) === 1, 'Generation 1 GL posting batch should use generation_no = 1.');

    const afterGen1SideEffects = await captureSideEffectState();
    await assertSideEffectsUnchanged(baselineSideEffects, afterGen1SideEffects, 'Generation 1 processing');

    const reversalCreate = await payrollReversalService.createReversalRequest({
        companyId: TEST_COMPANY_ID,
        workflowBatchId: generation1Posted.id,
        reason: 'Phase 15A sandbox reversal request',
        comments: 'Reversing Generation 1 for reopen verification.',
        user: financeUser
    });
    await payrollReversalService.submitRequestToManager({
        companyId: TEST_COMPANY_ID,
        requestId: reversalCreate.request.id,
        user: financeUser,
        comments: 'Submitting reversal to Manager.'
    });
    await payrollReversalService.managerEndorseRequest({
        companyId: TEST_COMPANY_ID,
        requestId: reversalCreate.request.id,
        user: managerUser,
        comments: 'Manager endorsed reversal.'
    });
    await payrollReversalService.auditorEndorseRequest({
        companyId: TEST_COMPANY_ID,
        requestId: reversalCreate.request.id,
        user: auditorUser,
        comments: 'Auditor endorsed reversal.'
    });
    await payrollReversalService.entityHeadApproveRequest({
        companyId: TEST_COMPANY_ID,
        requestId: reversalCreate.request.id,
        user: entityHeadUser,
        comments: 'Entity Head approved reversal.'
    });
    const reversalExecution = await payrollReversalService.executeApprovedReversal({
        companyId: TEST_COMPANY_ID,
        requestId: reversalCreate.request.id,
        user: financeUser
    });
    assert(reversalExecution.workflowStatus === payrollWorkflowService.WORKFLOW_STATUSES.REVERSED, 'Generation 1 should be REVERSED after reversal execution.');

    const reversedBatch = await getWorkflowBatchByGeneration(1);
    assert(reversedBatch.Status === payrollWorkflowService.WORKFLOW_STATUSES.REVERSED, 'Generation 1 batch should remain REVERSED after execution.');
    const reversalBatch = await getReversalBatch(reversalCreate.request.id);
    assert(reversalBatch, 'Reversal GL batch should exist.');
    const reversalLineTotals = await getReversalLineTotals(reversalBatch.id);
    assert(reversalLineTotals.debitTotal === reversalLineTotals.creditTotal, 'Reversal GL entries must balance.');

    const afterReversalSideEffects = await captureSideEffectState();
    await assertSideEffectsUnchanged(afterGen1SideEffects, afterReversalSideEffects, 'Reversal execution');

    const reopenCreate = await payrollReopenService.createReopenRequest({
        companyId: TEST_COMPANY_ID,
        workflowBatchId: reversedBatch.id,
        reason: 'Phase 15A sandbox reopen request',
        comments: 'Reopening reversed payroll for Generation 2 verification.',
        user: financeUser
    });
    await payrollReopenService.submitReopenToManager({
        companyId: TEST_COMPANY_ID,
        requestId: reopenCreate.request.id,
        user: financeUser,
        comments: 'Submitting reopen request to Manager.'
    });
    await payrollReopenService.managerEndorseReopen({
        companyId: TEST_COMPANY_ID,
        requestId: reopenCreate.request.id,
        user: managerUser,
        comments: 'Manager endorsed reopen.'
    });
    await payrollReopenService.auditorEndorseReopen({
        companyId: TEST_COMPANY_ID,
        requestId: reopenCreate.request.id,
        user: auditorUser,
        comments: 'Auditor endorsed reopen.'
    });
    await payrollReopenService.entityHeadApproveReopen({
        companyId: TEST_COMPANY_ID,
        requestId: reopenCreate.request.id,
        user: entityHeadUser,
        comments: 'Entity Head approved reopen.'
    });

    const generation2Open = await payrollReopenService.startReopenReprocessing({
        companyId: TEST_COMPANY_ID,
        requestId: reopenCreate.request.id,
        user: financeUser
    });
    const generation2Pending = await getWorkflowBatchByGeneration(2);
    assert(generation2Pending, 'Generation 2 workflow batch should be created.');
    assert(generation2Pending.Status === payrollWorkflowService.WORKFLOW_STATUSES.CORRECTION_IN_PROGRESS, 'Generation 2 should start in CORRECTION_IN_PROGRESS.');
    assert(Number(generation2Pending.OriginalWorkflowBatchID || 0) === Number(generation1Posted.id), 'Generation 2 should link back to Generation 1.');
    assert(Number(generation2Pending.ReopenRequestID || 0) === Number(reopenCreate.request.id), 'Generation 2 should link to the reopen request.');

    const archiveSummary = await getArchiveSummary(generation1Posted.id);
    assert(archiveSummary.rowCount === generation1Summary.rowCount, 'Archived Generation 1 row count must match original payroll row count.');

    const processResult2 = await ProcessEmolumentsService.processEmoluments({
        companyId: TEST_COMPANY_ID,
        activityCode: TEST_ACTIVITY,
        payrollDate: TEST_PAYROLL_DATE,
        processedByName: financeUser.name,
        processedByUser: financeUser,
        userRole: financeUser.role
    });
    assert(processResult2.workflowStatus === payrollWorkflowService.WORKFLOW_STATUSES.PROCESSED, 'Generation 2 should process to PROCESSED.');
    assert(processResult2.isCorrectionRun === true, 'Generation 2 should be treated as a correction run.');

    const generation2Processed = await getWorkflowBatchByGeneration(2);
    const generation2Summary = await getGenerationPayrollSummary(2, generation2Processed.id);
    assert(generation2Summary.rowCount > 0, 'Generation 2 should produce payroll rows.');

    const afterGen2ProcessSideEffects = await captureSideEffectState();
    await assertSideEffectsUnchanged(afterReversalSideEffects, afterGen2ProcessSideEffects, 'Generation 2 processing');

    await payrollWorkflowService.transitionWorkflow({
        companyId: TEST_COMPANY_ID,
        pMonth: TEST_MONTH,
        pYear: TEST_YEAR,
        pType: TEST_ACTIVITY,
        action: payrollWorkflowService.WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER,
        user: financeUser,
        comments: 'Submitting sandbox payroll generation 2 to Manager.'
    });

    managerQueue = await getQueueSnapshot([TEST_USERS[1]]);
    assert(managerQueue.manager.total > 0, 'Manager work queue should contain Generation 2 after reopen processing.');

    const generation2Manager = await getWorkflowBatchByGeneration(2);
    await managerPayrollWorkflowService.endorseBatch({
        companyId: TEST_COMPANY_ID,
        batchId: generation2Manager.id,
        user: managerUser,
        comments: 'Manager endorsed Generation 2.'
    });

    auditorQueue = await getQueueSnapshot([TEST_USERS[2]]);
    assert(auditorQueue.auditor.total > 0, 'Auditor work queue should contain Generation 2 after Manager endorsement.');

    const generation2Auditor = await getWorkflowBatchByGeneration(2);
    await auditorPayrollWorkflowService.endorseBatch({
        companyId: TEST_COMPANY_ID,
        batchId: generation2Auditor.id,
        user: auditorUser,
        comments: 'Auditor endorsed Generation 2.'
    });

    entityQueue = await getQueueSnapshot([TEST_USERS[3]]);
    assert(entityQueue['entity-head'].total > 0, 'Entity Head work queue should contain Generation 2 after Auditor endorsement.');

    const generation2Entity = await getWorkflowBatchByGeneration(2);
    await entityHeadPayrollWorkflowService.approveBatch({
        companyId: TEST_COMPANY_ID,
        batchId: generation2Entity.id,
        user: entityHeadUser,
        comments: 'Entity Head approved Generation 2.'
    });

    const posting2 = await payrollGlPostingService.postMonthlyPayrollToGL({
        companyId: TEST_COMPANY_ID,
        activityCode: TEST_ACTIVITY,
        postingDate: TEST_POSTING_DATE,
        postedBy: financeUser.id,
        postedByUser: financeUser
    });
    assert(posting2.workflowStatus === payrollWorkflowService.WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS, 'Generation 2 should post successfully.');

    const generation2Posted = await getWorkflowBatchByGeneration(2);
    const generation2PostingBatch = await getPostingBatch(2);
    assert(generation2PostingBatch, 'Generation 2 GL posting batch should exist.');
    assert(Number(generation2PostingBatch.generation_no || 0) === 2, 'Generation 2 GL posting batch should use generation_no = 2.');

    const activeGenerations = await getWorkflowGenerations();
    assert(activeGenerations.length >= 2, 'Payroll generation history should contain at least Generations 1 and 2.');
    assert(activeGenerations[0].GenerationNo === 2, 'Latest workflow generation should be Generation 2.');
    assert(activeGenerations.find((row) => Number(row.GenerationNo) === 1)?.Status === payrollWorkflowService.WORKFLOW_STATUSES.REVERSED, 'Generation 1 should remain REVERSED in history.');
    assert(activeGenerations.find((row) => Number(row.GenerationNo) === 2)?.Status === payrollWorkflowService.WORKFLOW_STATUSES.POSTED_TO_ACCOUNTS, 'Generation 2 should be POSTED_TO_ACCOUNTS in history.');

    const notificationSnapshot = await getNotificationSnapshot(users);
    const queueSnapshot = await getQueueSnapshot(users);

    result.generation1 = {
        process: processResult1,
        workflowBatchId: generation1Posted.id,
        summary: generation1Summary,
        postingBatchId: generation1PostingBatch.id,
        postingStatus: generation1Posted.Status
    };
    result.reversal = {
        requestId: reversalCreate.request.id,
        reversalBatchId: reversalBatch.id,
        workflowStatusAfterExecution: reversedBatch.Status,
        reversalDebitTotal: reversalLineTotals.debitTotal,
        reversalCreditTotal: reversalLineTotals.creditTotal,
        reversalLineCount: reversalLineTotals.lineCount
    };
    result.reopen = {
        requestId: reopenCreate.request.id,
        archivedRows: archiveSummary.rowCount,
        generation2WorkflowBatchId: generation2Pending.id,
        generation2OpenStatus: generation2Pending.Status,
        processUrl: generation2Open.processUrl
    };
    result.generation2 = {
        process: processResult2,
        workflowBatchId: generation2Posted.id,
        summary: generation2Summary,
        postingBatchId: generation2PostingBatch.id,
        postingStatus: generation2Posted.Status
    };
    result.generationHistory = activeGenerations.map((row) => ({
        id: row.id,
        generationNo: row.GenerationNo,
        status: row.Status,
        originalWorkflowBatchId: row.OriginalWorkflowBatchID,
        reopenRequestId: row.ReopenRequestID
    }));
    result.notifications = notificationSnapshot;
    result.queues = queueSnapshot;
    result.sideEffectsAfter = afterGen2ProcessSideEffects;
    result.reconciliation = {
        generation1: {
            rowCount: generation1Summary.rowCount,
            totalGross: generation1Summary.totalGross,
            totalTax: generation1Summary.totalTax,
            totalDeductions: generation1Summary.totalDeductions,
            totalNet: generation1Summary.totalNet,
            checksum: generation1Summary.checksum,
            archiveRowCount: archiveSummary.rowCount,
            finalStatus: reversedBatch.Status
        },
        generation2: {
            rowCount: generation2Summary.rowCount,
            totalGross: generation2Summary.totalGross,
            totalTax: generation2Summary.totalTax,
            totalDeductions: generation2Summary.totalDeductions,
            totalNet: generation2Summary.totalNet,
            checksum: generation2Summary.checksum,
            finalStatus: generation2Posted.Status
        }
    };

    return result;
}

module.exports = {
    TEST_ACTIVITY,
    TEST_COMPANY_ID,
    TEST_MONTH,
    TEST_PAYROLL_DATE,
    TEST_POSTING_DATE,
    TEST_STAFF,
    TEST_USERS,
    TEST_USER_PREFIX,
    TEST_YEAR,
    buildUser,
    cleanupTestData,
    ensureIndexes,
    ensureSandboxSeed,
    getGenerationPayrollSummary,
    getNotificationSnapshot,
    getPostingBatch,
    getReversalBatch,
    getReversalLineTotals,
    getWorkflowBatchByGeneration,
    runLifecycle
};

if (require.main === module) {
    runLifecycle()
        .then(async (result) => {
            console.log('Phase 15A isolated payroll reopen lifecycle verification passed.');
            console.log(JSON.stringify(result, null, 2));
            try {
                await cleanupTestData();
            } catch (cleanupError) {
                console.error('Cleanup warning after successful Phase 15A test:', cleanupError.message);
            }
            await pool.end();
        })
        .catch(async (error) => {
            console.error('Phase 15A isolated payroll reopen lifecycle verification failed.');
            console.error(error);
            try {
                await cleanupTestData();
            } catch (cleanupError) {
                console.error('Cleanup failed after Phase 15A test failure.', cleanupError);
            }
            try {
                await pool.end();
            } catch (closeError) {
                console.error('Failed to close DB pool.', closeError);
            }
            process.exitCode = 1;
        });
}
