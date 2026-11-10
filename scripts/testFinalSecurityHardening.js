const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const express = require('express');
const originalLoad = Module._load;
const originalEnv = { ...process.env };
let rows = new Map();
let events = [];
let failAudit = false;
let nextId = 100;
let locks = Promise.resolve();

async function execute(sql, args = []) {
    if (sql.startsWith('SELECT Pword AS storedPassword')) {
        const row=rows.get(String(args[0]));
        return [row && row.CompanyID===args[1] ? [{storedPassword:row.Pword}] : []];
    }
    if (sql.startsWith('SELECT CompanyID FROM tblstaff')) return [[{ CompanyID: args[0] === '0002' ? 2 : 1 }]];
    if (sql.includes('SELECT CompanyID FROM tblcominfo')) return [[{ CompanyID: args[0] }]];
    if (sql.includes('SELECT PFNo FROM tblpassword WHERE LOWER')) return [[]];
    if (sql.startsWith('INSERT INTO tblpassword')) {
        const id = nextId++;
        rows.set(String(id), { PFNo: id, Level: args[0], Username: args[1], FullName: args[2], Email: args[3], CompanyID: args[4], Pword: null });
        return [{ insertId: id }];
    }
    if (sql.startsWith('SELECT PFNo, Email')) {
        const row = rows.get(String(args[0]));
        return [[...(row && row.CompanyID === Number(args[1]) ? [{ ...row }] : [])]];
    }
    if (sql.startsWith('UPDATE tblpassword SET Pword')) {
        const row = rows.get(String(args[1]));
        if (!row || row.CompanyID !== args[2] || row.Pword !== args[3]) return [{ affectedRows: 0 }];
        row.Pword = args[0];
        return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('DELETE FROM tblpassword')) {
        const row = rows.get(String(args[0]));
        if (!row || row.Level !== args[1] || row.CompanyID !== args[2]) return [{ affectedRows: 0 }];
        rows.delete(String(args[0]));
        return [{ affectedRows: 1 }];
    }
    throw new Error('Unexpected fixture SQL');
}

const pool = { execute, getConnection: async () => {
    let unlock, snapshot, auditSnapshot;
    return { execute,
        beginTransaction: async () => {
            const previous = locks;
            locks = new Promise(resolve => { unlock = resolve; });
            await previous;
            snapshot = structuredClone(rows); auditSnapshot = [...events];
        },
        commit: async () => {},
        rollback: async () => { rows = snapshot; events = auditSnapshot; },
        release: () => unlock?.()
    };
} };

Module._load = function(request) {
    if (request === '../config/db' || request === './db') return pool;
    if (request === './auditTrailService') return { writeAuditEntryWithExecutor: async (connection, event) => {
        if (failAudit) throw new Error('fixture audit unavailable');
        events.push({ ...event, time: Date.now() });
    } };
    return originalLoad.apply(this, arguments);
};

