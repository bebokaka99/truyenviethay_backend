const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createNotificationInternal } = require('./notificationController');
// Import helper updateQuestProgress
const { updateQuestProgress } = require('./userController'); 

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
            // Đã login hôm nay -> Giữ nguyên streak cũ
            newStreak = user.login_streak;
        } else if (diff === 1) {
            // Login liên tiếp (hôm qua có login) -> Tăng 1
            newStreak = user.login_streak + 1;
        } else {
            // Mất chuỗi hoặc lần đầu -> Reset về 1
            newStreak = 1;
        }

        // 2. Cập nhật bảng Users (Chỉ update nếu là ngày mới)
        if (diff !== 0) {
            await db.execute("UPDATE users SET login_streak = ?, last_login_date = CURRENT_DATE() WHERE id = ?", [newStreak, userId]);
        }

        // 3. Cập nhật Nhiệm vụ (Quan trọng)
        
        // A. Daily Login: Luôn gọi, hàm helper sẽ tự check reset nếu cần
        await updateQuestProgress(userId, 'login', 1); 

        // B. Weekly Streak: Truyền giá trị streak thực tế vào
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

// --- ĐĂNG NHẬP (HỖ TRỢ EMAIL HOẶC USERNAME) ---
exports.login = async (req, res) => {
    // Frontend sẽ gửi lên 'identifier' thay vì 'email'
    // Nhưng để tương thích ngược, ta check cả 'email'
    const { identifier, email, password } = req.body;
    
    // Ưu tiên identifier (mới), nếu không có thì dùng email (cũ)
    const loginKey = identifier || email;

    try {
        // SỬA QUERY: Tìm theo email HOẶC username
        const [users] = await db.execute(
            'SELECT id, username, email, full_name, avatar, role, exp, rank_style, password, status, ban_expires_at FROM users WHERE email = ? OR username = ?', 
            [loginKey, loginKey]
        );
        
        if (users.length === 0) {
            return res.status(400).json({ message: 'Tài khoản không tồn tại!' });
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

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Mật khẩu không đúng!' });
        }
        
        // 4. Kích hoạt logic điểm danh & streak (Chỉ cho User)
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