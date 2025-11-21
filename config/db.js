const mysql = require('mysql2');
const dotenv = require('dotenv');
// Không cần import fs vì ta đọc từ ENV
// const fs = require('fs'); 

dotenv.config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+07:00', 
    
    // --- BẮT BUỘC PHẢI THÊM ĐOẠN NÀY CHO TI-DB/PLANETSCALE ---
    ssl: {
        // Node.js sẽ coi chuỗi này là nội dung của Certificate
        ca: process.env.TIDB_CA_CERT 
    }
});

// Kiểm tra kết nối
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Lỗi kết nối Database:', err.message);
        console.error('=> Lỗi 1: Kiểm tra lại biến môi trường.');
        console.error('=> Lỗi 2: Kiểm tra nội dung TIDB_CA_CERT có đầy đủ không.');
    } else {
        console.log('✅ Đã kết nối Database MySQL (Timezone +07:00)!');
        connection.release();
    }
});

module.exports = pool.promise();