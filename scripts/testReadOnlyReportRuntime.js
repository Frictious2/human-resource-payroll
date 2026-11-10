require('dotenv').config({ quiet: true, override: true });
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');
const pool = require('../config/db');
const tables = ['tblstaff','tblentitle','tblsalary','tblpayroll','tblgltrans'];
const port = Number(process.env.READ_ONLY_REPORT_TEST_PORT || 3231);

async function snapshot() {
    const result = {};
    for (const table of tables) {
        const [rows] = await pool.query(`SELECT * FROM ${table} WHERE CompanyID = ?`, [1]);
        result[table] = crypto.createHash('sha256').update(rows.map(x=>JSON.stringify(x)).sort().join('\n')).digest('hex');
    }
    return result;
}

async function main() {
    const before = await snapshot();
    const cwd = path.resolve(__dirname,'..');
    const child = spawn(process.execPath,['server.js'],{cwd,env:{...process.env,NODE_ENV:'development',PORT:String(port)},stdio:['ignore','pipe','pipe']});
    try {
        await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(new Error('Read-only report test server startup timed out')),30000);
            child.stdout.on('data',chunk=>{if(String(chunk).includes(`Server running on http://localhost:${port}`)){clearTimeout(timer);resolve();}});
            child.stderr.on('data',()=>{});
            child.on('error',error=>{clearTimeout(timer);reject(error);});
            child.on('exit',code=>{clearTimeout(timer);reject(new Error(`Report server exited ${code}`));});
        });
        await new Promise((resolve,reject)=>{
            const test=spawn(process.execPath,['scripts/testPayrollLiabilityReports.js'],{cwd,env:{...process.env,TEST_BASE_URL:`http://127.0.0.1:${port}`},stdio:'inherit'});
            test.on('error',reject);test.on('exit',code=>code===0?resolve():reject(new Error(`Report suite exited ${code}`)));
        });
    } finally {
        if(child.exitCode===null) await new Promise(resolve=>{
            child.once('exit',resolve);child.kill();
            const timer=setTimeout(()=>child.kill('SIGKILL'),10000);timer.unref();
        });
        assert.deepEqual(await snapshot(),before,'Company 1 financial/source records changed during read-only report verification; investigate, do not auto-revert.');
        console.log('FINANCIAL SAFETY PASS: Company 1 staff/entitlement/salary/payroll/GL fingerprints unchanged, including batch 161.');
    }
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;}).finally(()=>pool.end());
