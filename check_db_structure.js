const mysql = require('mysql2/promise');
const pool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'personnel_master'
});

(async () => {
    try {
        const [rows] = await pool.query("DESCRIBE tblstaff");
        rows.forEach(row => {
            console.log(JSON.stringify(row));
        });
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
})();
