const express = require('express');
const cors = require('cors');
const app = express();
const dotenv = require('dotenv');
const path = require('path');

dotenv.config(); 

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const notificationRoutes = require('./routes/notification');
const questRoutes = require('./routes/quest');
const commentRoutes = require('./routes/comment');
const reportRoutes = require('./routes/report');
const ratingRoutes = require('./routes/rating');

app.use(cors());
app.use(express.json());

// Static file cho ảnh avatar
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Đăng ký Routes
app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/notifications', notificationRoutes);
app.use('/quests', questRoutes);
app.use('/comments', commentRoutes);
app.use('/reports', reportRoutes);
app.use('/rating', ratingRoutes);

app.get('/', (req, res) => {
    res.send('Backend Node.js đang chạy ổn định!');
});

// API Proxy Otruyen
const axios = require('axios');
app.get('/api/home', async (req, res) => {
    try {
        const response = await axios.get('https://otruyenapi.com/v1/api/home');
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ message: "Lỗi lấy data Otruyen" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server đang chạy tại http://0.0.0.0:${PORT}`);
});
