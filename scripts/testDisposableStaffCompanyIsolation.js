require('./requireDisposableDatabase')();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const signature = require('cookie-signature');
const { pool, login, request, csrfFrom, cookieFrom } = require('./securityHttpTestUtils');
const base = process.env.TEST_BASE_URL;
const password = 'SyntheticAcceptanceOnly!123';
const checks = [];
const form = {
    pfno: 'Q001', sname: 'Synthetic Employee Updated', dob: '1990-01-01', sex: 'M', mstatus: 'S',
    nation: '01', address: 'Synthetic test address', city: 'Test', email: 'employee@example.test',
    doe: '2020-01-01', dateConfirmed: '2020-06-01', jobTitle: '0802', cGrade: '0800', gradeEmployed: '0800',
    dept: '01', empType: '01', empStatus: '01', nkin: 'Synthetic Kin', nkinRelationship: '01',
    nkinAddr: 'Test', accountNo: 'TESTONLY0001', nassitNo: 'TESTONLY0001', cGradeDate: '2020-01-01',
    cDeptDate: '2020-01-01', dEmp: '01', notch: '1', level: '08', vehicle: 'NO'
};

async function snapshot() {
    const result = {};
    for (const table of ['tblstaff', 'tblsalary', 'tblpayroll', 'tblqualif', 'tbldependant', 'tblaudittrail']) {
        const [rows] = await pool.query(`SELECT * FROM ${table}`);
        result[table] = rows.map(row => JSON.stringify(row)).sort();
    }
    return result;
}

