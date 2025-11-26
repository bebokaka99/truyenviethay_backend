const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    // Lấy token từ header
    const token = req.header('Authorization');

    // Kiểm tra nếu không có token
    if (!token) {
        return res.status(401).json({ message: 'Truy cập bị từ chối. Vui lòng đăng nhập.' });
    }

    try {
        // Loại bỏ prefix 'Bearer ' để lấy token gốc
        const cleanToken = token.replace('Bearer ', '');
        
        // Giải mã và xác thực
        const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);

        // Gán user vào request
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn.' });
    }
};