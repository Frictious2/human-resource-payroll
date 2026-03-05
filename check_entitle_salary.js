const mysql = require('mysql2/promise');
const pool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'personnel_master'
});

(async () => {
    try {
        const [rows] = await pool.query('SELECT PFNo, Salary FROM tblentitle LIMIT 5');
        console.log('tblentitle sample:', rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
})();
