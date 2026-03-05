const pool = require('mysql2/promise').createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'personnel_master'
});

(async () => {
    try {
        const [rows] = await pool.query("SELECT * FROM tblgrade WHERE GradeCode = '0700'");
        console.log(rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
})();
