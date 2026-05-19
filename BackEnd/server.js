// ✅ ต้อง require APM ก่อนทุกอย่าง (บรรทัดแรกสุดเลย!)

// const apm = require('elastic-apm-node').start({
//   serviceName: 'toteja-backend',
  
//   // 1. เปลี่ยน URL ให้ชี้ไปที่ Elastic Agent (Fleet)
//   // ถ้าแอปอยู่ใน Docker Network เดียวกัน ให้ใช้ชื่อ Service ของ Fleet
//   serverUrl: process.env.ELASTIC_APM_SERVER_URL || 'http://fleet-server:8200',

//   // 2. ต้องใส่ Secret Token (ห้ามลืม!) 
//   // เพราะ Fleet บังคับใช้ Token เพื่อไม่ให้ใครก็ไม่รู้ส่งข้อมูลปลอมมาใส่ Elasticsearch ของคุณ
//   secretToken: process.env.ELASTIC_APM_SECRET_TOKEN || 'YOUR_FLEET_APM_SECRET_TOKEN',

//   environment: process.env.NODE_ENV || 'production',
//   active: true,
// });
// const apm = require('elastic-apm-node').start({
//   serviceName: 'toteja-backend',

//   // ชี้ไป APM Server
//   serverUrl: process.env.ELASTIC_APM_SERVER_URL || 'http://apm-server:8200',

//   // standalone local dev ไม่ต้องใช้ token ก็ได้
//   secretToken: process.env.ELASTIC_APM_SECRET_TOKEN || '',

//   environment: process.env.NODE_ENV || 'development',

//   active: true,
// });
//online APM
// Add this to the very top of the first file loaded in your app
// require('dotenv').config();
// บรรทัดแรกสุด - อ่าน secret จาก Vault Agent แทน .env
const fs = require('fs');
const path = require('path');

const vaultSecretsPath = '/vault/secrets/app.env';

if (fs.existsSync(vaultSecretsPath)) {
  require('dotenv').config({ path: vaultSecretsPath });  // ← อ่านจาก vault
  console.log('✅ Loaded secrets from Vault Agent');
} else {
  require('dotenv').config();  // ← fallback dev local
  console.log('⚠️  Vault secrets not found, using .env fallback');
}
// require('elastic-apm-node').start({
//   serviceName: process.env.ELASTIC_APM_SERVICE_NAME,
//   serverUrl: process.env.ELASTIC_APM_SERVER_URL_PRODUCTION,
//   apiKey: process.env.ELASTIC_APM_API_KEY,
//   environment: "production",
//   active: true,
//   logLevel: 'trace',
// });

// // Add this to the very top of the first file loaded in your app
// var apm = require('elastic-apm-node').start()
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

// ✅ 1. Import Webhook Route เข้ามา
const webhookRoutes = require('./stripeWebhook'); 
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
    console.log('🚀 Starting backend server...\n');

    // ✅ STEP 1: Initialize Vault (MUST BE FIRST!)
    console.log('========== INITIALIZING SERVICES ==========\n');
    
    const vaultService = require('./config/vault');
    await vaultService.initialize();
    console.log('');

    // ✅ STEP 2: Initialize all services that need Vault
    const { initElasticsearch } = require('./config/elasticsearch');
    const { initClickhouse } = require('./config/clickhouse');
    const { initAWS } = require('./config/aws');
    
    console.log('📦 Initializing database connections...');
    await connectDB();
    console.log('');

    console.log('🔍 Initializing Elasticsearch...');
    await initElasticsearch();
    console.log('');

    console.log('📊 Initializing ClickHouse...');
    await initClickhouse();
    console.log('');

    console.log('☁️  Initializing AWS services...');
    await initAWS();
    console.log('');

    console.log('🔴 Initializing Redis...');
    await redisClient.connect();
    console.log('');
    
    // ===== INITIALIZE ELASTICSEARCH INDEXES =====
    console.log('🔄 Initializing Elasticsearch indexes...');
    const Video = require('./models/Video');
    const Purchase = require('./models/Purchase');
    
    await Video.initializeESIndex();
    await Purchase.initializeESIndex();
    console.log('✅ Elasticsearch indexes initialized\n');
    
    console.log('========== SERVICES INITIALIZED ==========\n');
    
    const PORT = vaultService.get('PORT') || 3000;

    server.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`📍 http://localhost:${PORT}`);
    });

    initWebSocket(server);
    console.log('🔌 WebSocket initialized');

  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();