const pool = require('./config/db');

async function run() {
    try {
        console.log("Checking tables...");
        const [paytype] = await pool.query('DESCRIBE tblpaytype');
        console.log('--- tblpaytype ---');
        console.log(JSON.stringify(paytype, null, 2));

        const [salary] = await pool.query('DESCRIBE tblsalary');
        console.log('\n--- tblsalary ---');
        console.log(JSON.stringify(salary, null, 2));

        const [entitle] = await pool.query('DESCRIBE tblentitle');
        console.log('\n--- tblentitle ---');
        console.log(JSON.stringify(entitle, null, 2));
        
        const [payroll] = await pool.query('DESCRIBE tblpayroll');
        console.log('\n--- tblpayroll ---');
        console.log(JSON.stringify(payroll, null, 2));

    } catch (err) {
        console.error("Error:", err);
    } finally {
        // process.exit(0);
    }
}

run();