async function accountTests() {
    process.env.RESET_TOKEN_SECRET = 'isolated-fixture-secret-'.repeat(3);
    const service = require('../services/accountSecurityService');
    const admin = { user: { role: 'admin', id: 9, companyId: 1, name: 'Fixture Admin' } };
    const input = { Username: 'synthetic', FullName: 'Synthetic Only', Email: 'synthetic@example.test' };
    const id = await service.createAccount(admin, 'Finance Manager', input);
    assert.equal(rows.get(String(id)).Level, 'Finance Manager');
    assert.equal(rows.get(String(id)).CompanyID, 1);
    assert.equal(rows.get(String(id)).Pword, null);
    assert.equal(events.at(-1).userName, 'Fixture Admin');
    assert.equal(events.at(-1).companyId, 1);
    assert(events.at(-1).time <= Date.now());
    await assert.rejects(service.createAccount(admin, 'Developer', input), /Role assignment/);
    await assert.rejects(service.createAccount(admin, 'Manager', { ...input, CompanyID: 2 }), /Not authorized/);
    await assert.rejects(service.createAccount({ user: { role: 'finance-manager', companyId: 1 } }, 'Manager', input), /Not authorized/);
    assert.throws(() => service.actorScope({ user: { role: 'admin' } }), /Company scope/);
    assert.equal(service.passwordIsValid('short'), false);
    assert.equal(service.passwordIsValid('A1!'.repeat(30)), false);
    const token = await service.issueSetupToken(id, 1);
    await assert.rejects(service.issueSetupToken(id, 2), /not found/);
    await assert.rejects(service.verifySetupToken(token + 'bad'));
    const expired = jwt.sign({ ...jwt.decode(token), exp: Math.floor(Date.now()/1000)-1 }, process.env.RESET_TOKEN_SECRET);
    await assert.rejects(service.verifySetupToken(expired));
    await assert.rejects(service.setPassword(token, 'LongStrong!123', id + 1), /Invalid account/);
    await service.setPassword(token, 'LongStrong!123', id);
    assert(await bcrypt.compare('LongStrong!123', rows.get(String(id)).Pword));
    await assert.rejects(service.setPassword(token, 'OtherStrong!123'), /Invalid or expired/);
    const second = await service.issueSetupToken(id, 1);
    const concurrent = await Promise.allSettled([service.setPassword(second, 'SecondStrong!123'), service.setPassword(second, 'ThirdStrong!123')]);
    assert.equal(concurrent.filter(x => x.status === 'fulfilled').length, 1);
    const before = rows.get(String(id)).Pword;
    failAudit = true;
    await assert.rejects(service.createAccount(admin, 'Manager', input), /audit unavailable/);
    assert.equal(rows.size, 1);
    const failedToken = await service.issueSetupToken(id, 1);
    await assert.rejects(service.setPassword(failedToken, 'FourthStrong!123'), /audit unavailable/);
    assert.equal(rows.get(String(id)).Pword, before);
    failAudit = false;
    const owner={id,companyId:1,source:'tblpassword',role:'finance-manager',name:'Fixture Holder'};
    await assert.rejects(service.changeOwnPassword(owner,'wrong','ChangedOwn!123'),/Current password/);
    await assert.rejects(service.changeOwnPassword(owner,'wrong','short'),/12\+/);
    failAudit=true;
    await assert.rejects(service.changeOwnPassword(owner,concurrent[0].status==='fulfilled'?'SecondStrong!123':'ThirdStrong!123','ChangedOwn!123'),/audit unavailable/);
    assert.equal(rows.get(String(id)).Pword,before);failAudit=false;
    await service.changeOwnPassword(owner,concurrent[0].status==='fulfilled'?'SecondStrong!123':'ThirdStrong!123','ChangedOwn!123');
    assert(await bcrypt.compare('ChangedOwn!123',rows.get(String(id)).Pword));
    await assert.rejects(service.deleteAccount({ user: { ...admin.user, companyId: 2 } }, 'Finance Manager', id), /not authorized/i);
    assert(rows.has(String(id)));
    await assert.rejects(service.manageDeveloper(admin, 'create'), /Not authorized/);
    const auth = require('../services/authService');
    const size = rows.size;
    process.env.NODE_ENV = 'production';
    assert.equal((await auth.ensureSeedDeveloper()).created, false);
    assert.equal(rows.size, size);
    const savedSecret=process.env.RESET_TOKEN_SECRET;
    process.env.RESET_TOKEN_SECRET='';process.env.JWT_SECRET='';
    await assert.rejects(service.issueSetupToken(id,1),/strong reset-token secret/);
    process.env.RESET_TOKEN_SECRET=savedSecret;
    const serverSource = await fs.readFile(path.resolve(__dirname, '../server.js'), 'utf8');
    assert(!serverSource.includes('ensureSeedDeveloper('));
    process.env.NODE_ENV = 'test';
    console.log('PASS account security: scoped/fixed roles, strong hashes, expiration/tamper/identity checks, replay/concurrency, audit rollback, production bootstrap disabled. All accounts are in-memory only.');
}

