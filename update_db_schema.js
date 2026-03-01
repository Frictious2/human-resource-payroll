const pool = require('./config/db');

async function updateSchema() {
    try {
        console.log('Checking tblmedical schema...');
        const [columns] = await pool.query(`SHOW COLUMNS FROM tblmedical LIKE 'PicturePath'`);
        
        if (columns.length === 0) {
            console.log('Adding PicturePath column to tblmedical...');
            await pool.query(`ALTER TABLE tblmedical ADD COLUMN PicturePath VARCHAR(255) DEFAULT NULL AFTER Amount`);
            console.log('Column PicturePath added successfully.');
        } else {
            console.log('Column PicturePath already exists.');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('Error updating schema:', error);
        process.exit(1);
    }
}

updateSchema();
