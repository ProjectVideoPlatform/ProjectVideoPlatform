const redisClient = require('../config/redis');

const rateLimiter = (options = {}) => {
  const {
    windowMs = 60000,
    max = 10,
    message = 'Too many requests',
    keyPrefix = 'rate_limit'
  } = options;

  return async (req, res, next) => {
    try {
      const key = `${keyPrefix}:${req.ip || 'unknown'}:${req.path}`;
      const now = Date.now();

      // ✅ ioredis pipeline syntax ถูกต้องแล้ว
      const pipeline = redisClient.pipeline();
      pipeline.incr(key);
      pipeline.ttl(key);

      const results = await pipeline.exec();
      
      // ✅ ตรวจสอบผลลัพธ์ pipeline
      const count = results[0][1];  // incr result
      const ttl = results[1][1];     // ttl result

      // ถ้า key เพิ่งถูกสร้าง (ttl === -1) → ตั้ง expire
      if (ttl === -1) {
        await redisClient.expire(key, Math.ceil(windowMs / 1000));
        
        // หรือใช้ pipeline เดิมเลยก็ได้
        // pipeline.expire(key, Math.ceil(windowMs / 1000));
        // await pipeline.exec();
      }

      // Set headers
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

      if (count > max) {
        return res.status(429).json({
          error: message,
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil(windowMs / 1000)
        });
      }

      next();
    } catch (error) {
      // ✅ ใช้ logger แทน console.error
      console.error('Rate limiter error:', error);
      // Don't block the request if rate limiter fails
      next();
    }
  };
};

module.exports = rateLimiter;