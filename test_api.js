const http = require('http');

http.get('http://localhost:3001/admin/api/parameters/discipline-reasons', (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('Response:', data);
  });

}).on('error', (err) => {
  console.log('Error: ' + err.message);
});
