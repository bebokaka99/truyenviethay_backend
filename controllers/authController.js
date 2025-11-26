const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const db = require('../config/db');

// Import helper từ userController
const { updateQuestProgress } = require('./userController');

// Helper function (Hàm phụ trợ)

// 1. Gửi email qua API Brevo
const sendEmailViaBrevo = async (toEmail, subject, htmlContent) => {
    try {
        const apiKey = process.env.EMAIL_PASS;
        const senderEmail = process.env.EMAIL_USER;
        const senderName = "TruyenVietHay Support";

        const data = {
            sender: { name: senderName, email: senderEmail },
            to: [{ email: toEmail }],
            subject: subject,
            htmlContent: htmlContent
        };

        await axios.post('https://api.brevo.com/v3/smtp/email', data, {
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        console.log(`API Brevo: Đã gửi mail tới ${toEmail}`);
        return true;
    } catch (error) {
        console.error("Lỗi API Brevo:", error.response ? error.response.data : error.message);
        return false;
    }
};

// 2. Xử lý điểm danh & Streak
const handleLoginStreaks = async (userId) => {
    try {
        const [rows] = await db.execute(
            "SELECT login_streak, last_login_date, DATEDIFF(CURRENT_DATE(), last_login_date) as diff FROM users WHERE id = ?",
            [userId]
        );
        const user = rows[0];
        let newStreak = 1;
        const diff = user.last_login_date ? user.diff : null;

        if (diff === 0) newStreak = user.login_streak; // Login cùng ngày
        else if (diff === 1) newStreak = user.login_streak + 1; // Login liên tiếp
        else newStreak = 1; // Mất chuỗi

        // Cập nhật DB nếu sang ngày mới
        if (diff !== 0) {
            await db.execute("UPDATE users SET login_streak = ?, last_login_date = CURRENT_DATE() WHERE id = ?", [newStreak, userId]);
        }

        // Cập nhật nhiệm vụ
        await updateQuestProgress(userId, 'login', 1);
        await updateQuestProgress(userId, 'streak', newStreak);
    } catch (error) {
        console.error("Lỗi streak:", error);
    }
};

// Main controller

exports.register = async (req, res) => {
    const { username, email, password, full_name } = req.body;
    try {
        const [existingUser] = await db.execute('SELECT * FROM users WHERE email = ? OR username = ?', [email, username]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: 'Email hoặc Username đã tồn tại!' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await db.execute(
            'INSERT INTO users (username, email, password, full_name) VALUES (?, ?, ?, ?)',
            [username, email, hashedPassword, full_name]
        );
        res.status(201).json({ message: 'Đăng ký thành công! Hãy đăng nhập ngay.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Lỗi server khi đăng ký.' });
    }
};

exports.login = async (req, res) => {
    const { identifier, email, password } = req.body;
    const loginKey = identifier || email; // Hỗ trợ cả 2 cách gửi

    try {
        const [users] = await db.execute(
            'SELECT id, username, email, full_name, avatar, role, exp, rank_style, password, status, ban_expires_at FROM users WHERE email = ? OR username = ?',
            [loginKey, loginKey]
        );

        if (users.length === 0) return res.status(400).json({ message: 'Tài khoản không tồn tại hoặc mật khẩu không đúng!' });

        const user = users[0];

        // Check Ban
        if (user.status === 'banned') {
            const now = new Date();
            if (user.ban_expires_at) {
                const banTime = new Date(user.ban_expires_at);
                if (banTime > now) return res.status(403).json({ message: `Tài khoản bị khóa đến ${banTime.toLocaleString('vi-VN')}` });
                else await db.execute("UPDATE users SET status = 'active', ban_expires_at = NULL WHERE id = ?", [user.id]); // Auto unlock
            } else {
                return res.status(403).json({ message: 'Tài khoản bị khóa vĩnh viễn.' });
            }
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Tài khoản không tồn tại hoặc mật khẩu không đúng!' });

        // Handle Streaks (User only)
        if (user.role === 'user') await handleLoginStreaks(user.id);

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                full_name: user.full_name,
                avatar: user.avatar,
                role: user.role,
                exp: user.exp,
                rank_style: user.rank_style
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Lỗi server khi đăng nhập.' });
    }
};

exports.forgotPassword = async (req, res) => {
    const { email } = req.body;
    try {
        const [users] = await db.execute('SELECT id, full_name FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ message: 'Email không tồn tại trong hệ thống!' });

        const user = users[0];
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Save OTP (15 mins expiry)
        await db.execute(
            'INSERT INTO password_resets (email, otp, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))',
            [email, otp]
        );

        // Get HTML Template & Send
        const htmlContent = getResetEmailTemplate(user.full_name, otp);
        console.log("Đang gọi API Brevo...");
        await sendEmailViaBrevo(email, '[TruyenVietHay] Mã xác nhận đặt lại mật khẩu', htmlContent);

        res.json({ message: 'Mã xác nhận đã được gửi tới email của bạn.' });
    } catch (error) {
        console.error("Lỗi forgotPassword:", error);
        res.status(500).json({ message: 'Lỗi hệ thống khi gửi mail.' });
    }
};

exports.resetPassword = async (req, res) => {
    let { email, otp, newPassword } = req.body;
    otp = otp ? otp.trim() : '';
    email = email ? email.trim() : '';

    try {
        const [resets] = await db.execute(
            'SELECT * FROM password_resets WHERE email = ? AND otp = ? AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
            [email, otp]
        );

        if (resets.length === 0) return res.status(400).json({ message: 'Mã xác nhận sai hoặc đã hết hạn!' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.execute('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, email]);
        await db.execute('DELETE FROM password_resets WHERE email = ?', [email]);

        res.json({ message: 'Đổi mật khẩu thành công!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};

// Template email đặt lại mật khẩu
const getResetEmailTemplate = (fullName, otp) => {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: 'Segoe UI', sans-serif; background-color: #f4f4f7; margin: 0; padding: 0; }
                .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
                .header { background-color: #1a1a2e; padding: 30px; text-align: center; }
                .header h1 { color: #ffffff; margin: 0; font-size: 24px; }
                .content { padding: 40px 30px; color: #333; line-height: 1.6; }
                .otp-box { background-color: #f0fdf4; border: 2px dashed #16a34a; color: #16a34a; font-size: 32px; font-weight: bold; text-align: center; padding: 15px; margin: 30px 0; letter-spacing: 8px; border-radius: 8px; }
                .warning { font-size: 13px; color: #666; background-color: #fff7ed; padding: 15px; border-radius: 6px; border-left: 4px solid #f97316; margin-top: 20px; }
                .footer { background-color: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header"><h1>TruyenVietHay</h1></div>
                <div class="content">
                    <p>Xin chào <strong>${fullName}</strong>,</p>
                    <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu. Mã xác nhận của bạn là:</p>
                    <div class="otp-box">${otp}</div>
                    <p>Mã này sẽ hết hạn sau <strong>15 phút</strong>.</p>
                    <div class="warning"><strong>Lưu ý:</strong> Nếu bạn không yêu cầu, vui lòng bỏ qua email này.</div>
                </div>
                <div class="footer">&copy; ${new Date().getFullYear()} TruyenVietHay. All rights reserved.</div>
            </div>
        </body>
        </html>
    `;
};