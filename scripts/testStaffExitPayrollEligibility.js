const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const recordWorkflowService = require('../services/recordWorkflowService');
const payrollValidationService = require('../services/payrollValidationService');
const staffStatusService = require('../services/staffStatusService');

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'personnel_master'
};

const COMPANY_ID = 1;
const TEST_PASSWORD = 'Phase11Exit@123';
const USERS = {
    dataEntry: { id: 9201, pfno: '9201', username: 'phase11b_dataentry', fullName: 'Phase 11B Data Entry', role: 'data-entry' },
    manager: { id: 9202, pfno: '9202', username: 'phase11b_manager', fullName: 'Phase 11B Manager', role: 'manager' },
    entityHead: { id: 9203, pfno: '9203', username: 'phase11b_entity', fullName: 'Phase 11B Entity Head', role: 'entity-head' }
};

const TEST_STAFF = {
    retired: 'X201',
    former: 'X202',
    redundant: 'X203',
    control: 'X204'
};

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function log(message) {
    process.stdout.write(`${message}\n`);
}

async function ensureUsers(connection) {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    for (const user of Object.values(USERS)) {
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
            [
                user.pfno,
                user.role === 'data-entry' ? 'Data Entry' : user.role === 'manager' ? 'Manager' : 'Entity Head',
                user.username,
                user.fullName,
                passwordHash,
                `${user.username}@example.test`,
                COMPANY_ID
            ]
        );
    }
}

async function getLookups(connection) {
    const [[dept], [grade], [job]] = await Promise.all([
        connection.query('SELECT Code FROM tbldept ORDER BY Code LIMIT 1').then(([rows]) => rows),
        connection.query('SELECT GradeCode FROM tblgrade ORDER BY GradeCode LIMIT 1').then(([rows]) => rows),
        connection.query('SELECT Code FROM tbljobtitle ORDER BY Code LIMIT 1').then(([rows]) => rows)
    ]);
    return { dept, grade, job };
}

async function ensureEntityHeadStaff(connection, lookups) {
    await connection.query(
        `INSERT INTO tblstaff (
            PFNo, SName, Email, DOE, GradeCode, CGrade, CGradeDate, JobTitle, CDept, CDeptDate,
            EmpStatus, HOD, HOD_SDate, HOD_EDate, NASSITR, Redundant, Linked, Letter,
            Approved, ApprovedBy, DateApproved, TimeApproved, CompanyID, KeyedIn, KeyedInBy
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '01', 1, ?, NULL, 0, 0, 0, 0, -1, 'seed', NOW(), NOW(), ?, NOW(), 'phase11b')
        ON DUPLICATE KEY UPDATE
            SName = VALUES(SName),
            Email = VALUES(Email),
            EmpStatus = '01',
            HOD = 1,
            HOD_SDate = VALUES(HOD_SDate),
            HOD_EDate = NULL,
            CompanyID = VALUES(CompanyID)`,
        [
            USERS.entityHead.pfno,
            USERS.entityHead.fullName,
            `${USERS.entityHead.username}@example.test`,
            '2020-01-01',
            lookups.grade.GradeCode,
            lookups.grade.GradeCode,
            '2020-01-01',
            lookups.job.Code,
            lookups.dept.Code,
            '2020-01-01',
            '2020-01-01',
            COMPANY_ID
        ]
    );
}

