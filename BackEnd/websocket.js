const WebSocket = require("ws");
const redis = require("./config/redis");

let wss = null;
const clients = new Map(); // videoId -> Set of ws

function initWebSocket(server) {
  wss = new WebSocket.Server({ server });
  console.log("WebSocket ready.");

  wss.on("connection", async (ws, req) => {
    // ✅ ดึง videoId จาก query string
    const url = new URL(req.url, "http://localhost");
    const videoId = url.searchParams.get("videoId");

    if (!videoId) {
      console.log("❌ No videoId — closing");
      ws.close(1008, "videoId required");
      return;
    }

    // ✅ เพิ่ม client เข้า Map
    if (!clients.has(videoId)) clients.set(videoId, new Set());
    clients.get(videoId).add(ws);
    console.log(`✅ Client connected: ${videoId} (total: ${clients.get(videoId).size})`);

    // ✅ เช็ค Redis ว่ามี event รอส่งอยู่มั้ย (กรณี transcode เสร็จก่อน client connect)
    try {
      const cached = await redis.get(`video-status:${videoId}`);
      if (cached) {
        console.log(`📦 Sending cached event: ${videoId}`);
        ws.send(cached);
        await redis.del(`video-status:${videoId}`);
      }
    } catch (err) {
      console.error("Redis get error:", err);
    }

    // Heartbeat
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", (msg) => {
      console.log("WS message:", msg.toString());
    });

    ws.on("close", (code, reason) => {
      console.log(`🔌 Client disconnected: ${videoId} code:${code}`);
      clients.get(videoId)?.delete(ws);
      if (clients.get(videoId)?.size === 0) clients.delete(videoId);
    });

    ws.on("error", (err) => {
      console.error(`WS error (${videoId}):`, err.message);
    });
  });

  // Heartbeat interval
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => clearInterval(interval));
}

async function broadcast(data) {
  const { videoId } = data;
  const message = JSON.stringify(data);

  console.log(`📡 Broadcasting: ${videoId}`);
  console.log(`👥 Connected clients:`, [...clients.keys()]);

  // ✅ เก็บใน Redis เผื่อ client ยังไม่ได้ connect
  try {
    await redis.set(`video-status:${videoId}`, message, { EX: 300 });
  } catch (err) {
    console.error("Redis set error:", err);
  }

  // ✅ ส่งเฉพาะ client ที่ subscribe videoId นั้น
  if (!clients.has(videoId)) {
    console.log(`⚠️ No client for ${videoId} — saved to Redis`);
    return;
  }

  clients.get(videoId).forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      console.log(`✅ Sent to client: ${videoId}`);
    }
  });
}

function getWSS() {
  return wss;
}

module.exports = { initWebSocket, broadcast, getWSS };
//เเบบไม่ใช่ room
// const WebSocket = require("ws");

// let wss = null;

// function initWebSocket(server) {

//   wss = new WebSocket.Server({ server });

//   console.log("WebSocket ready.");

//   wss.on("connection", (ws) => {

//     console.log("Client connected");

//     ws.isAlive = true;

//     ws.on("pong", () => {
//       ws.isAlive = true;
//     });

//     ws.on("message", (msg) => {
//       console.log("WS message:", msg.toString());
//     });

//     ws.on("close", () => {
//       console.log("Client disconnected");
//     });

//   });

//   const interval = setInterval(() => {

//     wss.clients.forEach((ws) => {

//       if (!ws.isAlive) return ws.terminate();

//       ws.isAlive = false;
//       ws.ping();

//     });

//   }, 30000);

//   wss.on("close", () => {
//     clearInterval(interval);
//   });

// }

// function broadcast(data) {

//   if (!wss) return;

//   wss.clients.forEach(client => {

//     if (client.readyState === WebSocket.OPEN) {
//       client.send(JSON.stringify(data));
//     }

//   });

// }

// function getWSS() {
//   return wss;
// }

// module.exports = {
//   initWebSocket,
//   broadcast,
//   getWSS
// };