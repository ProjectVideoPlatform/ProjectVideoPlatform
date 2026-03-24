const WebSocket = require("ws");
const redis = require("./config/redis"); 

let wss = null;
const clients = new Map(); // videoId -> Set of ws

// แยก Channel ให้ชัดเจน
const ROOM_REDIS_CHANNEL = "video-broadcast-events"; 
const GLOBAL_REDIS_CHANNEL = "global-broadcast-events"; // ✅ เพิ่มช่องสำหรับประกาศให้ทุกคน

function initWebSocket(server) {
  wss = new WebSocket.Server({ server });
  console.log("WebSocket ready.");

  // ==========================================
  // 🎧 1. ดักฟัง Event ห้อง (Room Broadcast)
  // ==========================================
  redis.subscribe(ROOM_REDIS_CHANNEL, (payload) => {
    const { videoId, data } = payload;
    const message = JSON.stringify({ type: "room_event", data });
    
    if (clients.has(videoId)) {
      clients.get(videoId).forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(message);
      });
    }
  });

  // ==========================================
  // 🎧 2. ดักฟัง Event ส่วนกลาง (Global Broadcast) ✅
  // ==========================================
  redis.subscribe(GLOBAL_REDIS_CHANNEL, (payload) => {
    // payload ในที่นี้คือข้อมูลประกาศส่วนกลาง
    const message = JSON.stringify({ type: "global_event", data: payload.data });
    
    // วนลูปส่งให้ "ทุกคน" ที่เชื่อมต่ออยู่กับ Server เครื่องนี้
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  });

  // ==========================================
  // จัดการ Connection ทั่วไป (เหมือนเดิม)
  // ==========================================
  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const videoId = url.searchParams.get("videoId");

    if (!videoId) {
      ws.close(1008, "videoId required");
      return;
    }

    if (!clients.has(videoId)) clients.set(videoId, new Set());
    clients.get(videoId).add(ws);

    // ดึง Cache ของห้อง (เหมือนเดิม)
    try {
      const cacheKey = `video-status:${videoId}`;
      const cachedMessages = await redis.lRange(cacheKey, 0, -1);
      if (cachedMessages && cachedMessages.length > 0) {
        cachedMessages.forEach(msg => {
          if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        });
        await redis.del(cacheKey);
      }
    } catch (err) {
      console.error("Redis cache error:", err);
    }

    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("close", () => {
      clients.get(videoId)?.delete(ws);
      if (clients.get(videoId)?.size === 0) clients.delete(videoId);
    });
  });

  // Heartbeat interval (เหมือนเดิม)
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => clearInterval(interval));
}

// ==========================================
// 📢 ฟังก์ชันสำหรับส่งเข้าห้อง (Room)
// ==========================================
async function broadcast(data) {
  const { videoId } = data;
  const message = JSON.stringify({ type: "room_event", data });

  try {
    const cacheKey = `video-status:${videoId}`;
    await redis.rPush(cacheKey, message);
    await redis.expire(cacheKey, 300); 
  } catch (err) {
    console.error("Redis cache set error:", err);
  }

  try {
    await redis.publish(ROOM_REDIS_CHANNEL, { videoId, data });
  } catch (err) {
    console.error("Redis publish error:", err);
  }
}

// ==========================================
// 📢 ฟังก์ชันสำหรับส่งหาทุกคน (Global) ✅
// ==========================================
async function broadcastToAll(data) {
  console.log(`🌍 Global Broadcasting:`, data);
  
  // ประกาศลงช่อง Global ให้ Server ทุกเครื่องรับรู้
  try {
    await redis.publish(GLOBAL_REDIS_CHANNEL, { data });
    
    // หมายเหตุ: งาน Global มักจะเป็นการประกาศสดแบบ Real-time 
    // จึงไม่นิยมเก็บ Cache แบบ Room เว้นแต่จะมี requirement พิเศษครับ
  } catch (err) {
    console.error("Redis global publish error:", err);
  }
}

function getWSS() {
  return wss;
}

module.exports = { initWebSocket, broadcast, broadcastToAll, getWSS };