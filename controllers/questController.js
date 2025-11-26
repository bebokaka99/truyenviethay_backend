const db = require('../config/db');
const { createNotificationInternal } = require('./notificationController');

// Helper: Calculate Level
const getLevelFromExp = (exp) => Math.floor(Math.sqrt(exp / 100)) || 1;

// 1. User Actions

// Get Available Quests & Status
exports.getQuests = async (req, res) => {
    const userId = req.user.id;
    try {
        const query = `
            SELECT q.*, 
                   IF(DATEDIFF(CURRENT_DATE(), uq.last_updated) = 0, uq.current_count, 0) as current_count,
                   IF(DATEDIFF(CURRENT_DATE(), uq.last_updated) = 0, uq.is_claimed, 0) as is_claimed
            FROM quests q
            LEFT JOIN user_quests uq ON q.id = uq.quest_id AND uq.user_id = ?
            ORDER BY FIELD(q.type, 'daily', 'weekly', 'achievement'), q.target_count ASC
        `;
        const [rows] = await db.execute(query, [userId]);
        res.json(rows);
    } catch (error) {
        console.error("Lỗi getQuests:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Claim Reward
exports.claimReward = async (req, res) => {
    const userId = req.user.id;
    const { quest_id } = req.body;
    let connection;

    try {
        connection = await db.getConnection();
        
        // 1. Check Quest Status
        const [quests] = await connection.execute(
            `SELECT q.reward_exp, q.type, q.target_count, 
                    uq.current_count, uq.is_claimed, uq.last_updated,
                    u.exp, 
                    DATEDIFF(CURRENT_DATE(), uq.last_updated) as days_diff 
             FROM quests q 
             JOIN user_quests uq ON q.id = uq.quest_id 
             JOIN users u ON uq.user_id = u.id 
             WHERE uq.user_id = ? AND uq.quest_id = ?`, 
            [userId, quest_id]
        );

        if (quests.length === 0) {
            connection.release();
            return res.status(400).json({ message: 'Chưa thực hiện nhiệm vụ này.' });
        }

        const quest = quests[0];

        // 2. Validation
        if (quest.type === 'daily' && quest.days_diff !== 0) {
            connection.release();
            return res.status(400).json({ message: 'Nhiệm vụ ngày cũ, hãy làm lại.' });
        }
        if (Number(quest.is_claimed) === 1) {
            connection.release();
            return res.status(400).json({ message: 'Đã nhận thưởng rồi.' });
        }
        if (quest.current_count < quest.target_count) {
            connection.release();
            return res.status(400).json({ message: 'Chưa đạt mục tiêu.' });
        }

        // 3. Process Transaction
        await connection.beginTransaction();

        // Mark as claimed
        await connection.execute(
            'UPDATE user_quests SET is_claimed = 1 WHERE user_id = ? AND quest_id = ?', 
            [userId, quest_id]
        );
        
        // Update User EXP & Level
        const newExp = (quest.exp || 0) + quest.reward_exp;
        const newLevel = getLevelFromExp(newExp);
        
        await connection.execute(
            'UPDATE users SET exp = ?, level = ? WHERE id = ?', 
            [newExp, newLevel, userId]
        );

        await connection.commit();

        // 4. Notify Level Up (Async)
        const oldLevel = getLevelFromExp(quest.exp || 0);
        if (newLevel > oldLevel) {
            createNotificationInternal(userId, 'level_up', 'Thăng cấp!', `Chúc mừng! Bạn đã đạt cấp ${newLevel}.`).catch(console.error);
        }

        res.json({ message: `Nhận +${quest.reward_exp} XP thành công!`, new_exp: newExp });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Lỗi claimReward:", error);
        res.status(500).json({ message: 'Lỗi server' });
    } finally {
        if (connection) connection.release();
    }
};

// 2. Admin Actions (Manage Quests)

exports.getAllQuestsAdmin = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM quests ORDER BY type, target_count ASC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.createQuest = async (req, res) => {
    const { quest_key, name, description, target_count, reward_exp, type, action_type } = req.body;
    
    try {
        const [exists] = await db.execute('SELECT id FROM quests WHERE quest_key = ?', [quest_key]);
        if (exists.length > 0) return res.status(400).json({ message: 'Key nhiệm vụ đã tồn tại!' });

        await db.execute(
            'INSERT INTO quests (quest_key, name, description, target_count, reward_exp, type, action_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [quest_key, name, description, target_count, reward_exp, type, action_type || 'read']
        );
        res.status(201).json({ message: 'Tạo nhiệm vụ thành công!' });
    } catch (error) {
        console.error("Lỗi createQuest:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.updateQuest = async (req, res) => {
    const { id } = req.params;
    const { name, description, target_count, reward_exp, type, action_type } = req.body;
    
    try {
        await db.execute(
            'UPDATE quests SET name=?, description=?, target_count=?, reward_exp=?, type=?, action_type=? WHERE id=?',
            [name, description, target_count, reward_exp, type, action_type, id]
        );
        res.json({ message: 'Cập nhật thành công!' });
    } catch (error) {
        console.error("Lỗi updateQuest:", error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.deleteQuest = async (req, res) => {
    try {
        await db.execute('DELETE FROM quests WHERE id = ?', [req.params.id]);
        res.json({ message: 'Đã xóa nhiệm vụ!' });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};