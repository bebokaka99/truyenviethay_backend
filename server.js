const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios'); // Move to top imports

// Configure environment variables
dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// Route imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const notificationRoutes = require('./routes/notification');
const questRoutes = require('./routes/quest');
const commentRoutes = require('./routes/comment');
const reportRoutes = require('./routes/report');
const ratingRoutes = require('./routes/rating');

// --- Middleware ---
app.use(cors());
app.use(express.json());

// Static file (Avatar, images)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Register routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/quests', questRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/rating', ratingRoutes);

// General Routes
// Health Check
app.get('/', (req, res) => {
    res.send('Backend Node.js đang chạy ổn định!');
});

// Proxy API Otruyen (Tránh lỗi CORS ở Frontend)
app.get('/api/home', async (req, res) => {
    try {
        const response = await axios.get('https://otruyenapi.com/v1/api/home');
        res.json(response.data);
    } catch (error) {
        console.error("Proxy Error:", error.message);
        res.status(500).json({ message: "Lỗi lấy data Otruyen" });
    }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server đang chạy tại http://0.0.0.0:${PORT}`);
});