async function ensureTestStaff(connection, lookups) {
    for (const pfno of Object.values(TEST_STAFF)) {
        await connection.query(
            `INSERT INTO tblstaff (
                PFNo, SName, DOE, GradeCode, CGrade, CGradeDate, JobTitle, CDept, CDeptDate,
                EmpStatus, ReasonCode, ReasonDate, Redundant, DateRedundant,
                NASSITR, Linked, Letter, Approved, ApprovedBy, DateApproved, TimeApproved, CompanyID, KeyedIn, KeyedInBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '01', NULL, NULL, 0, NULL, 0, 0, 0, -1, 'seed', NOW(), NOW(), ?, NOW(), 'phase11b')
            ON DUPLICATE KEY UPDATE
                SName = VALUES(SName),
                DOE = VALUES(DOE),
                GradeCode = VALUES(GradeCode),
                CGrade = VALUES(CGrade),
                CGradeDate = VALUES(CGradeDate),
                JobTitle = VALUES(JobTitle),
                CDept = VALUES(CDept),
                CDeptDate = VALUES(CDeptDate),
                EmpStatus = '01',
                ReasonCode = NULL,
                ReasonDate = NULL,
                Redundant = 0,
                DateRedundant = NULL,
                CompanyID = VALUES(CompanyID)`,
            [
                pfno,
                `Phase11B ${pfno}`,
                '2020-01-01',
                lookups.grade.GradeCode,
                lookups.grade.GradeCode,
                '2020-01-01',
                lookups.job.Code,
                lookups.dept.Code,
                '2020-01-01',
                COMPANY_ID
            ]
        );

        await connection.query(
            `INSERT INTO tblsalary (
                PFNo, Dept, PType, PDate, Grade, JobTitle, Salary, Annual, TotalIncome, Taxable, Tax,
                NassitEmp, NassitInst, NetIncome, Paid, FullPay, HalfPay, WithoutPay, Linked, Approved, Posted, CompanyID
            ) VALUES (?, ?, '01', ?, ?, ?, 1200, 14400, 1200, 1200, 0, 0, 0, 1200, 0, 1, 0, 0, 0, -1, 0, ?)
            ON DUPLICATE KEY UPDATE
                Dept = VALUES(Dept),
                PDate = VALUES(PDate),
                Grade = VALUES(Grade),
                JobTitle = VALUES(JobTitle),
                Salary = VALUES(Salary),
                Annual = VALUES(Annual),
                TotalIncome = VALUES(TotalIncome),
                Taxable = VALUES(Taxable),
                NetIncome = VALUES(NetIncome),
                Approved = -1,
                Posted = 0,
                CompanyID = VALUES(CompanyID)`,
            [pfno, lookups.dept.Code, '2026-01-01', lookups.grade.GradeCode, lookups.job.Code, COMPANY_ID]
        );

        await connection.query(
            `INSERT INTO tblentitle (
                PFNo, Salary, Allw02, Allw03, Allw04, Allw05, Allw06, Allw07, Allw08, Allw09, Allw10,
                Allw11, Allw12, Allw13, Allw14, Allw15, Allw16, Allw17, Allw18, Allw19, Allw20,
                KeyedIn, Operator, TimeKeyed, ApprovedBy, Approved, DateApproved, TimeApproved,
                PayThrough, Bank, PayingBBAN, AccountNo, PayingBank, CompanyID
             ) VALUES (
                ?, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                NOW(), 'Phase11B', NOW(), 'Phase11B', -1, NOW(), NOW(),
                'BANK', '01', 'BBAN', ?, '0001', ?
             )
             ON DUPLICATE KEY UPDATE
                AccountNo = VALUES(AccountNo),
                PayThrough = VALUES(PayThrough),
                Bank = VALUES(Bank),
                PayingBBAN = VALUES(PayingBBAN),
                PayingBank = VALUES(PayingBank),
                CompanyID = VALUES(CompanyID)`,
            [pfno, `AC-${pfno}`, COMPANY_ID]
        );
    }
}

