const db = require('../config/db');

// 1. GỬI ĐÁNH GIÁ (BẢN VÁ LỖI CHO ANDROID)
exports.submitRating = async (req, res) => {
    const userId = req.user.id;
    // Lấy raw data từ body
    let { comic_slug, score } = req.body;

    // --- DEBUG LOG ---
    // Giúp xem chính xác Android gửi dữ liệu dạng gì lên server
    console.log(`[RATING SUBMIT - DEBUG] User: ${userId}, Slug: ${comic_slug}, Raw Score:`, score, `Type: ${typeof score}`);
    // -----------------

    // BƯỚC XỬ LÝ QUAN TRỌNG:
    // 1. Ép kiểu về số thực (float). Nó xử lý tốt cả đầu vào là số 4.5 hoặc chuỗi "4.5".
    let numericScore = parseFloat(score);

    // 2. Validate dựa trên giá trị số đã ép kiểu
    // Kiểm tra: Nếu kết quả không phải là số (NaN), HOẶC < 0.5, HOẶC > 5 thì báo lỗi
    if (isNaN(numericScore) || numericScore < 0.5 || numericScore > 5) {
        console.error(`[RATING ERROR] Invalid score. Raw: ${score}, Parsed: ${numericScore}`);
        return res.status(400).json({ message: 'Điểm đánh giá không hợp lệ' });
    }

    try {
        // BƯỚC 3: Lưu vào DB
        // Sử dụng câu lệnh tối ưu: Nếu chưa có thì INSERT, nếu có rồi thì UPDATE.
        // Yêu cầu: Bảng 'ratings' phải có UNIQUE INDEX (user_id, comic_slug).
        await db.execute(
            `INSERT INTO ratings (user_id, comic_slug, score, created_at) 
             VALUES (?, ?, ?, NOW()) 
             ON DUPLICATE KEY UPDATE score = VALUES(score), created_at = NOW()`,
            [userId, comic_slug, numericScore] // <-- Dùng giá trị đã chuẩn hóa
        );

        // BƯỚC 4: Tính toán lại điểm trung bình mới nhất để trả về Frontend
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

        // Công thức Bayesian Rating
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