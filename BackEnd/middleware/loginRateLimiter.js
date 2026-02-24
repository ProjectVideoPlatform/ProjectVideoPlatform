const redisClient = require('../config/redis');
const logger = require('../utils/logger');

// 1. Middleware สำหรับเช็คก่อนเริ่ม Login
const loginRateLimiter = async (req, res, next) => {
  const { email } = req.body;
  const ip = req.ip;
  
  if (!email) return next();

  const userKey = `rate:user:${email}`;
  const ipKey = `rate:ip:${ip}`;
  const blockKey = `block:${ip}`;  // เปลี่ยนจาก blocked เป็น block เพื่อให้สอดคล้อง
  const waitKey = `wait:${email}`; // เพิ่มคีย์สำหรับรอ

  try {
    // 1. เช็คว่าถูกบล็อกหรือไม่
    const blocked = await redisClient.get(blockKey);
    if (blocked) {
      const ttl = await redisClient.ttl(blockKey);
      return res.status(429).json({ 
        error: 'Account temporarily locked. Too many failed attempts.',
        retryAfter: ttl,
        message: `Please try again in ${Math.ceil(ttl / 60)} minutes`
      });
    }

    // 2. เช็คว่าต้องรอหรือไม่ (กรณีเกิน limit แล้ว)
    const waitTime = await redisClient.get(waitKey);
    if (waitTime) {
      const ttl = await redisClient.ttl(waitKey);
      return res.status(429).json({
        error: 'Too many attempts. Please wait before trying again.',
        retryAfter: ttl,
        message: `Please try again in ${ttl} seconds`
      });
    }

    // 3. ดึงค่า attempts ปัจจุบัน
    const [userAttempts, ipAttempts] = await Promise.all([
      redisClient.get(userKey),
      redisClient.get(ipKey)
    ]);

    const userCount = parseInt(userAttempts) || 0;
    const ipCount = parseInt(ipAttempts) || 0;

    logger.debug(`Login attempt for ${email} from IP ${ip} - User attempts: ${userCount}, IP attempts: ${ipCount}`);

    // 4. เช็คขีดจำกัด
    if (userCount >= 5 || ipCount >= 20) {
      logger.warn(`Rate limit exceeded: ${email} from ${ip}`);
      
      // ถ้าเกิน limit ให้ตั้งค่ารอ 1 ชั่วโมง
      await redisClient.setex(waitKey, 3600, '1'); // รอ 1 ชั่วโมง
      
      // บล็อก IP ถ้าพยายามมากเกินไป (50+ ครั้ง)
      try {
        const blockCount = await redisClient.incr(`blockcount:${ip}`);
        if (blockCount === 1) {
          await redisClient.expire(`blockcount:${ip}`, 86400);
        }
        if (blockCount >= 50) {
          await redisClient.setex(blockKey, 86400, '1'); // บล็อก 24 ชั่วโมง
        }
      } catch (blockError) {
        logger.error('Error blocking IP:', blockError);
      }

      return res.status(429).json({ 
        error: 'Too many attempts. Please try again later.',
        retryAfter: 3600,
        message: 'Your account has been temporarily locked for 1 hour due to too many failed attempts.'
      });
    }

    next();
  } catch (error) {
    logger.error('Rate limiter error:', error);
    next();
  }
};

// 2. Helper สำหรับบันทึกเมื่อ Login พลาด
const recordFailedAttempt = async (email, ip) => {
  try {
    logger.debug(`Recording failed login for ${email} from IP ${ip}`);
    
    const userKey = `rate:user:${email}`;
    const ipKey = `rate:ip:${ip}`;

    const pipeline = redisClient.pipeline();
    pipeline.incr(userKey);
    pipeline.expire(userKey, 3600);
    pipeline.incr(ipKey);
    pipeline.expire(ipKey, 3600);
    
    const results = await pipeline.exec();
    
    const userAttempts = results[0][1];
    const ipAttempts = results[2][1];

    // ถ้าถึง limit ให้ตั้งค่ารอทันที
    if (userAttempts >= 5 || ipAttempts >= 20) {
      const waitKey = `wait:${email}`;
      await redisClient.setex(waitKey, 3600, '1');
      logger.warn(`Rate limit triggered for ${email} - setting wait period`);
    }

    logger.info(`Failed login recorded: ${email} [${ip}] - User: ${userAttempts}, IP: ${ipAttempts}`);
    await debugRedisKeys(email, ip);
    
    return { userAttempts, ipAttempts };
  } catch (error) {
    logger.error('Record failed attempt error:', error);
    return { userAttempts: 0, ipAttempts: 0 };
  }
};

// 3. Helper สำหรับล้างเมื่อ Login สำเร็จ
const clearFailedAttempts = async (email, ip) => {
  try {
    // ต้องล้างทั้ง attempts และ wait key
    await redisClient.del(
      `rate:user:${email}`, 
      `rate:ip:${ip}`,
      `wait:${email}`  // ล้าง wait key ด้วย
    );
    
    logger.info(`Cleared all rate limit data for ${email} from ${ip}`);
    await debugRedisKeys(email, ip);
  } catch (error) {
    logger.error('Clear failed attempts error:', error);
  }
};

// 4. Debug function
const debugRedisKeys = async (email, ip) => {
  try {
    const userKey = `rate:user:${email}`;
    const ipKey = `rate:ip:${ip}`;
    const blockKey = `block:${ip}`;
    const blockCountKey = `blockcount:${ip}`;
    const waitKey = `wait:${email}`;
    
    const pipeline = redisClient.pipeline();
    pipeline.get(userKey);
    pipeline.ttl(userKey);
    pipeline.get(ipKey);
    pipeline.ttl(ipKey);
    pipeline.get(blockKey);
    pipeline.ttl(blockKey);
    pipeline.get(blockCountKey);
    pipeline.get(waitKey);
    pipeline.ttl(waitKey);
    
    const results = await pipeline.exec();
    
    console.log('\n=== Redis Rate Limit Debug ===');
    console.log(`User (${userKey}): ${results[0][1] || 0} (TTL: ${results[1][1]}s)`);
    console.log(`IP (${ipKey}): ${results[2][1] || 0} (TTL: ${results[3][1]}s)`);
    console.log(`Block: ${results[4][1] || 'No'} (TTL: ${results[5][1]}s)`);
    console.log(`Block Count: ${results[6][1] || 0}`);
    console.log(`Wait (${waitKey}): ${results[7][1] || 'No'} (TTL: ${results[8][1]}s)`);
    console.log('==============================\n');
  } catch (error) {
    console.error('Debug error:', error.message);
  }
};

module.exports = { 
  loginRateLimiter, 
  recordFailedAttempt, 
  clearFailedAttempts,
  debugRedisKeys 
};