async function resetTestRows(connection) {
    await connection.query(`DELETE FROM workflow_notifications WHERE ReferenceID LIKE '%X20%' OR Message LIKE '%Phase 11B%'`).catch(() => {});
    await connection.query(`DELETE FROM record_workflow_actions WHERE RecordReference LIKE '%X20%'`).catch(() => {});
    await connection.query(`DELETE FROM record_workflow_items WHERE RecordReference LIKE '%X20%'`).catch(() => {});
    await connection.query(`DELETE FROM tblformer WHERE PFNo IN (?, ?, ?, ?)`, Object.values(TEST_STAFF)).catch(() => {});
    await connection.query(`DELETE FROM tblpayroll WHERE PFNo IN (?, ?, ?, ?)`, Object.values(TEST_STAFF)).catch(() => {});
    await connection.query(`UPDATE tblstaff SET EmpStatus='01', ReasonCode=NULL, ReasonDate=NULL, Redundant=0, DateRedundant=NULL, Approved=-1 WHERE PFNo IN (?, ?, ?, ?)`, Object.values(TEST_STAFF)).catch(() => {});
}

async function createFormerRecord(connection, { pfNo, reason, effectiveDate, briefInfo }) {
    await connection.query(
        `INSERT INTO tblformer (
            PFNo, DateofLetter, DateResigned, DateAccepted, Reason, ExitInterview, DateInterviewed,
            BriefInfo, NoticeDate, ExpDate, DateLeft, Operator, KeyedTime, DateKeyed,
            Approved, ApprovedBy, DateApproved, CompanyID
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'Phase11B', NOW(), NOW(), 0, NULL, NULL, ?)
        ON DUPLICATE KEY UPDATE
            DateofLetter = VALUES(DateofLetter),
            DateResigned = VALUES(DateResigned),
            DateAccepted = VALUES(DateAccepted),
            Reason = VALUES(Reason),
            DateInterviewed = VALUES(DateInterviewed),
            BriefInfo = VALUES(BriefInfo),
            NoticeDate = VALUES(NoticeDate),
            ExpDate = VALUES(ExpDate),
            DateLeft = VALUES(DateLeft),
            Approved = 0,
            ApprovedBy = NULL,
            DateApproved = NULL,
            CompanyID = VALUES(CompanyID)`,
        [pfNo, effectiveDate, effectiveDate, effectiveDate, reason, effectiveDate, briefInfo, effectiveDate, effectiveDate, effectiveDate, COMPANY_ID]
    );
}

async function approveStaffExit(connection, { pfNo, reason, effectiveDate, briefInfo }) {
    await createFormerRecord(connection, { pfNo, reason, effectiveDate, briefInfo });
    const module = 'staff-exit';
    const reference = recordWorkflowService.getModuleConfig(module).buildReferenceFromInput({ pfno: pfNo });
    const source = await recordWorkflowService.fetchModuleRecord(COMPANY_ID, module, reference, connection);
    await recordWorkflowService.ensureDraftItemForExistingRecord({
        companyId: COMPANY_ID,
        module,
        recordReference: reference,
        record: source,
        user: USERS.dataEntry,
        connection
    });
    const item = await recordWorkflowService.getWorkflowItemByReference(COMPANY_ID, module, reference, connection);
    await recordWorkflowService.submitRecord({ companyId: COMPANY_ID, module, workflowItemId: item.id, user: USERS.dataEntry, connection });
    await recordWorkflowService.managerEndorseRecord({ companyId: COMPANY_ID, workflowItemId: item.id, user: USERS.manager, comments: 'verified', connection });
    await recordWorkflowService.entityHeadApproveRecord({ companyId: COMPANY_ID, workflowItemId: item.id, user: USERS.entityHead, comments: 'approved', connection });
}

