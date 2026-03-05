const pool = require('mysql2/promise').createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'personnel_master'
});

(async () => {
    try {
        const [columns] = await pool.query('DESCRIBE tblsalary');
        console.log(columns.map(c => ({ Field: c.Field, Type: c.Type })));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
})();
