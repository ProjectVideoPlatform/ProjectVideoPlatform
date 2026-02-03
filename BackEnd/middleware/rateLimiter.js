// middleware/rateLimiter.js (Simple)
const redisClient = require('../config/redis');

const rateLimiter = (options = {}) => {
  const {
    windowMs = 60000, // 1 minute
    max = 10,         // 10 requests per minute
    message = 'Too many requests',
    keyPrefix = 'rate_limit'
  } = options;
  
  return async (req, res, next) => {
    try {
      // สร้าง key จาก IP + route
      const key = `${keyPrefix}:${req.ip || 'unknown'}:${req.path}`;
      const now = Date.now();
      
      // ใช้ Redis pipeline สำหรับ performance
      const pipeline = redisClient.pipeline();
      
      // เพิ่ม request count
      pipeline.incr(key);
      
      // ตั้ง expire ถ้าเป็น request แรก
      pipeline.ttl(key);
      
      const results = await pipeline.exec();
      const count = results[0][1];
      const ttl = results[1][1];
      
      // ถ้าไม่มี TTL (request แรก) → ตั้ง TTL
      if (ttl === -1) {
        await redisClient.expire(key, Math.ceil(windowMs / 1000));
      }
      
      // ตั้งค่า headers
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));
      
      // ตรวจสอบว่าเกิน limit ไหม
      if (count > max) {
        return res.status(429).json({
          error: message,
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil(windowMs / 1000)
        });
      }
      
      next();
    } catch (error) {
      console.error('Rate limiter error:', error);
      // ถ้า Redis ล้ม → ปล่อยผ่าน
      next();
    }
  };
};

module.exports = rateLimiter;