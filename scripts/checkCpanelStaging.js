const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { validateStagingTarget, validatePrivateRoot } = require('./stagingSetupSafety');

async function check() {
    const config = validateStagingTarget();
    require('../services/environmentValidationService').assertEnvironmentIsSafe();
    validatePrivateRoot(process.env.PRIVATE_UPLOAD_DIR);
    const connection = await require('mysql2/promise').createConnection(config);
    try {
        const [[identity]] = await connection.query('SELECT DATABASE() AS db');
        if (identity.db !== config.database) throw new Error('Unexpected database.');
        const [engines] = await connection.query('SHOW ENGINES');
        if (!engines.some(row => row.Engine === 'InnoDB' && ['YES','DEFAULT'].includes(row.Support))) throw new Error('InnoDB is unavailable.');
        const [tables] = await connection.query("SHOW TABLE STATUS WHERE Name IN ('tblstaff','tblsalary','tblpayroll','sessions')");
        if (tables.length !== 4 || tables.some(row => row.Engine !== 'InnoDB')) throw new Error('Required InnoDB tables unavailable.');
        const [indexes] = await connection.query('SHOW INDEX FROM sessions');
        if (!indexes.some(row => row.Column_name === 'expires')) throw new Error('Session expiration index missing.');
        const [staff] = await connection.query('SELECT PFNo, SName FROM tblstaff WHERE CompanyID=1');
        if (staff.length !== 2 || staff.some(row => !['S001','S002'].includes(row.PFNo) || !row.SName.startsWith('Synthetic Employee '))) throw new Error('Expected exclusively synthetic staging employees.');
        const [accounts] = await connection.query('SELECT Username FROM tblpassword');
        const allowed = require('./initializeCpanelStaging').roleDefinitions.map(([key])=>'staging_'+key);
        if (accounts.length !== 7 || accounts.some(row => !allowed.includes(row.Username))) throw new Error('Expected exclusively synthetic staging accounts.');
        const [salary] = await connection.query('SELECT PFNo,Salary,Taxable,Tax,NassitEmp,NassitInst,GratEmp,TotalDeduction,NetIncome FROM tblsalary WHERE CompanyID=1 ORDER BY PFNo');
        const controls = [['S001',1000,950,52.5,50,100,100,202.5,797.5],['S002',2000,1900,235,100,200,200,535,1465]];
        const fields = ['PFNo','Salary','Taxable','Tax','NassitEmp','NassitInst','GratEmp','TotalDeduction','NetIncome'];
        if (salary.length !== 2 || salary.some((row,index)=>fields.some((field,i)=>i===0 ? row[field]!==controls[index][i] : Math.abs(Number(row[field])-controls[index][i])>0.005))) throw new Error('Synthetic calculation control mismatch; investigate without changing tax rules.');
        console.log(JSON.stringify({status:'PASS',databaseConnection:true,innodb:true,sessionIndex:true,syntheticStaff:2,syntheticAccounts:7,calculationControls:'PASS',credentialsPrinted:false}));
    } finally { await connection.end(); }
}
if(require.main===module)check().catch(()=>{console.error('Staging verification failed; check protected configuration, synthetic fixture and schema. No credentials or employee values are printed.');process.exitCode=1;});
module.exports={check};
