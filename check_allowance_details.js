const mysql = require('mysql2/promise');
const pool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'personnel_master'
});

(async () => {
    try {
        // Get a grade that has notches
        const [rows] = await pool.query('SELECT * FROM tblallowance WHERE Notches > 0 LIMIT 1');
        if (rows.length > 0) {
            console.log('tblallowance record:', rows[0]);
            
            // Check tblgrade for this grade
            const gradeCode = rows[0].Grade;
            const [gradeRows] = await pool.query('SELECT * FROM tblgrade WHERE GradeCode = ?', [gradeCode]);
            console.log('tblgrade record:', gradeRows[0]);
        } else {
            console.log('No tblallowance record with Notches > 0 found.');
        }
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
})();
