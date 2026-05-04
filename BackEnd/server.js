require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const connectDB = require('./config/database');
const redisClient = require('./config/redis');
const authRoutes = require('./routes/auth');
const videoRoutes = require('./routes/videos');
const adminRoutes = require('./routes/admin');
const UserRoute = require('./routes/user');
const purchaseRoutes = require('./routes/Purchase');

// ✅ 1. Import Webhook Route เข้ามา
const webhookRoutes = require('./stripeWebhook'); 

const { startRedisSubscriber } = require('./services/redisSubscriber');
const cookieParser = require('cookie-parser');
const { initWebSocket } = require('./websocket');
const client = require('prom-client');

const app = express();
const server = http.createServer(app);
app.use(cookieParser());
client.collectDefaultMetrics();

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// ====== MIDDLEWARE ======
app.use(cors({
  origin: ['https://toteja.co', 'http://localhost:5173','http://localhost'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// ✅ 2. ประกาศ Webhook Route **ก่อน** express.json()
// เพื่อให้ express.raw() ใน webhook.js ทำงานได้โดยไม่ถูกกวน
app.use('/webhooks', webhookRoutes); 

// จากนั้นค่อยเปิดใช้งาน JSON parser สำหรับ Route อื่นๆ
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ====== ROUTES ======
app.use('/api/purchase', purchaseRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', UserRoute);
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

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    initWebSocket(server);
    console.log('WebSocket initialized');

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();