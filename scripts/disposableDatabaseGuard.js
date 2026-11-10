// Loaded with NODE_OPTIONS before any application/test module. Never use on the live app.
const target = process.env.WAEC_QA_DATABASE;
if (!/^waec_acceptance_\d{8}_[a-f0-9]{8}$/.test(target || '')) throw new Error('Disposable database name is required.');
const credentials = {
    host:process.env.WAEC_QA_HOST,port:Number(process.env.WAEC_QA_PORT),user:process.env.WAEC_QA_USER,password:process.env.WAEC_QA_PASSWORD,database:target
};
if (!/^waecqa_[a-f0-9]{8}$/.test(credentials.user || '') || !credentials.password) throw new Error('Restricted disposable database identity is required.');
Object.defineProperty(globalThis,'__WAEC_DISPOSABLE_GUARD__',{value:target});
function enforce() {
    Object.assign(process.env,{DBHOST:credentials.host,DB_HOST:credentials.host,DBPORT:String(credentials.port),DB_PORT:String(credentials.port),
        DBUSER:credentials.user,DB_USER:credentials.user,DBPASS:credentials.password,DB_PASSWORD:credentials.password,DBNAME:target,DB_NAME:target,
        NODE_ENV:process.env.WAEC_QA_PRODUCTION_MODE==='true'?'production':'test',ALLOW_DESTRUCTIVE_TESTS:'true',EMAIL_NOTIFICATIONS_ENABLED:'false',ACCOUNT_EMAIL_ENABLED:'false'});
}
enforce();
const dotenv=require('dotenv'),config=dotenv.config;
dotenv.config=(options)=>{const result=config({...options,quiet:true});enforce();return result;};
function options(value) {
    if (!value || typeof value!=='object' || value.database!==target || value.user!==credentials.user) throw new Error('Connection outside disposable database denied.');
    return value;
}
function sql(value) {
    const text=typeof value==='string'?value:value?.sql||'';
    if (/personnel_master/i.test(text) || /\b(?:CREATE|DROP)\s+(?:USER|DATABASE)\b|\bGRANT\b/i.test(text)) throw new Error('Live/admin SQL denied in acceptance child.');
    const use=text.match(/^\s*USE\s+`?([a-zA-Z0-9_]+)/i);
    if(use&&use[1]!==target)throw new Error('Database switch denied.');
}
const wrapped=new WeakSet();
function wrap(connection, promiseStyle) {
    if(wrapped.has(connection))return connection;wrapped.add(connection);
    for(const name of ['query','execute'])if(connection[name]){
        const original=connection[name];connection[name]=function(...args){sql(args[0]);return original.apply(this,args);};
    }
    if(connection.getConnection){const original=connection.getConnection;
        connection.getConnection=promiseStyle?async function(...args){return wrap(await original.apply(this,args),true);}
            :function(callback){return original.call(this,(error,value)=>callback(error,error?value:wrap(value,false)));};
    }
    if(connection.changeUser)connection.changeUser=()=>{throw new Error('Connection identity changes denied.');};
    return connection;
}
for(const moduleName of ['mysql2','mysql2/promise']){
    const mysql=require(moduleName);
    const promiseStyle=moduleName.endsWith('/promise');
    const originalPool=mysql.createPool;mysql.createPool=(value)=>wrap(originalPool(options(value)),promiseStyle);
    const originalConnection=mysql.createConnection;
    mysql.createConnection=(value)=>{const result=originalConnection(options(value));return result?.then?result.then(value=>wrap(value,true)):wrap(result,false);};
}
// No acceptance child may contact an SMTP server, even through a legacy direct transport.
require('nodemailer').createTransport=()=>({sendMail:async()=>({accepted:[],rejected:[],skipped:true,reason:'isolated-acceptance'}),verify:async()=>true,close:()=>{}});
