module.exports = function (req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next(); 
    } else {
        res.status(403).json({ message: 'Truy cập bị từ chối! Bạn không phải Admin.' });
    }
};