// questController.js (Thêm vào cuối file)

// --- HÀM CẬP NHẬT TIẾN TRÌNH NHIỆM VỤ (Dùng nội bộ) ---
exports.updateQuestProgress = async (userId, questKey, questType, specificValue = 1) => {
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Tìm Quest dựa trên questKey
        const [quests] = await connection.execute('SELECT id, target_count, type FROM quests WHERE quest_key = ?', [questKey]);
        if (quests.length === 0) {
            await connection.rollback();
            return; // Quest không tồn tại, kết thúc
        }
        const quest = quests[0];

        // 2. Tìm hoặc Khởi tạo user_quests
        // NOTE: Trong query, current_count được reset cho daily/weekly nếu ngày khác
        const [userQuests] = await connection.execute(
            `SELECT * FROM user_quests WHERE user_id = ? AND quest_id = ?`, 
            [userId, quest.id]
        );
        
        let currentCount = specificValue; // Mặc định là giá trị mới cho streak, hoặc 1
        let isClaimed = 0;

        if (userQuests.length > 0) {
            const uq = userQuests[0];
            const isNewDay = uq.last_updated && uq.last_updated.toISOString().split('T')[0] !== new Date().toISOString().split('T')[0];

            if (quest.type === 'daily' || quest.type === 'weekly') {
                // Nếu là nhiệm vụ Daily/Weekly và là ngày mới -> reset count, reset claim
                if (isNewDay) {
                    currentCount = specificValue; 
                    isClaimed = 0; 
                } else {
                    // Cập nhật giá trị cũ
                    currentCount = uq.current_count + specificValue;
                    isClaimed = uq.is_claimed;
                }
            } else {
                // Achievement: chỉ tăng nếu chưa hoàn thành
                if (uq.current_count < quest.target_count) {
                     currentCount = uq.current_count + specificValue;
                } else {
                    currentCount = uq.current_count; // Giữ nguyên
                }
                isClaimed = uq.is_claimed;
            }

            // Cập nhật tiến trình cho UserQuest đã tồn tại
            await connection.execute(
                'UPDATE user_quests SET current_count = ?, is_claimed = ?, last_updated = CURRENT_DATE() WHERE user_id = ? AND quest_id = ?',
                [currentCount, isClaimed, userId, quest.id]
            );

        } else {
            // Tạo mới UserQuest
            await connection.execute(
                'INSERT INTO user_quests (user_id, quest_id, current_count, is_claimed, last_updated) VALUES (?, ?, ?, ?, CURRENT_DATE())',
                [userId, quest.id, specificValue, 0]
            );
        }
        
        // 3. Kiểm tra hoàn thành và gửi thông báo
        if (currentCount >= quest.target_count && Number(isClaimed) === 0) {
            // Chỉ gửi thông báo nếu người dùng chưa nhận thưởng
            await createNotificationInternal(
                userId, 
                'quest', 
                'Nhiệm vụ hoàn thành!', 
                `Bạn đã hoàn thành: ${quest.name}. Nhận thưởng ngay!`, 
                '/profile?tab=tasks'
            );
        }

        await connection.commit();

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Lỗi cập nhật tiến trình nhiệm vụ:", error);
    } finally {
        if (connection) connection.release();
    }
};