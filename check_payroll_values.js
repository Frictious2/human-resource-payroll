const mysql = require('mysql2/promise');
const pool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'personnel_master'
});

(async () => {
    try {
        const [rows] = await pool.query('SELECT * FROM tblpayroll WHERE PYear = 0 LIMIT 1');
        console.log('tblpayroll PYear=0 sample:', rows);
        const [rows2] = await pool.query('SELECT * FROM tblpayroll WHERE PYear > 0 LIMIT 1');
        console.log('tblpayroll PYear>0 sample:', rows2);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
})();
