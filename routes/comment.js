const express = require('express');
const router = express.Router();

// Controllers & Middleware
const commentController = require('../controllers/commentController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// 1. Public Routes

// Lấy danh sách bình luận (kèm userId query để check like)
router.get('/:comic_slug', commentController.getComments);

// 2. User Routes (Requires Authentication)

// Gửi bình luận mới
router.post('/', authMiddleware, commentController.addComment);

// Thích / Bỏ thích bình luận
router.post('/like', authMiddleware, commentController.toggleLike);

// 3. Admin Routes (Requires Admin Privileges)

// Lấy tất cả bình luận (Mới nhất)
router.get('/admin/all', authMiddleware, adminMiddleware, commentController.getAllCommentsAdmin);

// Xóa bình luận bất kỳ (Force delete)
router.delete('/admin/:id', authMiddleware, adminMiddleware, commentController.deleteCommentAdmin);

module.exports = router;