const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const { createReport, getAllReports, deleteReport } = require('../controllers/reportController');

// User gửi báo cáo
router.post('/', authMiddleware, createReport);

// Admin quản lý
router.get('/admin/all', authMiddleware, adminMiddleware, getAllReports);
router.delete('/admin/:id', authMiddleware, adminMiddleware, deleteReport);

module.exports = router;