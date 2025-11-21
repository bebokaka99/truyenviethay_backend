const db = require('../config/db');

// Lấy danh sách thông báo
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
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Đánh dấu đã đọc
exports.markAsRead = async (req, res) => {
    const userId = req.user.id;
    try {
        await db.execute('UPDATE notifications SET is_read = TRUE WHERE user_id = ?', [userId]);
        res.json({ message: 'Đã đọc hết' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Hàm nội bộ (QUAN TRỌNG)
exports.createNotificationInternal = async (userId, type, title, message, link = null) => {
    try {
        await db.execute(
            'INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)',
            [userId, type, title, message, link]
        );
    } catch (error) {
        console.error("Lỗi tạo thông báo:", error);
    }
};