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

// 2. [ADMIN] Lấy tất cả báo cáo
exports.getAllReports = async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT r.*, u.username, u.full_name 
            FROM reports r 
            JOIN users u ON r.user_id = u.id 
            ORDER BY r.created_at DESC
        `);
        res.json(rows);
    } catch (error) {
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