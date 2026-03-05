const mysql = require('mysql2/promise');
const pool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'personnel_master'
});

(async () => {
    try {
        const [rows] = await pool.query('SELECT * FROM tblgrade LIMIT 5');
        console.log('tblgrade sample:', JSON.stringify(rows, null, 2));
        
        const [staffRows] = await pool.query('SELECT * FROM tblstaff LIMIT 1');
        console.log('tblstaff sample:', JSON.stringify(staffRows, null, 2));
        
        const [salaryRows] = await pool.query('SELECT * FROM tblsalary LIMIT 1');
        console.log('tblsalary sample:', JSON.stringify(salaryRows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
})();
