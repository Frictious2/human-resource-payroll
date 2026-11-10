require('dotenv').config({quiet:true,override:true});
const mysql=require('mysql2/promise');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const suffix=crypto.randomBytes(4).toString('hex');
const name=`waec_acceptance_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${suffix}`;
const username=`waecqa_${suffix}`,password=crypto.randomBytes(32).toString('hex');
const workspace=path.join(root,'private','acceptance-work',name);
const sourceConfig={host:process.env.DBHOST||process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DBPORT||process.env.DB_PORT||3306),
    user:process.env.DBUSER||process.env.DB_USER,password:process.env.DBPASS||process.env.DB_PASSWORD||'',database:process.env.DBNAME||process.env.DB_NAME||'personnel_master'};
const report={startedAt:new Date().toISOString(),database:name,mode:process.argv.includes('--package-only')?'PACKAGE_VERIFICATION':process.argv.includes('--staff-isolation-only')?'STAFF_ISOLATION_DIAGNOSTIC':process.argv.includes('--employee-only')?'EMPLOYEE_DIAGNOSTIC':'FULL',syntheticOnly:true,liveDatabase:sourceConfig.database,tests:[],status:'RUNNING'};
const reportPath=path.join(root,'docs/test-results/disposable-staging-acceptance-latest.json');
const tablesProtected=['tblstaff','tblentitle','tblsalary','tblpayroll','tblgltrans','tblpassword','tblaudittrail','payroll_workflow_batches','payroll_workflow_actions','record_workflow_items','record_workflow_actions'];
let admin,qa,created=false,userCreated=false,before,server;

async function fingerprints(){const result={};for(const table of tablesProtected){const [rows]=await admin.query(`SELECT * FROM \`${table}\``);result[table]=crypto.createHash('sha256').update(rows.map(x=>JSON.stringify(x)).sort().join('\n')).digest('hex');}return result;}
async function save(){await fs.writeFile(reportPath,JSON.stringify(report,null,2));await fs.writeFile(path.join(root,'docs/test-results',name+'-results.json'),JSON.stringify(report,null,2));}
async function insert(table,values){
    const [columns]=await qa.query(`SHOW COLUMNS FROM \`${table}\``);
    const row={};for(const column of columns){if(Object.hasOwn(values,column.Field))row[column.Field]=values[column.Field];
        else if(column.Null==='NO'&&column.Default===null&&!column.Extra.includes('auto_increment')){
            row[column.Field]=/int|decimal|double|float|bit/i.test(column.Type)?0:/date|timestamp/i.test(column.Type)?'2098-01-01':/^time/i.test(column.Type)?'00:00:00':'';
        }}
    try{await qa.query(`INSERT INTO \`${table}\` SET ?`,[row]);}catch(error){error.message=`Synthetic ${table} fixture: ${error.message}`;throw error;}
}
async function copyRuntime(){
    await fs.mkdir(workspace,{recursive:true,mode:0o700});
    for(const folder of ['config','controllers','middleware','routes','services','utils','validations','views','scripts','database'])await fs.cp(path.join(root,folder),path.join(workspace,folder),{recursive:true});
    for(const file of ['server.js','app.js','package.json','package-lock.json'])await fs.copyFile(path.join(root,file),path.join(workspace,file));
    for(const folder of ['css','js','images','vendor'])await fs.cp(path.join(root,'public',folder),path.join(workspace,'public',folder),{recursive:true});
    await fs.mkdir(path.join(workspace,'docs/test-results'),{recursive:true});
}
function childEnv(){return {...process.env,WAEC_QA_DATABASE:name,WAEC_QA_HOST:sourceConfig.host,WAEC_QA_PORT:String(sourceConfig.port),WAEC_QA_USER:username,WAEC_QA_PASSWORD:password,
    NODE_OPTIONS:`--require="${path.join(workspace,'scripts/disposableDatabaseGuard.js').replace(/\\/g,'/')}"`,PRIVATE_UPLOAD_DIR:path.join(workspace,'private/uploads'),APP_HOST:'127.0.0.1',
    INSTALLATION_COMPANY_ID:'1',TEST_BASE_URL:'http://127.0.0.1:3251',PHASE11_BASE_URL:'http://127.0.0.1:3251',TEST_COMPANY_ID:'1',YEARLY_TEST_COMPANY_ID:'1',YEARLY_TEST_YEAR:'2098'};}
