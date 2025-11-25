const bcrypt = require('bcryptjs');
const db = require('../config/db');
const axios = require('axios'); // Thư viện để gọi API Otruyen
const { createNotificationInternal } = require('./notificationController');

// ============================================================
// HELPER: CẬP NHẬT TIẾN ĐỘ NHIỆM VỤ (Dùng chung)
// ============================================================
const updateQuestProgress = async (userId, actionType, val = 1) => {
    try {
        const [quests] = await db.execute("SELECT * FROM quests WHERE action_type = ?", [actionType]);
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
                        newCount = val;
                    } else {
                        newCount = (quest.action_type === 'login') ? 1 : val;
                    }
                    newClaimed = 0;
                    needUpdate = true;
                    if (newCount >= quest.target_count) isFirstComplete = true;
                } else {
                    newClaimed = record.is_claimed;

                    if (quest.action_type === 'login') {
                        newCount = record.current_count;
                        if (quest.quest_key === 'weekly_streak') {
                            if (newCount !== val) {
                                newCount = val;
                                needUpdate = true;
                            }
                        } else {
                            if (record.days_diff !== 0) {
                                newCount = record.current_count + 1;
                                needUpdate = true;
                            }
                        }
                    } else {
                        if (record.current_count < quest.target_count || quest.type === 'achievement') {
                            newCount = record.current_count + val;
                            needUpdate = true;
                            if (newCount >= quest.target_count && record.current_count < quest.target_count && newClaimed === 0) {
                                isFirstComplete = true;
                            }
                        } else {
                            newCount = record.current_count;
                        }
                    }
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
        if (!await bcrypt.compare(currentPassword, user.password)) return res.status(400).json({ message: 'Sai mật khẩu' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
        res.json({ message: 'Đổi mật khẩu thành công' });
    } catch (error) { res.status(500).json({ message: 'Lỗi server' }); }
};


// ============================================================
// ADMIN ACTIONS
// ============================================================

exports.deleteUser = async (req, res) => {
    try { await db.execute('DELETE FROM users WHERE id = ?', [req.params.id]); res.json({ message: 'Đã xóa' }); } catch (e) { res.status(500).json({ message: 'Lỗi' }); }
};

exports.warnUser = async (req, res) => {
    try { await db.execute('UPDATE users SET warnings = warnings + 1 WHERE id = ?', [req.params.id]); res.json({ message: 'Đã cảnh báo' }); } catch (e) { res.status(500).json({ message: 'Lỗi' }); }
};

exports.banUser = async (req, res) => {
    const { id } = req.params; const { days } = req.body;
    let d = null, s = 'banned';
    if (days != -1 && days != '-1') {
        d = new Date();
        d.setDate(d.getDate() + parseInt(days));
        d = d.toISOString().slice(0, 19).replace('T', ' ');
    }
    try { await db.execute('UPDATE users SET status = ?, ban_expires_at = ? WHERE id = ?', [s, d, id]); res.json({ message: 'Đã chặn' }); } catch (e) { res.status(500).json({ message: 'Lỗi' }); }
};

exports.unbanUser = async (req, res) => {
    try { await db.execute("UPDATE users SET status = 'active', ban_expires_at = NULL WHERE id = ?", [req.params.id]); res.json({ message: 'Đã mở khóa' }); } catch (e) { res.status(500).json({ message: 'Lỗi' }); }
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

// [ADMIN] Lấy danh sách tất cả người dùng (CÓ PHÂN TRANG)
// Hàm này ĐƯỢC ĐẶT Ở CUỐI CÙNG và CHỈ XUẤT HIỆN 1 LẦN
exports.getAllUsers = async (req, res) => {
    try {
        console.log("Đang xử lý getAllUsers với query:", req.query); // Log để debug trên Render

        // 1. Xử lý tham số phân trang MỘT CÁCH CHẮC CHẮN NHẤT
        // Lấy giá trị raw
        let rawPage = req.query.page;
        let rawLimit = req.query.limit;

        // Ép kiểu sang số nguyên
        let page = parseInt(rawPage);
        let limit = parseInt(rawLimit);

        // Validate: Nếu không phải số hợp lệ (NaN) hoặc nhỏ hơn 1 thì dùng giá trị mặc định
        if (isNaN(page) || page < 1) page = 1;
        if (isNaN(limit) || limit < 1 || limit > 100) limit = 10; // Giới hạn max limit để an toàn
        
        // Tính toán offset, đảm bảo nó là một số dương
        const offset = (page - 1) * limit;

        console.log(`Parsed -> Page: ${page}, Limit: ${limit}, Offset: ${offset} (Types: ${typeof page}, ${typeof limit}, ${typeof offset})`);

        // 2. Đếm tổng số lượng user
        const [countResult] = await db.execute('SELECT COUNT(*) as total FROM users');
        const totalUsers = countResult[0].total;
        const totalPages = Math.ceil(totalUsers / limit);

        // 3. Truy vấn dữ liệu với LIMIT và OFFSET
        // QUAN TRỌNG NHẤT: Ép kiểu Number() một lần nữa NGAY TRONG mảng tham số
        // Điều này bắt buộc driver MySQL phải hiểu đây là số.
        const [rows] = await db.execute(
            `SELECT id, username, email, full_name, role, status, warnings, ban_expires_at, created_at 
             FROM users 
             ORDER BY created_at DESC 
             LIMIT ? OFFSET ?`,
            [Number(limit), Number(offset)] // <--- ĐÂY LÀ CHÌA KHÓA KHẮC PHỤC LỖI
        );

        // 4. Trả về kết quả
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
        // Log lỗi chi tiết ra server logs trên Render để biết chính xác lỗi SQL là gì
        console.error("LỖI CRITICAL tại getAllUsers (Admin):");
        console.error("- Message:", e.message);
        // Nếu có lỗi SQL cụ thể, log nó ra
        if (e.sqlMessage) console.error("- SQL Message:", e.sqlMessage);
        if (e.sql) console.error("- SQL Query bị lỗi:", e.sql);
        
        // Trả về thông báo lỗi chung chung cho frontend
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách user. Vui lòng kiểm tra log server.' });
    }
};