// ✅ บรรทัดแรกสุด: APM ต้อง start ก่อนทุกอย่าง
// entrypoint.sh โหลด secrets เข้า process.env ให้แล้วก่อน node รัน
// ดังนั้น process.env พร้อมใช้งานได้เลยตรงนี้
var apm = require('elastic-apm-node').start();

const { connectES } = require('./config/elasticsearch');
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

// ✅ Import Webhook Route ก่อน express.json()
const webhookRoutes = require('./stripeWebhook');
const cookieParser = require('cookie-parser');
const { initWebSocket } = require('./websocket');
const client = require('prom-client');

const app = express();
const server = http.createServer(app);

app.use(cookieParser());
client.collectDefaultMetrics();

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// ====== MIDDLEWARE ======
app.use(cors({
  origin: ['https://toteja.co', 'http://localhost:5173', 'http://localhost'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// ✅ Webhook ก่อน express.json() เสมอ
app.use('/webhooks', webhookRoutes);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ====== ROUTES ======
app.use('/api/purchase', purchaseRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', UserRoute);
app.use('/api/search', require('./routes/searchroute'));
app.use('/api/elasticsearch', require('./routes/elasticsearch'));
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
    await connectES();

    const Video = require('./models/Video');
    const Purchase = require('./models/Purchase');

    console.log('🔄 Initializing Elasticsearch indexes...');
    await Video.initializeESIndex();
    await Purchase.initializeESIndex();
    console.log('✅ Elasticsearch indexes initialized');

    console.log('Connected to MongoDB and Elasticsearch');

    const PORT = process.env.PORT || 3000;

    console.log('Connecting to Redis...');
    await redisClient.connect();

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