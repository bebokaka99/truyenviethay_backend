const express = require('express');
const router = express.Router();

// Controllers & Middleware
const ratingController = require('../controllers/ratingController');
const authMiddleware = require('../middleware/authMiddleware');

// 1. PUBLIC ROUTES

// Lấy điểm trung bình & thông tin đánh giá của truyện
router.get('/comic/:comic_slug', ratingController.getComicRating);

// Lấy bảng xếp hạng (Top truyện được đánh giá cao)
router.get('/top', ratingController.getTopRatings);

// 2. USER ROUTES (Cần đăng nhập)

// Gửi đánh giá sao
router.post('/', authMiddleware, ratingController.submitRating);

module.exports = router;