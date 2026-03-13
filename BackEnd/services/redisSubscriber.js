const redis = require("../config/redis");
const { broadcast } = require("../websocket");

async function startRedisSubscriber() {
  await redis.subscribe("video-status", (data) => {
    console.log("Redis event:", data);

    // ✅ parse ถ้า data เป็น string
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    broadcast(parsed);
  });
}

module.exports = { startRedisSubscriber };