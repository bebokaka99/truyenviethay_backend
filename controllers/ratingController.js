const db = require('../config/db');

// 1. Gửi đánh giá
exports.submitRating = async (req, res) => {
    const userId = req.user.id;
    const { comic_slug, score } = req.body;

    if (score < 0.5 || score > 5) return res.status(400).json({ message: 'Điểm không hợp lệ' });

    try {
        // Lưu ý: created_at tự động cập nhật nhờ "ON UPDATE CURRENT_TIMESTAMP" trong definition bảng
        await db.execute(
            `INSERT INTO ratings (user_id, comic_slug, score) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE score = VALUES(score)`,
            [userId, comic_slug, score]
        );
        
        const [avgRows] = await db.execute('SELECT AVG(score) as avg_score, COUNT(*) as total_votes FROM ratings WHERE comic_slug = ?', [comic_slug]);

        res.json({ 
            message: 'Đánh giá thành công!', 
            average: parseFloat(avgRows[0].avg_score || 0).toFixed(1),
            total: avgRows[0].total_votes
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// 2. Lấy thông tin đánh giá
exports.getComicRating = async (req, res) => {
    const { comic_slug } = req.params;
    const userId = req.query.userId;
    try {
        const [avgRows] = await db.execute('SELECT AVG(score) as avg_score, COUNT(*) as total_votes FROM ratings WHERE comic_slug = ?', [comic_slug]);
        let userScore = 0;
        if (userId && userId !== 'undefined') {
             const [userRows] = await db.execute('SELECT score FROM ratings WHERE user_id = ? AND comic_slug = ?', [userId, comic_slug]);
             if (userRows.length > 0) userScore = userRows[0].score;
        }
        res.json({
            average: parseFloat(avgRows[0].avg_score || 0).toFixed(1),
            total: avgRows[0].total_votes,
            user_score: userScore
        });
    } catch (error) { res.status(500).json({ message: 'Lỗi server' }); }
};

// 3. Lấy Top Ranking (FIX LỖI TÊN CỘT NGÀY THÁNG)
exports.getTopRatings = async (req, res) => {
    const { type } = req.query; // daily | weekly | monthly | all
    
    let timeCondition = "";
    
    // SỬA TẠI ĐÂY: Dùng 'created_at' thay vì 'updated_at'
    if (type === 'daily') {
        timeCondition = "AND DATE(created_at) = CURDATE()";
    } else if (type === 'weekly') {
        timeCondition = "AND YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)";
    } else if (type === 'monthly') {
        timeCondition = "AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())";
    }

    try {
        const [rows] = await db.execute(`
            SELECT comic_slug, AVG(score) as avg_score, COUNT(*) as total_votes
            FROM ratings
            WHERE 1=1 ${timeCondition}
            GROUP BY comic_slug
            HAVING total_votes >= 1 
            ORDER BY avg_score DESC, total_votes DESC
            LIMIT 10
        `);
        
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};