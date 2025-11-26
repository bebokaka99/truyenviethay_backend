const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+07:00',
  ssl: {
    ca: process.env.TIDB_CA_CERT
  }
});

// Check Connection
pool.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Lỗi kết nối Database:', err.message);
    console.error('⚠️  Gợi ý: Kiểm tra biến môi trường DB_HOST và TIDB_CA_CERT.');
  } else {
    console.log('✅ Đã kết nối Database MySQL (Timezone +07:00)');
    connection.release();
  }
});

module.exports = pool.promise();