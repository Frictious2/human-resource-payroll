const db = require('./config/db');

async function checkColumns() {
    try {
        const [rows] = await db.query('SHOW COLUMNS FROM tblleave');
        const columns = rows.map(r => r.Field);
        console.log('Columns in tblleave:', columns);
        
        const required = ['DaysPurchased', 'DatePurchased', 'Purchased', 'Allowance', 'Method', 'Bank', 'BBAN', 'Approved', 'LType'];
        const missing = required.filter(c => !columns.includes(c));
        
        if (missing.length > 0) {
            console.log('Missing columns:', missing);
        } else {
            console.log('All required columns exist.');
        }
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

checkColumns();
