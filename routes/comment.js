const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const { getComments, addComment, toggleLike, 
    getAllCommentsAdmin, deleteCommentAdmin } = require('../controllers/commentController');

// GET: Lấy bình luận (Thêm param userId để check like status)
router.get('/:comic_slug', getComments);

// POST: Gửi bình luận
router.post('/', authMiddleware, addComment);

// POST: Like/Unlike
router.post('/like', authMiddleware, toggleLike);

// Admin quản lý bình luận
router.get('/admin/all', authMiddleware, getAllCommentsAdmin);
router.delete('/admin/:id', authMiddleware, deleteCommentAdmin);

module.exports = router;