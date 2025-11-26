const express = require('express');
const router = express.Router();
const multer = require('multer');
const { storage } = require('../config/cloudinary');

// Controllers & Middleware
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// Config Upload
const upload = multer({ storage: storage });

// 1. Pubkic routes (Không cần đăng nhập)

router.post('/register', userController.registerUser);
router.post('/login', userController.loginUser);
router.get('/public/settings', userController.getPublicComicSettings);


// 2. User Routes (Cần đăng nhập)

// --- Profile & Account ---
router.get('/profile', authMiddleware, userController.getProfile);
router.put('/profile', authMiddleware, upload.single('avatar'), userController.updateProfile);
router.put('/change-password', authMiddleware, userController.changePassword);

// --- Reading History ---
router.get('/history', authMiddleware, userController.getHistory);
router.post('/history', authMiddleware, userController.saveHistory);
router.get('/history/check/:comic_slug', authMiddleware, userController.checkReadingHistory);

// --- Library (Tủ truyện) ---
router.get('/library', authMiddleware, userController.getLibrary);
router.post('/library', authMiddleware, userController.addToLibrary);
router.delete('/library/:comic_slug', authMiddleware, userController.removeFromLibrary);
router.get('/library/check/:comic_slug', authMiddleware, userController.checkFollowStatus);

// 3. Admin Routes (Cần quyền Admin)

// --- User Management ---
router.get('/admin/users', authMiddleware, adminMiddleware, userController.getAllUsers);
router.delete('/admin/users/:id', authMiddleware, adminMiddleware, userController.deleteUser);
router.put('/admin/users/:id/role', authMiddleware, adminMiddleware, userController.changeUserRole);

// Actions (Warn, Ban, Unban)
router.post('/admin/users/:id/warn', authMiddleware, adminMiddleware, userController.warnUser);
router.post('/admin/users/:id/ban', authMiddleware, adminMiddleware, userController.banUser);
router.post('/admin/users/:id/unban', authMiddleware, adminMiddleware, userController.unbanUser);

// --- Comic Management ---
router.get('/admin/comics', authMiddleware, adminMiddleware, userController.getManagedComics);
router.post('/admin/comics', authMiddleware, adminMiddleware, userController.updateComicSetting);

module.exports = router;