async function approveRedundancy(connection, { pfNo, effectiveDate }) {
    await connection.query(
        `UPDATE tblstaff
         SET Redundant = 2,
             DateRedundant = ?,
             ReasonCode = '12',
             ReasonDate = ?,
             Approved = 0
         WHERE PFNo = ?`,
        [effectiveDate, effectiveDate, pfNo]
    );
    const module = 'redundancy';
    const reference = recordWorkflowService.getModuleConfig(module).buildReferenceFromInput({ pfno: pfNo });
    const source = await recordWorkflowService.fetchModuleRecord(COMPANY_ID, module, reference, connection);
    await recordWorkflowService.ensureDraftItemForExistingRecord({
        companyId: COMPANY_ID,
        module,
        recordReference: reference,
        record: source,
        user: USERS.dataEntry,
        connection
    });
    const item = await recordWorkflowService.getWorkflowItemByReference(COMPANY_ID, module, reference, connection);
    await recordWorkflowService.submitRecord({ companyId: COMPANY_ID, module, workflowItemId: item.id, user: USERS.dataEntry, connection });
    await recordWorkflowService.managerEndorseRecord({ companyId: COMPANY_ID, workflowItemId: item.id, user: USERS.manager, comments: 'verified', connection });
    await recordWorkflowService.entityHeadApproveRecord({ companyId: COMPANY_ID, workflowItemId: item.id, user: USERS.entityHead, comments: 'approved', connection });
}

async function insertPayrollRow(connection, { pfNo, payrollDate, month, year, pType = '01' }) {
    const [staffRows] = await connection.query(`SELECT PFNo, CDept, CGrade, JobTitle, Level, EmpType, PayCurrency, AccountNo FROM tblstaff WHERE PFNo = ?`, [pfNo]);
    const staff = staffRows[0];
    await connection.query(
        `INSERT INTO tblpayroll (
            SalDate, PDate, PFNo, Dept, Grade, JobTitle, PayThrough, Bank, PayingBBAN, PayingBank,
            AccountNo, Level, Salary, TotalIncome, Taxable, Tax, NassitEmp, NassitInst, GratEmp, GratInst,
            NetIncome, PMonth, PYear, PType, FullPay, HalfPay, WithoutPay, Operator, DateKeyed, TimeKeyed,
            Approved, ApprovedBy, DateApproved, TimeApproved, EmpType, PayCurrency, ExchRate, Paid, CompanyID
        ) VALUES (?, ?, ?, ?, ?, ?, '01', '01', 'BBAN', '0001', ?, ?, 1200, 1200, 1200, 0, 0, 0, 0, 0, 1200, ?, ?, ?, 1, 0, 0, 'Phase11B', NOW(), NOW(), -1, 'Phase11B', NOW(), NOW(), ?, ?, 1, 0, ?)` ,
        [payrollDate, payrollDate, pfNo, staff.CDept, staff.CGrade, staff.JobTitle, staff.AccountNo || `AC-${pfNo}`, staff.Level || '01', month, year, pType, staff.EmpType || '01', staff.PayCurrency || 'SLE', COMPANY_ID]
    );
}

