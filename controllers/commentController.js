const db = require('../config/db');
const { createNotificationInternal } = require('./notificationController');
const { updateQuestProgress } = require('./userController');

// 1. Get Comments
exports.getComments = async (req, res) => {
    const { comic_slug } = req.params;
    const currentUserId = req.query.userId || 0;
    let chapterName = req.query.chapter_name;

    // Normalize chapterName
    if (['null', 'undefined', ''].includes(chapterName)) chapterName = null;

    try {
        const query = `
            SELECT c.*, u.full_name, u.avatar, u.role, u.rank_style, u.exp,
                   (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) as like_count,
                   (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = ?) as is_liked
            FROM comments c 
            JOIN users u ON c.user_id = u.id 
            WHERE c.comic_slug = ? AND c.chapter_name <=> ?
            ORDER BY c.created_at DESC
        `;
        const [rows] = await db.execute(query, [currentUserId, comic_slug, chapterName]);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi getComments:", error);
        res.status(500).json({ message: 'Lỗi lấy bình luận' });
    }
};

// 2. Add Comment
exports.addComment = async (req, res) => {
    const userId = req.user.id;
    const { comic_slug, content, parent_id, chapter_name } = req.body;
    const savedChapter = (chapter_name && chapter_name !== 'null') ? chapter_name : null;

    if (!content || !content.trim()) return res.status(400).json({ message: 'Nội dung trống' });

    try {
        // 1. Insert into DB
        const [result] = await db.execute(
            'INSERT INTO comments (user_id, comic_slug, content, parent_id, chapter_name) VALUES (?, ?, ?, ?, ?)',
            [userId, comic_slug, content, parent_id || null, savedChapter]
        );

        // 2. Update Quest (Async)
        updateQuestProgress(userId, 'comment', 1).catch(console.error);

        // 3. Get User Info for Response
        const [users] = await db.execute('SELECT full_name, avatar, role, rank_style, exp FROM users WHERE id = ?', [userId]);
        const currentUser = users[0];

        // 4. Handle Reply Notification
        if (parent_id) {
            const [parents] = await db.execute('SELECT user_id FROM comments WHERE id = ?', [parent_id]);
            if (parents.length > 0 && parents[0].user_id !== userId) {
                createNotificationInternal(
                    parents[0].user_id,
                    'reply',
                    `${currentUser.full_name} đã trả lời bạn`,
                    `Trong truyện: ${comic_slug}`,
                    `/truyen-tranh/${comic_slug}#comment-${result.insertId}`
                ).catch(console.error);
            }
        }

        // 5. Return New Comment Data
        res.status(201).json({
            id: result.insertId,
            user_id: userId,
            comic_slug,
            chapter_name: savedChapter,
            content,
            parent_id: parent_id || null,
            created_at: new Date(),
            full_name: currentUser.full_name,
            avatar: currentUser.avatar,
            role: currentUser.role,
            rank_style: currentUser.rank_style,
            exp: currentUser.exp,
            like_count: 0,
            is_liked: 0
        });

    } catch (error) {
        console.error("Lỗi addComment:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// 3. Like / Unlike Comment
exports.toggleLike = async (req, res) => {
    const userId = req.user.id;
    const { comment_id } = req.body;

    try {
        const [exists] = await db.execute('SELECT id FROM comment_likes WHERE user_id = ? AND comment_id = ?', [userId, comment_id]);

        if (exists.length > 0) {
            // Unlike
            await db.execute('DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?', [userId, comment_id]);
            res.json({ message: 'Unliked', status: false });
        } else {
            // Like
            await db.execute('INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)', [userId, comment_id]);
            res.json({ message: 'Liked', status: true });

            // Notify Like (Async)
            const [comments] = await db.execute('SELECT user_id, comic_slug, content FROM comments WHERE id = ?', [comment_id]);
            if (comments.length > 0 && comments[0].user_id !== userId) {
                const [likers] = await db.execute('SELECT full_name FROM users WHERE id = ?', [userId]);
                createNotificationInternal(
                    comments[0].user_id,
                    'like',
                    `${likers[0].full_name} thích bình luận`,
                    `"${comments[0].content.substring(0, 20)}..."`,
                    `/truyen-tranh/${comments[0].comic_slug}#comment-${comment_id}`
                ).catch(e => console.error("Lỗi notif like:", e));
            }
        }
    } catch (error) {
        console.error("Lỗi toggleLike:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// 4. Admin Actions

exports.getAllCommentsAdmin = async (req, res) => {
    try {
        const query = `
            SELECT c.*, u.username, u.avatar, u.full_name
            FROM comments c 
            JOIN users u ON c.user_id = u.id 
            ORDER BY c.created_at DESC 
            LIMIT 100
        `;
        const [rows] = await db.execute(query);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.deleteCommentAdmin = async (req, res) => {
    const { id } = req.params;
    try {
        await db.execute('DELETE FROM comments WHERE id = ?', [id]);
        res.json({ message: 'Đã xóa bình luận' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};