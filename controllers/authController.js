const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { createNotificationInternal } = require('./notificationController');
const { updateQuestProgress } = require('./userController'); 

// --- CẤU HÌNH GỬI MAIL (FIX TIME OUT & IPV6) ---
const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com", // Máy chủ của Brevo
    port: 587,                    // Cổng chuẩn của Brevo
    secure: false,                // false cho cổng 587
    auth: {
        user: process.env.EMAIL_USER, // Email tài khoản Brevo
        pass: process.env.EMAIL_PASS  // SMTP Key của Brevo
    },
    tls: {
        rejectUnauthorized: false // Giúp kết nối mượt hơn trên Linux
    }
});

// Kiểm tra kết nối (Debug)
transporter.verify(function (error, success) {
    if (error) {
        console.log("❌ Lỗi kết nối SMTP Brevo:", error);
    } else {
        console.log("✅ Kết nối SMTP Brevo thành công!");
    }
});

// Kiểm tra kết nối ngay khi khởi động
transporter.verify(function (error, success) {
    if (error) {
        console.log("❌ Lỗi kết nối Mail Server:", error);
    } else {
        console.log("✅ Mail Server đã sẵn sàng (IPv4)!");
    }
});

// --- LOGIC ĐIỂM DANH & STREAK ---
const handleLoginStreaks = async (userId) => {
    try {
        const [rows] = await db.execute(
            "SELECT login_streak, last_login_date, DATEDIFF(CURRENT_DATE(), last_login_date) as diff FROM users WHERE id = ?", 
            [userId]
        );
        const user = rows[0];
        let newStreak = 1;
        const diff = user.last_login_date ? user.diff : null; 

        if (diff === 0) newStreak = user.login_streak;
        else if (diff === 1) newStreak = user.login_streak + 1;
        else newStreak = 1;

        if (diff !== 0) {
            await db.execute("UPDATE users SET login_streak = ?, last_login_date = CURRENT_DATE() WHERE id = ?", [newStreak, userId]);
        }

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
        if (existingUser.length > 0) return res.status(400).json({ message: 'Email hoặc Username đã tồn tại!' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await db.execute('INSERT INTO users (username, email, password, full_name) VALUES (?, ?, ?, ?)', [username, email, hashedPassword, full_name]);
        res.status(201).json({ message: 'Đăng ký thành công! Hãy đăng nhập ngay.' });
    } catch (error) { console.error(error); res.status(500).json({ message: 'Lỗi server.' }); }
};

// --- ĐĂNG NHẬP ---
exports.login = async (req, res) => {
    const { identifier, email, password } = req.body;
    const loginKey = identifier || email;

    try {
        const [users] = await db.execute('SELECT id, username, email, full_name, avatar, role, exp, rank_style, password, status, ban_expires_at FROM users WHERE email = ? OR username = ?', [loginKey, loginKey]);
        if (users.length === 0) return res.status(400).json({ message: 'Tài khoản không tồn tại!' });

        const user = users[0];
        if (user.status === 'banned') {
            const now = new Date();
            if (user.ban_expires_at && new Date(user.ban_expires_at) > now) {
                return res.status(403).json({ message: `Tài khoản bị khóa đến ${new Date(user.ban_expires_at).toLocaleString()}` });
            } else {
                await db.execute("UPDATE users SET status = 'active', ban_expires_at = NULL WHERE id = ?", [user.id]);
            }
        }

        if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ message: 'Mật khẩu không đúng!' });
        
        if (user.role === 'user') await handleLoginStreaks(user.id);

        const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, username: user.username, email: user.email, full_name: user.full_name, avatar: user.avatar, role: user.role, exp: user.exp, rank_style: user.rank_style } });
    } catch (error) { console.error(error); res.status(500).json({ message: 'Lỗi server.' }); }
};

// --- 1. QUÊN MẬT KHẨU (GỬI OTP) ---
exports.forgotPassword = async (req, res) => {
    const { email } = req.body;
    try {
        const [users] = await db.execute('SELECT id, full_name FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ message: 'Email không tồn tại!' });

        const user = users[0];
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        await db.execute(
            'INSERT INTO password_resets (email, otp, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))', 
            [email, otp]
        );

        const mailOptions = {
            // QUAN TRỌNG: Brevo yêu cầu email người gửi phải trùng với email đăng nhập
            // Hoặc là Sender đã được xác minh trong dashboard Brevo
            from: `"TruyenVietHay" <${process.env.EMAIL_USER}>`, 
            to: email,
            subject: '[TruyenVietHay] Mã xác nhận đặt lại mật khẩu',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                   <style>
                        body { font-family: sans-serif; background-color: #f4f4f7; padding: 20px; }
                        .container { max-width: 600px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
                        .otp { font-size: 32px; font-weight: bold; color: #16a34a; text-align: center; margin: 20px 0; letter-spacing: 5px; }
                   </style>
                </head>
                <body>
                    <div class="container">
                        <h2>TruyenVietHay - Đặt lại mật khẩu</h2>
                        <p>Xin chào <strong>${user.full_name}</strong>,</p>
                        <p>Mã OTP của bạn là:</p>
                        <div class="otp">${otp}</div>
                        <p>Mã có hiệu lực trong 15 phút.</p>
                    </div>
                </body>
                </html>
            `
        };

        console.log("Đang gửi mail qua Brevo tới:", email);
        await transporter.sendMail(mailOptions);
        console.log("Gửi thành công!");
        res.json({ message: 'Đã gửi mã OTP!' });

    } catch (error) {
        console.error("Lỗi gửi mail:", error);
        res.status(500).json({ message: 'Lỗi server khi gửi mail.' });
    }
};

// --- 2. RESET PASSWORD ---
exports.resetPassword = async (req, res) => {
    let { email, otp, newPassword } = req.body;
    otp = otp.trim();
    email = email.trim();

    try {
        const [resets] = await db.execute(
            'SELECT * FROM password_resets WHERE email = ? AND otp = ? AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
            [email, otp]
        );

        if (resets.length === 0) return res.status(400).json({ message: 'Mã xác nhận sai hoặc hết hạn!' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.execute('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, email]);
        await db.execute('DELETE FROM password_resets WHERE email = ?', [email]);

        res.json({ message: 'Đổi mật khẩu thành công!' });
    } catch (error) { console.error(error); res.status(500).json({ message: 'Lỗi server.' }); }
};