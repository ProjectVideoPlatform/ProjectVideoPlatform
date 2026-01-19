const crypto = require('crypto');
const redisClient = require('../config/redis');

const preventDuplicate = (prefix) => {
  return async (req, res, next) => {
    const userId = req.user._id.toString();

    let resourceId = '';

    // single purchase
    if (req.params.id) {
      resourceId = req.params.id;
    }

    // bulk purchase
    else if (Array.isArray(req.body.videoIds)) {
      const hash = crypto
        .createHash('sha1')
        .update(req.body.videoIds.sort().join(','))
        .digest('hex');
      resourceId = hash;
    }

    // fallback (payment-level)
    else if (req.body.transactionId) {
      resourceId = req.body.transactionId;
    }

    const lockKey = `lock:${prefix}:${userId}:${resourceId}`;

    const acquired = await redisClient.set(lockKey, 'processing', {
      NX: true,
      EX: 15
    });

    if (!acquired) {
      return res.status(429).json({
        error: 'Duplicate request detected. Please wait.'
      });
    }

    req.lockKey = lockKey;
    next();
  };
};

module.exports = preventDuplicate;
