const mysql = require('mysql2/promise');
const pool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'personnel_master'
});

(async () => {
    try {
        const [rows] = await pool.query('DESCRIBE tblpayroll');
        console.log('tblpayroll columns:', rows.map(r => r.Field));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
})();
