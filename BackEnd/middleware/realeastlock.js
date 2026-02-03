// สร้างไฟล์ใหม่ releaseLock.js
const releaseLock = async (req, res, next) => {
  try {
    await next();
  } finally {
    // ไม่ว่า success หรือ error จะลบ lock เสมอ
    if (req.lockKey) {
      await redisClient.del(req.lockKey).catch(console.error);
    }
  }
};

module.exports = releaseLock;