async function save(session, data) {
    const response = await request(base, '/data-entry/staff/new-edit', {
        method: 'POST', headers: { cookie: session.cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': session.csrfToken },
        body: new URLSearchParams(data)
    });
    await response.text();
    return response;
}

async function denied(name, session, data, statuses) {
    const before = await snapshot();
    assert(statuses.includes((await save(session, data)).status), name);
    assert.deepEqual(await snapshot(), before, `${name}: no partial record/audit writes`);
    checks.push(name);
}

async function main() {
    const own = await login(base, 'qa_data-entry', password);
    const [[original]] = await pool.execute('SELECT * FROM tblstaff WHERE PFNo=? AND CompanyID=1', ['Q001']);
    assert(original);
    await pool.query('INSERT INTO tblstaff SET ?', [{ ...original, PFNo: 'Q002', CompanyID: 2, SName: 'Synthetic Foreign Employee' }]);
    const tokens = await Promise.all(Array.from({ length: 6 }, async () => {
        const response = await request(base, '/qa-csrf-concurrency-not-found', { headers: { cookie: own.cookie } });
        assert.equal(response.status, 404); return csrfFrom(await response.text());
    }));
    assert(tokens.every(token => token === own.csrfToken));
    checks.push('parallel redirected requests retain persisted login CSRF');
    for (const url of ['/data-entry/staff/new-edit/search?q=Synthetic', '/data-entry/enquiry/staff/birthdays?month=1', '/data-entry/enquiry/staff/general-info?export=json']) {
        const response = await request(base, url, { headers: { cookie: own.cookie } });
        assert.equal(response.status, 200); const rows = await response.json();
        assert(!rows.some(row => row.PFNo === 'Q002'), 'Foreign employee must not appear in selectors or enquiry');
    }
    checks.push('staff search, birthday and general-info lists exclude foreign company');
    await denied('same-installation user cannot edit foreign staff', own, { ...form, pfno: 'Q002' }, [404]);
    await denied('forged company rejected', own, { ...form, CompanyID: '2' }, [403]);
    await denied('invalid employee identifier rejected', own, { ...form, pfno: '../Q001' }, [400]);
    await denied('unauthenticated save rejected', { cookie: '', csrfToken: '' }, form, [302, 403]);
    const manager = await login(base, 'qa_manager', password);
    await denied('wrong role rejected with valid CSRF', manager, form, [403]);

    const [columns] = await pool.query('SHOW COLUMNS FROM tbldependant');
    for (const [DepNo, CompanyID, Dependant] of [['8', 1, 'Synthetic Own Child'], ['9', 2, 'Synthetic Foreign Child']]) {
        const row = { PFNo: 'Q001', DepNo, CompanyID, Dependant, RCode: '03', DOB: '2015-01-01', PhoneNo: '', Closed: 0, Approved: 0 };
        for (const column of columns) {
            if (!(column.Field in row) && column.Null === 'NO' && column.Default === null && !column.Extra.includes('auto_increment')) {
                row[column.Field] = /int|decimal|float|double|bit/i.test(column.Type) ? 0 : /date|timestamp/i.test(column.Type) ? '2098-01-01' : /^time/i.test(column.Type) ? '00:00:00' : '';
            }
        }
        await pool.query('INSERT INTO tbldependant SET ?', [row]);
    }
    for (const [url, method, actor, data] of [
        ['/data-entry/api/staff/dependants', 'PUT', own, { pfno: 'Q001', depNo: '9', dependant: 'MUST NOT CHANGE', rcode: '03', dob: '2015-01-01', phone: '' }],
        ['/manager/approve/dependants', 'POST', manager, { pfno: 'Q001', depNo: '9', action: 'approve' }]
    ]) {
        const beforeChild = await snapshot();
        const response = await request(base, url, { method, headers: { cookie: actor.cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': actor.csrfToken }, body: new URLSearchParams(data) });
        assert.equal(response.status, 404); await response.text(); assert.deepEqual(await snapshot(), beforeChild);
    }
    const children = await request(base, '/data-entry/api/staff/Q001/dependants', { headers: { cookie: own.cookie } });
    assert.equal(children.status, 200); const childData = await children.json();
    assert(childData.dependants.some(row => String(row.DepNo) === '8'));
    assert(!childData.dependants.some(row => String(row.DepNo) === '9'));
    const ownChild = await request(base, '/data-entry/api/staff/dependants', { method: 'PUT', headers: { cookie: own.cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': own.csrfToken },
        body: new URLSearchParams({ pfno: 'Q001', depNo: '8', dependant: 'Updated Synthetic Own Child', rcode: '03', dob: '2015-01-01', phone: '' }) });
    assert.equal(ownChild.status, 200); await ownChild.text();
    const [[childSaved]] = await pool.execute('SELECT Dependant FROM tbldependant WHERE PFNo=? AND DepNo=? AND CompanyID=1', ['Q001', '8']);
    assert.equal(childSaved.Dependant, 'Updated Synthetic Own Child');
    checks.push('foreign child-row edit/approval denied without writes; own child edit and scoped list work');
    const managerReview = await request(base, '/manager/approve/new-staff/view?pfno=Q001', { headers: { cookie: manager.cookie } });
    assert.equal(managerReview.status, 200);
    assert(!(await managerReview.text()).includes('Synthetic Foreign Child'));
    checks.push('Manager staff review excludes foreign dependant records');

    // Simulate a session issued before installation enforcement was deployed.
    const sessionId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const session = { cookie: { originalMaxAge: 600000, expires: new Date(Date.now() + 600000).toISOString(), httpOnly: true, path: '/' },
        user: { id: 820010, role: 'data-entry', companyId: 2, name: 'Synthetic Foreign Operator' }, csrfToken: token };
    await pool.execute('INSERT INTO sessions (session_id, expires, data) VALUES (?, ?, ?)', [sessionId, Math.floor(Date.now()/1000)+600, JSON.stringify(session)]);
    const foreign = { cookie: `${process.env.SESSION_COOKIE_NAME || 'hrpayroll.sid'}=${encodeURIComponent('s:'+signature.sign(sessionId, require('../config/sessionStore').getSessionSecret({isProduction:false})))}`, csrfToken: token };
    await denied('foreign-company stale session rejected', foreign, form, [403]);

    const hash = await require('bcrypt').hash(password, 10);
    await pool.execute('INSERT INTO tblpassword (PFNo, DateCreated, Level, Username, FullName, Pword, Email, CompanyID) VALUES (?, NOW(), ?, ?, ?, ?, ?, ?)',
        [820010, 'Data Entry', 'qa_foreign_dataentry', 'Synthetic Foreign Operator', hash, 'foreign@example.test', 2]);
    const page = await request(base, '/login');
    const anonymousCookie = cookieFrom(page), loginToken = csrfFrom(await page.text());
    const refused = await request(base, '/login', { method: 'POST', headers: { cookie: anonymousCookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ identifier: 'qa_foreign_dataentry', password, _csrf: loginToken }) });
    assert.equal(refused.status, 401); await refused.text();
    checks.push('foreign-company login rejected');

    assert.equal((await save(own, form)).status, 302);
    const [[saved]] = await pool.execute('SELECT * FROM tblstaff WHERE PFNo=? AND CompanyID=1', ['Q001']);
    assert.equal(saved.SName, form.sname); assert.equal(Number(saved.Approved), 0, 'Staff edit must require fresh Manager approval');
    const [[foreignAfter]] = await pool.execute('SELECT * FROM tblstaff WHERE PFNo=? AND CompanyID=2', ['Q002']);
    assert.equal(foreignAfter.SName, 'Synthetic Foreign Employee');
    const [[audit]] = await pool.execute("SELECT COUNT(*) n FROM tblaudittrail WHERE CompanyID=1 AND RecordID='Q001' AND FormName='data-entry/staff/new-edit' AND UserName='Synthetic data-entry' AND Action='Edit'");
    assert(Number(audit.n)>0); checks.push('same-company edit preserves approval rules and actor/company audit');

    // Fail the real audit INSERT after preparation: all related changes must roll back.
    await pool.query("CREATE TRIGGER qa_staff_audit_failure BEFORE INSERT ON tblaudittrail FOR EACH ROW BEGIN IF NEW.FormName='data-entry/staff/new-edit' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic audit failure'; END IF; END");
    try { await denied('audit persistence failure rolls back all staff/master/salary writes', own, { ...form, sname: 'MUST ROLL BACK' }, [500]); }
    finally { await pool.query('DROP TRIGGER qa_staff_audit_failure'); }
    console.log(JSON.stringify({ status: 'PASS', checks, liveDataUsed: false }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
