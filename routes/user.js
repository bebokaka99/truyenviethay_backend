const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController'); // Đảm bảo dòng này có
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

const multer = require('multer');

const { storage } = require('../config/cloudinary');

const upload = multer({ storage: storage });

// ==================== PUBLIC ROUTES (Không cần đăng nhập) ====================
// Đăng ký người dùng mới
router.post('/register', userController.registerUser);

// Đăng nhập
router.post('/login', userController.loginUser);

// Lấy cấu hình truyện công khai (Hot, Ẩn...)
router.get('/public/settings', userController.getPublicComicSettings);


// ==================== PRIVATE ROUTES (Cần đăng nhập) ====================

// --- Profile ---
// Lấy thông tin profile của chính mình
router.get('/profile', authMiddleware, userController.getProfile);
// Cập nhật profile (avatar, full_name...)
router.put('/profile', authMiddleware, upload.single('avatar'), userController.updateProfile);
// Đổi mật khẩu
router.put('/change-password', authMiddleware, userController.changePassword);


// --- History (Lịch sử đọc) ---
// Lưu lịch sử đọc truyện
router.post('/history', authMiddleware, userController.saveHistory);
// Lấy toàn bộ lịch sử đọc truyện
router.get('/history', authMiddleware, userController.getHistory);
// --- CÁC ROUTE MỚI ĐỂ SỬA LỖI 404 ---
// Kiểm tra lịch sử đọc của 1 truyện cụ thể
router.get('/history/check/:comic_slug', authMiddleware, userController.checkReadingHistory);


// --- Library (Tủ truyện) ---
// Thêm vào tủ truyện (theo dõi)
router.post('/library', authMiddleware, userController.addToLibrary);
// Xóa khỏi tủ truyện (bỏ theo dõi)
router.delete('/library/:comic_slug', authMiddleware, userController.removeFromLibrary);
// Lấy danh sách tủ truyện
router.get('/library', authMiddleware, userController.getLibrary);
// --- CÁC ROUTE MỚI ĐỂ SỬA LỖI 404 ---
// Kiểm tra xem đã theo dõi truyện này chưa
router.get('/library/check/:comic_slug', authMiddleware, userController.checkFollowStatus);


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

// --- COMIC SETTINGS ROUTES (Quản lý truyện) ---
// Lấy danh sách các truyện đã được cấu hình (ẩn/hiện/đề cử)
router.get('/admin/comics', authMiddleware, adminMiddleware, userController.getManagedComics);
// Cập nhật cấu hình cho một truyện
router.post('/admin/comics', authMiddleware, adminMiddleware, userController.updateComicSetting);

module.exports = router;