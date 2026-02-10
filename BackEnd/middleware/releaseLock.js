const redisClient = require('../config/redis');
const logger = require('../utils/logger');

const releaseLock = async (req, res, next) => {
  try {
    await next();
  } catch (error) {
    // Pass error to error handler
    throw error;
  } finally {
    // Always release lock in finally block
    if (req.lockKey) {
      try {
        await redisClient.del(req.lockKey);
        logger.debug(`Lock released: ${req.lockKey}`);
      } catch (error) {
        logger.error(`Failed to release lock ${req.lockKey}:`, error);
      }
    }
  }
};

// Alternative: Express middleware style
const releaseLockMiddleware = (req, res, next) => {
  const originalEnd = res.end;
  
  res.end = function(...args) {
    // Release lock when response ends
    releaseLock(req).finally(() => {
      originalEnd.apply(res, args);
    });
  };
  
  next();
};

module.exports = { releaseLock, releaseLockMiddleware };