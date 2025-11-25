const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// --- SỬA LỖI Ở ĐÂY ---
// Thay vì lấy từng hàm lẻ, ta lấy toàn bộ object controller
const reportController = require('../controllers/reportController');
// --------------------


// ===========================================
// ROUTES BÁO LỖI TRUYỆN (CŨ)
// ===========================================
// Cập nhật các route cũ để dùng 'reportController.' phía trước tên hàm

// User gửi báo cáo truyện
router.post('/', authMiddleware, reportController.createReport);

// Admin quản lý báo cáo truyện
router.get('/admin/all', authMiddleware, adminMiddleware, reportController.getAllReports);
router.delete('/admin/:id', authMiddleware, adminMiddleware, reportController.deleteReport);


// ===========================================
// ROUTES MỚI CHO BÁO CÁO BÌNH LUẬN
// ===========================================
// Các route này bây giờ sẽ hoạt động vì biến reportController đã được định nghĩa ở trên

// [USER] Gửi báo cáo cho một bình luận
router.post('/comments', authMiddleware, reportController.submitCommentReport);

// [ADMIN] Lấy danh sách tất cả báo cáo bình luận
router.get('/comments/admin/all', authMiddleware, adminMiddleware, reportController.getAllCommentReportsForAdmin);

// [ADMIN] Xử lý một báo cáo bình luận (Xóa comment hoặc bỏ qua)
router.post('/comments/admin/:id/resolve', authMiddleware, adminMiddleware, reportController.resolveCommentReport);

module.exports = router;