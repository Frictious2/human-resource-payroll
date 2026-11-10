const mysql = require('mysql2/promise');
require('./requireDisposableDatabase')();
const bcrypt = require('bcrypt');

const BASE_URL = process.env.PHASE11_BASE_URL || 'http://localhost:3001';
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'personnel_master'
};

const TEST_PASSWORD = 'Phase11Test@123';
const COMPANY_ID = 1;

const TEST_USERS = [
    { pfno: '9101', level: 'Data Entry', username: 'phase11_dataentry', fullName: 'Phase 11 Data Entry', email: 'phase11.dataentry@example.test' },
    { pfno: '9102', level: 'Manager', username: 'phase11_manager', fullName: 'Phase 11 Manager', email: 'phase11.manager@example.test' },
    { pfno: '9103', level: 'Entity Head', username: 'phase11_entity', fullName: 'Phase 11 Entity Head', email: 'phase11.entity@example.test' }
];

const TEST_STAFF = {
    transfer: 'T101',
    promotion: 'P101',
    acting: 'A101',
    leave: 'L101',
    training: 'C101',
    exit: 'E101',
    redundancy: 'R101'
};

function log(message) {
    process.stdout.write(`${message}\n`);
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function formatSqlDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

class HttpSession {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.cookies = new Map();
        this.csrfToken = '';
    }

    _storeCookies(response) {
        const setCookies = typeof response.headers.getSetCookie === 'function'
            ? response.headers.getSetCookie()
            : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);

        for (const cookie of setCookies) {
            const [pair] = String(cookie).split(';');
            const index = pair.indexOf('=');
            if (index > 0) {
                this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
            }
        }
    }

    _cookieHeader() {
        return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
    }

    async request(path, options = {}) {
        const headers = new Headers(options.headers || {});
        if (this.cookies.size) {
            headers.set('cookie', this._cookieHeader());
        }

        const response = await fetch(`${this.baseUrl}${path}`, {
            ...options,
            headers,
            redirect: options.redirect || 'manual'
        });
        this._storeCookies(response);
        const text = await response.text();
        const tokenMatch = text.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i)
            || text.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i);
        if (tokenMatch) this.csrfToken = tokenMatch[1];
        return {
            status: response.status,
            headers: response.headers,
            text,
            location: response.headers.get('location') || ''
        };
    }

    async form(path, data, method = 'POST') {
        const body = new URLSearchParams();
        Object.entries(data).forEach(([key, value]) => {
            body.append(key, value == null ? '' : String(value));
        });
        return this.request(path, {
            method,
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-csrf-token': this.csrfToken
            },
            body
        });
    }
}

async function ensureTestUsers(connection) {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
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
            [user.pfno, user.level, user.username, user.fullName, passwordHash, user.email, COMPANY_ID]
        );
    }
}

async function ensureWorkflowRoleStaff(connection, lookups) {
    const now = new Date('2026-07-01T00:00:00Z');

    await connection.query(
        `INSERT INTO tblstaff (
            PFNo, SName, Email, DOE, GradeCode, CGrade, CGradeDate, JobTitle, CDept, CDeptDate,
            EmpStatus, HOD, HOD_SDate, HOD_EDate, NASSITR, Redundant, Linked, Letter,
            Approved, ApprovedBy, DateApproved, TimeApproved, CompanyID, KeyedIn, KeyedInBy
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '01', 1, ?, NULL, 0, 0, 0, 0, -1, 'seed', NOW(), NOW(), ?, NOW(), 'phase11')
        ON DUPLICATE KEY UPDATE
            SName = VALUES(SName),
            Email = VALUES(Email),
            DOE = VALUES(DOE),
            GradeCode = VALUES(GradeCode),
            CGrade = VALUES(CGrade),
            CGradeDate = VALUES(CGradeDate),
            JobTitle = VALUES(JobTitle),
            CDept = VALUES(CDept),
            CDeptDate = VALUES(CDeptDate),
            EmpStatus = '01',
            HOD = 1,
            HOD_SDate = VALUES(HOD_SDate),
            HOD_EDate = NULL,
            CompanyID = VALUES(CompanyID)`,
        [
            '9103',
            'Phase 11 Entity Head',
            'phase11.entity@example.test',
            now,
            lookups.grade1.GradeCode,
            lookups.grade1.GradeCode,
            now,
            lookups.job1.Code,
            lookups.dept1.Code,
            now,
            now,
            COMPANY_ID
        ]
    );
}

