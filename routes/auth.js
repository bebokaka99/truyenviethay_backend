const express = require('express');
const router = express.Router();

// 1. Import các hàm từ Controller (Thêm forgotPassword, resetPassword)
const { 
    register, 
    login, 
    forgotPassword, 
    resetPassword 
} = require('../controllers/authController');

// 2. Định nghĩa các Route

// Đăng ký
// POST /api/auth/register
router.post('/register', register);

// Đăng nhập
// POST /api/auth/login
router.post('/login', login);

// Quên mật khẩu (Gửi OTP)
// POST /api/auth/forgot-password
router.post('/forgot-password', forgotPassword);

// Đặt lại mật khẩu (Xác nhận OTP)
// POST /api/auth/reset-password
router.post('/reset-password', resetPassword);

module.exports = router;