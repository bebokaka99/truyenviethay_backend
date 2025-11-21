const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createNotificationInternal } = require('./notificationController');
// Import hàm updateQuestProgress từ userController để tái sử dụng
const { updateQuestProgress } = require('./userController'); 

// --- LOGIC ĐIỂM DANH & STREAK ---
const handleLoginStreaks = async (userId) => {
    try {
        // Lấy thông tin lần đăng nhập cuối cùng
        const [rows] = await db.execute("SELECT login_streak, last_login_date, DATEDIFF(CURRENT_DATE(), last_login_date) as diff FROM users WHERE id = ?", [userId]);
        const user = rows[0];
        
        let newStreak = 1;
        const diff = user.last_login_date ? user.diff : null; // null nếu chưa login bao giờ

        if (diff === 0) {
            // Đã login hôm nay -> Không làm gì, giữ nguyên streak
            newStreak = user.login_streak;
        } else if (diff === 1) {
            // Login liên tục (hôm qua có login) -> Tăng streak
            newStreak = user.login_streak + 1;
        } else {
            // Mất chuỗi hoặc lần đầu -> Reset về 1
            newStreak = 1;
        }

        // Cập nhật User (Streak mới & Ngày login mới)
        await db.execute("UPDATE users SET login_streak = ?, last_login_date = CURRENT_DATE() WHERE id = ?", [newStreak, userId]);

        // Cập nhật Nhiệm vụ
        // 1. Daily Login (Điểm danh ngày) - Chỉ update nếu là lần đầu trong ngày (diff !== 0)
        if (diff !== 0) { 
             await updateQuestProgress(userId, 'daily_login', 'daily');
        }

        // 2. Weekly Streak (Truyền số ngày streak vào để check)
        await updateQuestProgress(userId, 'weekly_streak', 'weekly', newStreak);

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

        // Trigger nhiệm vụ "Bước chân đầu tiên" (Nếu có)
        // await updateQuestProgress(result.insertId, 'first_register', 'one_time');

        res.status(201).json({ message: 'Đăng ký thành công! Hãy đăng nhập ngay.' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Lỗi server khi đăng ký.' });
    }
};

// --- ĐĂNG NHẬP ---
exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. Tìm user & lấy đầy đủ thông tin (bao gồm status ban)
        const [users] = await db.execute('SELECT id, username, email, full_name, avatar, role, exp, rank_style, password, status, ban_expires_at FROM users WHERE email = ?', [email]);
        
        if (users.length === 0) {
            return res.status(400).json({ message: 'Email không tồn tại!' });
        }

        const user = users[0];

        // 2. Kiểm tra BAN
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

        // 3. Kiểm tra mật khẩu
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Mật khẩu không đúng!' });
        }
        
        // 4. Kích hoạt logic điểm danh & streak
        if (user.role === 'user') {
            await handleLoginStreaks(user.id);
        }

        // 5. Tạo token
        const token = jwt.sign(
            { id: user.id, role: user.role }, 
            process.env.JWT_SECRET, 
            { expiresIn: '7d' }
        );

        // 6. Trả về user
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