async function testClassificationAndEligibility(connection) {
    log('Testing status mapping and payroll eligibility...');
    const exitDate = '2026-02-15';
    const redundancyDate = '2026-01-31';

    await approveStaffExit(connection, {
        pfNo: TEST_STAFF.retired,
        reason: '04',
        effectiveDate: `${exitDate} 00:00:00`,
        briefInfo: 'Retirement test'
    });
    await approveStaffExit(connection, {
        pfNo: TEST_STAFF.former,
        reason: '07',
        effectiveDate: '2026-02-02 00:00:00',
        briefInfo: 'Former test'
    });
    await approveRedundancy(connection, {
        pfNo: TEST_STAFF.redundant,
        effectiveDate: `${redundancyDate} 00:00:00`
    });

    const [statusRows] = await connection.query(
        `SELECT PFNo, EmpStatus, ReasonCode, DATE(ReasonDate) AS ReasonDate, Redundant, DATE(DateRedundant) AS DateRedundant
         FROM tblstaff
         WHERE PFNo IN (?, ?, ?)
         ORDER BY PFNo`,
        [TEST_STAFF.retired, TEST_STAFF.former, TEST_STAFF.redundant]
    );

    const retired = statusRows.find((row) => row.PFNo === TEST_STAFF.retired);
    const former = statusRows.find((row) => row.PFNo === TEST_STAFF.former);
    const redundant = statusRows.find((row) => row.PFNo === TEST_STAFF.redundant);

    assert(retired.EmpStatus === '02', 'Retired staff should use broad former EmpStatus 02');
    assert(retired.ReasonCode === '04', 'Retired staff should preserve retirement reason code');
    assert(former.EmpStatus === '02', 'Former staff should use EmpStatus 02');
    assert(former.ReasonCode === '07', 'Former staff should preserve former reason code');
    assert(redundant.EmpStatus === '02', 'Redundant staff should use EmpStatus 02 after final approval');
    assert(Number(redundant.Redundant) === 1, 'Redundant staff should be finally marked Redundant = 1');

    const activeBeforeRetire = await payrollValidationService.isStaffActiveForPayrollPeriod(connection, {
        pfNo: TEST_STAFF.retired,
        payrollDate: '2026-01-31',
        companyId: COMPANY_ID
    });
    const activeOnRetireDate = await payrollValidationService.isStaffActiveForPayrollPeriod(connection, {
        pfNo: TEST_STAFF.retired,
        payrollDate: '2026-02-15',
        companyId: COMPANY_ID
    });
    const activeAfterRetire = await payrollValidationService.isStaffActiveForPayrollPeriod(connection, {
        pfNo: TEST_STAFF.retired,
        payrollDate: '2026-02-28',
        companyId: COMPANY_ID
    });

    const activeBeforeFormer = await payrollValidationService.isStaffActiveForPayrollPeriod(connection, {
        pfNo: TEST_STAFF.former,
        payrollDate: '2026-01-31',
        companyId: COMPANY_ID
    });
    const activeAfterFormer = await payrollValidationService.isStaffActiveForPayrollPeriod(connection, {
        pfNo: TEST_STAFF.former,
        payrollDate: '2026-02-28',
        companyId: COMPANY_ID
    });

    const activeBeforeRedundant = await payrollValidationService.isStaffActiveForPayrollPeriod(connection, {
        pfNo: TEST_STAFF.redundant,
        payrollDate: '2026-01-30',
        companyId: COMPANY_ID
    });
    const activeOnRedundantDate = await payrollValidationService.isStaffActiveForPayrollPeriod(connection, {
        pfNo: TEST_STAFF.redundant,
        payrollDate: '2026-01-31',
        companyId: COMPANY_ID
    });
    const activeAfterRedundant = await payrollValidationService.isStaffActiveForPayrollPeriod(connection, {
        pfNo: TEST_STAFF.redundant,
        payrollDate: '2026-02-01',
        companyId: COMPANY_ID
    });

    assert(activeBeforeRetire === true, 'Retired staff should remain payroll-eligible before effective date');
    assert(activeOnRetireDate === true, 'Retired staff currently remain payroll-eligible on the effective date');
    assert(activeAfterRetire === false, 'Retired staff should be excluded after effective date');
    assert(activeBeforeFormer === true, 'Former staff should remain payroll-eligible before effective date');
    assert(activeAfterFormer === false, 'Former staff should be excluded after effective date');
    assert(activeBeforeRedundant === true, 'Redundant staff should remain payroll-eligible before effective date');
    assert(activeOnRedundantDate === true, 'Redundant staff currently remain payroll-eligible on the effective date');
    assert(activeAfterRedundant === false, 'Redundant staff should be excluded after effective date');

    const activeFilter = staffStatusService.getActiveStaffFilter('s');
    const [searchRows] = await connection.query(
        `SELECT PFNo FROM tblstaff s WHERE s.PFNo IN (?, ?, ?, ?) AND ${activeFilter} ORDER BY PFNo`,
        [TEST_STAFF.retired, TEST_STAFF.former, TEST_STAFF.redundant, TEST_STAFF.control]
    );
    const visiblePfNos = searchRows.map((row) => row.PFNo);
    assert(visiblePfNos.includes(TEST_STAFF.control), 'Control staff should remain visible in active search');
    assert(!visiblePfNos.includes(TEST_STAFF.retired), 'Retired staff should be excluded from active search after final approval');
    assert(!visiblePfNos.includes(TEST_STAFF.former), 'Former staff should be excluded from active search after final approval');
    assert(!visiblePfNos.includes(TEST_STAFF.redundant), 'Redundant staff should be excluded from active search after final approval');
}