async function getLookups(connection) {
    const [[dept1], [dept2], [grade1], [grade2], [job1], [job2], [leaveType]] = await Promise.all([
        connection.query('SELECT Code, Dept FROM tbldept ORDER BY Code LIMIT 1').then(([rows]) => rows),
        connection.query('SELECT Code, Dept FROM tbldept ORDER BY Code LIMIT 1 OFFSET 1').then(([rows]) => rows),
        connection.query('SELECT GradeCode, Grade FROM tblgrade ORDER BY GradeCode LIMIT 1').then(([rows]) => rows),
        connection.query('SELECT GradeCode, Grade FROM tblgrade ORDER BY GradeCode LIMIT 1 OFFSET 1').then(([rows]) => rows),
        connection.query('SELECT Code, JobTitle FROM tbljobtitle ORDER BY Code LIMIT 1').then(([rows]) => rows),
        connection.query('SELECT Code, JobTitle FROM tbljobtitle ORDER BY Code LIMIT 1 OFFSET 1').then(([rows]) => rows),
        connection.query('SELECT Code, LeaveType FROM tblleavetype ORDER BY Code LIMIT 1').then(([rows]) => rows)
    ]);
    return { dept1, dept2: dept2 || dept1, grade1, grade2: grade2 || grade1, job1, job2: job2 || job1, leaveType };
}

async function ensureTestStaff(connection, lookups) {
    const now = new Date('2026-07-01T00:00:00Z');
    for (const pfno of Object.values(TEST_STAFF)) {
        await connection.query(
            `INSERT INTO tblstaff (
                PFNo, SName, DOE, GradeCode, CGrade, CGradeDate, JobTitle, CDept, CDeptDate,
                EmpStatus, NASSITR, Redundant, Linked, Letter, Approved, ApprovedBy, DateApproved, TimeApproved, CompanyID, KeyedIn, KeyedInBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '01', 0, 0, 0, 0, -1, 'seed', NOW(), NOW(), ?, NOW(), 'phase11')
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
                NASSITR = 0,
                Redundant = 0,
                Linked = 0,
                Letter = 0,
                CompanyID = VALUES(CompanyID)`,
            [
                pfno,
                `Phase11 ${pfno}`,
                now,
                lookups.grade1.GradeCode,
                lookups.grade1.GradeCode,
                now,
                lookups.job1.Code,
                lookups.dept1.Code,
                now,
                COMPANY_ID
            ]
        );

        await connection.query(
            `INSERT INTO tblsalary (
                PFNo, Dept, PType, PDate, Grade, JobTitle, Salary, Annual, Allw14, TotalIncome, Taxable, Tax,
                NassitEmp, NassitInst, NetIncome, Paid, FullPay, HalfPay, WithoutPay, Linked, Approved, Posted, CompanyID
            ) VALUES (?, ?, '01', ?, ?, ?, 1200, 14400, 0, 1200, 1200, 0, 0, 0, 1200, 0, 1, 0, 0, 0, -1, 0, ?)
            ON DUPLICATE KEY UPDATE
                PDate = VALUES(PDate),
                Grade = VALUES(Grade),
                JobTitle = VALUES(JobTitle),
                Salary = VALUES(Salary),
                Annual = VALUES(Annual),
                CompanyID = VALUES(CompanyID),
                Allw14 = 0,
                Approved = -1,
                Posted = 0`,
            [pfno, lookups.dept1.Code, now, lookups.grade1.GradeCode, lookups.job1.Code, COMPANY_ID]
        );
    }
}

async function login(identifier, path = '/login') {
    const session = new HttpSession(BASE_URL);
    await session.request(path);
    const response = await session.form(path, { identifier, password: TEST_PASSWORD });
    assert([302, 303].includes(response.status), `Login failed for ${identifier}: ${response.status}`);
    return session;
}

