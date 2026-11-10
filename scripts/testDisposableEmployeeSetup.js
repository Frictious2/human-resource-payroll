require('./requireDisposableDatabase')();
const assert=require('node:assert/strict');
const bcrypt=require('bcrypt');
const pool=require('../config/db');
const base=process.env.TEST_BASE_URL;
const password='SyntheticAcceptanceOnly!123';

class BrowserSession{
    constructor(){this.cookies=new Map();this.token='';}
    async request(url,options={}){
        const response=await fetch(base+url,{redirect:'manual',...options,headers:{...options.headers,cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join(';'),...(options.method==='POST'?{'x-csrf-token':this.token}:{})}});
        for(const item of response.headers.getSetCookie()){const pair=item.split(';')[0],index=pair.indexOf('=');this.cookies.set(pair.slice(0,index),pair.slice(index+1));}
        return response;
    }
    async login(username){let r=await this.request('/login');let html=await r.text();this.token=html.match(/name="csrf-token" content="([^"]+)"/)[1];
        r=await this.request('/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({identifier:username,password})});assert.equal(r.status,302);
        r=await this.request('/qa-not-a-real-route');html=await r.text();this.token=html.match(/name="csrf-token" content="([^"]+)"/)[1];}
    async post(url,body){
        const cookie=this.cookies.get(process.env.SESSION_COOKIE_NAME||'hrpayroll.sid');
        const signed=decodeURIComponent(cookie||'');const id=signed.slice(2,signed.lastIndexOf('.'));
        const [[stored]]=await pool.execute('SELECT data FROM sessions WHERE session_id=?',[id]);
        assert(stored&&JSON.parse(stored.data).csrfToken===this.token,`Persisted CSRF mismatch before ${url}`);
        const r=await this.request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});const text=await r.text();assert.equal(r.status,302,`${url} failed: ${text.slice(0,200)}`);return r;}
}

