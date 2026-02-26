const pool = require('./config/db');

async function checkTables() {
    try {
        const [paytype] = await pool.query('DESCRIBE tblpaytype');
        console.log('--- tblpaytype ---');
        console.log(JSON.stringify(paytype, null, 2));

        // Check for PDate in tblpayroll to see if it exists
        const [payroll] = await pool.query('DESCRIBE tblpayroll');
        console.log('\n--- tblpayroll columns ---');
        console.log(payroll.map(c => c.Field).join(', '));
        
        // Check for PDate in tblsalary
        const [salary] = await pool.query('DESCRIBE tblsalary');
        console.log('\n--- tblsalary columns ---');
        console.log(salary.map(c => c.Field).join(', '));

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

checkTables();
