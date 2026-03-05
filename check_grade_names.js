const pool = require('mysql2/promise').createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'personnel_master'
});

(async () => {
    try {
        const [rows] = await pool.query(`
            SELECT GradeCode, COUNT(DISTINCT Grade) as name_count 
            FROM tblgrade 
            GROUP BY GradeCode 
            HAVING name_count > 1
        `);
        console.log('GradeCodes with multiple names:', rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
})();
