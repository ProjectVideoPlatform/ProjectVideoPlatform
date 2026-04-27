// workers/trendingWorker.js
'use strict';

const cron        = require('node-cron');
const { clickhouse } = require('../config/clickhouse');
const redisClient    = require('../config/redis');
const logger         = require('../utils/logger');

const REDIS_KEY    = 'global:trending:videos';
const REDIS_TTL    = 3600;        // 1 ชม.
const TRENDING_LIMIT = 50;

async function refreshTrending() {
  try {
    const resultSet = await clickhouse.query({
      query: `
        SELECT
          video_id,
          countIf(event_type = 'play')      AS plays,
          countIf(event_type = 'completed') AS completions,
          uniq(session_id)                  AS unique_viewers
        FROM video_watch_events
        WHERE event_time >= now() - INTERVAL 24 HOUR
          AND watch_duration_seconds > 0
        GROUP BY video_id
        ORDER BY completions DESC, unique_viewers DESC
        LIMIT ${TRENDING_LIMIT}
      `,
      format: 'JSONEachRow',
    });

    const data     = await resultSet.json();
    const videoIds = data.map(r => r.video_id);

    if (videoIds.length === 0) {
      logger.info('[Trending] No data in last 24h, skipping.');
      return;
    }

    // ✅ เช็ค isOpen ก่อน — ป้องกัน connect ซ้ำ
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }

    const multi = redisClient.multi();
    multi.del(REDIS_KEY);
    multi.rPush(REDIS_KEY, videoIds);  // ✅ node-redis v4 ใช้ rPush (camelCase) + array โดยตรง
    multi.expire(REDIS_KEY, REDIS_TTL);
    await multi.exec();

    logger.info(`✅ [Trending] Refreshed ${videoIds.length} videos`);

  } catch (err) {
    logger.error('❌ [Trending] Refresh failed:', err);
  }
}

async function startWorker() {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }

    await refreshTrending();

    cron.schedule('*/10 * * * *', async () => {
      logger.info('[Trending] Scheduled refresh...');
      await refreshTrending();
    });

    logger.info('🚀 Trending worker ready.');

  } catch (err) {
    logger.error('❌ Failed to start trending worker:', err);
    process.exit(1);
  }
}

startWorker();