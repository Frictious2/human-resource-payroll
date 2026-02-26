const db = require('./config/db');

(async () => {
    try {
        const tables = ['tblloan', 'tblquery', 'tblpayrollitems', 'tblentitle', 'tblpaytype', 'tblpayroll', 'tblstaff', 'tblsalary'];
        
        for (const table of tables) {
            console.log(`\n--- ${table} ---`);
            try {
                const [cols] = await db.query(`SHOW COLUMNS FROM ${table}`);
                console.log(cols.map(c => `${c.Field} (${c.Type})`).join(', '));
            } catch (err) {
                console.log(`Error showing columns for ${table}: ${err.message}`);
            }
        }
        
        console.log('\n--- tblpaytype content ---');
        try {
            const [payTypes] = await db.query('SELECT * FROM tblpaytype');
            console.log(JSON.stringify(payTypes, null, 2));
        } catch (e) { console.log(e.message); }

        console.log('\n--- tblpayrollitems content (first 5) ---');
        try {
            const [items] = await db.query('SELECT * FROM tblpayrollitems LIMIT 5');
            console.log(JSON.stringify(items, null, 2));
        } catch (e) { console.log(e.message); }

    } catch (e) {
        console.error(e);
    } finally {
        await db.end();
    }
})();
