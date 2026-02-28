const pool = require('./config/db');

async function checkColumns() {
    try {
        const [rows] = await pool.query('SHOW COLUMNS FROM tblleave');
        const columns = rows.map(r => r.Field);
        console.log('Columns in tblleave:', columns.join(', '));
        
        const required = ['DaysPurchased', 'DatePurchased', 'Purchased', 'Method', 'Bank', 'BBAN', 'Allowance'];
        const missing = required.filter(c => !columns.includes(c));
        
        if (missing.length > 0) {
            console.log('MISSING COLUMNS:', missing.join(', '));
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