async function findWorkflowItem(connection, module, referenceLike) {
    const [rows] = await connection.query(
        `SELECT * FROM record_workflow_items WHERE CompanyID = ? AND Module = ? AND RecordReference LIKE ? ORDER BY id DESC LIMIT 1`,
        [COMPANY_ID, module, referenceLike]
    );
    return rows[0] || null;
}

async function submitWorkflow(session, workflowItemId, module) {
    // Current Save actions submit automatically; assert the actual state and action,
    // rather than submitting a second time or accepting either legacy/new status.
    const connection=await mysql.createConnection(DB_CONFIG);
    try{
        const [[item]]=await connection.query('SELECT Status,CompanyID,Module FROM record_workflow_items WHERE id=?',[workflowItemId]);
        assert(item?.Status==='SUBMITTED_TO_MANAGER'&&item.CompanyID===COMPANY_ID&&item.Module===module,'Save must submit the correct company/module to Manager');
        const [[history]]=await connection.query("SELECT COUNT(*) AS total FROM record_workflow_actions WHERE WorkflowItemID=? AND Action='SUBMIT_TO_MANAGER' AND CompanyID=?",[workflowItemId,COMPANY_ID]);
        assert(Number(history.total)>0,'Automatic submission must write action history');
    }finally{await connection.end();}
}

async function managerReturn(session, workflowItemId, comments = '') {
    return session.form(`/manager/record-workflow/${workflowItemId}/return`, { comments });
}

async function managerEndorse(session, workflowItemId, comments = '') {
    const response = await session.form(`/manager/record-workflow/${workflowItemId}/endorse`, { comments });
    assert([302, 303].includes(response.status), `Manager endorse failed for workflow item ${workflowItemId}: ${response.status}`);
    assert(!/error=/i.test(response.location || ''), `Manager endorse returned an error for workflow item ${workflowItemId}: ${response.location}`);
    return response;
}

async function entityApprove(session, workflowItemId, comments = '') {
    const response = await session.form(`/entity-head/record-workflow/${workflowItemId}/approve`, { comments });
    assert([302, 303].includes(response.status), `Entity Head approval failed for workflow item ${workflowItemId}: ${response.status}`);
    assert(!/error=/i.test(response.location || ''), `Entity Head approval returned an error for workflow item ${workflowItemId}: ${response.location}`);
    return response;
}

async function entityReturn(session, workflowItemId, comments = '') {
    return session.form(`/entity-head/record-workflow/${workflowItemId}/return`, { comments });
}

async function entityReject(session, workflowItemId, comments = '') {
    return session.form(`/entity-head/record-workflow/${workflowItemId}/reject`, { comments });
}

