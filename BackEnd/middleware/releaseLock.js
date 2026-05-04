const redisClient = require('../config/redis');
const logger = require('../utils/logger');

// Alternative: Express middleware style
const releaseLockMiddleware = (req, res, next) => {
  // ใช้เหตุการณ์ 'finish' เพื่อให้มั่นใจว่าทำงานหลังจากส่งข้อมูลให้ลูกค้าเสร็จแล้ว
  res.on('finish', async () => {
    if (req.lockKey) {
      try {
        await redisClient.del(req.lockKey);
        logger.debug(`Lock released after response finish: ${req.lockKey}`);
      } catch (error) {
        logger.error(`Failed to release lock ${req.lockKey}:`, error);
      }
    }
  });

  next(); // ส่งต่อไปยัง Controller ทันที ไม่ต้องรอให้ข้างบนทำงานเสร็จ
};

module.exports = { releaseLockMiddleware };