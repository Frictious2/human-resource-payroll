require('./requireDisposableDatabase')();
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { readZip, createZip } = require('./stagingArchive');
const pool = require('../config/db');
const root = path.resolve(__dirname, '..'), extracted = path.join(root, 'package-extracted');
let child;
const sessionSecret = crypto.randomBytes(48).toString('hex'), resetSecret = crypto.randomBytes(48).toString('hex');
const port = 3271, origin = `http://127.0.0.1:${port}`;
const passwords = {};

function setupCli(values) {
    return new Promise((resolve,reject)=>{
        const processChild=spawn(process.execPath,['scripts/initializeCpanelStaging.js','--schema','--seed','--passwords-stdin'],{
            cwd:extracted,env:{...process.env,WAEC_QA_PRODUCTION_MODE:'true',SESSION_SECRET:sessionSecret,RESET_TOKEN_SECRET:resetSecret,
                APP_BASE_URL:'https://staging.example.invalid',TRUST_PROXY_HOPS:'1'},stdio:['pipe','pipe','pipe']});
        let output='';const timer=setTimeout(()=>{processChild.kill();reject(new Error('Setup CLI timeout.'));},120000);
        processChild.stdout.on('data',data=>{output+=data;});processChild.stderr.on('data',data=>{output+=data;});
        processChild.on('error',error=>{clearTimeout(timer);reject(error);});
        processChild.on('close',code=>{clearTimeout(timer);resolve({code,output});});
        processChild.stdin.end(JSON.stringify(values));
    });
}

async function launch() {
    const env = { ...process.env, WAEC_QA_PRODUCTION_MODE: 'true', SESSION_SECRET: sessionSecret, RESET_TOKEN_SECRET: resetSecret,
        APP_BASE_URL: 'https://staging.example.invalid', APP_HOST: '127.0.0.1', TRUST_PROXY_HOPS: '1', PORT: String(port), STAGING_SETUP_ENABLED: 'false' };
    child = spawn(process.execPath, ['app.js'], { cwd: extracted, env, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve,reject)=>{let error='';const timer=setTimeout(()=>reject(new Error('Packaged startup timed out: '+error.slice(-300))),30000);
        child.stdout.on('data',data=>{if(String(data).includes(`Server running on http://localhost:${port}`)){clearTimeout(timer);resolve();}});
        child.stderr.on('data',data=>{error+=data;});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Packaged startup failed.'));});});
}
async function stop() { if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});child=null; }
class Browser {
    constructor(){this.cookie='';this.token='';}
    async request(url,options={}) {
        const response=await fetch(origin+url,{redirect:'manual',...options,headers:{'x-forwarded-proto':'https',cookie:this.cookie,...options.headers}});
        const set=response.headers.getSetCookie().find(value=>value.startsWith('hrpayroll.sid='));
        if(set)this.cookie=set.split(';')[0];
        return response;
    }
    async login(key) {
        let response=await this.request('/login');let html=await response.text();const token=html.match(/name="csrf-token" content="([^"]+)"/)[1];
        response=await this.request('/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({identifier:'staging_'+key,password:passwords[key],_csrf:token})});
        assert.equal(response.status,302);const cookie=response.headers.getSetCookie().find(value=>value.startsWith('hrpayroll.sid='));
        assert(/; Secure/i.test(cookie)&&/; HttpOnly/i.test(cookie)&&/SameSite=Lax/i.test(cookie));await response.text();
        response=await this.request('/package-token-not-found');html=await response.text();this.token=html.match(/name="csrf-token" content="([^"]+)"/)[1];
    }
    async post(url,body,status=302) {
        const response=await this.request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-csrf-token':this.token},body:new URLSearchParams(body)});
        assert.equal(response.status,status,`Packaged route failed: ${url}`);return response;
    }
}

