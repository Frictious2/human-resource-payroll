const pool = require('./config/db');

(async () => {
    try {
        console.log("Checking tblSalaryHistory Columns:");
        const [shRows] = await pool.query("SHOW COLUMNS FROM tblsalaryhistory");
        console.log("tblSalaryHistory:", shRows.map(r => r.Field).join(', '));

        console.log("\nChecking tblIncrement Columns:");
        const [iRows] = await pool.query("SHOW COLUMNS FROM tblincrement");
        console.log("tblIncrement:", iRows.map(r => r.Field).join(', '));

        console.log("\nChecking tblBonus Columns:");
        const [bRows] = await pool.query("SHOW COLUMNS FROM tblbonus");
        console.log("tblBonus:", bRows.map(r => r.Field).join(', '));

        console.log("\nChecking tblExport Columns:");
        try {
            const [eRows] = await pool.query("SHOW COLUMNS FROM tblExport");
            console.log("tblExport:", eRows.map(r => r.Field).join(', '));
        } catch (e) { console.log("tblExport not found or error:", e.message); }

        console.log("\nChecking tblYearlyPayments Columns:");
        try {
            const [yRows] = await pool.query("SHOW COLUMNS FROM tblYearlyPayments");
            console.log("tblYearlyPayments:", yRows.map(r => r.Field).join(', '));
        } catch (e) { console.log("tblYearlyPayments not found or error:", e.message); }
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
})();
