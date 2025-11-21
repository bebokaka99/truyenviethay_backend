const express = require('express');
const cors = require('cors');
const app = express();
const dotenv = require('dotenv');
const path = require('path');
const axios = require('axios');

// Load env
dotenv.config();

// Kết nối database
const db = require('./config/db');

// CORS
app.use(cors({
    origin: [
        "https://truyenviethay-frontend.pages.dev",
        "*"
    ],
    methods: "GET,POST,PUT,DELETE",
    credentials: true
}));

app.use(express.json());

// Static for avatar
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const notificationRoutes = require('./routes/notification');
const questRoutes = require('./routes/quest');
const commentRoutes = require('./routes/comment');
const reportRoutes = require('./routes/report');
const ratingRoutes = require('./routes/rating');

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/quests', questRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/rating', ratingRoutes);

app.get('/', (req, res) => {
    res.send('Backend Node.js đang chạy ổn định!');
});

// API Proxy Otruyen
app.get('/api/home', async (req, res) => {
    try {
        const response = await axios.get('https://otruyenapi.com/v1/api/home', {
            timeout: 8000
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ message: "Lỗi lấy data Otruyen" });
    }
});

// Run server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server chạy trên cổng ${PORT}`);
});