async function run(script,args=[]){
    const entry={script,status:'RUNNING'};report.tests.push(entry);await save();
    console.log('RUN',script);
    const result=await new Promise(resolve=>{const env=childEnv();if(script.endsWith('testFinanceManagerOversight.js'))env.TEST_BASE_URL='http://127.0.0.1:3118';const child=spawn(process.execPath,[script,...args],{cwd:workspace,env,stdio:['ignore','pipe','pipe']});let output='';
        const timer=setTimeout(()=>{child.kill();resolve({exitCode:null,output:'Test timeout'});},180000);
        child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
        child.on('error',()=>{clearTimeout(timer);resolve({exitCode:null,output:'Child launch failed'});});
        child.on('exit',code=>{clearTimeout(timer);resolve({exitCode:code,output});});});
    entry.exitCode=result.exitCode;entry.status=result.exitCode===0?'PASS':'FAIL';
    const sanitized=result.output.split(password).join('[REDACTED]');
    await fs.writeFile(path.join(workspace,path.basename(script)+'.log'),sanitized,{mode:0o600});
    if(entry.status==='FAIL'){entry.failureTail=sanitized.split(/\r?\n/).slice(-10).join('\n');console.log('FAIL',script,entry.failureTail);}else console.log('PASS',script);
    await save();return entry.status==='PASS';
}

