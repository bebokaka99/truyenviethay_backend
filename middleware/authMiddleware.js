const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

module.exports = function (req, res, next) {
    // 1. Lấy token từ header (thường gửi dạng: "Bearer <token>")
    const token = req.header('Authorization');

    // 2. Nếu không có token => Chặn
    if (!token) {
        return res.status(401).json({ message: 'Không có quyền truy cập, vui lòng đăng nhập!' });
    }

    try {
        // 3. Giải mã token (Bỏ chữ 'Bearer ' nếu có)
        const cleanToken = token.replace('Bearer ', '');
        const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);

        // 4. Gán thông tin user vào request để bước sau dùng
        req.user = decoded; 
        next(); // Cho phép đi tiếp
    } catch (err) {
        res.status(401).json({ message: 'Token không hợp lệ!' });
    }
};