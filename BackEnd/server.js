require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/database');

const authRoutes = require('./routes/auth');
const videoRoutes = require('./routes/videos');
const adminRoutes = require('./routes/admin');
const UserRoute = require('./routes/user');
const paymentRoutes = require('./routes/payment'); // Payment Route
const client = require('prom-client');
const app = express();


client.collectDefaultMetrics();

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});


// ====== MIDDLEWARE ======
// CORS
app.use(cors({
  origin: ['https://toteja.co','http://localhost:5173' ],
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
}));
// JSON / URL-encoded for most routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// NOTE:
// Do NOT apply express.text() or express.raw() globally —
// the payment callback route must receive the RAW body exactly as sent by KBank/KPlus.
// The payment callback route should apply express.raw({...}) locally on that route.
// See routes/payment.js example below.

// ====== ROUTES ======
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', UserRoute);
app.use('/api/payment', paymentRoutes); // << payment routes (callback route must be raw)

// Health check
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

    // Start server
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log('Environment variables required:');
      console.log('- MONGO_URI');
      console.log('- AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (if used)');
      console.log('- UPLOADS_BUCKET, HLS_OUTPUT_BUCKET');
      console.log('- MEDIACONVERT_ENDPOINT, MEDIACONVERT_ROLE');
      console.log('- CLOUDFRONT_DOMAIN, CLOUDFRONT_KEY_PAIR_ID, CLOUDFRONT_PRIVATE_KEY_PATH');
      console.log('- KPLUS_WEBHOOK_SECRET (สำหรับตรวจลายเซ็น webhook)');
    });

    // ---- WebSocket init: prefer external ./websocket.js if present ----
    try {
      // If you created websocket.js which exports initWebSocket(server),
      // it will be used (recommended for cleaner separation).
      const { initWebSocket } = require('./websocket');
      if (typeof initWebSocket === 'function') {
        initWebSocket(server);
        console.log('WebSocket initialized via ./websocket.js');
        return;
      }
    } catch (err) {
      // ignore if module not found
    }

    // ---- Fallback: simple global WebSocket server (ws) ----
    const WebSocket = require('ws');
    global.wss = new WebSocket.Server({ server });

    wss.on('connection', (ws) => {
      console.log('WebSocket client connected');
      ws.send(JSON.stringify({ message: 'Connected to payment channel' }));
      ws.on('message', (msg) => {
        console.log('WS message from client:', msg.toString());
      });
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
