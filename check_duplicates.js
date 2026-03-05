const pool = require('mysql2/promise').createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'personnel_master'
});

(async () => {
    try {
        console.log('Checking for duplicates in tblstaff (PFNo)...');
        const [staffDups] = await pool.query(`
            SELECT PFNo, COUNT(*) as count 
            FROM tblstaff 
            GROUP BY PFNo 
            HAVING count > 1
        `);
        console.log('Staff Duplicates:', staffDups);

        console.log('Checking for duplicates in tblgrade (GradeCode)...');
        const [gradeDups] = await pool.query(`
            SELECT GradeCode, COUNT(*) as count 
            FROM tblgrade 
            GROUP BY GradeCode 
            HAVING count > 1
        `);
        console.log('Grade Duplicates:', gradeDups);

        console.log('Checking for duplicates in tblsalary (PFNo, PDate)...');
         const [salaryDups] = await pool.query(`
            SELECT PFNo, PDate, COUNT(*) as count 
            FROM tblsalary 
            WHERE Approved = 0
            GROUP BY PFNo, PDate 
            HAVING count > 1
        `);
        console.log('Salary Duplicates (Approved=0):', salaryDups);

    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
})();