async function testTransfer(connection, sessions, lookups) {
    log('Testing transfer workflow...');
    const transferDate = '2026-07-15 00:00:00';
    const pfno = TEST_STAFF.transfer;
    const [beforeRows] = await connection.query('SELECT CDept FROM tblstaff WHERE PFNo = ?', [pfno]);
    const beforeDept = beforeRows[0].CDept;

    const save = await sessions.dataEntry.form('/data-entry/staff/transfer', {
        pfno,
        newDeptCode: lookups.dept2.Code,
        transferDate
    });
    assert(save.status === 200, 'Transfer save route did not return 200');

    const item = await findWorkflowItem(connection, 'transfer', `${encodeURIComponent(pfno)}%`);
    assert(item && item.Status === 'SUBMITTED_TO_MANAGER', 'Transfer save must automatically submit to Manager');

    await submitWorkflow(sessions.dataEntry, item.id, 'transfer');
    const [afterSubmitStaff] = await connection.query('SELECT CDept FROM tblstaff WHERE PFNo = ?', [pfno]);
    assert(afterSubmitStaff[0].CDept === beforeDept, 'Transfer changed department before final approval');

    const emptyReturn = await managerReturn(sessions.manager, item.id, '');
    assert([302, 303].includes(emptyReturn.status) && /error=/.test(emptyReturn.location), 'Manager return without comments should be blocked');

    const validReturn = await managerReturn(sessions.manager, item.id, 'Need date correction');
    assert([302, 303].includes(validReturn.status), 'Manager return failed for transfer');
    const [returnedRows] = await connection.query('SELECT Status FROM record_workflow_items WHERE id = ?', [item.id]);
    assert(returnedRows[0]?.Status === 'RETURNED_BY_MANAGER', 'Transfer was not moved to RETURNED_BY_MANAGER after Manager return');

    const resave = await sessions.dataEntry.form('/data-entry/staff/transfer', {
        pfno,
        newDeptCode: lookups.dept2.Code,
        transferDate
    });
    assert(resave.status === 200, 'Transfer re-save after Manager return did not return 200');

    const refreshedItem = await findWorkflowItem(connection, 'transfer', `${encodeURIComponent(pfno)}%`);
    assert(refreshedItem && refreshedItem.Status === 'SUBMITTED_TO_MANAGER', 'Transfer correction save must resubmit to Manager');

    await submitWorkflow(sessions.dataEntry, refreshedItem.id, 'transfer');
    await managerEndorse(sessions.manager, refreshedItem.id, 'Looks good');
    await entityApprove(sessions.entityHead, refreshedItem.id, 'Approved');

    const [transferRows] = await connection.query('SELECT approved, approvedby FROM tbltransfer WHERE PFNO = ? AND TDate = ? AND PrevDept = ?', [pfno, transferDate, beforeDept]);
    const [afterApprovalStaff] = await connection.query('SELECT CDept FROM tblstaff WHERE PFNo = ?', [pfno]);
    assert(Number(transferRows[0].approved) === -1, 'Transfer legacy approval field was not updated');
    assert(afterApprovalStaff[0].CDept === lookups.dept2.Code, 'Transfer did not update tblstaff.CDept after final approval');
}

async function testPromotion(connection, sessions, lookups) {
    log('Testing promotion workflow...');
    const promotionDate = '2026-07-16';
    const pfno = TEST_STAFF.promotion;
    const [beforeRows] = await connection.query('SELECT CGrade, JobTitle FROM tblstaff WHERE PFNo = ?', [pfno]);

    const save = await sessions.dataEntry.form('/data-entry/staff/promotion-demotion', {
        pfno,
        promotionDate,
        currentGradeCode: lookups.grade1.GradeCode,
        newJobTitle: lookups.job2.Code,
        newGrade: lookups.grade2.GradeCode,
        type: 'promotion'
    });
    assert([302, 303].includes(save.status), 'Promotion save route did not redirect successfully');

    const item = await findWorkflowItem(connection, 'promotion', `${encodeURIComponent(pfno)}%`);
    assert(item && item.Status === 'SUBMITTED_TO_MANAGER', 'Promotion save must automatically submit to Manager');
    await submitWorkflow(sessions.dataEntry, item.id, 'promotion');
    await managerEndorse(sessions.manager, item.id, 'Forwarded');

    const [midRows] = await connection.query('SELECT CGrade, JobTitle FROM tblstaff WHERE PFNo = ?', [pfno]);
    assert(midRows[0].CGrade === beforeRows[0].CGrade, 'Promotion changed grade before final approval');
    assert(midRows[0].JobTitle === beforeRows[0].JobTitle, 'Promotion changed job title before final approval');

    await entityApprove(sessions.entityHead, item.id, 'Approved');

    const [promoRows] = await connection.query('SELECT Approved FROM tblpromotions WHERE PFNO = ? AND Activity = 1', [pfno]);
    const [afterRows] = await connection.query('SELECT CGrade, GradeCode, JobTitle FROM tblstaff WHERE PFNo = ?', [pfno]);
    assert(Number(promoRows[0].Approved) === -1, 'Promotion legacy approval field was not updated');
    assert(afterRows[0].CGrade === lookups.grade2.GradeCode, 'Promotion did not update current grade after final approval');
    assert(afterRows[0].GradeCode === lookups.grade2.GradeCode, 'Promotion did not update GradeCode after final approval');
    assert(afterRows[0].JobTitle === lookups.job2.Code, 'Promotion did not update JobTitle after final approval');
}

