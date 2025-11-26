const express = require('express');
const router = express.Router();

// Controllers & Middleware
const questController = require('../controllers/questController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// 1. USER ROUTES (Nhiệm vụ & Nhận thưởng)

// Lấy danh sách nhiệm vụ và trạng thái
router.get('/', authMiddleware, questController.getQuests);

// Nhận thưởng nhiệm vụ
router.post('/claim', authMiddleware, questController.claimReward);

// 2. ADMIN ROUTES (Quản lý nhiệm vụ)

// Lấy tất cả nhiệm vụ
router.get('/admin/all', authMiddleware, adminMiddleware, questController.getAllQuestsAdmin);

// Tạo nhiệm vụ mới
router.post('/admin', authMiddleware, adminMiddleware, questController.createQuest);

// Cập nhật nhiệm vụ
router.put('/admin/:id', authMiddleware, adminMiddleware, questController.updateQuest);

// Xóa nhiệm vụ
router.delete('/admin/:id', authMiddleware, adminMiddleware, questController.deleteQuest);

module.exports = router;