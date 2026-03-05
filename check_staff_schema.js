const pool = require('./config/db');

(async () => {
    try {
        const [cols] = await pool.query('SHOW COLUMNS FROM tblstaff');
        console.log(JSON.stringify(cols.map(c => c.Field)));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();