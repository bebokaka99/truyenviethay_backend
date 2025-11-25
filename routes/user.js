const express = require('express');
const router = express.Router();
// --- QUAN TRỌNG: Dòng này bị thiếu nên gây ra lỗi ---
const userController = require('../controllers/userController');
// ----------------------------------------------------
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// ==================== PUBLIC ROUTES ====================
// Đăng ký người dùng mới
router.post('/register', userController.registerUser);

// Đăng nhập
router.post('/login', userController.loginUser);

// ==================== PRIVATE ROUTES (Cần đăng nhập) ====================
// Lấy thông tin profile của chính mình
router.get('/profile', authMiddleware, userController.getProfile);

// Cập nhật profile (avatar, full_name...)
router.put('/profile', authMiddleware, userController.updateProfile);

// Đổi mật khẩu
router.put('/change-password', authMiddleware, userController.changePassword);

// Lưu lịch sử đọc truyện
router.post('/history', authMiddleware, userController.saveHistory);

// Lấy lịch sử đọc truyện
router.get('/history', authMiddleware, userController.getHistory);

// Kiểm tra lịch sử đọc của 1 truyện cụ thể (để hiện nút "Đọc tiếp")
router.get('/history/:comic_slug', authMiddleware, userController.checkReadingHistory);

// Thêm vào tủ truyện (theo dõi)
router.post('/library', authMiddleware, userController.addToLibrary);

// Xóa khỏi tủ truyện (bỏ theo dõi)
router.delete('/library/:comic_slug', authMiddleware, userController.removeFromLibrary);

// Lấy danh sách tủ truyện
router.get('/library', authMiddleware, userController.getLibrary);

// Kiểm tra trạng thái theo dõi truyện
router.get('/library/:comic_slug/check', authMiddleware, userController.checkFollowStatus);

// ==================== ADMIN ROUTES (Cần role admin) ====================

// Lấy danh sách tất cả user (có phân trang)
router.get('/admin/users', authMiddleware, adminMiddleware, userController.getAllUsers);

// Cảnh báo user
router.post('/admin/users/:id/warn', authMiddleware, adminMiddleware, userController.warnUser);

// Chặn user (Ban)
router.post('/admin/users/:id/ban', authMiddleware, adminMiddleware, userController.banUser);

// Mở khóa user (Unban)
router.post('/admin/users/:id/unban', authMiddleware, adminMiddleware, userController.unbanUser);

// Xóa user (Cẩn thận khi dùng)
router.delete('/admin/users/:id', authMiddleware, adminMiddleware, userController.deleteUser);

// [MỚI] Thay đổi role của user (User <-> Admin)
router.put('/admin/users/:id/role', authMiddleware, adminMiddleware, userController.changeUserRole);

// --- COMIC SETTINGS ROUTES ---
// Lấy danh sách các truyện đã được cấu hình (ẩn/hiện/đề cử)
router.get('/admin/comics', authMiddleware, adminMiddleware, userController.getManagedComics);

// Cập nhật cấu hình cho một truyện
router.post('/admin/comics', authMiddleware, adminMiddleware, userController.updateComicSetting);

router.get('/public/settings', userController.getPublicComicSettings);

module.exports = router;