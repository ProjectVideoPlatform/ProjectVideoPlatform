const crypto = require('crypto');
const redisClient = require('../config/redis');
const logger = require('../utils/logger');

const preventDuplicate = (prefix, options = {}) => {
  const {
    ttl = 15, // seconds
    errorMessage = 'Duplicate request detected. Please wait.'
  } = options;
  
  return async (req, res, next) => {
    try {
      const userId = req.user?._id?.toString();
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      let resourceId = '';
      
      // Determine resource ID based on request type
      if (req.params.id) {
        resourceId = req.params.id;
      } else if (Array.isArray(req.body.videoIds)) {
        const hash = crypto
          .createHash('sha1')
          .update(req.body.videoIds.sort().join(','))
          .digest('hex')
          .substring(0, 8);
        resourceId = hash;
      } else if (req.body.transactionId) {
        resourceId = req.body.transactionId;
      } else {
        resourceId = 'general';
      }
      
      const lockKey = `lock:${prefix}:${userId}:${resourceId}`;
      
      // ✅ แก้ไข: ใช้ syntax ที่ถูกต้องของ ioredis
      // วิธีที่ 1: ใช้ method แยก
      const acquired = await redisClient.set(
        lockKey, 
        'processing', 
        'EX', ttl,     // Expire ใน ttl วินาที
        'NX'           // Set only if not exists
      );
      
      // หรือ วิธีที่ 2: ใช้ object options (ioredis รองรับ)
      // const acquired = await redisClient.set(lockKey, 'processing', 'EX', ttl, 'NX');
      
      // หรือ วิธีที่ 3: ใช้ SETNX + EXPIRE แยกกัน (รองรับทุกเวอร์ชัน)
      // const exists = await redisClient.setnx(lockKey, 'processing');
      // if (exists === 1) {
      //   await redisClient.expire(lockKey, ttl);
      //   const acquired = true;
      // } else {
      //   const acquired = false;
      // }
      
      if (!acquired) {
        logger.warn(`Duplicate request blocked: ${lockKey}`, { userId, resourceId });
        return res.status(429).json({
          error: errorMessage,
          retryAfter: ttl,
          code: 'DUPLICATE_REQUEST'
        });
      }
      
      // Store lock info in request for cleanup if needed
      req.lockKey = lockKey;
      req.lockTtl = ttl;
      
      logger.debug(`Lock acquired: ${lockKey}`, { userId, resourceId });
      next();
      
    } catch (error) {
      logger.error('PreventDuplicate middleware error:', error);
      // Clean up lock if error occurred after acquiring
      if (req.lockKey) {
        await redisClient.del(req.lockKey).catch(e => logger.error('Failed to release lock:', e));
      }
      next(error);
    }
  };
};

module.exports = preventDuplicate;