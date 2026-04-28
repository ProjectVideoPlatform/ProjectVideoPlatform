'use strict';

const http        = require('http');
const cron        = require('node-cron');
const { clickhouse } = require('../config/clickhouse');
const redisClient = require('../config/redis');
const logger      = require('../utils/logger');

const REDIS_KEY      = 'global:trending:videos';
const REDIS_TTL      = 3600;
const TRENDING_LIMIT = 50;

// ─── State ────────────────────────────────────────────────────────────────────
//
//  health endpoint เช็คสิ่งที่ trendingWorker ใช้จริง:
//    - lastRunSuccess: cron รอบล่าสุด success ไหม
//    - lastRunAt:      รอบล่าสุดรันเมื่อไหร่ (ถ้าเกิน 15 นาที = stale = unhealthy)
//    - isShuttingDown: กำลัง shutdown อยู่ไหม
//
let lastRunSuccess = false;
let lastRunAt      = null;
let isShuttingDown = false;

// ─── Core logic ───────────────────────────────────────────────────────────────
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

    if (!videoIds.length) {
      logger.info('[Trending] No data in last 24h, skipping Redis update.');
      // ไม่ update Redis แต่ยัง mark success เพราะ query ทำงานปกติ
      lastRunSuccess = true;
      lastRunAt      = Date.now();
      return;
    }

    if (!redisClient.isOpen) {
      await redisClient.connect();
    }

    // atomic: del + push + expire ใน transaction เดียว
    const multi = redisClient.multi();
    multi.del(REDIS_KEY);
    multi.rPush(REDIS_KEY, videoIds);
    multi.expire(REDIS_KEY, REDIS_TTL);
    await multi.exec();

    lastRunSuccess = true;
    lastRunAt      = Date.now();

    logger.info(`✅ [Trending] Refreshed ${videoIds.length} videos`);
  } catch (err) {
    lastRunSuccess = false;
    lastRunAt      = Date.now(); // ✅ update เวลาแม้ fail — เพื่อให้รู้ว่า cron ยังรันอยู่
    logger.error('❌ [Trending] Refresh failed:', err);
    // ไม่ throw → cron รอบต่อไปยังทำงาน
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
async function startWorker() {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }

    // รันทันทีตอนเริ่ม
    await refreshTrending();

    // cron ทุก 10 นาที — ครอบ try/catch แยกต่างหาก
    // crash ใน cron 1 รอบ ไม่ kill process ทั้งหมด
    cron.schedule('*/10 * * * *', async () => {
      try {
        logger.info('[Trending] Scheduled refresh...');
        await refreshTrending();
      } catch (err) {
        // refreshTrending ไม่ throw แต่ถ้า cron framework throw เอง catch ไว้ที่นี่
        logger.error('[Trending] Cron crashed unexpectedly:', err);
        lastRunSuccess = false;
      }
    });

    logger.info('🚀 Trending worker ready.');
  } catch (err) {
    logger.error('❌ Failed to start trending worker:', err);
    process.exit(1);
  }
}

// ─── Health endpoint ──────────────────────────────────────────────────────────
//
//  unhealthy เมื่อ:
//    1. กำลัง shutdown
//    2. รันครั้งล่าสุดแล้ว fail
//    3. ไม่ได้รันมานานกว่า 15 นาที (cron หยุดทำงานโดยไม่รู้ตัว)
//
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 นาที

http.createServer((req, res) => {
  if (req.url !== '/health') {
    res.writeHead(404).end();
    return;
  }

  const isStale = lastRunAt !== null
    && (Date.now() - lastRunAt) > STALE_THRESHOLD_MS;

  const healthy = !isShuttingDown && lastRunSuccess && !isStale;

  res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status:        healthy ? 'ok' : 'unhealthy',
    lastRunAt:     lastRunAt ? new Date(lastRunAt).toISOString() : null,
    lastRunSuccess,
    isStale,
    isShuttingDown,
  }));
}).listen(3099, () => {
  logger.info('[Trending] Health endpoint listening on :3099');
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info('[Trending] Shutting down gracefully...');
  try {
    if (redisClient.isOpen) await redisClient.quit();
    process.exit(0);
  } catch (err) {
    logger.error('[Trending] Shutdown error:', err.message);
    process.exit(1);
  }
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

startWorker();