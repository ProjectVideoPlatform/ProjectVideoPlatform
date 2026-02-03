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
        // Single purchase
        resourceId = req.params.id;
      } else if (Array.isArray(req.body.videoIds)) {
        // Bulk purchase
        const hash = crypto
          .createHash('sha1')
          .update(req.body.videoIds.sort().join(','))
          .digest('hex')
          .substring(0, 8);
        resourceId = hash;
      } else if (req.body.transactionId) {
        // Payment-level
        resourceId = req.body.transactionId;
      } else {
        resourceId = 'general';
      }
      
      const lockKey = `lock:${prefix}:${userId}:${resourceId}`;
      
      // Try to acquire lock
      const acquired = await redisClient.set(lockKey, 'processing', {
        NX: true,
        EX: ttl
      });
      
      if (!acquired) {
        logger.warn(`Duplicate request blocked: ${lockKey}`, { userId });
        return res.status(429).json({
          error: errorMessage,
          retryAfter: ttl,
          code: 'DUPLICATE_REQUEST'
        });
      }
      
      req.lockKey = lockKey;
      req.lockTtl = ttl;
      
      logger.debug(`Lock acquired: ${lockKey}`, { userId });
      next();
      
    } catch (error) {
      logger.error('PreventDuplicate middleware error:', error);
      next(error);
    }
  };
};

module.exports = preventDuplicate;