const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { createNotificationInternal } = require('./notificationController');

// ============================================================
// HELPER: CẬP NHẬT TIẾN ĐỘ NHIỆM VỤ (Dùng chung)
// ============================================================
const updateQuestProgress = async (userId, actionType, incrementAmount = 1) => {
    try {
        // 1. Tìm tất cả nhiệm vụ khớp với hành động (VD: 'read', 'comment', 'login')
        const [quests] = await db.execute("SELECT * FROM quests WHERE action_type = ?", [actionType]);
        
        if (quests.length === 0) return;

        // 2. Duyệt qua từng nhiệm vụ tìm được để cập nhật
        for (const quest of quests) {
            // Lấy trạng thái hiện tại của user đối với nhiệm vụ này
            const [existing] = await db.execute(
                `SELECT id, current_count, is_claimed, 
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
                // Chưa làm bao giờ -> Tạo mới
                newCount = incrementAmount;
                if (newCount >= quest.target_count) isFirstComplete = true;
                
                await db.execute(
                    "INSERT INTO user_quests (user_id, quest_id, current_count, is_claimed, last_updated) VALUES (?, ?, ?, 0, CURRENT_DATE())",
                    [userId, quest.id, newCount]
                );
            } else {
                const record = existing[0];
                let shouldReset = false;

                // Logic Reset dựa trên loại nhiệm vụ (ENUM: 'daily', 'weekly', 'achievement')
                if (quest.type === 'daily' && record.days_diff !== 0) {
                    shouldReset = true; // Khác ngày -> Reset
                } else if (quest.type === 'weekly' && record.weeks_diff !== 0) {
                    shouldReset = true; // Khác tuần -> Reset
                }
                // quest.type === 'achievement': Không bao giờ reset
                
                if (shouldReset) {
                    newCount = incrementAmount; 
                    newClaimed = 0;
                    needUpdate = true;
                    // Nếu reset mà đạt ngay target (ví dụ target=1)
                    if (newCount >= quest.target_count) isFirstComplete = true;
                } else {
                    // Cùng chu kỳ -> Cộng dồn
                    newCount = record.current_count;
                    newClaimed = record.is_claimed;
                    
                    // Chỉ tăng nếu chưa max hoặc là achievement (tích lũy)
                    // Hoặc tăng đến khi đạt target để user nhận thưởng
                    if (newCount < quest.target_count || quest.type === 'achievement') {
                        newCount += incrementAmount;
                        needUpdate = true;
                        
                        // Check nếu vừa cán mốc target và chưa nhận thưởng
                        if (newCount >= quest.target_count && record.current_count < quest.target_count && newClaimed === 0) {
                            isFirstComplete = true;
                        }
                    }
                }

                if (needUpdate) {
                    await db.execute(
                        "UPDATE user_quests SET current_count = ?, is_claimed = ?, last_updated = CURRENT_DATE() WHERE id = ?",
                        [newCount, newClaimed, record.id]
                    );
                }
            }

            // 3. Bắn thông báo nếu hoàn thành lần đầu tiên trong chu kỳ
            if (isFirstComplete) {
                 await createNotificationInternal(
                    userId, 
                    'quest', // ENUM type cho notifications
                    'Nhiệm vụ hoàn thành!', 
                    `Bạn đã hoàn thành: ${quest.name}. Hãy vào trang hồ sơ nhận thưởng!`, 
                    '/profile?tab=tasks'
                );
            }
        }
    } catch (error) {
        console.error(`Lỗi updateQuestProgress (${actionType}):`, error);
    }
};

// Export helper để các Controller khác sử dụng
exports.updateQuestProgress = updateQuestProgress;


// ============================================================
// LIBRARY (TỦ TRUYỆN)
// ============================================================

exports.addToLibrary = async (req, res) => {
    const userId = req.user.id;
    const { comic_slug, comic_name, comic_image, latest_chapter } = req.body;
    try {
        await db.execute(
            `INSERT INTO library (user_id, comic_slug, comic_name, comic_image, latest_chapter) 
             VALUES (?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE latest_chapter = VALUES(latest_chapter), comic_image = VALUES(comic_image)`,
            [userId, comic_slug, comic_name, comic_image, latest_chapter]
        );
        res.status(200).json({ message: 'Đã lưu vào tủ truyện!' });
    } catch (error) { res.status(500).json({ message: 'Lỗi server' }); }
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
        const [rows] = await db.execute('SELECT * FROM library WHERE user_id = ? ORDER BY created_at DESC', [userId]);
        res.json(rows);
    } catch (error) { res.status(500).json({ message: 'Lỗi server' }); }
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
        // 1. Lưu lịch sử đọc vào DB
        await db.execute(
            `INSERT INTO reading_history (user_id, comic_slug, comic_name, comic_image, chapter_name, read_at) 
             VALUES (?, ?, ?, ?, ?, NOW()) 
             ON DUPLICATE KEY UPDATE chapter_name = VALUES(chapter_name), read_at = NOW()`,
            [userId, comic_slug, comic_name, comic_image, chapter_name]
        );

        // 2. Cập nhật Nhiệm vụ Đọc
        // Gọi helper với action_type = 'read'
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
        // Lấy 50 dòng gần nhất
        const [rows] = await db.execute('SELECT * FROM reading_history WHERE user_id = ? ORDER BY read_at DESC LIMIT 50', [userId]);
        res.json(rows);
    } catch (error) { res.status(500).json({ message: 'Lỗi server' }); }
};

exports.checkReadingHistory = async (req, res) => {
    const userId = req.user.id;
    const { comic_slug } = req.params;
    try {
        const [rows] = await db.execute('SELECT chapter_name FROM reading_history WHERE user_id = ? AND comic_slug = ?', [userId, comic_slug]);
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