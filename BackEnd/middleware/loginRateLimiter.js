const redisClient = require('../config/redis');
const logger = require('../utils/logger');

// ── config ──────────────────────────────────────────────
const RATE_LIMIT = {
  maxUserAttempts:  10,
  maxIpAttempts:    30,
  softLockSec:      15 * 60,
  hardBlockSec:     60 * 60,
  hardBlockTrigger: 100,
  counterTtlSec:    60 * 60,
  blockCountTtlSec: 24 * 60 * 60,
};

// ── helpers ─────────────────────────────────────────────
const formatTtlMessage = (ttlSeconds) => {
  if (!ttlSeconds || ttlSeconds <= 0) return 'Please try again later.';

  const hours   = Math.floor(ttlSeconds / 3600);
  const minutes = Math.ceil((ttlSeconds % 3600) / 60);

  if (hours > 0 && minutes > 0) {
    return `Your account is locked. Please try again in ${hours} hour${hours > 1 ? 's' : ''} and ${minutes} minute${minutes > 1 ? 's' : ''}.`;
  }
  if (hours > 0) {
    return `Your account is locked. Please try again in ${hours} hour${hours > 1 ? 's' : ''}.`;
  }
  return `Your account is locked. Please try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`;
};

const formatLockResponse = (type, ttlSeconds) => {
  const hours   = Math.floor(ttlSeconds / 3600);
  const minutes = Math.ceil((ttlSeconds % 3600) / 60);

  let timeStr = '';
  if (hours > 0 && minutes > 0) {
    timeStr = `${hours} hour${hours > 1 ? 's' : ''} and ${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else if (hours > 0) {
    timeStr = `${hours} hour${hours > 1 ? 's' : ''}`;
  } else {
    timeStr = `${minutes} minute${minutes > 1 ? 's' : ''}`;
  }

  if (type === 'ip') {
    return {
      error: 'Your IP has been temporarily blocked due to too many failed attempts.',
      retryAfter: ttlSeconds,
      retryAfterMinutes: Math.ceil(ttlSeconds / 60),
      message: `Access from your IP is blocked. Please try again in ${timeStr}.`,
    };
  }

  return {
    error: 'Your account has been temporarily locked due to too many failed login attempts.',
    retryAfter: ttlSeconds,
    retryAfterMinutes: Math.ceil(ttlSeconds / 60),
    message: `Please try again in ${timeStr}.`,
  };
};

// ── middleware ───────────────────────────────────────────
const loginRateLimiter = async (req, res, next) => {
  const { email } = req.body;
  const ip = req.ip;

  if (!email) return next();

  const userKey  = `rate:user:${email}`;
  const ipKey    = `rate:ip:${ip}`;
  const blockKey = `block:${ip}`;
  const waitKey  = `wait:${email}`;

  try {
    const pipeline = redisClient.pipeline();
    pipeline.get(blockKey);
    pipeline.ttl(blockKey);
    pipeline.get(waitKey);
    pipeline.ttl(waitKey);
    pipeline.get(userKey);
    pipeline.get(ipKey);

    const results = await pipeline.exec();
    const [
      [, blocked],  [, blockTtl],
      [, waiting],  [, waitTtl],
      [, userVal],  [, ipVal],
    ] = results;

    // 1. IP hard block
    if (blocked) {
      let ttl = blockTtl;
      if (ttl < 0) {
        await redisClient.expire(blockKey, RATE_LIMIT.hardBlockSec);
        ttl = RATE_LIMIT.hardBlockSec;
        logger.warn(`Fixed missing TTL on blockKey for ${ip}`);
      }
      return res.status(429).json(formatLockResponse('ip', ttl));
    }

    // 2. Email soft lock
    if (waiting) {
      let ttl = waitTtl;
      if (ttl < 0) {
        await redisClient.expire(waitKey, RATE_LIMIT.softLockSec);
        ttl = RATE_LIMIT.softLockSec;
        logger.warn(`Fixed missing TTL on waitKey for ${email}`);
      }
      return res.status(429).json(formatLockResponse('email', ttl));
    }

    // 3. เช็ค attempt count
    const userCount = parseInt(userVal) || 0;
    const ipCount   = parseInt(ipVal)   || 0;

    logger.debug(`Login attempt: ${email} from ${ip} — user: ${userCount}/${RATE_LIMIT.maxUserAttempts}, ip: ${ipCount}/${RATE_LIMIT.maxIpAttempts}`);

    if (userCount >= RATE_LIMIT.maxUserAttempts || ipCount >= RATE_LIMIT.maxIpAttempts) {
      logger.warn(`Rate limit exceeded: ${email} from ${ip}`);

      await redisClient.set(waitKey, '1', 'EX', RATE_LIMIT.softLockSec);

      try {
        const blockCountKey = `blockcount:${ip}`;
        const blockCount = await redisClient.incr(blockCountKey);
        if (blockCount === 1) await redisClient.expire(blockCountKey, RATE_LIMIT.blockCountTtlSec);
        if (blockCount >= RATE_LIMIT.hardBlockTrigger) {
          await redisClient.set(blockKey, '1', 'EX', RATE_LIMIT.hardBlockSec);
          logger.warn(`IP ${ip} hard blocked for 1h (blockcount: ${blockCount})`);
        }
      } catch (blockError) {
        logger.error('Error updating block count:', blockError);
      }

      return res.status(429).json(formatLockResponse('email', RATE_LIMIT.softLockSec));
    }

    // แจ้งเตือนล่วงหน้าเมื่อใกล้ถึง limit
    const attemptsLeft = RATE_LIMIT.maxUserAttempts - userCount;
    if (attemptsLeft <= 3) {
      res.setHeader('X-RateLimit-Warning', `${attemptsLeft} attempt${attemptsLeft > 1 ? 's' : ''} remaining before account lockout`);
    }

    next();
  } catch (error) {
    logger.error('Rate limiter error:', error);
    next();
  }
};

// ── record / clear ───────────────────────────────────────
const recordFailedAttempt = async (email, ip) => {
  try {
    const userKey = `rate:user:${email}`;
    const ipKey   = `rate:ip:${ip}`;
    const waitKey = `wait:${email}`;

    const userAttempts = await redisClient.incr(userKey);
    if (userAttempts === 1) await redisClient.expire(userKey, RATE_LIMIT.counterTtlSec);

    const ipAttempts = await redisClient.incr(ipKey);
    if (ipAttempts === 1) await redisClient.expire(ipKey, RATE_LIMIT.counterTtlSec);

    if (userAttempts >= RATE_LIMIT.maxUserAttempts || ipAttempts >= RATE_LIMIT.maxIpAttempts) {
      await redisClient.set(waitKey, '1', 'EX', RATE_LIMIT.softLockSec);
      logger.warn(`Wait period set for ${email}`);
    }

    logger.info(`Failed login: ${email} [${ip}] — user: ${userAttempts}, ip: ${ipAttempts}`);

    if (process.env.NODE_ENV === 'development') {
      await debugRedisKeys(email, ip);
    }

    return { userAttempts, ipAttempts };
  } catch (error) {
    logger.error('Record failed attempt error:', error);
    return { userAttempts: 0, ipAttempts: 0 };
  }
};

const clearFailedAttempts = async (email, ip) => {
  try {
    await redisClient.del(
      `rate:user:${email}`,
      `rate:ip:${ip}`,
      `wait:${email}`
    );
    logger.info(`Cleared rate limit data for ${email} from ${ip}`);

    if (process.env.NODE_ENV === 'development') {
      await debugRedisKeys(email, ip);
    }
  } catch (error) {
    logger.error('Clear failed attempts error:', error);
  }
};

// ── debug ────────────────────────────────────────────────
const debugRedisKeys = async (email, ip) => {
  try {
    const keys = {
      user:       `rate:user:${email}`,
      ip:         `rate:ip:${ip}`,
      block:      `block:${ip}`,
      blockCount: `blockcount:${ip}`,
      wait:       `wait:${email}`,
    };

    const pipeline = redisClient.pipeline();
    pipeline.get(keys.user);
    pipeline.ttl(keys.user);
    pipeline.get(keys.ip);
    pipeline.ttl(keys.ip);
    pipeline.get(keys.block);
    pipeline.ttl(keys.block);
    pipeline.get(keys.blockCount);
    pipeline.get(keys.wait);
    pipeline.ttl(keys.wait);

    const results = await pipeline.exec();
    const v = results.map(([err, val]) => (err ? null : val));

    console.log('\n=== Redis Rate Limit Debug ===');
    console.log(`User       : ${v[0] || 0} (TTL: ${v[1]}s)`);
    console.log(`IP         : ${v[2] || 0} (TTL: ${v[3]}s)`);
    console.log(`Block      : ${v[4] || 'No'} (TTL: ${v[5]}s)`);
    console.log(`Block Count: ${v[6] || 0}`);
    console.log(`Wait       : ${v[7] || 'No'} (TTL: ${v[8]}s)`);
    console.log('==============================\n');
  } catch (error) {
    console.error('Debug error:', error.message);
  }
};

// ── exports ──────────────────────────────────────────────
module.exports = {
  loginRateLimiter,
  recordFailedAttempt,
  clearFailedAttempts,
  debugRedisKeys,
};