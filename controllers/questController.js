const db = require('../config/db');
const { createNotificationInternal } = require('./notificationController');

const getLevelFromExp = (exp) => Math.floor(Math.sqrt(exp / 100)) || 1;

// User Get Quests
exports.getQuests = async (req, res) => {
    const userId = req.user.id;
    try {
        const [rows] = await db.execute(`
            SELECT q.*, 
                   IF(DATEDIFF(CURRENT_DATE(), uq.last_updated) = 0, uq.current_count, 0) as current_count,
                   IF(DATEDIFF(CURRENT_DATE(), uq.last_updated) = 0, uq.is_claimed, 0) as is_claimed
            FROM quests q
            LEFT JOIN user_quests uq ON q.id = uq.quest_id AND uq.user_id = ?
            ORDER BY FIELD(q.type, 'daily', 'weekly', 'achievement'), q.target_count ASC
        `, [userId]);
        res.json(rows);
    } catch (error) { res.status(500).json({ message: 'Lỗi server' }); }
};

// User Claim Reward (Giữ nguyên logic đã fix ở bước trước)
exports.claimReward = async (req, res) => {
    const userId = req.user.id;
    const { quest_id } = req.body;
    let connection;
    try {
        connection = await db.getConnection();
        const [quests] = await connection.execute(
            `SELECT q.reward_exp, uq.current_count, q.target_count, uq.is_claimed, u.exp, DATEDIFF(CURRENT_DATE(), uq.last_updated) as days_diff 
             FROM quests q JOIN user_quests uq ON q.id = uq.quest_id JOIN users u ON uq.user_id = u.id 
             WHERE uq.user_id = ? AND uq.quest_id = ?`, [userId, quest_id]
        );

        if (quests.length === 0) { connection.release(); return res.status(400).json({ message: 'Chưa thực hiện.' }); }
        const quest = quests[0];

        if (quest.type === 'daily' && quest.days_diff !== 0) { connection.release(); return res.status(400).json({ message: 'Ngày cũ, hãy làm lại.' }); }
        if (Number(quest.is_claimed) === 1) { connection.release(); return res.status(400).json({ message: 'Đã nhận rồi.' }); }
        if (quest.current_count < quest.target_count) { connection.release(); return res.status(400).json({ message: 'Chưa đạt mục tiêu.' }); }

        await connection.beginTransaction();
        await connection.execute('UPDATE user_quests SET is_claimed = 1 WHERE user_id = ? AND quest_id = ?', [userId, quest_id]);
        
        const newExp = (quest.exp || 0) + quest.reward_exp;
        const newLevel = getLevelFromExp(newExp);
        await connection.execute('UPDATE users SET exp = ?, level = ? WHERE id = ?', [newExp, newLevel, userId]);
        await connection.commit();

        try {
            const oldLevel = getLevelFromExp(quest.exp || 0);
            if (newLevel > oldLevel) await createNotificationInternal(userId, 'level_up', 'Thăng cấp!', `Đạt cấp ${newLevel}.`);
        } catch (e) {}

        res.json({ message: `Nhận +${quest.reward_exp} XP thành công!`, new_exp: newExp });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error(error); res.status(500).json({ message: 'Lỗi server' });
    } finally { if (connection) connection.release(); }
};

// --- ADMIN ACTIONS (FIX QUAN TRỌNG: THÊM action_type) ---

exports.getAllQuestsAdmin = async (req, res) => {
    try { const [rows] = await db.execute('SELECT * FROM quests ORDER BY type, target_count ASC'); res.json(rows); } 
    catch (error) { res.status(500).json({ message: 'Lỗi server' }); }
};

exports.createQuest = async (req, res) => {
    // Nhận action_type từ body
    const { quest_key, name, description, target_count, reward_exp, type, action_type } = req.body;
    try {
        const [exists] = await db.execute('SELECT id FROM quests WHERE quest_key = ?', [quest_key]);
        if (exists.length > 0) return res.status(400).json({ message: 'Key đã tồn tại!' });

        await db.execute(
            'INSERT INTO quests (quest_key, name, description, target_count, reward_exp, type, action_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [quest_key, name, description, target_count, reward_exp, type, action_type || 'read']
        );
        res.status(201).json({ message: 'Tạo thành công!' });
    } catch (error) { console.error(error); res.status(500).json({ message: 'Lỗi server' }); }
};

exports.updateQuest = async (req, res) => {
    const { id } = req.params;
    // Nhận action_type để update
    const { name, description, target_count, reward_exp, type, action_type } = req.body;
    try {
        await db.execute(
            'UPDATE quests SET name=?, description=?, target_count=?, reward_exp=?, type=?, action_type=? WHERE id=?',
            [name, description, target_count, reward_exp, type, action_type, id]
        );
        res.json({ message: 'Cập nhật thành công!' });
    } catch (error) { console.error(error); res.status(500).json({ message: 'Lỗi server' }); }
};

exports.deleteQuest = async (req, res) => {
    const { id } = req.params;
    try { await db.execute('DELETE FROM quests WHERE id = ?', [id]); res.json({ message: 'Đã xóa!' }); } 
    catch (error) { res.status(500).json({ message: 'Lỗi server' }); }
};