module.exports = (req, res, next) => {
    // Kiểm tra user đã đăng nhập và có role là admin hay không
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Truy cập bị từ chối. Yêu cầu quyền Admin.' });
    }
};