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

      // ioredis pipeline (เร็วกว่า multi สำหรับ non-transactional)
      const pipeline = redisClient.pipeline();
      pipeline.incr(key);
      pipeline.ttl(key);

      // ioredis: exec() คืน [[err, val], [err, val], ...]
      const results = await pipeline.exec();
      const [incrErr, count] = results[0];
      const [ttlErr,  ttl]   = results[1];

      if (incrErr) throw incrErr;
      if (ttlErr)  throw ttlErr;

      // ถ้า key เพิ่งถูกสร้าง (ttl === -1) → ตั้ง expire
      if (ttl === -1) {
        await redisClient.expire(key, Math.ceil(windowMs / 1000));
      }

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
      console.error('Rate limiter error:', error);
      next();
    }
  };
};

module.exports = rateLimiter;