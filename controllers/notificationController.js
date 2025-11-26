const db = require('../config/db');

// 1. API HANDLERS (Cho Frontend gọi)

// Lấy danh sách thông báo (Limit 20 & đếm số chưa đọc)
exports.getNotifications = async (req, res) => {
    const userId = req.user.id;
    try {
        const [rows] = await db.execute(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', 
            [userId]
        );
        const [countRow] = await db.execute(
            'SELECT COUNT(*) as unread FROM notifications WHERE user_id = ? AND is_read = FALSE', 
            [userId]
        );
        res.json({ items: rows, unread: countRow[0].unread });
    } catch (error) {
        console.error("Lỗi getNotifications:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Đánh dấu tất cả là đã đọc
exports.markAsRead = async (req, res) => {
    try {
        await db.execute('UPDATE notifications SET is_read = TRUE WHERE user_id = ?', [req.user.id]);
        res.json({ message: 'Đã đọc hết' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// 2. INTERNAL HELPER (Gọi từ các Controller khác)

exports.createNotificationInternal = async (userId, type, title, message, link = null) => {
    try {
        await db.execute(
            'INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)',
            [userId, type, title, message, link]
        );
    } catch (error) {
        // Chỉ log lỗi server, không làm crash luồng chính của user
        console.error("INTERNAL ERROR - Create Notification:", error);
    }
};