async function sessionTests() {
    const { MysqlSessionStore } = require('../config/sessionStore');
    let calls = 0, release;
    const sqlCalls = [];
    const store = new MysqlSessionStore({ query: sql => {
        sqlCalls.push(sql); calls++;
        return new Promise(resolve => { release = () => resolve([{ affectedRows: 2 }]); });
    } }, { cleanupBatchSize: 2, cleanupIntervalMs: 20 });
    const a = store.clearExpiredSessions();
    assert.equal(a, store.clearExpiredSessions());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert(sqlCalls[0].includes('expires < UNIX_TIMESTAMP()'));
    assert(sqlCalls[0].includes('LIMIT 2'));
    release(); await a;
    store.startCleanup();
    assert(store.cleanupTimer);
    await store.close();
    assert.equal(store.cleanupTimer, null);
    await store.clearExpiredSessions();
    assert.equal(calls, 1);
    const broken = new MysqlSessionStore({ query: () => { throw new Error('fixture DB error'); } });
    await assert.rejects(broken.clearExpiredSessions(), /fixture DB error/);
    await broken.close();
    const now=Math.floor(Date.now()/1000);
    const sessions=[{id:'expired1',expires:now-100},{id:'expired2',expires:now-20},{id:'expired3',expires:now-1},{id:'active',expires:now+600}];
    const worker=new MysqlSessionStore({query:async sql=>{
        assert(sql.includes('expires < UNIX_TIMESTAMP()'));
        const expired=sessions.filter(x=>x.expires<now).sort((x,y)=>x.expires-y.expires).slice(0,2);
        for(const item of expired) sessions.splice(sessions.indexOf(item),1);
        return [{affectedRows:expired.length}];
    }},{cleanupBatchSize:2});
    await worker.clearExpiredSessions();assert.equal(sessions.length,2);assert(sessions.some(x=>x.id==='active'));
    await worker.clearExpiredSessions();assert.deepEqual(sessions.map(x=>x.id),['active']);await worker.close();
    console.log('PASS session cleanup: bounded indexed predicate, no overlap, sync/async errors, timer stopped; touch cannot recreate deleted sessions (source checked).');
}

