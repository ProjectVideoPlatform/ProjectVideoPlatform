require('dotenv').config();
const express = require('express');
const http = require('http'); // ✅ เพิ่ม
const cors = require('cors');
const connectDB = require('./config/database');
const redisClient = require('./config/redis');
const authRoutes = require('./routes/auth');
const videoRoutes = require('./routes/videos');
const adminRoutes = require('./routes/admin');
const UserRoute = require('./routes/user');
const paymentRoutes = require('./routes/payment');
const purchaseRoutes = require('./routes/Purchase');
const { startRedisSubscriber } = require('./services/redisSubscriber');
const cookieParser = require('cookie-parser'); // ✅ 1. เพิ่มตัวนี้
const { initWebSocket } = require('./websocket'); // ✅ import ตรงๆ เลย
const client = require('prom-client');

const app = express();
const server = http.createServer(app); // ✅ สร้าง http server ก่อน
app.use(cookieParser());
client.collectDefaultMetrics();

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// ====== MIDDLEWARE ======
app.use(cors({
  origin: ['https://toteja.co', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ====== ROUTES ======
app.use('/api/purchases', purchaseRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', UserRoute);
app.use('/api/payment', paymentRoutes);
app.use('/api/public', require('./routes/analyze'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ====== ERROR HANDLING ======
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// ====== START SERVER ======
const startServer = async () => {
  try {
    await connectDB();

    const PORT = process.env.PORT || 3000;

    console.log('Connecting to Redis...');
    await redisClient.connect();
    await startRedisSubscriber();

    // ✅ ใช้ server.listen แทน app.listen
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // ✅ init WebSocket กับ http server เดียวกัน
    initWebSocket(server);
    console.log('WebSocket initialized');

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();