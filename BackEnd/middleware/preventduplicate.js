const preventDuplicate = (prefix) => {
  return async (req, res, next) => {
    const userId = req.user._id.toString();
    let resourceId = '';
    let type = '';

    // single purchase
    if (req.params.id) {
      resourceId = req.params.id;
      type = 'single';
    }
    // bulk purchase
    else if (Array.isArray(req.body.videoIds)) {
      const hash = crypto
        .createHash('sha1')
        .update(req.body.videoIds.sort().join(','))
        .digest('hex');
      resourceId = hash;
      type = 'bulk';
    }
    // fallback (payment-level)
    else if (req.body.transactionId) {
      resourceId = req.body.transactionId;
      type = 'payment';
    }
    // unknown
    else {
      resourceId = 'unknown';
      type = 'unknown';
    }

    const lockKey = `lock:${prefix}:${userId}:${resourceId}`;

    // Log สำหรับ debugging
    console.log(`[PreventDuplicate] User:${userId} Type:${type} Key:${lockKey}`);

    const acquired = await redisClient.set(lockKey, 'processing', {
      NX: true,
      EX: 15
    });

    if (!acquired) {
      console.log(`[PreventDuplicate] Blocked duplicate for ${lockKey}`);
      return res.status(429).json({
        error: 'Duplicate request detected. Please wait.',
        retryAfter: 15  // บอกว่าให้รอกี่วินาที
      });
    }

    req.lockKey = lockKey;
    req.lockType = type;
    next();
  };
};