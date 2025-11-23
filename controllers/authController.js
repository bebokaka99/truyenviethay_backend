const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { createNotificationInternal } = require('./notificationController');
// Import helper updateQuestProgress
const { updateQuestProgress } = require('./userController'); 

// --- CẤU HÌNH GỬI MAIL (FIX LỖI TIMEOUT RENDER - STARTTLS) ---
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,             // BẮT BUỘC dùng cổng 587 trên Render
    secure: false,         // secure: false (để dùng STARTTLS)
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        // Quan trọng: Bỏ qua lỗi chứng chỉ SSL (Self-signed certificate error) thường gặp trên Linux
        rejectUnauthorized: false
    },
    // Tăng timeout để tránh bị ngắt kết nối quá sớm
    connectionTimeout: 20000, // 20 giây
    greetingTimeout: 20000,   // 20 giây
    socketTimeout: 20000      // 20 giây
});

// Kiểm tra kết nối mail ngay khi khởi động (Debug)
transporter.verify(function (error, success) {
    if (error) {
        console.log("❌ Lỗi kết nối Mail Server:", error);
    } else {
        console.log("✅ Mail Server đã sẵn sàng!");
    }
});

// --- LOGIC ĐIỂM DANH & STREAK (Đã Fix) ---
const handleLoginStreaks = async (userId) => {
    try {
        // 1. Lấy thông tin đăng nhập lần cuối
        const [rows] = await db.execute(
            "SELECT login_streak, last_login_date, DATEDIFF(CURRENT_DATE(), last_login_date) as diff FROM users WHERE id = ?", 
            [userId]
        );
        const user = rows[0];
        
        let newStreak = 1;
        const diff = user.last_login_date ? user.diff : null; 

        // Logic tính toán Streak
        if (diff === 0) {
            newStreak = user.login_streak;
        } else if (diff === 1) {
            newStreak = user.login_streak + 1;
        } else {
            newStreak = 1;
        }

        // 2. Cập nhật bảng Users (Chỉ update nếu là ngày mới)
        if (diff !== 0) {
            await db.execute("UPDATE users SET login_streak = ?, last_login_date = CURRENT_DATE() WHERE id = ?", [newStreak, userId]);
        }

        // 3. Cập nhật Nhiệm vụ
        await updateQuestProgress(userId, 'login', 1); 
        await updateQuestProgress(userId, 'streak', newStreak);

    } catch (error) {
        console.error("Lỗi streak:", error);
    }
};

// --- ĐĂNG KÝ ---
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

// --- ĐĂNG NHẬP ---
exports.login = async (req, res) => {
    const { identifier, email, password } = req.body;
    const loginKey = identifier || email;

    try {
        const [users] = await db.execute(
            'SELECT id, username, email, full_name, avatar, role, exp, rank_style, password, status, ban_expires_at FROM users WHERE email = ? OR username = ?', 
            [loginKey, loginKey]
        );
        
        if (users.length === 0) {
            return res.status(400).json({ message: 'Tài khoản không tồn tại!' });
        }

        const user = users[0];

        if (user.status === 'banned') {
            const now = new Date();
            if (user.ban_expires_at) {
                const banTime = new Date(user.ban_expires_at);
                if (banTime > now) {
                    return res.status(403).json({ message: `Tài khoản bị khóa đến ${banTime.toLocaleString('vi-VN')}` });
                } else {
                    await db.execute("UPDATE users SET status = 'active', ban_expires_at = NULL WHERE id = ?", [user.id]);
                }
            } else {
                return res.status(403).json({ message: 'Tài khoản bị khóa vĩnh viễn.' });
            }
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Mật khẩu không đúng!' });
        }
        
        if (user.role === 'user') {
            await handleLoginStreaks(user.id);
        }

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

// ==========================================
// 1. QUÊN MẬT KHẨU (GỬI OTP)
// ==========================================
exports.forgotPassword = async (req, res) => {
    const { email } = req.body;
    try {
        const [users] = await db.execute('SELECT id, full_name FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ message: 'Email không tồn tại trong hệ thống!' });

        const user = users[0];
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        await db.execute(
            'INSERT INTO password_resets (email, otp, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))', 
            [email, otp]
        );

        const mailOptions = {
            from: '"TruyenVietHay Security" <no-reply@truyenviethay.com>',
            to: email,
            subject: '[TruyenVietHay] Mã xác nhận đặt lại mật khẩu',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f7; margin: 0; padding: 0; }
                        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-top: 40px; }
                        .header { background-color: #1a1a2e; padding: 30px; text-align: center; }
                        .header h1 { color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px; }
                        .content { padding: 40px 30px; color: #333333; line-height: 1.6; }
                        .otp-box { background-color: #f0fdf4; border: 2px dashed #16a34a; color: #16a34a; font-size: 32px; font-weight: bold; text-align: center; padding: 15px; margin: 30px 0; letter-spacing: 8px; border-radius: 8px; }
                        .warning { font-size: 13px; color: #666666; background-color: #fff7ed; padding: 15px; border-radius: 6px; border-left: 4px solid #f97316; margin-top: 20px; }
                        .footer { background-color: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header"><h1>TruyenVietHay</h1></div>
                        <div class="content">
                            <p>Xin chào <strong>${user.full_name}</strong>,</p>
                            <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Vui lòng sử dụng mã xác nhận bên dưới để hoàn tất quá trình:</p>
                            <div class="otp-box">${otp}</div>
                            <p>Mã này sẽ hết hạn sau <strong>15 phút</strong>.</p>
                            <div class="warning"><strong>Lưu ý:</strong> Nếu bạn không yêu cầu thay đổi mật khẩu, vui lòng bỏ qua email này. Tuyệt đối không chia sẻ mã này cho bất kỳ ai.</div>
                        </div>
                        <div class="footer">&copy; ${new Date().getFullYear()} TruyenVietHay. All rights reserved.</div>
                    </div>
                </body>
                </html>
            `
        };

        await transporter.sendMail(mailOptions);
        res.json({ message: 'Mã xác nhận đã được gửi tới email của bạn.' });

    } catch (error) {
        console.error("Lỗi gửi mail:", error);
        res.status(500).json({ message: 'Lỗi server khi gửi mail.' });
    }
};

// --- 2. ĐẶT LẠI MẬT KHẨU ---
exports.resetPassword = async (req, res) => {
    let { email, otp, newPassword } = req.body;
    otp = otp.trim();
    email = email.trim();

    try {
        const [resets] = await db.execute(
            'SELECT * FROM password_resets WHERE email = ? AND otp = ? AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
            [email, otp]
        );

        if (resets.length === 0) {
            return res.status(400).json({ message: 'Mã xác nhận sai hoặc đã hết hạn!' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.execute('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, email]);
        await db.execute('DELETE FROM password_resets WHERE email = ?', [email]);

        res.json({ message: 'Đổi mật khẩu thành công!' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};