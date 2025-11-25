const express = require('express');
const router = express.Router();
// --- DÒNG NÀY BỊ THIẾU GÂY RA LỖI ---
const reportController = require('../controllers/reportController');
// ------------------------------------
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// ===========================================
// --- ROUTES BÁO LỖI TRUYỆN (CŨ) ---
// ===========================================
// (Giữ nguyên các route cũ của bạn ở đây, ví dụ:)
// router.post('/', authMiddleware, reportController.submitReport);
// router.get('/admin/all', authMiddleware, adminMiddleware, reportController.getAllReportsForAdmin);
// router.delete('/admin/:id', authMiddleware, adminMiddleware, reportController.deleteReport);


// ===========================================
// --- ROUTES MỚI CHO BÁO CÁO BÌNH LUẬN ---
// ===========================================

// [USER] Gửi báo cáo cho một bình luận
// Dòng này gây lỗi trước đó do thiếu reportController
router.post('/comments', authMiddleware, reportController.submitCommentReport);

// [ADMIN] Lấy danh sách tất cả báo cáo bình luận
router.get('/comments/admin/all', authMiddleware, adminMiddleware, reportController.getAllCommentReportsForAdmin);

// [ADMIN] Xử lý một báo cáo bình luận (Xóa comment hoặc bỏ qua)
router.post('/comments/admin/:id/resolve', authMiddleware, adminMiddleware, reportController.resolveCommentReport);

module.exports = router;