async function main(){
    assert(/^waec_acceptance_\d{8}_[a-f0-9]{8}$/.test(name));
    admin=await mysql.createConnection(sourceConfig);before=await fingerprints();
    await admin.query(`CREATE DATABASE \`${name}\``);created=true;
    for(const host of ['localhost','127.0.0.1']){
        await admin.query('CREATE USER ?@? IDENTIFIED BY ?',[username,host,password]);userCreated=true;
        await admin.query(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO ?@?`,[username,host]);
    }
    qa=await mysql.createConnection({...sourceConfig,database:name,user:username,password});
    let denied=false;try{await mysql.createConnection({...sourceConfig,user:username,password});}catch(error){denied=['ER_DBACCESS_DENIED_ERROR','ER_ACCESS_DENIED_ERROR'].includes(error.code);}
    assert(denied,'Restricted test identity must be denied access to the live database');report.liveAccessDenied=true;
    if (process.argv.includes('--package-only')) {
        await copyRuntime();
        await fs.mkdir(path.join(workspace,'deploy'),{recursive:true});
        await fs.copyFile(path.join(root,'deploy/waec-cpanel-staging.zip'),path.join(workspace,'deploy/waec-cpanel-staging.zip'));
        report.sanitizedWorkspace=path.relative(root,workspace);
        report.status=await run('scripts/testCpanelStagingPackage.js')?'PASS':'BLOCKED';
        return;
    }
    const [tables]=await admin.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'",[sourceConfig.database]);
    await qa.query('SET FOREIGN_KEY_CHECKS=0');
    for(const {TABLE_NAME:table} of tables){const [[ddl]]=await admin.query(`SHOW CREATE TABLE \`${table.replace(/`/g,'``')}\``);let sql=ddl['Create Table'].replace(/ AUTO_INCREMENT=\d+/g,'');
        if(sql.includes('`'+sourceConfig.database+'`.'))sql=sql.split('`'+sourceConfig.database+'`.').join('`'+name+'`.');
        await qa.query(sql);}
    await qa.query('SET FOREIGN_KEY_CHECKS=1');report.schemaOnlyTables=tables.length;
    await insert('tblcominfo',{CompanyID:1,Com_Name:'Synthetic Acceptance Company A',TinNo:'SYNTHETIC',Address:'Synthetic test address',Email:'synthetic@example.test',Manager:'Synthetic Manager',DateCreated:'2098-01-01',StaffCapacity:100});
    for(const [Code,PayType] of [['01','Salary'],['02','Rent'],['04','Welfare'],['05','Inducement'],['06','Gratuity'],['07','Backlog'],['08','EOS'],['09','Bonus'],['13','Leave'],['14','Acting'],['15','Long service'],['33','Provident'],['40','Guarantee'],['41','Employer NASSIT'],['42','Employer provident']])await insert('tblpaytype',{Code,PayType,CompanyID:1});
    for(const Code of ['01','03'])await insert('tbldept',{Code,Dept:'Synthetic '+Code,CompanyID:1});
    for(const GradeCode of ['0800','0400']){const JobTitle=GradeCode==='0800'?'0802':'0401';await insert('tblgrade',{GradeCode,JobTitle,Grade:'Synthetic '+GradeCode,NotchIncr:1,CompanyID:1});await insert('tbljobtitle',{Code:JobTitle,JobTitle:'Synthetic '+JobTitle,CompanyID:1});await insert('tblallowance',{Grade:GradeCode,ScaleDate:'2026-01-01',StartLevel:12000,EndLevel:12000,Notches:1,Increment:0,CompanyID:1});}
    await insert('tblleavetype',{Code:'01',LeaveType:'Synthetic Annual Leave',CompanyID:1});
    await insert('tblrelation',{RCode:'03',Relation:'QA Child',CompanyID:1});
    await insert('tblparams1',{SeqNo:1,AdvanceInt:0,LoanDuration:12,CompanyID:1});
    await insert('tbltax',{BankID:'01',TaxDate:'2026-01-01',R1:600,R1Tax:0,R2:1200,R2Tax:15,R3:1800,R3Tax:20,R4:2400,R4Tax:25,R5:99000,R5Tax:30,CompanyID:1});
    for(let number=1;number<=42;number++){const Code=String(number).padStart(2,'0');await insert('tblpayrollitems',{Code,Income:'Synthetic '+Code,Freq:['02','05','13'].includes(Code)?'Y':'M',Taxable:['01','02','05','13'].includes(Code)?1:0,
        Percent:Code==='32'?5:['33','41'].includes(Code)?10:['02','05','13'].includes(Code)?20:0,CompanyID:1});}
    await copyRuntime();report.sanitizedWorkspace=path.relative(root,workspace);await save();
    server=spawn(process.execPath,['server.js'],{cwd:workspace,env:{...childEnv(),PORT:'3251'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{let errors='';const timer=setTimeout(()=>reject(new Error('Isolated app startup timed out: '+errors.slice(-1500))),30000);server.stdout.on('data',chunk=>{if(String(chunk).includes('Server running on http://localhost:3251')){clearTimeout(timer);resolve();}});server.stderr.on('data',chunk=>{errors+=String(chunk).split(password).join('[REDACTED]');});server.on('exit',()=>{clearTimeout(timer);reject(new Error('Isolated app exited during startup: '+errors.slice(-1500)));});});
    const tests=process.argv.includes('--employee-only')?['scripts/testDisposableEmployeeSetup.js','scripts/testCsrfProtection.js']:['scripts/testDisposableEmployeeSetup.js','scripts/testFinalSecurityHardening.js','scripts/testSecurityHttpIsolated.js','scripts/testSecurityPayrollRegression.js','scripts/testCsrfProtection.js','scripts/testLoginRateLimiting.js','scripts/testPersistentSessionStore.js','scripts/testPhase14PayrollReversalWorkflow.js','scripts/testPhase15PayrollReopenWorkflow.js','scripts/testYearlyPaymentWorkflow.js','scripts/testPayrollWorkflowFoundation.js','scripts/testPhase11RecordWorkflows.js','scripts/testPayrollLiabilityReports.js','scripts/auditPayrollItemTaxability.js','scripts/auditSierraLeonePayeCalculation.js'];
    const selectedTests=process.argv.includes('--staff-isolation-only')?['scripts/testDisposableEmployeeSetup.js','scripts/testDisposableStaffCompanyIsolation.js']:tests;
    if(!process.argv.includes('--staff-isolation-only')&&!process.argv.includes('--employee-only'))selectedTests.push('scripts/testDisposableStaffCompanyIsolation.js');
    if(!process.argv.includes('--staff-isolation-only')&&!process.argv.includes('--employee-only'))selectedTests.push('scripts/testFinanceManagerOversight.js');
    if(!process.argv.includes('--staff-isolation-only')&&!process.argv.includes('--employee-only'))selectedTests.push('scripts/testStandaloneConfiguration.js');
    for(const script of selectedTests)await run(script);
    report.status=report.tests.every(x=>x.status==='PASS')?'PASS':'BLOCKED';
}

main().catch(error=>{report.status='BLOCKED';report.errorCode=error.code||'ACCEPTANCE_FAILED';report.error=String(error.message).split(password).join('[REDACTED]');console.log('DISPOSABLE_ACCEPTANCE_BLOCKED',report.errorCode);}).finally(async()=>{
    try{
        if(server&&server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill();});
        if(qa)await qa.end();
        if(admin&&before){assert.deepEqual(await fingerprints(),before,'Live protected records changed; investigate without auto-revert.');report.liveProtectedRecordsUnchanged=true;}
        if(admin&&created){assert(/^waec_acceptance_\d{8}_[a-f0-9]{8}$/.test(name));await admin.query(`DROP DATABASE \`${name}\``);report.disposableDatabaseRemoved=true;}
        if(admin&&userCreated){for(const host of ['localhost','127.0.0.1'])await admin.query('DROP USER IF EXISTS ?@?',[username,host]);report.restrictedDatabaseUsersRemoved=true;}
    }catch(error){report.cleanupError=error.code||error.message;report.status='BLOCKED';}
    finally{await admin?.end();report.completedAt=new Date().toISOString();await save();console.log('DISPOSABLE_ACCEPTANCE',report.status);if(report.status!=='PASS')process.exitCode=1;}
});
