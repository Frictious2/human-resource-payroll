const mysql = require('mysql2/promise');

async function test() {
  const pool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'personnel_master'
  });

  try {
    const [rows] = await pool.query('SELECT * FROM tblparams1 LIMIT 1');
    console.log('Rows found:', rows.length);
    if (rows.length > 0) {
      console.log('Row 0:', JSON.stringify(rows[0], null, 2));
      
      const d = rows[0];
      if(d.NDate) console.log('NDate split:', String(d.NDate).split('T')[0]);
      if(d.ClockIn) console.log('ClockIn:', String(d.ClockIn));
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

test();