const db = require('../config/db');

// 1. SUBMIT RATING (ĐÁNH GIÁ TRUYỆN)
exports.submitRating = async (req, res) => {
    const userId = req.user.id;
    const { comic_slug, score } = req.body;

    // 1. Input Validation & Normalization
    // Parse float to handle both string ("4.5") and number (4.5) inputs
    const numericScore = parseFloat(score);

    if (isNaN(numericScore) || numericScore < 0.5 || numericScore > 5) {
        return res.status(400).json({ message: 'Điểm đánh giá không hợp lệ (0.5 - 5.0)' });
    }

    try {
        // 2. Insert or Update Rating
        await db.execute(
            `INSERT INTO ratings (user_id, comic_slug, score, created_at) 
             VALUES (?, ?, ?, NOW()) 
             ON DUPLICATE KEY UPDATE score = VALUES(score), created_at = NOW()`,
            [userId, comic_slug, numericScore]
        );

        // 3. Calculate New Average
        const [avgRows] = await db.execute(
            'SELECT AVG(score) as avg_score, COUNT(*) as total_votes FROM ratings WHERE comic_slug = ?', 
            [comic_slug]
        );

        const newAvg = parseFloat(avgRows[0].avg_score || 0).toFixed(1);
        const newTotal = avgRows[0].total_votes;

        res.json({ 
            message: 'Đánh giá thành công!', 
            average: newAvg,
            total: newTotal
        });

    } catch (error) {
        console.error("Lỗi submitRating:", error);
        res.status(500).json({ message: 'Lỗi server khi đánh giá' });
    }
};

// 2. GET RATING INFO (COMIC & USER)
exports.getComicRating = async (req, res) => {
    const { comic_slug } = req.params;
    const userId = req.query.userId;

    try {
        // 1. Get Comic Global Stats
        const [avgRows] = await db.execute(
            'SELECT AVG(score) as avg_score, COUNT(*) as total_votes FROM ratings WHERE comic_slug = ?', 
            [comic_slug]
        );

        // 2. Get User Specific Score (if logged in)
        let userScore = 0;
        if (userId && userId !== 'undefined' && userId !== 'null') {
             const [userRows] = await db.execute(
                 'SELECT score FROM ratings WHERE user_id = ? AND comic_slug = ?', 
                 [userId, comic_slug]
             );
             if (userRows.length > 0) userScore = userRows[0].score;
        }

        res.json({
            average: parseFloat(avgRows[0].avg_score || 0).toFixed(1),
            total: avgRows[0].total_votes,
            user_score: userScore
        });
    } catch (error) { 
        console.error("Lỗi getComicRating:", error);
        res.status(500).json({ message: 'Lỗi server' }); 
    }
};

// 3. GET RANKING (BAYESIAN AVERAGE)
exports.getTopRatings = async (req, res) => {
    const { type } = req.query; // daily | weekly | monthly | all
    const m = 10; // Min votes required to be ranked

    // Build Time Condition
    let timeCondition = "";
    if (type === 'daily') timeCondition = "AND DATE(created_at) = CURDATE()";
    else if (type === 'weekly') timeCondition = "AND YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)";
    else if (type === 'monthly') timeCondition = "AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())";

    try {
        // Get Global Average (C)
        const [globalStats] = await db.execute("SELECT AVG(score) as global_avg FROM ratings");
        const C = parseFloat(globalStats[0].global_avg || 3.0); 

        // Bayesian Rating Formula: 
        // weighted = ( (count / (count+m)) * avg ) + ( (m / (count+m)) * C )
        const query = `
            SELECT 
                comic_slug, 
                COUNT(*) as total_votes, 
                AVG(score) as raw_avg,
                ( (COUNT(*) / (COUNT(*) + ?)) * AVG(score) + (? / (COUNT(*) + ?)) * ? ) as weighted_score
            FROM ratings
            WHERE 1=1 ${timeCondition}
            GROUP BY comic_slug
            HAVING total_votes >= 1
            ORDER BY weighted_score DESC
            LIMIT 10
        `;

        const [rows] = await db.execute(query, [m, m, m, C]);
        
        const formattedRows = rows.map(row => ({
            comic_slug: row.comic_slug,
            total_votes: row.total_votes,
            avg_score: parseFloat(row.weighted_score).toFixed(1), 
            raw_score: parseFloat(row.raw_avg).toFixed(1)
        }));

        res.json(formattedRows);

    } catch (error) {
        console.error("Lỗi getTopRatings:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};