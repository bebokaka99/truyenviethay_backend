const db = require('../config/db');
const { createNotificationInternal } = require('./notificationController');

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
// 1. [USER] Gửi báo cáo bình luận
exports.submitCommentReport = async (req, res) => {
    const reporterId = req.user.id;
    const { comment_id, reason } = req.body;

    if (!comment_id || !reason) {
        return res.status(400).json({ message: 'Vui lòng cung cấp ID bình luận và lý do báo cáo.' });
    }

    try {
        // Kiểm tra xem người này đã báo cáo comment này chưa để tránh spam
        const [existing] = await db.execute(
            'SELECT id FROM comment_reports WHERE reporter_id = ? AND comment_id = ?',
            [reporterId, comment_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({ message: 'Bạn đã báo cáo bình luận này rồi.' });
        }

        // Thêm báo cáo vào DB
        await db.execute(
            'INSERT INTO comment_reports (reporter_id, comment_id, reason, created_at) VALUES (?, ?, ?, NOW())',
            [reporterId, comment_id, reason]
        );

        res.status(201).json({ message: 'Đã gửi báo cáo. Cảm ơn bạn!' });
    } catch (error) {
        console.error("Lỗi submitCommentReport:", error);
        res.status(500).json({ message: 'Lỗi server khi gửi báo cáo.' });
    }
};

// 2. [ADMIN] Lấy danh sách tất cả báo cáo bình luận
exports.getAllCommentReportsForAdmin = async (req, res) => {
    try {
        // JOIN các bảng để lấy đầy đủ thông tin: người báo cáo, nội dung comment, người bị báo cáo
        const [rows] = await db.execute(`
            SELECT cr.*, 
                   u.username AS reporter_name, 
                   c.content AS comment_content, 
                   c.user_id AS reported_user_id,
                   ru.username AS reported_user_name
            FROM comment_reports cr
            JOIN users u ON cr.reporter_id = u.id
            JOIN comments c ON cr.comment_id = c.id
            LEFT JOIN users ru ON c.user_id = ru.id
            ORDER BY cr.created_at DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi getAllCommentReportsForAdmin:", error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách báo cáo.' });
    }
};

// 3. [ADMIN] Xử lý báo cáo (Xóa comment HOẶC Bỏ qua báo cáo)
exports.resolveCommentReport = async (req, res) => {
    const reportId = req.params.id;
    const { action } = req.body; // 'delete_comment' hoặc 'dismiss'

    if (!['delete_comment', 'dismiss'].includes(action)) {
        return res.status(400).json({ message: 'Hành động không hợp lệ.' });
    }

    try {
        // Nếu hành động là xóa comment
        if (action === 'delete_comment') {
             // a. Lấy thông tin comment và người đăng TRƯỚC KHI xóa
             const [commentRows] = await db.execute(
                `SELECT c.id, c.user_id, c.content, cr.reason 
                 FROM comment_reports cr
                 JOIN comments c ON cr.comment_id = c.id
                 WHERE cr.id = ?`, 
                [reportId]
            );

             if (commentRows.length === 0) {
                 // Trường hợp hiếm: comment đã bị xóa trước đó
                 await db.execute('DELETE FROM comment_reports WHERE id = ?', [reportId]);
                 return res.json({ message: 'Bình luận không còn tồn tại. Đã đóng báo cáo.' });
             }

             const commentData = commentRows[0];
             
             // b. Thực hiện xóa comment khỏi bảng comments
             await db.execute('DELETE FROM comments WHERE id = ?', [commentData.id]);

             // c. Gửi thông báo cho người bị xóa comment (nếu user đó còn tồn tại)
             if (commentData.user_id) {
                const shortContent = commentData.content.length > 50 ? commentData.content.substring(0, 50) + '...' : commentData.content;
                await createNotificationInternal(
                    commentData.user_id,
                    'system',
                    'Bình luận của bạn đã bị xóa',
                    `Bình luận: "${shortContent}" đã bị xóa do vi phạm. Lý do báo cáo: ${commentData.reason}.`,
                    null
                );
             }
        }

        // Dù hành động là gì thì cuối cùng cũng xóa báo cáo đó đi
        await db.execute('DELETE FROM comment_reports WHERE id = ?', [reportId]);

        res.json({ message: action === 'delete_comment' ? 'Đã xóa bình luận, gửi thông báo và đóng báo cáo.' : 'Đã bỏ qua báo cáo.' });
    } catch (error) {
        console.error("Lỗi resolveCommentReport:", error);
        res.status(500).json({ message: 'Lỗi server khi xử lý báo cáo.' });
    }
};