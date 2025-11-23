const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios'); // Dùng Axios để gọi API Brevo (Cần cài: npm install axios)
const { createNotificationInternal } = require('./notificationController');
// Import helper updateQuestProgress từ userController
const { updateQuestProgress } = require('./userController'); 

// ============================================================
// HÀM GỬI MAIL QUA BREVO API (HTTP v3) - FIX LỖI TIMEOUT
// ============================================================
const sendEmailViaBrevo = async (toEmail, subject, htmlContent) => {
    // Lấy API Key từ biến môi trường (Mã bắt đầu bằng xkeysib-...)
    const apiKey = process.env.EMAIL_PASS; 
    
    // Email người gửi (Phải là email thực đã verify với Brevo, VD: tlm20k2@gmail.com)
    // Lấy từ biến môi trường EMAIL_USER mà bạn đã cấu hình trên Render
    const senderEmail = process.env.EMAIL_USER; 
    const senderName = "TruyenVietHay Support";

    const data = {
        sender: { name: senderName, email: senderEmail },
        to: [{ email: toEmail }],
        subject: subject,
        htmlContent: htmlContent
    };

    try {
        await axios.post('https://api.brevo.com/v3/smtp/email', data, {
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        console.log(`✅ API Brevo: Đã gửi mail tới ${toEmail}`);
        return true;
    } catch (error) {
        console.error("❌ Lỗi API Brevo:", error.response ? error.response.data : error.message);
        // Không ném lỗi ra ngoài để tránh crash luồng chính, chỉ log lỗi
        return false;
    }
};

// ============================================================
// LOGIC ĐIỂM DANH & STREAK
// ============================================================
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
            // Đã login hôm nay -> Giữ nguyên
            newStreak = user.login_streak;
        } else if (diff === 1) {
            // Login liên tiếp -> Tăng 1
            newStreak = user.login_streak + 1;
        } else {
            // Mất chuỗi hoặc lần đầu -> Reset về 1
            newStreak = 1;
        }

        // 2. Cập nhật bảng Users (Chỉ update nếu là ngày mới)
        if (diff !== 0) {
            await db.execute("UPDATE users SET login_streak = ?, last_login_date = CURRENT_DATE() WHERE id = ?", [newStreak, userId]);
        }

        // 3. Cập nhật Nhiệm vụ
        // A. Daily Login: Luôn gọi, hàm helper sẽ tự check reset nếu cần
        await updateQuestProgress(userId, 'login', 1); 

        // B. Weekly Streak: Truyền giá trị streak thực tế vào
        await updateQuestProgress(userId, 'streak', newStreak);

    } catch (error) {
        console.error("Lỗi streak:", error);
    }
};

// ============================================================
// ĐĂNG KÝ
// ============================================================
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

// ============================================================
// ĐĂNG NHẬP (HỖ TRỢ EMAIL HOẶC USERNAME)
// ============================================================
exports.login = async (req, res) => {
    // Frontend gửi 'identifier', check cả 'email' để tương thích ngược
    const { identifier, email, password } = req.body;
    const loginKey = identifier || email;

    try {
        // Tìm user theo email HOẶC username
        const [users] = await db.execute(
            'SELECT id, username, email, full_name, avatar, role, exp, rank_style, password, status, ban_expires_at FROM users WHERE email = ? OR username = ?', 
            [loginKey, loginKey]
        );
        
        if (users.length === 0) {
            return res.status(400).json({ message: 'Tài khoản không tồn tại!' });
        }

        const user = users[0];

        // Kiểm tra BAN
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
        
        // Kích hoạt logic điểm danh (Chỉ cho User thường)
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

// ============================================================
// 1. QUÊN MẬT KHẨU (GỬI OTP QUA API BREVO)
// ============================================================
exports.forgotPassword = async (req, res) => {
    const { email } = req.body;
    try {
        const [users] = await db.execute('SELECT id, full_name FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ message: 'Email không tồn tại trong hệ thống!' });

        const user = users[0];
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Lưu OTP vào DB (Dùng hàm SQL DATE_ADD để tính giờ server DB, tránh lệch múi giờ)
        await db.execute(
            'INSERT INTO password_resets (email, otp, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))', 
            [email, otp]
        );

        // Nội dung Email HTML Chuyên nghiệp
        const htmlContent = `
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
                    <div class="header">
                        <h1>TruyenVietHay</h1>
                    </div>
                    <div class="content">
                        <p>Xin chào <strong>${user.full_name}</strong>,</p>
                        <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Vui lòng sử dụng mã xác nhận bên dưới để hoàn tất quá trình:</p>
                        
                        <div class="otp-box">${otp}</div>
                        
                        <p>Mã này sẽ hết hạn sau <strong>15 phút</strong>.</p>
                        
                        <div class="warning">
                            <strong>Lưu ý:</strong> Nếu bạn không yêu cầu thay đổi mật khẩu, vui lòng bỏ qua email này. Tuyệt đối không chia sẻ mã này cho bất kỳ ai.
                        </div>
                    </div>
                    <div class="footer">
                        &copy; ${new Date().getFullYear()} TruyenVietHay. All rights reserved.<br>
                        Đây là email tự động, vui lòng không trả lời.
                    </div>
                </div>
            </body>
            </html>
        `;

        // Gọi hàm gửi mail qua API
        console.log("Đang gọi API Brevo...");
        await sendEmailViaBrevo(email, '[TruyenVietHay] Mã xác nhận đặt lại mật khẩu', htmlContent);
        
        res.json({ message: 'Mã xác nhận đã được gửi tới email của bạn.' });

    } catch (error) {
        console.error("Lỗi forgotPassword:", error);
        res.status(500).json({ message: 'Lỗi hệ thống khi gửi mail.' });
    }
};

// ============================================================
// 2. ĐẶT LẠI MẬT KHẨU (RESET)
// ============================================================
exports.resetPassword = async (req, res) => {
    let { email, otp, newPassword } = req.body;
    
    // Cắt khoảng trắng thừa để tránh lỗi nhập liệu
    otp = otp ? otp.trim() : '';
    email = email ? email.trim() : '';

    try {
        // Kiểm tra OTP với NOW() của Database
        const [resets] = await db.execute(
            'SELECT * FROM password_resets WHERE email = ? AND otp = ? AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
            [email, otp]
        );

        if (resets.length === 0) {
            return res.status(400).json({ message: 'Mã xác nhận sai hoặc đã hết hạn!' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.execute('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, email]);
        
        // Xóa mã OTP đã dùng
        await db.execute('DELETE FROM password_resets WHERE email = ?', [email]);

        res.json({ message: 'Đổi mật khẩu thành công!' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Lỗi server.' });
    }
};