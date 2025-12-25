const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: '127.0.0.1',
  user: 'root',
  password: '',
  database: 'personnel_master',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const createTables = async () => {
  try {
    // tblEOSCalc
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`tblEOSCalc\` (
        \`ID\` int(11) NOT NULL AUTO_INCREMENT,
        \`CompanyID\` int(11) DEFAULT NULL,
        \`EOSDate\` date DEFAULT NULL,
        \`RangeYears\` int(11) DEFAULT 0,
        \`RangeDays\` int(11) DEFAULT 0,
        \`RangeRed\` decimal(18,2) DEFAULT 0.00,
        \`Exemption\` decimal(18,2) DEFAULT 0.00,
        \`TaxPercent\` decimal(5,2) DEFAULT 0.00,
        \`ExGratiaStartYears\` int(11) DEFAULT 0,
        \`ExGratiaEndYears\` int(11) DEFAULT 0,
        \`ExGratiaYears\` int(11) DEFAULT 0,
        \`ExGratiaMinAge\` int(11) DEFAULT 0,
        \`LongServiceStartYears\` int(11) DEFAULT 0,
        \`LongServicePercent\` decimal(5,2) DEFAULT 0.00,
        \`LongServiceUSD\` decimal(18,2) DEFAULT 0.00,
        PRIMARY KEY (\`ID\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('tblEOSCalc created or exists');

    // tblCourseType
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`tblCourseType\` (
        \`Code\` varchar(2) NOT NULL,
        \`CourseType\` varchar(100) NOT NULL,
        \`CompanyID\` int(11) DEFAULT NULL,
        PRIMARY KEY (\`Code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('tblCourseType created or exists');

    // tblEmpStatus
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`tblEmpStatus\` (
        \`Code\` varchar(2) NOT NULL,
        \`EmpStatus\` varchar(100) NOT NULL,
        \`CompanyID\` int(11) DEFAULT NULL,
        PRIMARY KEY (\`Code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('tblEmpStatus created or exists');

  } catch (err) {
    console.error('Error creating tables:', err);
  } finally {
    pool.end();
  }
};

createTables();
