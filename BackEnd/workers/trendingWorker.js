'use strict';

const http           = require('http');
const { clickhouse } = require('../config/clickhouse');
const redisClient    = require('../config/redis');
const logger         = require('../utils/logger');

const REDIS_KEY      = 'global:trending:videos';
const REDIS_TTL      = 3600;
const TRENDING_LIMIT = 50;

let lastRunSuccess = false;
let lastRunAt      = null;
let isShuttingDown = false;
let isRunning      = false;
let totalRuns      = 0;      // ✅ นับรอบทั้งหมด
let totalSuccess   = 0;      // ✅ นับรอบที่สำเร็จ
let totalFailed    = 0;      // ✅ นับรอบที่ fail

// ─── Core logic ───────────────────────────────────────────────────────────────
async function refreshTrending() {
  if (isRunning) {
    logger.warn('[Trending] Previous run still in progress, skipping...');
    return;
  }

  isRunning = true;
  totalRuns++;
  const runId     = totalRuns;
  const startTime = Date.now();

  logger.info(`[Trending] ▶ Run #${runId} starting...`);

  try {
    // ── ClickHouse query ──────────────────────────────────
    logger.info(`[Trending] #${runId} Querying ClickHouse (limit=${TRENDING_LIMIT}, window=24h)...`);

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
      query_params: {},
      clickhouse_settings: { max_execution_time: 30 },
    });

    const data     = await resultSet.json();
    const videoIds = data.map(r => r.video_id);
    const queryMs  = Date.now() - startTime;

    logger.info(`[Trending] #${runId} ClickHouse done in ${queryMs}ms | rows=${data.length} | videoIds=${videoIds.length}`);

    // log top 5 เพื่อ debug
    data.slice(0, 5).forEach((row, i) => {
      logger.info(`[Trending] #${runId}   top${i + 1}: video=${row.video_id} plays=${row.plays} completions=${row.completions} viewers=${row.unique_viewers}`);
    });

    if (!videoIds.length) {
      logger.warn(`[Trending] #${runId} No data in last 24h — Redis not updated`);
      lastRunSuccess = true;
      lastRunAt      = Date.now();
      totalSuccess++;
      return;
    }

    // ── Redis update ──────────────────────────────────────
    logger.info(`[Trending] #${runId} Updating Redis key="${REDIS_KEY}" TTL=${REDIS_TTL}s...`);

    if (!redisClient.isOpen) {
      logger.warn(`[Trending] #${runId} Redis not open — reconnecting...`);
      await redisClient.connect();
      logger.info(`[Trending] #${runId} Redis reconnected`);
    }

   const pipeline = redisClient.pipeline();
pipeline.del(REDIS_KEY);
pipeline.rpush(REDIS_KEY, ...videoIds);  // ioredis ใช้ lowercase + spread
pipeline.expire(REDIS_KEY, REDIS_TTL);
const multiResult = await pipeline.exec();

logger.info(`[Trending] #${runId} Redis multi result: ${JSON.stringify(multiResult)}`);


    // verify ว่าเซฟจริง
    const savedCount = await redisClient.lLen(REDIS_KEY);
    logger.info(`[Trending] #${runId} Redis verify: lLen=${savedCount} (expected ${videoIds.length})`);

    lastRunSuccess = true;
    lastRunAt      = Date.now();
    totalSuccess++;

    const totalMs = Date.now() - startTime;
    logger.info(`[Trending] #${runId} ✅ Done in ${totalMs}ms | success=${totalSuccess} failed=${totalFailed} total=${totalRuns}`);

  } catch (err) {
    totalFailed++;
    lastRunSuccess = false;
    lastRunAt      = Date.now();

    const totalMs = Date.now() - startTime;
    logger.error(`[Trending] #${runId} ❌ Failed after ${totalMs}ms | success=${totalSuccess} failed=${totalFailed} total=${totalRuns}`);
    logger.error(`[Trending] #${runId} Error:`, err);
  } finally {
    isRunning = false;
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
async function startWorker() {
  try {
    logger.info('[Trending] Starting worker...');
    logger.info(`[Trending] Config: REDIS_KEY=${REDIS_KEY} TTL=${REDIS_TTL}s LIMIT=${TRENDING_LIMIT}`);

    if (!redisClient.isOpen) {
      logger.info('[Trending] Connecting to Redis...');
      await redisClient.connect();
      logger.info('[Trending] Redis connected');
    }

    // ping ClickHouse ก่อนเริ่ม
    try {
      await clickhouse.query({ query: 'SELECT 1', format: 'JSONEachRow' });
      logger.info('[Trending] ClickHouse connected ✅');
    } catch (err) {
      logger.error('[Trending] ClickHouse connection failed:', err.message);
      throw err;
    }

    await refreshTrending();

    const INTERVAL_MS = 10 * 60 * 1000;
    setInterval(async () => {
      logger.info('[Trending] ⏰ Interval triggered');
      try {
        await refreshTrending();
      } catch (err) {
        logger.error('[Trending] Interval crashed unexpectedly:', err);
        lastRunSuccess = false;
        isRunning      = false;
      }
    }, INTERVAL_MS);

    logger.info(`[Trending] 🚀 Worker ready | interval=${INTERVAL_MS / 1000 / 60}min`);
  } catch (err) {
    logger.error('[Trending] ❌ Failed to start:', err);
    process.exit(1);
  }
}

// ─── Health endpoint ──────────────────────────────────────────────────────────
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

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
    isRunning,
    isShuttingDown,
    stats: { totalRuns, totalSuccess, totalFailed }, // ✅ stats สะสม
  }));
}).listen(3099, () => {
  logger.info('[Trending] Health endpoint listening on :3099');
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`[Trending] Shutting down | stats: runs=${totalRuns} success=${totalSuccess} failed=${totalFailed}`);
  try {
    if (redisClient.isOpen) await redisClient.quit();
    logger.info('[Trending] Redis disconnected');
    process.exit(0);
  } catch (err) {
    logger.error('[Trending] Shutdown error:', err.message);
    process.exit(1);
  }
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

startWorker();