require('dotenv').config();
const mysql = require('mysql2/promise');

const dbConfig = {
    host: process.env.DBHOST,
    user: process.env.DBUSER,
    password: process.env.DBPASS,
    database: process.env.DBNAME
};

async function checkRecent() {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        
        console.log("\n--- Checking for recent entries in tblpayroll ---");
        // Check for entries created today or recently
        const [rows] = await conn.query(`
            SELECT PType, PMonth, PYear, DateKeyed, TimeKeyed, COUNT(*) as Count 
            FROM tblpayroll 
            GROUP BY PType, PMonth, PYear, DateKeyed, TimeKeyed 
            ORDER BY DateKeyed DESC, TimeKeyed DESC 
            LIMIT 5
        `);
        
        if (rows.length > 0) {
            console.table(rows);
            console.log(`\n✅ Found ${rows[0].Count} records for PType '${rows[0].PType}' (Month: ${rows[0].PMonth}, Year: ${rows[0].PYear}) keyed on ${rows[0].DateKeyed} at ${rows[0].TimeKeyed}.`);
        } else {
            console.log("❌ No recent records found in tblpayroll.");
        }

        console.log("\n--- Checking Total Count in tblpayroll ---");
        const [count] = await conn.query("SELECT COUNT(*) as Total FROM tblpayroll");
        console.log(`Total records: ${count[0].Total}`);

    } catch (error) {
        console.error(error);
    } finally {
        if (conn) await conn.end();
    }
}

checkRecent();
