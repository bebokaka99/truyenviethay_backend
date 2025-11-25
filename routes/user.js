const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const multer = require('multer');

// --- CẤU HÌNH UPLOAD (CLOUDINARY) ---
// 1. Import storage từ file config đã tạo
const { storage } = require('../config/cloudinary'); 

// 2. Khởi tạo Multer với storage của Cloudinary
// (Xóa bỏ toàn bộ đoạn diskStorage và fileFilter cũ để tránh xung đột)
const upload = multer({ storage }); 

// --- IMPORT CONTROLLERS ---
const { 
    addToLibrary, removeFromLibrary, getLibrary, checkFollowStatus, 
    saveHistory, getHistory, checkReadingHistory,
    updateProfile, changePassword, 
    getAllUsers, deleteUser, warnUser, banUser, unbanUser, 
    getManagedComics, updateComicSetting, getPublicComicSettings
} = require('../controllers/userController');

// --- ROUTES ---

// 1. Library (Tủ truyện)
router.post('/library', authMiddleware, addToLibrary);
router.delete('/library/:comic_slug', authMiddleware, removeFromLibrary);
router.get('/library', authMiddleware, getLibrary);
router.get('/library/check/:comic_slug', authMiddleware, checkFollowStatus);

// 2. History (Lịch sử)
router.post('/history', authMiddleware, saveHistory);
router.get('/history', authMiddleware, getHistory);
router.get('/history/check/:comic_slug', authMiddleware, checkReadingHistory);

// 3. Public Settings
router.get('/public/settings', getPublicComicSettings);

// 4. Profile (Cá nhân)
// Sửa lỗi chính tả 'outer' -> 'router'
// Sử dụng middleware 'upload.single' để xử lý ảnh avatar trước khi vào controller
router.put('/profile', authMiddleware, upload.single('avatar'), updateProfile);
router.put('/password', authMiddleware, changePassword);

// 5. Admin Routes
router.get('/admin/users', authMiddleware, adminMiddleware, getAllUsers);
router.delete('/admin/users/:id', authMiddleware, adminMiddleware, deleteUser);
router.post('/admin/users/:id/warn', authMiddleware, adminMiddleware, warnUser);
router.post('/admin/users/:id/ban', authMiddleware, adminMiddleware, banUser);
router.post('/admin/users/:id/unban', authMiddleware, adminMiddleware, unbanUser);
router.put('/admin/users/:id/role', authMiddleware, adminMiddleware, userController.changeUserRole);
// Route Quản lý Truyện (Admin)
router.get('/admin/comics', authMiddleware, adminMiddleware, getManagedComics);
router.post('/admin/comics', authMiddleware, adminMiddleware, updateComicSetting);

module.exports = router;