async function testPostingValidation(connection) {
    log('Testing payroll posting validation...');
    await connection.query(`DELETE FROM tblpayroll WHERE PFNo IN (?, ?, ?)`, [TEST_STAFF.retired, TEST_STAFF.former, TEST_STAFF.redundant]);

    await insertPayrollRow(connection, {
        pfNo: TEST_STAFF.retired,
        payrollDate: '2026-02-28',
        month: 2,
        year: 2026
    });

    let blocked = false;
    try {
        await payrollValidationService.validateNoFormerRetiredRedundantInPayroll(connection, {
            companyId: COMPANY_ID,
            activityCode: '01',
            payrollMonth: 2,
            payrollYear: 2026
        });
    } catch (error) {
        blocked = true;
        assert(/Former, Retired, or Redundant/i.test(error.message), 'Posting validation should report ineligible staff rows');
    }
    assert(blocked, 'Posting validation should block payroll rows for ineligible staff');

    await connection.query(`DELETE FROM tblpayroll WHERE PFNo IN (?, ?, ?)`, [TEST_STAFF.retired, TEST_STAFF.former, TEST_STAFF.redundant]);
    await insertPayrollRow(connection, {
        pfNo: TEST_STAFF.control,
        payrollDate: '2026-01-31',
        month: 1,
        year: 2026
    });
    await payrollValidationService.validateNoFormerRetiredRedundantInPayroll(connection, {
        companyId: COMPANY_ID,
        activityCode: '01',
        payrollMonth: 1,
        payrollYear: 2026
    });
}

async function cleanup(connection) {
    await connection.query(`DELETE FROM workflow_notifications WHERE ReferenceID LIKE '%X20%' OR Message LIKE '%Phase 11B%'`).catch(() => {});
    await connection.query(`DELETE FROM record_workflow_actions WHERE RecordReference LIKE '%X20%'`).catch(() => {});
    await connection.query(`DELETE FROM record_workflow_items WHERE RecordReference LIKE '%X20%'`).catch(() => {});
    await connection.query(`DELETE FROM tblformer WHERE PFNo IN (?, ?, ?, ?)`, Object.values(TEST_STAFF)).catch(() => {});
    await connection.query(`DELETE FROM tblpayroll WHERE PFNo IN (?, ?, ?, ?)`, Object.values(TEST_STAFF)).catch(() => {});
    await connection.query(`DELETE FROM tblsalary WHERE PFNo IN (?, ?, ?, ?)`, Object.values(TEST_STAFF)).catch(() => {});
    await connection.query(`DELETE FROM tblstaff WHERE PFNo IN (?, ?, ?, ?)`, Object.values(TEST_STAFF)).catch(() => {});
    await connection.query(`DELETE FROM tblstaff WHERE PFNo = ?`, [USERS.entityHead.pfno]).catch(() => {});
}

async function main() {
    const connection = await mysql.createConnection(DB_CONFIG);
    try {
        await cleanup(connection);
        await ensureUsers(connection);
        const lookups = await getLookups(connection);
        await ensureEntityHeadStaff(connection, lookups);
        await ensureTestStaff(connection, lookups);
        await resetTestRows(connection);
        await testClassificationAndEligibility(connection);
        await testPostingValidation(connection);
        log('Staff exit payroll eligibility verification passed.');
    } finally {
        await cleanup(connection);
        await connection.end();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
