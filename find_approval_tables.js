const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DBHOST || 'localhost',
    user: process.env.DBUSER || 'root',
    password: process.env.DBPASSWORD || '',
    database: process.env.DBNAME || 'personnel_master',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function findTables() {
    try {
        const [rows] = await pool.query(`
            SELECT TABLE_NAME 
            FROM information_schema.COLUMNS 
            WHERE TABLE_SCHEMA = '${process.env.DBNAME || 'personnel_master'}' 
            AND COLUMN_NAME = 'Approved'
        `);
        console.log('Tables with Approved column:');
        rows.forEach(row => console.log(row.TABLE_NAME));
    } catch (error) {
        console.error(error);
    } finally {
        process.exit();
    }
}

findTables();
