const pool = require('mysql2/promise').createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'personnel_master'
});

(async () => {
    try {
        const [rows] = await pool.query('DESCRIBE tblentitle');
        console.log('tblentitle columns:', rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
})();