async function main(){
    const [[identity]]=await pool.query('SELECT DATABASE() AS db');assert.equal(identity.db,process.env.WAEC_QA_DATABASE);
    const hash=await bcrypt.hash(password,10);
    const roles=[['Data Entry','data-entry'],['Manager','manager'],['Finance Officer','finance-officer'],['Auditor','auditor'],['Entity Head','entity-head']];
    const users={};
    for(let i=0;i<roles.length;i++){const [level,role]=roles[i],id=820000+i;await pool.execute('INSERT INTO tblpassword (PFNo,DateCreated,Level,Username,FullName,Pword,Email,CompanyID) VALUES (?,NOW(),?,?,?,?,?,1)',[id,level,`qa_${role}`,`Synthetic ${role}`,hash,`${role}@example.test`]);users[role]={id,role,companyId:1,name:`Synthetic ${role}`,source:'tblpassword'};}
    const de=new BrowserSession(),manager=new BrowserSession();await de.login('qa_data-entry');await manager.login('qa_manager');
    await de.post('/data-entry/staff/new-edit',{pfno:'Q001',sname:'Synthetic Employee One',dob:'1990-01-01',sex:'M',mstatus:'S',nation:'01',address:'Synthetic test address',city:'Test',phone:'',email:'employee@example.test',doe:'2020-01-01',dateConfirmed:'2020-06-01',jobTitle:'0802',cGrade:'0800',gradeEmployed:'0800',dept:'01',empType:'01',empStatus:'01',nkin:'Synthetic Kin',nkinRelationship:'01',nkinAddr:'Test',nkinPhone:'',accountNo:'TESTONLY0001',nassitNo:'TESTONLY0001',cGradeDate:'2020-01-01',cDeptDate:'2020-01-01',dEmp:'01',notch:'1',level:'08',vehicle:'NO'});
    let [[staff]]=await pool.execute('SELECT Approved FROM tblstaff WHERE PFNo=? AND CompanyID=1',['Q001']);assert.equal(Number(staff.Approved),0);
    await manager.post('/manager/approve/new-staff',{pfno:'Q001',action:'approve'});
    await de.post('/data-entry/payroll/entitle',{pfno:'Q001',item_01:'1',item_02:'1',item_05:'1',item_13:'1',paythroughCode:'02',bankCode:'03',accountNo:'TESTONLY0001',payingBBAN:'TESTONLYBBAN'});
    let [[entitlement]]=await pool.execute('SELECT Approved FROM tblentitle WHERE PFNo=? AND CompanyID=1',['Q001']);assert.equal(Number(entitlement.Approved),0);
    await manager.post('/manager/approve/entitlement',{pfno:'Q001',action:'approve'});
    const salary={pfno:'Q001',pdate:'2026-01-31',annual:'12000',salary:'1000',totalIncome:'1000',taxable:'950',tax:'52.50',nassitEmp:'50',nassitInst:'100',gratEmp:'100',gratInst:'0',totalDeduction:'202.50',netIncome:'797.50',ded1:'0',unionDues:'0',ded3:'0',ded4:'0'};
    for(let i=2;i<=20;i++)salary[`allw${String(i).padStart(2,'0')}`]='0';
    await de.post('/data-entry/payroll/payroll-setup',salary);
    await de.post('/data-entry/payroll/edit-payroll',{...salary,fullPay:'1',halfPay:'0',days:'30',totAllw:'0'});
    await manager.post('/manager/approve/salary',{pfno:'Q001',pdate:'2026-01-31',action:'approve'});
    const [[stored]]=await pool.execute('SELECT * FROM tblsalary WHERE PFNo=? AND CompanyID=1',['Q001']);
    assert(Number(stored.Approved)!==0);assert.equal(Number(stored.Tax),52.5);assert.equal(Number(stored.NassitEmp),50);assert.equal(Number(stored.NassitInst),100);assert.equal(Number(stored.GratEmp),100);assert.equal(Number(stored.NetIncome),797.5);
    const [[audit]]=await pool.execute("SELECT COUNT(*) AS total FROM tblaudittrail WHERE CompanyID=1 AND RecordID='Q001' AND FormName LIKE 'manager/approve/%'");assert(Number(audit.total)>=3);
    const finance=users['finance-officer'];
    const processed=await require('../services/processEmolumentsService').processEmoluments({companyId:1,activityCode:'01',payrollDate:'2026-01-31',processedByName:finance.name,processedByUser:finance,userRole:finance.role});
    assert.equal(processed.workflowStatus,'PROCESSED');
    const workflow=require('../services/payrollWorkflowService');const batch=await workflow.getWorkflowBatch(1,1,2026,'01');
    await workflow.transitionWorkflow({companyId:1,pMonth:1,pYear:2026,pType:'01',action:workflow.WORKFLOW_ACTIONS.SUBMIT_TO_MANAGER,user:finance,comments:'Synthetic acceptance'});
    await require('../services/managerPayrollWorkflowService').endorseBatch({companyId:1,batchId:batch.id,user:users.manager,comments:'Synthetic acceptance'});
    await require('../services/auditorPayrollWorkflowService').endorseBatch({companyId:1,batchId:batch.id,user:users.auditor,comments:'Synthetic acceptance'});
    await require('../services/entityHeadPayrollWorkflowService').approveBatch({companyId:1,batchId:batch.id,user:users['entity-head'],comments:'Synthetic acceptance'});
    const financeBrowser=new BrowserSession();await financeBrowser.login('qa_finance-officer');
    const payslip=await financeBrowser.request('/finance/api/reports/payslip?month=1&year=2026&scope=staff&pfno=Q001');assert.equal(payslip.status,200);
    assert((await payslip.text()).includes('797.5'));
    console.log('PASS synthetic employee creation, entitlement/salary submission, real Manager approvals/audits, PAYE/NASSIT/PROV-EMP, payroll processing, normal payroll approval chain and payslip API.');
}
main().catch(error=>{console.error(error.code||'TEST_FAILED',String(error.message).replace(/\s+/g,' ').slice(0,500));process.exitCode=1;}).finally(()=>pool.end());
