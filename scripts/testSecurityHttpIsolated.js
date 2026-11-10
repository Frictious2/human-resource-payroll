const assert = require('node:assert/strict');
const Module = require('node:module');
const session = require('express-session');
const bcrypt = require('bcrypt');
const originalLoad = Module._load;
const originalEnv = { ...process.env };
let accounts = [];
const fakePool = {
    execute: async (sql,args) => {
        assert(/^\s*SELECT\b/i.test(sql), 'No SQL mutation is allowed in this HTTP harness');
        if (sql.includes('FROM developer')) return [[]];
        if (sql.includes('FROM tblpassword') && sql.includes('LOWER')) return [accounts.filter(x=>x.Username===args[0])];
        if (sql.includes('FROM tblpassword p')) { assert(sql.includes('p.CompanyID = ?')); return [[]]; }
        return [[]];
    },
    query: async sql => {
        assert(/^\s*SELECT|^SHOW\b/i.test(sql));
        return [sql.startsWith('SHOW TABLE STATUS') ? [{ Name:'sessions' }] : []];
    }
};
Module._load = function(request) {
    if (/config\/db$/.test(request) || request === './db') return fakePool;
    if (/brandingService$/.test(request)) return { getBranding: async()=>({companyName:'Synthetic HTTP UAT',logoPath:null}) };
    if (/workflowNotificationService$/.test(request)) return { getNotificationSummary:async()=>({unreadCount:0,recent:[]}), markAllAsRead:async()=>0 };
    if (/auditTrailService$/.test(request)) return { logAuthEvent:async()=>{} };
    return originalLoad.apply(this,arguments);
};

function cookie(response) { return (response.headers.get('set-cookie')||'').split(';')[0]; }
function csrf(html) { const match=html.match(/name="csrf-token" content="([^"]+)"/); assert(match,'CSRF token missing'); return match[1]; }

async function main() {
    process.env.NODE_ENV='test';process.env.LOGIN_RATE_LIMIT_MAX='3';
    const pass='SyntheticOnly!123';const hash=await bcrypt.hash(pass,10);
    const roles=[['Admin','admin'],['Data Entry','data-entry'],['Finance Officer','finance-officer'],['Finance Manager','finance-manager'],['Manager','manager'],['Auditor','auditor'],['Entity Head','entity-head']];
    accounts=roles.map(([Level,role],i)=>({PFNo:7000+i,Username:`fixture_${role}`,FullName:'Synthetic User',Email:`fixture_${i}@example.test`,CompanyID:1,Level,Pword:hash}));
    const {createApp,startServer}=require('../server');
    const store=new session.MemoryStore();const app=createApp({sessionStore:store});
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const request=(url,options={})=>fetch(base+url,{redirect:'manual',...options});
    try {
        for(const [Level,role] of roles){
            const loginPage=await request('/login');const anonymous=cookie(loginPage);const token=csrf(await loginPage.text());
            const login=await request('/login',{method:'POST',headers:{cookie:anonymous,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({identifier:`fixture_${role}`,password:pass,_csrf:token})});
            assert.equal(login.status,302);assert(login.headers.get('location').includes(role==='finance-officer'?'/finance/':role==='data-entry'?'/data-entry/':`/${role}/`));
            const authCookie=cookie(login);assert.notEqual(authCookie,anonymous,'Login must regenerate session ID');
            const missing=await request('/logout',{method:'POST',headers:{cookie:authCookie}});assert.equal(missing.status,403);
            const invalid=await request('/logout',{method:'POST',headers:{cookie:authCookie,'x-csrf-token':'bad'}});assert.equal(invalid.status,403);
            const notFound=await request('/synthetic-not-found',{headers:{cookie:authCookie}});const currentToken=csrf(await notFound.text());
            assert.equal(notFound.status,404);
            const denied=await request('/developer/developers',{method:'POST',headers:{cookie:authCookie,'x-csrf-token':currentToken,'content-type':'application/json'},body:'{}'});assert.equal(denied.status,403);
            const scoped=await request('/admin/api/finance-managers',{headers:{cookie:authCookie,accept:'application/json'}});assert.equal(scoped.status,role==='admin'?200:403);
            const logout=await request('/logout',{method:'POST',headers:{cookie:authCookie,'x-csrf-token':currentToken}});assert.equal(logout.status,302);
            const after=await request('/dashboard',{headers:{cookie:authCookie}});assert.equal(after.headers.get('location'),'/login');
        }
        const missing=await request('/uploads/staff_photos/fixture.png');assert.equal(missing.status,401);
        const encoded=await request('/%75ploads/staff_photos/fixture.png');assert([401,404].includes(encoded.status));
        for(let i=0;i<3;i++){
            const page=await request('/login');const token=csrf(await page.text());
            const fail=await request('/login',{method:'POST',headers:{cookie:cookie(page),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({identifier:'no-such-user',password:'invalid',_csrf:token})});assert.equal(fail.status,401);
        }
        const page=await request('/login');const token=csrf(await page.text());
        const limited=await request('/login',{method:'POST',headers:{cookie:cookie(page),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({identifier:'no-such-user',password:'invalid',_csrf:token})});assert.equal(limited.status,429);
        const available=await request('/login');assert.equal(available.status,200);
        assert.equal(available.headers.get('x-content-type-options'),'nosniff');assert(available.headers.get('content-security-policy'));assert.equal(available.headers.get('x-powered-by'),null);
        let accountLimited=0;
        for(let i=0;i<31;i++){
            const setup=await request('/admin/admins/set-password?token=invalid');
            assert([400,429].includes(setup.status));if(setup.status===429)accountLimited++;
        }
        assert(accountLimited>0,'Account setup endpoints must be rate limited');
        const probe=require('node:net').createServer();probe.listen(0,'127.0.0.1');
        await new Promise(resolve=>probe.once('listening',resolve));const productionPort=probe.address().port;
        await new Promise(resolve=>probe.close(resolve));
        Object.assign(process.env,{ NODE_ENV:'production',PORT:String(productionPort),APP_BASE_URL:'https://synthetic.example.test',TRUST_PROXY_HOPS:'1',
            SESSION_SECRET:'temporary-session-fixture-'.repeat(3),RESET_TOKEN_SECRET:'temporary-reset-fixture-'.repeat(3),
            DB_HOST:'127.0.0.1',DB_NAME:'synthetic',DB_USER:'synthetic',DB_PASSWORD:'synthetic-only',EMAIL_NOTIFICATIONS_ENABLED:'false',ACCOUNT_EMAIL_ENABLED:'false' });
        const production=await startServer();
        assert.equal(production.server.address().address,'127.0.0.1');
        await new Promise(resolve=>production.server.close(resolve));await production.sessionStore.close();
        console.log('PASS production startup rehearsal: loopback-only boot and session readiness with SELECT/SHOW-only fake database; privileged writes are forbidden by the adapter.');
        console.log('PASS: seven-role real Express HTTP login/regeneration, missing/invalid CSRF 403, valid-token role denial, logout invalidation, company-scoped Admin lists, static upload blocking, login rate limit 429 and headers. Accounts and sessions are in-memory; no database writes.');
    } finally { await new Promise(resolve=>server.close(resolve));store.clear(); }
}
main().catch(error=>{console.error('FAIL',error);process.exitCode=1;}).finally(()=>{Module._load=originalLoad;process.env=originalEnv;});
