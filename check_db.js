const pool = require('./config/db');

async function checkTables() {
    try {
        const [paytype] = await pool.query('DESCRIBE tblpaytype');
        console.log('--- tblpaytype ---');
        console.log(paytype.map(c => c.Field).join(', '));

        const [salary] = await pool.query('DESCRIBE tblsalary');
        console.log('\n--- tblsalary ---');
        console.log(salary.map(c => c.Field).join(', '));

        const [entitle] = await pool.query('DESCRIBE tblentitle');
        console.log('\n--- tblentitle ---');
        console.log(entitle.map(c => c.Field).join(', '));

        const [payroll] = await pool.query('DESCRIBE tblpayroll');
        console.log('\n--- tblpayroll ---');
        console.log(payroll.map(c => c.Field).join(', '));

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

checkTables();
