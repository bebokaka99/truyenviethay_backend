const express = require('express');
const router = express.Router();

// Controllers & Middleware
const notificationController = require('../controllers/notificationController');
const authMiddleware = require('../middleware/authMiddleware');

// NOTIFICATION ROUTES

// Lấy danh sách thông báo
router.get('/', authMiddleware, notificationController.getNotifications);

// Đánh dấu tất cả là đã đọc
router.put('/read-all', authMiddleware, notificationController.markAsRead);

module.exports = router;