async function main() {
    const bytes=await fs.readFile(path.join(root,'deploy/waec-cpanel-staging.zip')), entries=readZip(bytes);
    assert.throws(()=>createZip(new Map([['../escape',Buffer.from('bad')]])));
    const manifest=JSON.parse(entries.get('DEPLOYMENT-MANIFEST.json'));
    assert.equal(entries.size,manifest.files.length+1);
    for(const file of manifest.files){const data=entries.get(file.path);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),file.sha256);}
    assert(!entries.has('.env'));assert(![...entries.keys()].some(name=>/^public\/uploads\/|^private\/|^node_modules\/|^docs\/test-results\//.test(name)));
    for(const [name,data] of entries){const destination=path.resolve(extracted,...name.split('/'));assert(destination.startsWith(extracted+path.sep));await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,data,{flag:'wx',mode:0o600});}
    const setup=require(path.join(extracted,'scripts/initializeCpanelStaging'));
    const baseline={...process.env};
    assert.throws(()=>setup.validateStagingTarget({...baseline,STAGING_SETUP_ENABLED:'true',DB_NAME:'personnel_master',DBNAME:'personnel_master',STAGING_DB_NAME:'personnel_master'}));
    assert.throws(()=>setup.validateStagingTarget({...baseline,STAGING_SETUP_ENABLED:'false'}));
    Object.assign(process.env,{STAGING_SETUP_ENABLED:'true',STAGING_DB_NAME:process.env.WAEC_QA_DATABASE,PRIVATE_UPLOAD_DIR:path.join(extracted,'private/uploads')});
    for(const [key] of setup.roleDefinitions)passwords[key]=crypto.randomBytes(24).toString('base64url')+'Aa1!';
    const refused=await setupCli({...passwords,entity_head:'bad'});assert.equal(refused.code,1);
    const [empty]=await pool.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');assert.equal(empty.length,0);
    const cli=await setupCli(passwords);assert.equal(cli.code,0,'Packaged initializer CLI failed: '+cli.output.slice(-500));
    assert(Object.values(passwords).every(value=>!cli.output.includes(value)&&!refused.output.includes(value)),'Setup must never print credentials');
    const initialized=JSON.parse(cli.output.trim());assert.equal(initialized.syntheticStaff,2);assert.equal(initialized.syntheticAccounts,7);
    const [tables]=await pool.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');assert.equal(tables.length,manifest.schemaTables);
    const [[counts]]=await pool.query('SELECT (SELECT COUNT(*) FROM tblstaff) staff,(SELECT COUNT(*) FROM tblsalary) salary,(SELECT COUNT(*) FROM tblgltrans) gl,(SELECT COUNT(*) FROM tblpayroll WHERE PYear<>0) monthly');
    assert.deepEqual([Number(counts.staff),Number(counts.salary),Number(counts.gl),Number(counts.monthly)],[2,2,0,0]);
    const [accounts]=await pool.query('SELECT Username,Pword FROM tblpassword');
    for(const row of accounts)assert(await require('bcrypt').compare(passwords[row.Username.slice(8)],row.Pword));
    await require(path.join(extracted,'scripts/checkCpanelStaging')).check();
    await assert.rejects(setup.initialize({seed:true,passwords}),/empty|overwritten/i);
    const [[before]]=await pool.query('SELECT COUNT(*) n FROM tblaudittrail');
    assert(Number(before.n)>=13);
    await launch();
    const browser={};const roles={admin:'admin',data_entry:'data-entry',finance:'finance',finance_manager:'finance-manager',manager:'manager',auditor:'auditor',entity_head:'entity-head'};
    for(const key of Object.keys(roles)){
        const session=browser[key]=new Browser();await session.login(key);
        const response=await session.request('/'+roles[key]+'/dashboard');assert.equal(response.status,200,`Dashboard ${key}`);await response.text();
    }
    const denied=await browser.finance_manager.post('/finance/payroll/process-emoluments',{},403);await denied.text();
    const forged=await browser.data_entry.request('/data-entry/dashboard?CompanyID=2');assert.equal(forged.status,403);await forged.text();
    const missing=await browser.data_entry.request('/data-entry/staff/new-edit',{method:'POST'});assert.equal(missing.status,403);await missing.text();
    for(const pfno of ['S001','S002']){
        for(const [url,extra] of [['new-staff',{}],['entitlement',{}],['salary',{pdate:'2098-08-31'}]])await (await browser.manager.post('/manager/approve/'+url,{pfno,action:'approve',...extra})).text();
    }
    const processed=await browser.finance.post('/finance/payroll/process-emoluments',{activityCode:'01',payrollDate:'2098-08-31'},200);
    const result=await processed.json();assert.equal(result.success,true);assert.equal(result.data.workflowStatus,'PROCESSED');
    const [[payroll]]=await pool.query("SELECT COUNT(*) n,SUM(Salary) basic,SUM(Tax) tax,SUM(NassitEmp) nassit,SUM(GratEmp) provident,SUM(NetIncome) net FROM tblpayroll WHERE PYear=2098 AND PMonth=8 AND PType='01' AND CompanyID=1");
    assert.deepEqual([Number(payroll.n),Number(payroll.basic),Number(payroll.tax),Number(payroll.nassit),Number(payroll.provident),Number(payroll.net)],[2,3000,287.5,150,300,2262.5]);
    const fm=browser.finance_manager;await stop();await launch();
    const persisted=await fm.request('/finance-manager/dashboard');assert.equal(persisted.status,200);await persisted.text();
    const logout=await fm.post('/logout',{});await logout.text();
    const after=await fm.request('/finance-manager/dashboard');assert.equal(after.status,302);assert.equal(after.headers.get('location'),'/login');await after.text();
    console.log(JSON.stringify({status:'PASS',archiveIntegrity:true,schemaTables:tables.length,syntheticOnly:true,credentialsNotDistributed:true,emptyDatabaseAndLiveNameGuards:true,
        productionModeLoopbackStartup:true,sevenRoleDashboards:true,secureCookieProxyRehearsal:true,csrfAndCompanyDenial:true,managerApprovals:true,syntheticPayrollProcessed:true,sessionRestartAndLogout:true,
        actualCpanelTested:false,actualHttpsTested:false}));
}
main().catch(error=>{console.error('PACKAGE_VERIFICATION_FAILED',error.code||'',String(error.message).slice(0,500));process.exitCode=1;}).finally(async()=>{await stop();await pool.end();});
