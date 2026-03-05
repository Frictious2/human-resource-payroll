const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DBHOST || '127.0.0.1',
  user: process.env.DBUSER || 'root',
  password: process.env.DBPASS || '',
  database: process.env.DBNAME || 'personnel_master',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;