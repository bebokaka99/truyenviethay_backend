const db = require('../config/db');

exports.submitRating = async (req, res) => {
    const userId = req.user.id;
    const { comic_slug, score } = req.body;

    // Validate
    if (!score || isNaN(score) || score < 0.5 || score > 5) {
        return res.status(400).json({ message: 'Điểm đánh giá không hợp lệ' });
    }

    try {
        // BƯỚC 1 & 2: Dùng câu lệnh "INSERT ... ON DUPLICATE KEY UPDATE"
        // Yêu cầu: Bảng 'ratings' phải có UNIQUE INDEX trên cặp (user_id, comic_slug)
        // Nếu bạn đã làm theo hướng dẫn tạo bảng trước đây thì đã có rồi.
        await db.execute(
            `INSERT INTO ratings (user_id, comic_slug, score, created_at) 
             VALUES (?, ?, ?, NOW()) 
             ON DUPLICATE KEY UPDATE score = VALUES(score), created_at = NOW()`,
            [userId, comic_slug, score]
        );

        // BƯỚC 3: Tính toán lại điểm trung bình để trả về Frontend
        // (Phần này giữ nguyên)
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
        // Kiểm tra lại lỗi, nếu vẫn là lỗi khác thì báo lỗi server
        res.status(500).json({ message: 'Lỗi server khi đánh giá' });
    }
};

// ... (Các hàm getComicRating và getTopRatings giữ nguyên không thay đổi)
// 2. LẤY THÔNG TIN ĐÁNH GIÁ (Của truyện & Của User)
exports.getComicRating = async (req, res) => {
    const { comic_slug } = req.params;
    const userId = req.query.userId; // userId lấy từ query param (có thể null)

    try {
        // 1. Lấy điểm trung bình thực tế của truyện
        const [avgRows] = await db.execute(
            'SELECT AVG(score) as avg_score, COUNT(*) as total_votes FROM ratings WHERE comic_slug = ?', 
            [comic_slug]
        );

        // 2. Lấy điểm user đã đánh giá (nếu đã đăng nhập)
        let userScore = 0;
        if (userId && userId !== 'undefined' && userId !== 'null') {
             const [userRows] = await db.execute(
                 'SELECT score FROM ratings WHERE user_id = ? AND comic_slug = ?', 
                 [userId, comic_slug]
             );
             if (userRows.length > 0) {
                 userScore = userRows[0].score;
             }
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
// 3. BẢNG XẾP HẠNG (Sử dụng Bayesian Average)
exports.getTopRatings = async (req, res) => {
    const { type } = req.query; // daily | weekly | monthly | all
    
    const m = 10; // (Minimum votes): Số vote tối thiểu để điểm số được tin cậy.
                  // Truyện ít hơn 5 vote sẽ bị kéo điểm về mức trung bình toàn sàn.

    let timeCondition = "";
    if (type === 'daily') {
        timeCondition = "AND DATE(created_at) = CURDATE()";
    } else if (type === 'weekly') {
        timeCondition = "AND YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)";
    } else if (type === 'monthly') {
        timeCondition = "AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())";
    }

    try {
        const [globalStats] = await db.execute("SELECT AVG(score) as global_avg FROM ratings");
        const C = parseFloat(globalStats[0].global_avg || 3.0); 

        // 2. Truy vấn và Tính toán Bayesian Rating (Weighted Rating)
        // Công thức: (v / (v+m)) * R + (m / (v+m)) * C
        const sql = `
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

        const [rows] = await db.execute(sql, [m, m, m, C]);
        
        // 3. Format dữ liệu trả về
        const formattedRows = rows.map(row => ({
            comic_slug: row.comic_slug,
            total_votes: row.total_votes,
            
            avg_score: parseFloat(row.weighted_score).toFixed(1), 
            
            // Trả thêm điểm gốc (raw) nếu bạn muốn hiển thị tooltip "Điểm thực: 5.0"
            raw_score: parseFloat(row.raw_avg).toFixed(1)
        }));

        res.json(formattedRows);

    } catch (error) {
        console.error("Lỗi getTopRatings:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};