// workers/trendingWorker.js
const cron = require('node-cron');
const { clickhouse } = require('../config/clickhouse');
const redisClient = require('../config/redis'); // ✅ ใช้ singleton ที่คุณส่งมา
const logger = require('../utils/logger');

async function refreshTrending() {
  try {
    // 1. ดึงข้อมูลจาก ClickHouse
    // ใช้ FINAL เพื่อให้แน่ใจว่าได้ข้อมูลล่าสุดที่รวมร่าง (Merge) แล้ว
    const resultSet = await clickhouse.query({
      query: `
        SELECT
          video_id,
          countIf(event_type = 'play')      AS plays,
          countIf(event_type = 'completed') AS completions,
          uniq(session_id)                  AS unique_viewers
        FROM app_db.video_watch_events
        WHERE event_time >= now() - INTERVAL 24 HOUR
          AND watch_duration_seconds > 0
        GROUP BY video_id
        ORDER BY completions DESC, unique_viewers DESC
        LIMIT 50
      `,
      format: 'JSONEachRow'
    });

    const data = await resultSet.json();
    const videoIds = data.map(r => r.video_id);

    if (videoIds.length === 0) {
      logger.info('[Trending] No data found in the last 24h, skipping refresh.');
      return;
    }

    // 2. ใช้ Multi (Pipeline) เพื่อทำ Atomic Replace
    // เราเรียกใช้ .multi() จาก singleton ซึ่งจะส่งคืน ioredis multi object
    const multi = redisClient.multi();
    
    const REDIS_KEY = 'global:trending:videos';
    
    multi.del(REDIS_KEY);
    multi.rpush(REDIS_KEY, ...videoIds); // ใช้ spread operator เพื่อ push ทั้ง list
    multi.expire(REDIS_KEY, 3600);       // ตั้ง TTL ไว้ 1 ชม. กันข้อมูลค้างถ้า worker พัง
    
    await multi.exec();

    logger.info(`✅ [Trending] Refreshed: ${videoIds.length} videos`);
  } catch (error) {
    logger.error('❌ [Trending] Error refreshing trending:', error);
  }
}

// เริ่มต้นระบบ
async function startWorker() {
  try {
    // เชื่อมต่อ Redis ก่อนเริ่มรัน
    await redisClient.connect();
    
    // รันทันที 1 ครั้งตอนเริ่ม
    await refreshTrending();

    // ตั้งเวลาทำงานทุกๆ 10 นาที
    cron.schedule('*/10 * * * *', async () => {
      logger.info('[Trending] Running scheduled refresh...');
      await refreshTrending();
    });

    logger.info('🚀 Trending worker is ready and scheduled.');
  } catch (err) {
    logger.error('Failed to start Trending worker:', err);
    process.exit(1);
  }
}

startWorker();