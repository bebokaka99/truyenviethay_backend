const db = require('../config/db');

// 1. Gửi báo cáo (User gửi)
exports.createReport = async (req, res) => {
    const userId = req.user.id;
    const { comic_slug, chapter_name, reason } = req.body;

    try {
        await db.execute(
            'INSERT INTO reports (user_id, comic_slug, chapter_name, reason) VALUES (?, ?, ?, ?)',
            [userId, comic_slug, chapter_name, reason]
        );
        res.status(201).json({ message: 'Đã gửi báo cáo thành công!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// 2. [ADMIN] Lấy tất cả báo cáo (Sửa JOIN -> LEFT JOIN)
exports.getAllReports = async (req, res) => {
    try {
        // Dùng LEFT JOIN để vẫn hiện báo cáo ngay cả khi user bị xóa
        const [rows] = await db.execute(`
            SELECT r.*, 
                   COALESCE(u.username, 'User đã xóa') as username, 
                   COALESCE(u.full_name, 'N/A') as full_name
            FROM reports r 
            LEFT JOIN users u ON r.user_id = u.id 
            ORDER BY r.created_at DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi lấy báo cáo:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// 3. [ADMIN] Xóa báo cáo (Đã xử lý xong)
exports.deleteReport = async (req, res) => {
    const { id } = req.params;
    try {
        await db.execute('DELETE FROM reports WHERE id = ?', [id]);
        res.json({ message: 'Đã xóa báo cáo' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};