require('dotenv').config();
const mysql = require('mysql2/promise');

const dbConfig = {
    host: process.env.DBHOST,
    user: process.env.DBUSER,
    password: process.env.DBPASS,
    database: process.env.DBNAME
};

async function inspect() {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        console.log("Checking tblpayroll for recent entries...");
        const [rows] = await conn.query(`
            SELECT PType, PMonth, PYear, COUNT(*) as count 
            FROM tblpayroll 
            GROUP BY PType, PMonth, PYear 
            ORDER BY PYear DESC, PMonth DESC
        `);
        console.table(rows);
        
        console.log("\nChecking tblpaytype...");
        const [types] = await conn.query('SELECT * FROM tblpaytype');
        console.table(types);

    } catch (error) {
        console.error(error);
    } finally {
        if (conn) await conn.end();
    }
}

inspect();
