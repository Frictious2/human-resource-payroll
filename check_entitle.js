const pool = require('./config/db');

async function checkEntitle() {
    try {
        const [entitle] = await pool.query('DESCRIBE tblentitle');
        console.log('--- tblentitle columns ---');
        console.log(entitle.map(c => c.Field).join(', '));
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

checkEntitle();
