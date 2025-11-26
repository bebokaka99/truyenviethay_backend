const db = require('../config/db');
const { createNotificationInternal } = require('./notificationController');

// 1. Story Reports (Báo cáo truyện)
// [USER] Create Report
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
        console.error("Lỗi createReport:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// [ADMIN] Get All Reports
exports.getAllReports = async (req, res) => {
    try {
        const query = `
            SELECT r.*, 
                   COALESCE(u.username, 'User đã xóa') as username, 
                   COALESCE(u.full_name, 'N/A') as full_name
            FROM reports r 
            LEFT JOIN users u ON r.user_id = u.id 
            ORDER BY r.created_at DESC
        `;
        const [rows] = await db.execute(query);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi getAllReports:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// [ADMIN] Delete Report (Resolved)
exports.deleteReport = async (req, res) => {
    try {
        await db.execute('DELETE FROM reports WHERE id = ?', [req.params.id]);
        res.json({ message: 'Đã xóa báo cáo' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// 2. Comment Reports (Báo cáo bình luận)

// [USER] Submit Comment Report
exports.submitCommentReport = async (req, res) => {
    const reporterId = req.user.id;
    const { comment_id, reason } = req.body;

    if (!comment_id || !reason) {
        return res.status(400).json({ message: 'Vui lòng cung cấp ID bình luận và lý do.' });
    }

    try {
        const [existing] = await db.execute(
            'SELECT id FROM comment_reports WHERE reporter_id = ? AND comment_id = ?',
            [reporterId, comment_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({ message: 'Bạn đã báo cáo bình luận này rồi.' });
        }

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

// [ADMIN] Get All Comment Reports
exports.getAllCommentReportsForAdmin = async (req, res) => {
    try {
        const query = `
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
        `;
        const [rows] = await db.execute(query);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi getAllCommentReportsForAdmin:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// [ADMIN] Resolve Comment Report (Delete Comment OR Dismiss Report)
exports.resolveCommentReport = async (req, res) => {
    const reportId = req.params.id;
    const { action } = req.body; // 'delete_comment' | 'dismiss'

    if (!['delete_comment', 'dismiss'].includes(action)) {
        return res.status(400).json({ message: 'Hành động không hợp lệ.' });
    }

    try {
        if (action === 'delete_comment') {
            // 1. Get info before delete
            const [commentRows] = await db.execute(
                `SELECT c.id, c.user_id, c.content, cr.reason 
                 FROM comment_reports cr
                 JOIN comments c ON cr.comment_id = c.id
                 WHERE cr.id = ?`, 
                [reportId]
            );

            if (commentRows.length === 0) {
                await db.execute('DELETE FROM comment_reports WHERE id = ?', [reportId]);
                return res.json({ message: 'Bình luận không tồn tại. Đã đóng báo cáo.' });
            }

            const commentData = commentRows[0];
            
            // 2. Delete Comment
            await db.execute('DELETE FROM comments WHERE id = ?', [commentData.id]);

            // 3. Notify User
            if (commentData.user_id) {
                const shortContent = commentData.content.length > 50 ? commentData.content.substring(0, 50) + '...' : commentData.content;
                await createNotificationInternal(
                    commentData.user_id, 'system', 
                    'Bình luận của bạn đã bị xóa',
                    `Bình luận: "${shortContent}" đã bị xóa do vi phạm. Lý do: ${commentData.reason}.`, null
                );
            }
        }

        // Finally delete the report
        await db.execute('DELETE FROM comment_reports WHERE id = ?', [reportId]);

        res.json({ message: action === 'delete_comment' ? 'Đã xóa bình luận và gửi thông báo.' : 'Đã bỏ qua báo cáo.' });
    } catch (error) {
        console.error("Lỗi resolveCommentReport:", error);
        res.status(500).json({ message: 'Lỗi server khi xử lý báo cáo.' });
    }
};