async function testActing(connection, sessions, lookups) {
    log('Testing acting workflow...');
    const pfno = TEST_STAFF.acting;
    const sDate = '2026-07-20 00:00:00';
    const eDate = '2026-07-30 00:00:00';
    const actingAmount = 345;

    const save = await sessions.dataEntry.form('/data-entry/payroll/acting-allowance', {
        pfno,
        entryDate: '2026-07-14 00:00:00',
        c_grade: lookups.grade1.GradeCode,
        jobTitle: lookups.job1.Code,
        cGrade_salary: 1200,
        a_dept: lookups.dept2.Code,
        a_grade: lookups.grade2.GradeCode,
        a_jobTitle: lookups.job2.Code,
        gradeDifference: 1,
        a_days: 10,
        sDate,
        eDate,
        a_salary: actingAmount
    });
    assert(save.status === 200, 'Acting save route did not return 200');

    const [salaryBeforeSubmit] = await connection.query("SELECT Allw14 FROM tblsalary WHERE PFNo = ? AND Dept = ? AND PType = '01'", [pfno, lookups.dept1.Code]);
    assert(Number(salaryBeforeSubmit[0].Allw14 || 0) === 0, 'Acting changed Allw14 at draft stage');

    const item = await findWorkflowItem(connection, 'acting', `${encodeURIComponent(pfno)}%`);
    assert(item && item.Status === 'SUBMITTED_TO_MANAGER', 'Acting save must automatically submit to Manager');
    await submitWorkflow(sessions.dataEntry, item.id, 'acting');

    const editBlocked = await sessions.dataEntry.form('/data-entry/payroll/acting-allowance', {
        pfno,
        entryDate: '2026-07-14 00:00:00',
        c_grade: lookups.grade1.GradeCode,
        jobTitle: lookups.job1.Code,
        cGrade_salary: 1200,
        a_dept: lookups.dept2.Code,
        a_grade: lookups.grade2.GradeCode,
        a_jobTitle: lookups.job2.Code,
        gradeDifference: 1,
        a_days: 10,
        sDate,
        eDate,
        a_salary: actingAmount
    });
    assert(editBlocked.status === 409, 'Acting edit after submission was not blocked with 409');

    await managerEndorse(sessions.manager, item.id, 'Forwarded');
    const [salaryBeforeApproval] = await connection.query("SELECT Allw14 FROM tblsalary WHERE PFNo = ? AND Dept = ? AND PType = '01'", [pfno, lookups.dept1.Code]);
    assert(Number(salaryBeforeApproval[0].Allw14 || 0) === 0, 'Acting changed Allw14 before final approval');

    await entityApprove(sessions.entityHead, item.id, 'Approved');

    const [actingRows] = await connection.query('SELECT Approved FROM tblacting WHERE PFNO = ? AND SDate = ?', [pfno, sDate]);
    const [salaryAfterApproval] = await connection.query("SELECT Allw14 FROM tblsalary WHERE PFNo = ? AND Dept = ? AND PType = '01'", [pfno, lookups.dept1.Code]);
    assert(Number(actingRows[0].Approved) === -1, 'Acting legacy approval field was not updated');
    assert(Number(salaryAfterApproval[0].Allw14 || 0) === actingAmount, 'Acting final approval did not apply Allw14');
}

async function testLeave(connection, sessions, lookups) {
    log('Testing leave workflow...');
    const pfno = TEST_STAFF.leave;
    const save = await sessions.dataEntry.form('/data-entry/api/leave/application', {
        pfno,
        lType: lookups.leaveType.Code,
        lYear: '2026',
        deduct: 0,
        proposed: '2026-07-14',
        available: 20,
        lDays: 5,
        startDate: '2026-08-01',
        part: 5,
        holidays: 0,
        withPay: 1,
        resumptionDate: '2026-08-06',
        allowance: 0,
        resumed: 0,
        dateResumed: '',
        purchased: 0,
        daysPurchased: 0,
        datePurchased: ''
    });
    assert(save.status === 200, 'Leave save route did not return 200');

    const item = await findWorkflowItem(connection, 'leave', '%');
    assert(item && item.Status === 'SUBMITTED_TO_MANAGER', 'Leave save must automatically submit to Manager');
    await submitWorkflow(sessions.dataEntry, item.id, 'leave');
    await managerEndorse(sessions.manager, item.id, 'Forwarded');
    await entityApprove(sessions.entityHead, item.id, 'Approved');

    const [leaveRows] = await connection.query('SELECT Approved, ApprovedBy FROM tblleave WHERE ID = ?', [Number(decodeURIComponent(item.RecordReference))]);
    assert(Number(leaveRows[0].Approved) === -1, 'Leave final approval did not update legacy approval fields');
}

