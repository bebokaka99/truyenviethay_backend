const bcrypt = require('bcryptjs');
const db = require('../config/db');
const axios = require('axios'); 
const { createNotificationInternal } = require('./notificationController');

// ============================================================
// HELPER: CẬP NHẬT TIẾN ĐỘ NHIỆM VỤ (Dùng chung - Logic Đã Fix)
// ============================================================
const updateQuestProgress = async (userId, actionType, val = 1) => {
    try {
        // Tìm tất cả nhiệm vụ khớp với hành động
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
                // --- CHƯA LÀM BAO GIỜ -> TẠO MỚI ---
                newCount = val; 
                if (newCount >= quest.target_count) isFirstComplete = true;
                
                await db.execute(
                    "INSERT INTO user_quests (user_id, quest_id, current_count, is_claimed, last_updated) VALUES (?, ?, ?, 0, NOW())",
                    [userId, quest.id, newCount]
                );
            } else {
                // --- ĐÃ CÓ DỮ LIỆU -> CẬP NHẬT ---
                const record = existing[0];
                
                // 1. Xử lý Reset theo chu kỳ
                let isReset = false;
                if (quest.type === 'daily' && record.days_diff !== 0) isReset = true;
                if (quest.type === 'weekly' && record.weeks_diff !== 0) isReset = true;

                if (isReset) {
                    // Reset: Bắt đầu chu kỳ mới
                    if (quest.quest_key === 'weekly_streak') {
                         newCount = val; // Streak giữ nguyên giá trị thực tế truyền vào
                    } else {
                         newCount = (quest.action_type === 'login') ? 1 : val; 
                    }
                    newClaimed = 0; 
                    needUpdate = true;
                } else {
                    // Cùng chu kỳ: Cộng dồn hoặc Giữ nguyên
                    newClaimed = record.is_claimed;
                    
                    if (quest.action_type === 'login') {
                        // LOGIN: Idempotent trong ngày
                        newCount = record.current_count; 
                        if (quest.quest_key === 'weekly_streak') {
                            if (newCount !== val) {
                                newCount = val;
                                needUpdate = true;
                            }
                        }
                    } else {
                        // READ/COMMENT: Cộng dồn
                        if (record.current_count < quest.target_count || quest.type === 'achievement') {
                            newCount = record.current_count + val;
                            needUpdate = true;
                        } else {
                            newCount = record.current_count;
                        }
                    }
                }

                // Kiểm tra hoàn thành
                if (newCount >= quest.target_count && newClaimed === 0) {
                    if (isReset || record.current_count < quest.target_count) {
                        isFirstComplete = true;
                    }
                }

                if (needUpdate) {
                    await db.execute(
                        "UPDATE user_quests SET current_count = ?, is_claimed = ?, last_updated = NOW() WHERE id = ?",
                        [newCount, newClaimed, record.id]
                    );
                }
            }

            // Gửi thông báo
            if (isFirstComplete) {
                 await createNotificationInternal(
                    userId, 'quest', 'Nhiệm vụ hoàn thành!', 
                    `Bạn đã hoàn thành: ${quest.name}. Nhận thưởng ngay!`, '/profile?tab=tasks'
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
                console.error(`Lỗi fetch Otruyen ${comic.comic_slug}:`, err.message);
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

        // Cập nhật Nhiệm vụ Đọc
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
        let avatarPath = req.file ? req.file.path.replace(/\\/g, "/") : null;
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
        if(!await bcrypt.compare(currentPassword, user.password)) return res.status(400).json({ message: 'Sai mật khẩu' });
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
        res.json({ message: 'Đổi mật khẩu thành công' });
    } catch (error) { res.status(500).json({ message: 'Lỗi server' }); }
};


// ============================================================
// ADMIN ACTIONS
// ============================================================

exports.getAllUsers = async (req, res) => {
    try { const [rows] = await db.execute('SELECT id, username, email, full_name, role, status, warnings, ban_expires_at, created_at FROM users ORDER BY created_at DESC'); res.json(rows); } catch (e) { res.status(500).json({message: 'Lỗi'}); }
};

exports.deleteUser = async (req, res) => { 
    try { await db.execute('DELETE FROM users WHERE id = ?', [req.params.id]); res.json({message:'Đã xóa'}); } catch(e) { res.status(500).json({message:'Lỗi'}); } 
};

exports.warnUser = async (req, res) => { 
    try { await db.execute('UPDATE users SET warnings = warnings + 1 WHERE id = ?', [req.params.id]); res.json({message:'Đã cảnh báo'}); } catch(e) { res.status(500).json({message:'Lỗi'}); } 
};

exports.banUser = async (req, res) => { 
    const {id} = req.params; const {days} = req.body; 
    let d = null, s = 'banned'; 
    if(days != -1 && days != '-1') { 
        d = new Date(); 
        d.setDate(d.getDate() + parseInt(days)); 
        d = d.toISOString().slice(0,19).replace('T',' '); 
    }
    try { await db.execute('UPDATE users SET status = ?, ban_expires_at = ? WHERE id = ?', [s, d, id]); res.json({message:'Đã chặn'}); } catch(e) { res.status(500).json({message:'Lỗi'}); } 
};

exports.unbanUser = async (req, res) => { 
    try { await db.execute("UPDATE users SET status = 'active', ban_expires_at = NULL WHERE id = ?", [req.params.id]); res.json({message:'Đã mở khóa'}); } catch(e) { res.status(500).json({message:'Lỗi'}); } 
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