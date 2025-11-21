const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { submitRating, getComicRating, getTopRatings } = require('../controllers/ratingController');

// Public: Lấy điểm trung bình truyện
router.get('/comic/:comic_slug', getComicRating);

// Public: Lấy bảng xếp hạng
router.get('/top', getTopRatings);

// Private: Gửi đánh giá
router.post('/', authMiddleware, submitRating);

module.exports = router;