async function testTraining(connection, sessions) {
    log('Testing training workflow...');
    const pfno = TEST_STAFF.training;
    const startDate = '2026-09-01 00:00:00';

    const save = await sessions.dataEntry.form('/data-entry/api/staff/training', {
        pfno,
        course: 'Phase 11 Training',
        level: 'BASIC',
        type: '01',
        organisedBy: 'QA',
        duration: '5 Days',
        country: 'SL',
        startDate,
        cost: 100,
        sponsor: '01',
        completed: 0,
        yearCompleted: ''
    });
    assert(save.status === 200, 'Training save route did not return 200');

    const item = await findWorkflowItem(connection, 'training', `${encodeURIComponent(pfno)}%`);
    assert(item && item.Status === 'SUBMITTED_TO_MANAGER', 'Training save must automatically submit to Manager');
    const returned=await managerReturn(sessions.manager,item.id,'Synthetic training correction required');
    assert([302,303].includes(returned.status)&&!/error=/.test(returned.location),'Manager must return training before it can be edited');

    const updateDraft = await sessions.dataEntry.form('/data-entry/api/staff/training', {
        pfno,
        course: 'Phase 11 Training Updated',
        level: 'BASIC',
        type: '01',
        organisedBy: 'QA',
        duration: '6 Days',
        country: 'SL',
        startDate,
        cost: 150,
        sponsor: '01',
        completed: 0,
        yearCompleted: '',
        originalCourse: 'Phase 11 Training',
        originalStartDate: startDate
    }, 'PUT');
    assert(updateDraft.status === 200, 'Training draft edit failed');

    const updatedItem = await findWorkflowItem(connection, 'training', `${encodeURIComponent(pfno)}%`);
    await submitWorkflow(sessions.dataEntry, updatedItem.id, 'training');

    const updateBlocked = await sessions.dataEntry.form('/data-entry/api/staff/training', {
        pfno,
        course: 'Phase 11 Training Updated Again',
        level: 'BASIC',
        type: '01',
        organisedBy: 'QA',
        duration: '7 Days',
        country: 'SL',
        startDate,
        cost: 200,
        sponsor: '01',
        completed: 0,
        yearCompleted: '',
        originalCourse: 'Phase 11 Training Updated',
        originalStartDate: startDate
    }, 'PUT');
    assert(updateBlocked.status === 409, 'Training edit after submission was not blocked');

    await managerEndorse(sessions.manager, updatedItem.id, 'Forwarded');
    await entityApprove(sessions.entityHead, updatedItem.id, 'Approved');

    const [rows] = await connection.query('SELECT approved FROM tblcourse WHERE PFNo = ? AND Course = ? AND StartDate = ?', [pfno, 'Phase 11 Training Updated', startDate]);
    assert(Number(rows[0].approved) === -1, 'Training final approval did not update legacy approval fields');
}

