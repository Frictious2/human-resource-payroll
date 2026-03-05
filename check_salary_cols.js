const mysql = require('mysql2/promise');
const pool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'personnel_master'
});

(async () => {
    try {
        const [salaryCols] = await pool.query('SHOW COLUMNS FROM tblsalary');
        console.log('tblsalary Columns:', salaryCols.map(c => c.Field));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
})();