async function privateFileTests() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'waec-private-test-'));
    process.env.PRIVATE_UPLOAD_DIR = root;
    const { createPrivateFileHandler, createImageUpload, imageType } = require('../services/privateFileService');
    await fs.mkdir(path.join(root, 'staff_photos'));
    const file = path.join(root, 'staff_photos', 'fixture.png');
    const png = Buffer.from([137,80,78,71,13,10,26,10]);
    await fs.writeFile(file, png);
    assert.equal(imageType(Buffer.from('<script>bad</script>')), null);
    assert.equal(imageType(png), 'png');
    const app = express();
    app.use((req, res, next) => { if (req.get('x-test-role')) req.user = { id: 'synthetic-file-user', role: req.get('x-test-role'), companyId: Number(req.get('x-test-company')) }; next(); });
    app.post('/upload', createImageUpload('staff_photos').single('photo'), (req,res)=>res.json({filename:req.file.filename}));
    app.use('/uploads', createPrivateFileHandler({ roots: [root], executor: { query: async (sql, args) => {
        assert(sql.includes('CompanyID = ?'));
        return [args[0] === '/uploads/staff_photos/fixture.png' && args[1] === 1 ? [{ PFNo: '0001' }] : []];
    } } }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
        assert.equal((await fetch(url+'/uploads/staff_photos/fixture.png')).status, 401);
        const headers = { 'x-test-role': 'manager', 'x-test-company': '1' };
        const allowed = await fetch(url+'/uploads/staff_photos/fixture.png', { headers });
        assert.equal(allowed.status, 200);
        assert.equal(allowed.headers.get('cache-control'), 'private, no-store');
        assert.equal(allowed.headers.get('x-content-type-options'), 'nosniff');
        assert.equal((await fetch(url+'/uploads/staff_photos/fixture.png', { headers: { ...headers, 'x-test-company': '2' } })).status, 404);
        assert.equal((await fetch(url+'/uploads/medical_receipts/fixture.png', { headers: { ...headers, 'x-test-role': 'finance-manager' } })).status, 403);
        assert.equal((await fetch(url+'/uploads/staff_photos/fixture.exe', { headers })).status, 404);
        assert.equal((await fetch(url+'/uploads/staff_photos/%252e%252e', { headers })).status, 404);
        assert.equal((await fetch(url+'/uploads/staff_photos/fixture.png', { headers: { ...headers, 'x-test-company': '0' } })).status, 403);
        const uploadHeaders = { 'x-test-role':'data-entry','x-test-company':'1' };
        function form(buffer, filename='photo.png', pfno='0001') {
            const data=new FormData(); data.set('pfno',pfno);data.set('photo',new Blob([buffer],{type:'image/png'}),filename);return data;
        }
        const forged = form(png); forged.set('CompanyID', '2');
        assert.equal((await fetch(url+'/upload',{method:'POST',headers:uploadHeaders,body:forged})).status,403);
        const forgedWithoutFile = new FormData(); forgedWithoutFile.set('pfno','0001'); forgedWithoutFile.set('CompanyID','2');
        assert.equal((await fetch(url+'/upload',{method:'POST',headers:uploadHeaders,body:forgedWithoutFile})).status,403);
        assert.equal((await fetch(url+'/upload',{method:'POST',headers:uploadHeaders,body:form(Buffer.from('<script>bad</script>'))})).status,400);
        assert.equal((await fetch(url+'/upload',{method:'POST',headers:uploadHeaders,body:form(png,'file.exe')})).status,400);
        assert.equal((await fetch(url+'/upload',{method:'POST',headers:uploadHeaders,body:form(png,'file.png','0002')})).status,403);
        assert.equal((await fetch(url+'/upload',{method:'POST',headers:uploadHeaders,body:form(Buffer.alloc(3*1024*1024+1))})).status,400);
        const accepted=await fetch(url+'/upload',{method:'POST',headers:uploadHeaders,body:form(png,'../../untrusted.png')});
        assert.equal(accepted.status,200);
        const stored=await accepted.json();assert(/^[0-9a-f-]+\.png$/.test(stored.filename));
        await fs.unlink(path.join(root,'staff_photos',stored.filename));
    } finally {
        await new Promise(resolve => server.close(resolve));
        await fs.unlink(file); await fs.rmdir(path.dirname(file)); await fs.rmdir(root);
    }
    console.log('PASS private files: real HTTP auth/role/company/invalid-path denial, headers, safe image classification; synthetic temporary file removed.');
}

async function shutdownTests() {
    const { createShutdownHandler } = require('../services/shutdownService');
    const steps = [];
    const shutdown = createShutdownHandler({
        server: { close: cb => { steps.push('http'); setTimeout(cb, 20); }, closeIdleConnections: () => {} },
        sessionStore: { stopCleanup: () => steps.push('timer'), close: async () => steps.push('sessions') },
        mailer: { close: async () => steps.push('smtp') }, pool: { end: async () => steps.push('pool') },
        exit: code => steps.push(`exit${code}`)
    });
    const a = shutdown(); assert.equal(a, shutdown()); await a;
    assert.deepEqual(steps, ['timer','http','sessions','smtp','pool','exit0']);
    await new Promise(resolve=>{
        const deadline=createShutdownHandler({server:{close:()=>{},closeAllConnections:()=>steps.push('forced')},
            sessionStore:{stopCleanup:()=>{}},mailer:{},pool:{},timeoutMs:1000,exit:code=>{assert.equal(code,1);resolve();}});
        deadline();assert.equal(deadline(),deadline());
    });
    assert(steps.includes('forced'));
    console.log('PASS graceful shutdown: duplicate signal guard, HTTP drain before pool close, timers/mail closed, success exit.');
}

(async () => {
    try { await accountTests(); await sessionTests(); await privateFileTests(); await shutdownTests(); }
    finally { Module._load = originalLoad; process.env = originalEnv; }
})().catch(error => { console.error('FAIL', error); process.exitCode = 1; });
