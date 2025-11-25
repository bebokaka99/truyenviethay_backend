const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const { createReport, getAllReports, deleteReport } = require('../controllers/reportController');

// User gửi báo cáo
router.post('/', authMiddleware, createReport);

// Admin quản lý
router.get('/admin/all', authMiddleware, adminMiddleware, getAllReports);
router.delete('/admin/:id', authMiddleware, adminMiddleware, deleteReport);

// [USER] Gửi báo cáo cho một bình luận
router.post('/comments', authMiddleware, reportController.submitCommentReport);

// [ADMIN] Lấy danh sách tất cả báo cáo bình luận
router.get('/comments/admin/all', authMiddleware, adminMiddleware, reportController.getAllCommentReportsForAdmin);

// [ADMIN] Xử lý một báo cáo bình luận (Xóa comment hoặc bỏ qua)
router.post('/comments/admin/:id/resolve', authMiddleware, adminMiddleware, reportController.resolveCommentReport);

module.exports = router;