async function testStaffExit(connection, sessions) {
    log('Testing staff exit workflow...');
    const pfno = TEST_STAFF.exit;
    const save = await sessions.dataEntry.form('/data-entry/staff/exit', {
        pfno,
        reason: '04',
        reasonDate: '2026-10-01',
        noticeDate: '2026-08-01',
        noticeExpiry: '2026-09-30',
        dateLeft: '2026-10-01',
        briefDetails: 'Phase 11 retirement test',
        dateAccepted: '2026-08-15',
        interviewed: '1',
        dateInterviewed: '2026-08-20'
    });
    assert([302, 303].includes(save.status), 'Staff exit save route did not redirect');

    const item = await findWorkflowItem(connection, 'staff-exit', `${encodeURIComponent(pfno)}%`);
    assert(item && item.Status === 'SUBMITTED_TO_MANAGER', 'Staff exit save must automatically submit to Manager');

    const [beforeRows] = await connection.query('SELECT EmpStatus FROM tblstaff WHERE PFNo = ?', [pfno]);
    await submitWorkflow(sessions.dataEntry, item.id, 'staff-exit');
    await managerEndorse(sessions.manager, item.id, 'Forwarded');
    const [midRows] = await connection.query('SELECT EmpStatus FROM tblstaff WHERE PFNo = ?', [pfno]);
    assert(midRows[0].EmpStatus === beforeRows[0].EmpStatus, 'Staff exit changed EmpStatus before final approval');

    await entityApprove(sessions.entityHead, item.id, 'Approved');
    const [formerRows] = await connection.query('SELECT Approved FROM tblformer WHERE PFNo = ?', [pfno]);
    const [afterRows] = await connection.query('SELECT EmpStatus, ReasonCode FROM tblstaff WHERE PFNo = ?', [pfno]);
    assert(Number(formerRows[0].Approved) === -1, 'Staff exit legacy approval field was not updated');
    assert(afterRows[0].EmpStatus === '02', 'Staff exit did not apply the expected final former EmpStatus mapping');
    assert(afterRows[0].ReasonCode === '04', 'Staff exit did not persist ReasonCode on tblstaff');
}

async function testRedundancy(connection, sessions) {
    log('Testing redundancy workflow...');
    const pfno = TEST_STAFF.redundancy;
    const save = await sessions.dataEntry.form('/data-entry/staff/redundancy', { pfno });
    assert([302, 303].includes(save.status), 'Redundancy save route did not redirect');

    const item = await findWorkflowItem(connection, 'redundancy', `${encodeURIComponent(pfno)}%`);
    assert(item && item.Status === 'SUBMITTED_TO_MANAGER', 'Redundancy save must automatically submit to Manager');

    const [beforeSubmit] = await connection.query('SELECT Redundant FROM tblstaff WHERE PFNo = ?', [pfno]);
    assert(Number(beforeSubmit[0].Redundant) === 2, 'Redundancy proposal flag was not stored as pending state');

    await submitWorkflow(sessions.dataEntry, item.id, 'redundancy');
    const [midRows] = await connection.query('SELECT Redundant FROM tblstaff WHERE PFNo = ?', [pfno]);
    assert(Number(midRows[0].Redundant) === 2, 'Redundancy pending state changed before final approval');

    await managerEndorse(sessions.manager, item.id, 'Forwarded');
    await entityApprove(sessions.entityHead, item.id, 'Approved');

    const [afterRows] = await connection.query('SELECT Redundant, ReasonCode, Approved FROM tblstaff WHERE PFNo = ?', [pfno]);
    assert(Number(afterRows[0].Redundant) === 1, 'Redundancy final approval did not activate the live redundancy state');
    assert(afterRows[0].ReasonCode === '12', 'Redundancy did not preserve reason code 12');
    assert(Number(afterRows[0].Approved) === -1, 'Redundancy final approval did not update tblstaff legacy approval field');
}

async function testLegacyManagerRoutes(sessions) {
    log('Testing legacy manager routes...');
    const checks = [
        ['/manager/approve/transfer', '/manager/record-workflow?module=transfer&status=SUBMITTED_TO_MANAGER'],
        ['/manager/approve/promotion-demotion', '/manager/record-workflow?module=promotion&status=SUBMITTED_TO_MANAGER'],
        ['/manager/approve/training', '/manager/record-workflow?module=training&status=SUBMITTED_TO_MANAGER'],
        ['/manager/approve/leave-application', '/manager/record-workflow?module=leave&status=SUBMITTED_TO_MANAGER'],
        ['/manager/approve/acting-allowance', '/manager/record-workflow?module=acting&status=SUBMITTED_TO_MANAGER'],
        ['/manager/approve/exit', '/manager/record-workflow?module=staff-exit&status=SUBMITTED_TO_MANAGER'],
        ['/manager/approve/redundancy', '/manager/record-workflow?module=redundancy&status=SUBMITTED_TO_MANAGER']
    ];

    for (const [route, expected] of checks) {
        const response = await sessions.manager.request(route);
        assert([302, 303].includes(response.status), `Expected redirect from ${route}`);
        assert(response.location === expected, `Unexpected redirect for ${route}: ${response.location}`);
    }
}

