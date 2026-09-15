const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DBHOST || process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DBPORT || process.env.DB_PORT || 3306),
  user: process.env.DBUSER || process.env.DB_USER || 'root',
  password: process.env.DBPASS || process.env.DB_PASSWORD || '',
  database: process.env.DBNAME || process.env.DB_NAME || 'personnel_master',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;
