const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); // <-- CẦN THÊM DÒNG NÀY ĐỂ ĐĂNG NHẬP HOẠT ĐỘNG
const db = require('../config/db');
const axios = require('axios'); // Thư viện để gọi API Otruyen
const { createNotificationInternal } = require('./notificationController');

// ============================================================
// AUTHENTICATION (ĐĂNG KÝ & ĐĂNG NHẬP) - CÁC HÀM BỊ THIẾU
// ============================================================

// Đăng ký người dùng mới
exports.registerUser = async (req, res) => {
    const { username, email, password, full_name } = req.body;

    // Validate đầu vào cơ bản
    if (!username || !email || !password || !full_name) {
        return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin.' });
    }

    try {
        // Kiểm tra xem username hoặc email đã tồn tại chưa
        const [existingUsers] = await db.execute(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({ message: 'Tên đăng nhập hoặc Email đã tồn tại.' });
        }

        // Mã hóa mật khẩu
        const hashedPassword = await bcrypt.hash(password, 10);

        // Thêm user mới vào DB
        // Role mặc định là 'user', status mặc định là 'active' (đã set trong DB schema)
        await db.execute(
            'INSERT INTO users (username, email, password, full_name, created_at) VALUES (?, ?, ?, ?, NOW())',
            [username, email, hashedPassword, full_name]
        );

        res.status(201).json({ message: 'Đăng ký thành công! Vui lòng đăng nhập.' });

    } catch (error) {
        console.error("Lỗi registerUser:", error);
        res.status(500).json({ message: 'Lỗi server khi đăng ký.' });
    }
};

// Đăng nhập
exports.loginUser = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Vui lòng nhập tên đăng nhập và mật khẩu.' });
    }

    try {
        // Tìm user trong DB
        const [users] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
        const user = users[0];

        if (!user) {
            return res.status(401).json({ message: 'Sai tên đăng nhập hoặc mật khẩu.' });
        }

        // Kiểm tra mật khẩu
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Sai tên đăng nhập hoặc mật khẩu.' });
        }

        // Kiểm tra xem user có bị ban không
        if (user.status === 'banned') {
            // Kiểm tra xem hạn ban còn không
            if (user.ban_expires_at && new Date(user.ban_expires_at) > new Date()) {
                return res.status(403).json({
                    message: `Tài khoản bị khóa đến ${new Date(user.ban_expires_at).toLocaleString('vi-VN')}. Lý do: Vi phạm quy định.`
                });
            } else {
                // Nếu hết hạn ban, tự động mở khóa (tùy chọn, ở đây mình cập nhật lại trạng thái)
                await db.execute("UPDATE users SET status = 'active', ban_expires_at = NULL WHERE id = ?", [user.id]);
                user.status = 'active'; // Cập nhật object user hiện tại
            }
        }

        // Tạo JWT Token
        // CHÚ Ý: Thay 'YOUR_JWT_SECRET_KEY' bằng secret key thật của bạn trong file .env nếu có
        const tokenSecret = process.env.JWT_SECRET || 'YOUR_FALLBACK_SECRET_KEY';
        const token = jwt.sign(
            { id: user.id, role: user.role, username: user.username },
            tokenSecret,
            { expiresIn: '7d' } // Token hết hạn sau 7 ngày
        );

        // Cập nhật nhiệm vụ đăng nhập hàng ngày
        updateQuestProgress(user.id, 'login', 1).catch(err => console.error("Login Quest Error:", err));
        // Cập nhật streak
        updateQuestProgress(user.id, 'login', 1, 'weekly_streak').catch(err => console.error("Streak Quest Error:", err));


        // Trả về token và thông tin user (không bao gồm password)
        res.json({
            message: 'Đăng nhập thành công!',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                full_name: user.full_name,
                avatar: user.avatar,
                role: user.role,
                exp: user.exp,
                rank_style: user.rank_style
            }
        });

    } catch (error) {
        console.error("Lỗi loginUser:", error);
        res.status(500).json({ message: 'Lỗi server khi đăng nhập.' });
    }
};