async function cleanupFixtures(connection) {
    const staffList = Object.values(TEST_STAFF);
    await connection.query(
        `DELETE FROM workflow_notifications WHERE ReferenceID IN (${staffList.map(() => '?').join(', ')}) OR Message LIKE '%Phase 11%'`,
        [...staffList]
    ).catch(() => {});
    await connection.query(`DELETE FROM record_workflow_actions WHERE CompanyID = ? AND RecordReference LIKE '%1%01%'`, [COMPANY_ID]).catch(() => {});
    await connection.query(`DELETE FROM record_workflow_items WHERE CompanyID = ? AND RecordReference LIKE '%1%01%'`, [COMPANY_ID]).catch(() => {});
    await connection.query(`DELETE FROM tbltransfer WHERE PFNO = ?`, [TEST_STAFF.transfer]);
    await connection.query(`DELETE FROM tblpromotions WHERE PFNO = ?`, [TEST_STAFF.promotion]);
    await connection.query(`DELETE FROM tblacting WHERE PFNO = ?`, [TEST_STAFF.acting]);
    await connection.query(`DELETE FROM tblleave WHERE PFNO = ?`, [TEST_STAFF.leave]);
    await connection.query(`DELETE FROM tblcourse WHERE PFNo = ?`, [TEST_STAFF.training]);
    await connection.query(`DELETE FROM tblformer WHERE PFNo = ?`, [TEST_STAFF.exit]);
    await connection.query(`DELETE FROM tblsalary WHERE PFNo IN (${staffList.map(() => '?').join(', ')})`, staffList);
    await connection.query(`DELETE FROM tblstaff WHERE PFNo IN (${staffList.map(() => '?').join(', ')})`, staffList);
    await connection.query(`DELETE FROM tblstaff WHERE PFNo = '9103'`).catch(() => {});
}

async function main() {
    const connection = await mysql.createConnection(DB_CONFIG);
    try {
        await cleanupFixtures(connection).catch(() => {});
        await ensureTestUsers(connection);
        const lookups = await getLookups(connection);
        await ensureWorkflowRoleStaff(connection, lookups);
        await ensureTestStaff(connection, lookups);

        const sessions = {
            dataEntry: await login('phase11_dataentry'),
            manager: await login('phase11_manager'),
            entityHead: await login('phase11_entity', '/entity-head/login')
        };

        const smokeRoutes = [
            ['/data-entry/staff/transfer', sessions.dataEntry],
            ['/data-entry/staff/promotion-demotion', sessions.dataEntry],
            ['/data-entry/payroll/acting-allowance', sessions.dataEntry],
            ['/data-entry/leave/application', sessions.dataEntry],
            ['/data-entry/staff/training', sessions.dataEntry],
            ['/data-entry/staff/exit', sessions.dataEntry],
            ['/data-entry/staff/redundancy', sessions.dataEntry],
            ['/manager/record-workflow', sessions.manager],
            ['/entity-head/record-workflow', sessions.entityHead]
        ];

        for (const [route, session] of smokeRoutes) {
            const response = await session.request(route);
            assert(response.status === 200, `Smoke route failed: ${route} -> ${response.status}`);
        }

        await testTransfer(connection, sessions, lookups);
        await testPromotion(connection, sessions, lookups);
        await testActing(connection, sessions, lookups);
        await testLeave(connection, sessions, lookups);
        await testTraining(connection, sessions);
        await testStaffExit(connection, sessions);
        await testRedundancy(connection, sessions);
        await testLegacyManagerRoutes(sessions);

        log('Phase 11A verification passed.');
    } finally {
        await cleanupFixtures(connection).catch((error) => {
            console.error('Cleanup warning:', error.message);
        });
        await connection.end();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
