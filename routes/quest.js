const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware'); // Import thêm
const { 
    getQuests, claimReward,
    getAllQuestsAdmin, createQuest, updateQuest, deleteQuest // Import hàm mới
} = require('../controllers/questController');

// User Routes
router.get('/', authMiddleware, getQuests);
router.post('/claim', authMiddleware, claimReward);

// Admin Routes
router.get('/admin/all', authMiddleware, adminMiddleware, getAllQuestsAdmin);
router.post('/admin', authMiddleware, adminMiddleware, createQuest);
router.put('/admin/:id', authMiddleware, adminMiddleware, updateQuest);
router.delete('/admin/:id', authMiddleware, adminMiddleware, deleteQuest);

module.exports = router;