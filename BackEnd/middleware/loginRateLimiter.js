const redisClient = require('../config/redis');
const logger = require('../utils/logger');

// 1. Middleware สำหรับเช็คก่อนเริ่ม Login
const loginRateLimiter = async (req, res, next) => {
  const { email } = req.body;
  const ip = req.ip;
  if (!email) return next();

  const userKey = `rate:user:${email}`;
  const ipKey = `rate:ip:${ip}`;

  try {
    // ดึงค่าพร้อมกันเพื่อลด Latency
    const [blocked, userAttempts, ipAttempts] = await Promise.all([
      redisClient.get(`blocked:${ip}`),
      redisClient.get(userKey),
      redisClient.get(ipKey)
    ]);

    if (blocked) {
      return res.status(429).json({ error: 'Access denied. Too many failed attempts.' });
    }

    if (parseInt(userAttempts) >= 5 || parseInt(ipAttempts) >= 20) {
      logger.warn(`Rate limit exceeded: ${email} from ${ip}`);
      
      // logic การนับเพื่อบล็อก IP ถาวร (24 ชม.)
      const blockCount = await redisClient.incr(`blockcount:${ip}`);
      if (blockCount === 1) await redisClient.expire(`blockcount:${ip}`, 86400);
      if (blockCount >= 50) await redisClient.setex(`blocked:${ip}`, 86400, '1');

      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }

    next();
  } catch (error) {
    logger.error('Rate limiter error:', error);
    next(); // Fail-open
  }
};

// 2. Helper สำหรับบันทึกเมื่อ Login พลาด
const recordFailedAttempt = async (email, ip) => {
  try {
    console.log(`Recording failed login for ${email} from IP ${ip}`);
    const userKey = `rate:user:${email}`;
    const ipKey = `rate:ip:${ip}`;

    // ใช้ Pipeline/Multi เพื่อความเร็วและชัวร์ว่า expire จะถูกตั้งค่า
    await redisClient.multi()
      .incr(userKey).expire(userKey, 3600)
      .incr(ipKey).expire(ipKey, 3600)
      .exec();

    logger.debug(`Failed login recorded: ${email} [${ip}]`);
  } catch (error) {
    logger.error('Record failed attempt error:', error);
  }
};

// 3. Helper สำหรับล้างเมื่อ Login สำเร็จ
const clearFailedAttempts = async (email, ip) => {
  try {
    await redisClient.del(`rate:user:${email}`, `rate:ip:${ip}`);
  } catch (error) {
    logger.error('Clear failed attempts error:', error);
  }
};

module.exports = { loginRateLimiter, recordFailedAttempt, clearFailedAttempts };