// ============================================================
// HELPER: CẬP NHẬT TIẾN ĐỘ NHIỆM VỤ (Dùng chung)
// ============================================================
// Lưu ý: Đã thêm tham số questKeyOptional để hỗ trợ 'weekly_streak'
const updateQuestProgress = async (userId, actionType, val = 1, questKeyOptional = null) => {
    try {
        let query = "SELECT * FROM quests WHERE action_type = ?";
        let params = [actionType];

        if (questKeyOptional) {
            query += " AND quest_key = ?";
            params.push(questKeyOptional);
        }

        const [quests] = await db.execute(query, params);
        if (quests.length === 0) return;

        for (const quest of quests) {
            const [existing] = await db.execute(
                `SELECT id, current_count, is_claimed, last_updated,
                        DATEDIFF(CURRENT_DATE(), last_updated) as days_diff,
                        YEARWEEK(CURRENT_DATE(), 1) - YEARWEEK(last_updated, 1) as weeks_diff
                 FROM user_quests WHERE user_id = ? AND quest_id = ?`,
                [userId, quest.id]
            );

            let newCount = 0;
            let newClaimed = 0;
            let needUpdate = false;
            let isFirstComplete = false;

            if (existing.length === 0) {
                newCount = val;
                if (newCount >= quest.target_count) isFirstComplete = true;

                await db.execute(
                    "INSERT INTO user_quests (user_id, quest_id, current_count, is_claimed, last_updated) VALUES (?, ?, ?, 0, NOW())",
                    [userId, quest.id, newCount]
                );
            } else {
                const record = existing[0];
                let isReset = false;

                if (quest.type === 'daily' && record.days_diff !== 0) isReset = true;
                else if (quest.type === 'weekly' && record.weeks_diff !== 0) isReset = true;

                if (isReset) {
                    if (quest.quest_key === 'weekly_streak') {
                        // Nếu là streak, reset về 1 nếu bị ngắt quãng, ngược lại giữ nguyên để cộng tiếp ở dưới
                        if (record.days_diff > 1) newCount = 1; else newCount = record.current_count;
                    } else {
                        newCount = (quest.action_type === 'login') ? 1 : val;
                    }
                    newClaimed = 0;
                    needUpdate = true;

                } else {
                    newClaimed = record.is_claimed;
                    newCount = record.current_count;
                }

                // Logic cộng dồn (áp dụng cho cả khi vừa reset hoặc không reset)
                if (quest.quest_key === 'weekly_streak') {
                    // Logic cho streak: chỉ cộng nếu là ngày mới liền kề
                    if (record.days_diff === 1) {
                        newCount = record.current_count + 1;
                        needUpdate = true;
                    }
                } else if (quest.action_type === 'login') {
                    // Login thường: không cộng dồn trong ngày
                }
                else {
                    // Các nhiệm vụ khác (đọc, comment): cộng dồn bình thường
                    if (record.current_count < quest.target_count || quest.type === 'achievement') {
                        newCount = record.current_count + val;
                        needUpdate = true;
                    }
                }

                // Kiểm tra hoàn thành sau khi tính toán newCount
                if (newCount >= quest.target_count && record.current_count < quest.target_count && newClaimed === 0) {
                    isFirstComplete = true;
                    needUpdate = true; // Đảm bảo cập nhật nếu hoàn thành
                }


                if (needUpdate) {
                    await db.execute(
                        "UPDATE user_quests SET current_count = ?, is_claimed = ?, last_updated = NOW() WHERE id = ?",
                        [newCount, newClaimed, record.id]
                    );
                }
            }

            if (isFirstComplete) {
                await createNotificationInternal(
                    userId, 'quest', 'Nhiệm vụ hoàn thành!',
                    `Bạn đã hoàn thành: ${quest.name}. Hãy vào trang hồ sơ nhận thưởng!`, '/profile?tab=tasks'
                );
            }
        }
    } catch (error) {
        console.error(`Lỗi updateQuestProgress (${actionType}):`, error);
    }
};

exports.updateQuestProgress = updateQuestProgress;


// ============================================================
// LIBRARY (TỦ TRUYỆN)
// ============================================================

