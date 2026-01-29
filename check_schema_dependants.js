
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

async function checkSchema() {
    try {
        const [dependantColumns] = await pool.query("SHOW COLUMNS FROM tbldependant");
        console.log('tbldependant columns:', dependantColumns.map(c => c.Field));

        const [relationColumns] = await pool.query("SHOW COLUMNS FROM tblRelation");
        console.log('tblRelation columns:', relationColumns.map(c => c.Field));
        
        const [params1Columns] = await pool.query("SHOW COLUMNS FROM tblparams1");
        console.log('tblparams1 columns:', params1Columns.map(c => c.Field));
        
        const [params1Data] = await pool.query("SELECT * FROM tblparams1 LIMIT 1");
        console.log('tblparams1 data:', params1Data);

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

checkSchema();
