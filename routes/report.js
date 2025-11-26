const express = require('express');
const router = express.Router();

// Controllers & Middleware
const reportController = require('../controllers/reportController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// 1. Story Reports (Báo cáo truyện)

// [USER] Gửi báo cáo truyện
router.post('/', authMiddleware, reportController.createReport);

// [ADMIN] Lấy tất cả báo cáo truyện
router.get('/admin/all', authMiddleware, adminMiddleware, reportController.getAllReports);

// [ADMIN] Xóa báo cáo (đã xử lý)
router.delete('/admin/:id', authMiddleware, adminMiddleware, reportController.deleteReport);

// 2. Comment Reports (Báo cáo bình luận)

// [USER] Gửi báo cáo cho một bình luận
router.post('/comments', authMiddleware, reportController.submitCommentReport);

// [ADMIN] Lấy danh sách tất cả báo cáo bình luận
router.get('/comments/admin/all', authMiddleware, adminMiddleware, reportController.getAllCommentReportsForAdmin);

// [ADMIN] Xử lý một báo cáo bình luận (Xóa comment HOẶC Bỏ qua)
router.post('/comments/admin/:id/resolve', authMiddleware, adminMiddleware, reportController.resolveCommentReport);

module.exports = router;