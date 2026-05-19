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
require('dotenv').config();

// require('elastic-apm-node').start({
//   serviceName: process.env.ELASTIC_APM_SERVICE_NAME,
//   serverUrl: process.env.ELASTIC_APM_SERVER_URL_PRODUCTION,
//   apiKey: process.env.ELASTIC_APM_API_KEY,
//   environment: "production",
//   active: true,
//   logLevel: 'trace',
// });

// Add this to the very top of the first file loaded in your app
var apm = require('elastic-apm-node').start()
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
    await connectDB();
    await connectES();
    
    // ===== INITIALIZE ELASTICSEARCH INDEXES =====
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

// สั่งรันเซิร์ฟเวอร์หลัก
startServer();


// =========================================================================
// 🌟 ⚡ PRODUCTION DYNAMIC SECRETS: APP-MANAGED CONFIG WATCHER 🌟 ⚡
// =========================================================================
const fs = require('fs');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const vaultEnvPath = '/vault/secrets/app.env';

if (fs.existsSync(vaultEnvPath)) {
  console.log('👀 [Vault Watcher] Active: Monitoring app.env for dynamic credential rotations...');

  // ใช้ watchFile (Polling) เพื่อความเสถียรสูงสุดบน Docker Volumes ข้ามระบบปฏิบัติการ
  fs.watchFile(vaultEnvPath, { interval: 5000 }, async (curr, prev) => {
    // เงื่อนไข: ถ้าเวลาการแก้ไขไฟล์ (mtime) มีค่าใหม่กว่าเดิม แปลว่า Vault Agent เพิ่งเขียนรหัสชุดใหม่เสร็จ
    if (curr.mtime > prev.mtime) {
      console.log('🔄 [Vault Watcher] Modification detected in app.env! Initiating hot-reload...');

      try {
        // 1. โหลดข้อมูลสิทธิ์ตัวใหม่เข้าสู่หน่วยความจำหลัก (process.env)
        const envConfig = dotenv.parse(fs.readFileSync(vaultEnvPath));
        for (const key in envConfig) {
          process.env[key] = envConfig[key];
        }
        console.log('✅ [Vault Watcher] Successfully updated process.env keys in memory');

        // 2. เคลียร์สายสัญญาณการเชื่อมต่อก้อนเก่า (เพื่อป้องกันอาการล็อกอินพังหลังคีย์เดิมหมดอายุ)
        if (mongoose.connection.readyState !== 0) {
          console.log('🔄 [Vault Watcher] Closing old MongoDB active connections pool...');
          await mongoose.disconnect();
        }

        // 3. ปลุกระดมท่อเชื่อมต่อก้อนใหม่ผ่านรหัสผ่านล่าสุดทันที
        console.log('🔄 [Vault Watcher] Re-establishing Mongoose cluster link with fresh tokens...');
        await connectDB();
        console.log('🚀 [Vault Watcher] Hot-Reload Complete! System smoothly rotated credentials without downtime.');

      } catch (error) {
        console.error('❌ [Vault Watcher] Error during app-managed hot-reload execution:', error);
      }
    }
  });
}