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
        
        console.log("\n--- tblpayroll Structure ---");
        const [columns] = await conn.query("DESCRIBE tblpayroll");
        columns.forEach(col => {
            if (['PType', 'PMonth', 'PYear'].includes(col.Field)) {
                console.log(`${col.Field}: ${col.Type}`);
            }
        });

        console.log("\n--- tblpayroll Sample Data (PMonth, PType) ---");
        const [rows] = await conn.query(`
            SELECT DISTINCT PType, PMonth, PYear 
            FROM tblpayroll 
            ORDER BY PYear DESC, PMonth DESC 
            LIMIT 20
        `);
        console.table(rows);

    } catch (error) {
        console.error(error);
    } finally {
        if (conn) await conn.end();
    }
}

inspect();