exports.addToLibrary = async (req, res) => {
    const userId = req.user.id;
    const { comic_slug, comic_name, comic_image, latest_chapter } = req.body;

    try {
        await db.execute(
            `INSERT INTO library (user_id, comic_slug, comic_name, comic_image, latest_chapter, created_at) 
             VALUES (?, ?, ?, ?, ?, NOW()) 
             ON DUPLICATE KEY UPDATE 
                latest_chapter = VALUES(latest_chapter), 
                comic_image = VALUES(comic_image),
                created_at = NOW()`,
            [userId, comic_slug, comic_name, comic_image, latest_chapter]
        );
        res.status(200).json({ message: 'Đã lưu vào tủ truyện!' });
    } catch (error) {
        console.error("Lỗi addToLibrary:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.removeFromLibrary = async (req, res) => {
    const userId = req.user.id;
    const { comic_slug } = req.params;
    try {
        await db.execute('DELETE FROM library WHERE user_id = ? AND comic_slug = ?', [userId, comic_slug]);
        res.status(200).json({ message: 'Đã bỏ theo dõi!' });
    } catch (error) { res.status(500).json({ message: 'Lỗi server' }); }
};

exports.getLibrary = async (req, res) => {
    const userId = req.user.id;
    try {
        const [libraryComics] = await db.execute('SELECT * FROM library WHERE user_id = ? ORDER BY created_at DESC', [userId]);

        if (libraryComics.length === 0) {
            return res.json([]);
        }

        const enrichedLibrary = await Promise.all(libraryComics.map(async (comic) => {
            try {
                const apiRes = await axios.get(`https://otruyenapi.com/v1/api/truyen-tranh/${comic.comic_slug}`);
                const apiData = apiRes.data.data.item;

                let latestChap = 'Đang cập nhật';
                if (apiData.chapters && apiData.chapters.length > 0) {
                    const serverData = apiData.chapters[0].server_data;
                    if (serverData && serverData.length > 0) {
                        latestChap = serverData[serverData.length - 1].chapter_name;
                    }
                }

                return {
                    ...comic,
                    latest_chapter: latestChap,
                    updated_at: apiData.updatedAt,
                    comic_name: apiData.name,
                    comic_image: `https://img.otruyenapi.com/uploads/comics/${apiData.thumb_url}`
                };
            } catch (err) {
                // console.error(`Lỗi fetch Otruyen ${comic.comic_slug}:`, err.message);
                return {
                    ...comic,
                    updated_at: comic.created_at
                };
            }
        }));

        enrichedLibrary.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

        res.json(enrichedLibrary);
    } catch (error) {
        console.error("Lỗi getLibrary:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.checkFollowStatus = async (req, res) => {
    const userId = req.user.id;
    const { comic_slug } = req.params;
    try {
        const [rows] = await db.execute('SELECT id FROM library WHERE user_id = ? AND comic_slug = ?', [userId, comic_slug]);
        res.json({ isFollowed: rows.length > 0 });
    } catch (error) { res.status(500).json({ message: 'Lỗi server' }); }
};


// ============================================================
// HISTORY (LỊCH SỬ & NHIỆM VỤ ĐỌC)
// ============================================================

exports.saveHistory = async (req, res) => {
    const userId = req.user.id;
    const { comic_slug, comic_name, comic_image, chapter_name } = req.body;

    try {
        await db.execute(
            `INSERT INTO reading_history (user_id, comic_slug, comic_name, comic_image, chapter_name, read_at) 
             VALUES (?, ?, ?, ?, ?, NOW()) 
             ON DUPLICATE KEY UPDATE 
                chapter_name = VALUES(chapter_name), 
                comic_image = VALUES(comic_image),
                read_at = NOW()`,
            [userId, comic_slug, comic_name, comic_image, chapter_name]
        );

        updateQuestProgress(userId, 'read', 1).catch(err => console.error("Quest Update Error:", err));

        res.status(200).json({ message: 'Đã lưu lịch sử' });
    } catch (error) {
        console.error("Lỗi saveHistory:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getHistory = async (req, res) => {
    const userId = req.user.id;
    try {
        const [rows] = await db.execute('SELECT * FROM reading_history WHERE user_id = ? ORDER BY read_at DESC LIMIT 50', [userId]);
        res.json(rows);
    } catch (error) { res.status(500).json({ message: 'Lỗi server' }); }
};

exports.checkReadingHistory = async (req, res) => {
    const userId = req.user.id;
    const { comic_slug } = req.params;
    try {
        const [rows] = await db.execute('SELECT chapter_name FROM reading_history WHERE user_id = ? AND comic_slug = ? ORDER BY read_at DESC LIMIT 1', [userId, comic_slug]);
        if (rows.length > 0) res.json({ chapter_name: rows[0].chapter_name });
        else res.json({ chapter_name: null });
    } catch (error) { res.status(500).json({ message: 'Lỗi server' }); }
};


// ============================================================
// PROFILE (THÔNG TIN CÁ NHÂN)
// ============================================================

exports.getProfile = async (req, res) => {
    try {
        const [users] = await db.execute('SELECT id, username, email, full_name, avatar, role, exp, rank_style, created_at FROM users WHERE id = ?', [req.user.id]);
        if (users.length === 0) return res.status(404).json({ message: 'User không tồn tại' });
        res.json(users[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.updateProfile = async (req, res) => {
    const userId = req.user.id;
    const { full_name, rank_style } = req.body;
    try {
        // Khi dùng Cloudinary Storage, req.file.path CHÍNH LÀ URL của ảnh trên Cloud
        let avatarPath = req.file ? req.file.path : null;

        let sql = 'UPDATE users SET full_name = ?, rank_style = ?';
        let params = [full_name, rank_style];

        if (avatarPath) {
            sql += ', avatar = ?';
            params.push(avatarPath);
        }

        sql += ' WHERE id = ?';
        params.push(userId);

        await db.execute(sql, params);

        const [users] = await db.execute('SELECT id, username, email, full_name, avatar, role, exp, rank_style FROM users WHERE id = ?', [userId]);
        res.json({ message: 'Cập nhật thành công!', user: users[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.changePassword = async (req, res) => {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;
    try {
        const [users] = await db.execute('SELECT password FROM users WHERE id = ?', [userId]);
        const user = users[0];
        if (!await bcrypt.compare(currentPassword, user.password)) return res.status(400).json({ message: 'Sai mật khẩu hiện tại' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
        res.json({ message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' });
    } catch (error) { res.status(500).json({ message: 'Lỗi server' }); }
};


// ============================================================
// ADMIN ACTIONS
// ============================================================

exports.deleteUser = async (req, res) => {
    try { await db.execute('DELETE FROM users WHERE id = ?', [req.params.id]); res.json({ message: 'Đã xóa user' }); } catch (e) { res.status(500).json({ message: 'Lỗi xóa user' }); }
};

// [ADMIN] Cảnh báo user kèm thông báo
exports.warnUser = async (req, res) => {
    const userId = req.params.id;
    // Nhận lý do từ body request
    const { reason } = req.body;

    if (!reason) {
        return res.status(400).json({ message: 'Vui lòng cung cấp lý do cảnh báo.' });
    }

    try {
        // 1. Tăng số lần cảnh báo trong DB
        await db.execute('UPDATE users SET warnings = warnings + 1 WHERE id = ?', [userId]);

        // 2. Gửi thông báo hệ thống cho người dùng
        // (Đảm bảo bạn đã import createNotificationInternal ở đầu file này)
        await createNotificationInternal(
            userId,
            'system',
            'Bạn đã nhận 1 cảnh báo vi phạm',
            `Lý do: ${reason}. Vui lòng tuân thủ quy định cộng đồng. Nhiều cảnh báo có thể dẫn đến khóa tài khoản.`,
            null // Không có link cụ thể
        );

        res.json({ message: 'Đã gửi cảnh báo và thông báo cho người dùng.' });
    } catch (e) {
        console.error("Lỗi warnUser:", e);
        res.status(500).json({ message: 'Lỗi khi gửi cảnh báo.' });
    }
};

exports.banUser = async (req, res) => {
    const { id } = req.params; const { days } = req.body;
    let d = null, s = 'banned';
    if (days != -1 && days != '-1') {
        d = new Date();
        d.setDate(d.getDate() + parseInt(days));
        d = d.toISOString().slice(0, 19).replace('T', ' ');
    }
    try { await db.execute('UPDATE users SET status = ?, ban_expires_at = ? WHERE id = ?', [s, d, id]); res.json({ message: 'Đã chặn người dùng' }); } catch (e) { res.status(500).json({ message: 'Lỗi chặn user' }); }
};

exports.unbanUser = async (req, res) => {
    try { await db.execute("UPDATE users SET status = 'active', ban_expires_at = NULL WHERE id = ?", [req.params.id]); res.json({ message: 'Đã mở khóa người dùng' }); } catch (e) { res.status(500).json({ message: 'Lỗi mở khóa user' }); }
};

// [ADMIN] Thay đổi Role User (User <-> Admin)
exports.changeUserRole = async (req, res) => {
    const userIdToChange = req.params.id;
    const { newRole } = req.body;
    const adminId = req.user.id;

    if (!['user', 'admin'].includes(newRole)) {
        return res.status(400).json({ message: 'Role không hợp lệ.' });
    }

    if (parseInt(userIdToChange) === adminId) {
        return res.status(403).json({ message: 'Bạn không thể tự thay đổi quyền của chính mình.' });
    }

    try {
        await db.execute('UPDATE users SET role = ? WHERE id = ?', [newRole, userIdToChange]);
        res.json({ message: `Thành công! Đã thay đổi quyền user thành ${newRole.toUpperCase()}.` });
    } catch (error) {
        console.error("Lỗi changeUserRole:", error);
        res.status(500).json({ message: 'Lỗi server khi thay đổi quyền.' });
    }
};

exports.getManagedComics = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM comic_settings ORDER BY updated_at DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.updateComicSetting = async (req, res) => {
    const { slug, name, is_hidden, is_recommended } = req.body;
    try {
        await db.execute(`
            INSERT INTO comic_settings (slug, name, is_hidden, is_recommended) 
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                name = VALUES(name),
                is_hidden = VALUES(is_hidden),
                is_recommended = VALUES(is_recommended)
        `, [slug, name, is_hidden, is_recommended]);

        res.json({ message: 'Cập nhật trạng thái truyện thành công!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getPublicComicSettings = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT slug, is_hidden, is_recommended FROM comic_settings');
        const settingsMap = {};
        rows.forEach(row => {
            settingsMap[row.slug] = {
                is_hot: row.is_recommended === 1,
                is_hidden: row.is_hidden === 1
            };
        });
        res.json(settingsMap);
    } catch (error) {
        console.error(error);
        res.status(500).json({});
    }
};

// [ADMIN] Lấy danh sách tất cả người dùng (CÓ PHÂN TRANG) - FIX LỖI LIMIT
exports.getAllUsers = async (req, res) => {
    try {
        let page = parseInt(req.query.page);
        let limit = parseInt(req.query.limit);

        if (isNaN(page) || page < 1) page = 1;
        if (isNaN(limit) || limit < 1 || limit > 100) limit = 10;

        const offset = (page - 1) * limit;

        const [countResult] = await db.execute('SELECT COUNT(*) as total FROM users');
        const totalUsers = countResult[0].total;
        const totalPages = Math.ceil(totalUsers / limit);

        // Dùng template literal cho LIMIT/OFFSET để tránh lỗi của mysql2 driver
        const query = `
            SELECT id, username, email, full_name, avatar, role, status, warnings, ban_expires_at, created_at 
            FROM users 
            ORDER BY created_at DESC 
            LIMIT ${limit} OFFSET ${offset}
        `;

        const [rows] = await db.execute(query);

        res.json({
            data: rows,
            pagination: {
                currentPage: page,
                limit: limit,
                totalUsers: totalUsers,
                totalPages: totalPages
            }
        });

    } catch (e) {
        console.error("LỖI CRITICAL tại getAllUsers (Admin):", e);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách user.' });
    }
};