'use strict';

const { Kafka } = require('kafkajs');
const { createClient } = require('@clickhouse/client');
const crypto = require('crypto');
const redisClient = require('../config/redis');

const clickhouse = createClient({
  url:      'http://clickhouse:8123',
  username: process.env.CLICKHOUSE_USER     || 'app_user',
  password: process.env.CLICKHOUSE_PASSWORD || 'strong_password',
  database: process.env.CLICKHOUSE_DB       || 'app_db',
});

const DEDUPE_TTL_SEC = 60 * 60 * 24;

async function filterNewEvents(eventIds) {
  if (eventIds.length === 0) return new Set();
  const pipeline = redisClient.pipeline();
  for (const id of eventIds) {
    pipeline.set(`dedupe:event:${id}`, '1', 'EX', DEDUPE_TTL_SEC, 'NX');
  }
  const results = await pipeline.exec();
  const newIds  = new Set();
  results.forEach(([err, result], index) => {
    if (!err && result === 'OK') newIds.add(eventIds[index]);
  });
  return newIds;
}

function validateMessage(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Payload is not JSON object');
  if (!payload.videoId || (!payload.eventType && !payload.event_type)) {
    throw new Error('Missing required fields: videoId or eventType');
  }
  return true;
}

function toClickhouseTimestamp(raw) {
  return new Date(raw || Date.now()).toISOString().replace('T', ' ').substring(0, 19);
}

function mapToRow(data) {
  const VALID_TYPES = new Set([
    'play', 'watch', 'watch_chunk', 'pause', 'seek', 'completed', 'close', 'error',
  ]);

  const eventType = String(data.eventType || data.event_type || 'unknown');
  if (!VALID_TYPES.has(eventType)) {
    throw new Error(`Invalid eventType: "${eventType}"`);
  }

  // ── FIX #1: fallbackId ใช้ fields ที่มีจริงใน payload เท่านั้น ─────────────
  // เดิมใช้ data.startTime ซึ่งไม่เคยถูกส่งมา → ทุก event ได้ hash เหมือนกัน
  // ใช้ currentTime + timestamp แทน ซึ่งมีค่าเสมอ
  const fallbackId = crypto
    .createHash('md5')
    .update([
      data.videoId    || data.video_id    || '',
      data.userId     || data.user_id     || '',
      data.sessionId  || data.session_id  || '',
      eventType,
      data.currentTime || data.current_time_seconds || 0,
      data.timestamp   || data.event_time || Date.now(),
    ].join('_'))
    .digest('hex');

  // ── FIX #5: chunk fields ต้อง Math.round() เหมือนกับ duration fields อื่น ─
  return {
    event_id:   String(data.eventId || data.event_id || fallbackId),
    video_id:   String(data.videoId || data.video_id || ''),
    user_id:    String(data.userId  || data.user_id  || 'anonymous'),
    session_id: String(data.sessionId || data.session_id || ''),
    event_type: eventType,

    watch_duration_seconds: Math.max(0, Math.round(Number(data.duration             || data.watch_duration_seconds || 0))),
    total_watch_seconds:    Math.max(0, Math.round(Number(data.totalWatchTime       || data.total_watch_seconds    || 0))),
    current_time_seconds:   Math.max(0, Math.round(Number(data.currentTime          || data.current_time_seconds   || 0))),

    chunk_start_seconds:  Math.max(0, Math.round(Number(data.chunk_start_seconds  || 0))),
    chunk_end_seconds:    Math.max(0, Math.round(Number(data.chunk_end_seconds    || 0))),
    max_progress_seconds: Math.max(0, Math.round(Number(data.max_progress_seconds || 0))),

    device_type:  String(data.device  || data.device_type  || 'unknown'),
    country_code: String(data.country || data.country_code || 'unknown'),
    event_time:   toClickhouseTimestamp(data.timestamp || data.event_time || data.receivedAt),
  };
}

// ── FIX #6: unwrap { events: [...] } format ที่ frontend ส่งมา ────────────────
// frontend ส่ง POST body = { events: [...] }
// worker เดิม expect [...] หรือ {...} ตรงๆ → items ไม่ถูก parse
function extractItems(payload) {
  if (Array.isArray(payload))          return payload;           // [...] raw array
  if (Array.isArray(payload?.events))  return payload.events;   // { events: [...] }
  return [payload];                                              // single event object
}

class ClickHouseKafkaWorker {
  constructor() {
    this.MAX_RETRIES    = 3;
    this.BATCH_SIZE     = parseInt(process.env.BATCH_SIZE    || '1000', 10);
    this.TOPIC          = process.env.KAFKA_TOPIC            || 'video-logs';
    this.DLQ_TOPIC      = process.env.KAFKA_DLQ_TOPIC        || 'video-logs-dlq';
    this.isShuttingDown = false;

    // ── FIX #4: track active batch ให้ shutdown รอ ───────────────────────────
    this._activeBatch = null;

    this.kafka = new Kafka({
      clientId: 'clickhouse-ingester',
      brokers:  (process.env.KAFKA_BROKERS || 'kafka:9092').split(','),
      retry:    { initialRetryTime: 100, retries: 8 },
    });

    this.consumer = this.kafka.consumer({
      groupId:         'clickhouse-worker-group',
      sessionTimeout:  30000,
      maxWaitTimeInMs: 9000,
      minBytes:        1024 * 500,
    });

    this.producer = this.kafka.producer();
  }

  async start() {
    try {
      await clickhouse.query({ query: 'SELECT 1', format: 'JSONEachRow' });
      await this.producer.connect();
      await this.consumer.connect();
      await this.consumer.subscribe({ topic: this.TOPIC, fromBeginning: false });
      console.log(`[Worker] Started consuming ${this.TOPIC}`);

      await this.consumer.run({
        partitionsConsumedConcurrently: 1,
        autoCommit:           false,
        eachBatchAutoResolve: false,
        eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isStale }) => {
          if (this.isShuttingDown || isStale()) return;

          // ── FIX #4: เก็บ promise ของ batch ปัจจุบัน ───────────────────────
          this._activeBatch = this._processBatch(
            batch, resolveOffset, heartbeat, commitOffsetsIfNecessary,
          );
          await this._activeBatch;
          this._activeBatch = null;
        },
      });
    } catch (err) {
      console.error('[Worker] Startup failed:', err.message);
      setTimeout(() => this.start(), 5000);
    }
  }

  // ── FIX #2: commit ครั้งเดียวหลังทุก chunk ใน batch สำเร็จ ─────────────────
  // เดิม commit ทีละ chunk → ถ้า chunk ที่ 2 fail ข้อมูล chunk ที่ 1 หาย
  // ใหม่: resolveOffset ทีละ chunk (บอก kafkajs ว่า process แล้ว)
  //       แต่ commitOffsetsIfNecessary เรียกครั้งเดียวตอนจบ batch
  async _processBatch(batch, resolveOffset, heartbeat, commitOffsetsIfNecessary) {
    const messages = batch.messages;
    for (let i = 0; i < messages.length; i += this.BATCH_SIZE) {
      if (this.isShuttingDown) break;
      const chunk = messages.slice(i, i + this.BATCH_SIZE);
      await this._processChunk(chunk, heartbeat);
      resolveOffset(chunk[chunk.length - 1].offset);
      await heartbeat();
    }
    // commit ครั้งเดียวหลัง batch ทั้งหมดสำเร็จ
    await commitOffsetsIfNecessary();
  }

  async _processChunk(chunk, heartbeat) {
    const candidateRows  = [];
    const failedMessages = [];

    for (const msg of chunk) {
      try {
        const rawValue = msg.value?.toString();
        if (!rawValue) throw new Error('Empty message value');

        const payload = JSON.parse(rawValue);
        // ── FIX #6: ใช้ extractItems แทน Array.isArray ตรงๆ ─────────────────
        const items = extractItems(payload);

        for (const item of items) {
          validateMessage(item);
          candidateRows.push({ row: mapToRow(item), msg });
        }
      } catch (err) {
        failedMessages.push({
          key:     msg.key || Buffer.from('validation-error'),
          value:   msg.value || Buffer.from(''),
          headers: { error: err.message, originalOffset: String(msg.offset) },
        });
      }
    }

    // Redis dedupe
    const eventIds  = candidateRows.map(({ row }) => row.event_id);
    let newEventIds = new Set(eventIds);
    try {
      newEventIds = await filterNewEvents(eventIds);
    } catch (redisErr) {
      console.error(`[Worker] Redis dedupe error: ${redisErr.message}. Bypassing.`);
    }

    const rowsToInsert = candidateRows.filter(({ row }) => newEventIds.has(row.event_id));

    if (rowsToInsert.length > 0) {
      let retries = 0;
      let success = false;
      const insertData = rowsToInsert.map(({ row }) => row);

      while (retries < this.MAX_RETRIES && !success) {
        try {
          await clickhouse.insert({
            table:  'video_watch_events',
            values: insertData,
            format: 'JSONEachRow',
          });
          success = true;
        } catch (err) {
          retries++;
          console.error(`[Worker] Insert attempt ${retries} failed: ${err.message}`);
          if (retries < this.MAX_RETRIES) {
            // ── FIX #3: heartbeat ทุก retry ป้องกัน Kafka คิดว่า consumer ตาย ─
            // backoff 1s, 2s (ไม่ใช้ 4s เพราะ maxWaitTimeInMs=9s)
            await heartbeat();
            await new Promise(r => setTimeout(r, 1000 * retries));
          }
        }
      }

      if (!success) {
        console.error('[Worker] FATAL: Insert failed after retries. Sending to DLQ.');
        for (const { msg } of rowsToInsert) {
          failedMessages.push({
            key:     msg.key || Buffer.from('db-error'),
            value:   msg.value,
            headers: { error: 'ClickHouse insert failed', originalOffset: String(msg.offset) },
          });
        }
      }
    }

    if (failedMessages.length > 0) {
      try {
        await this.producer.send({ topic: this.DLQ_TOPIC, messages: failedMessages });
      } catch (dlqErr) {
        console.error('[Worker] CRITICAL: DLQ send failed!', dlqErr.message);
      }
    }
  }

  // ── FIX #4: shutdown รอ batch ปัจจุบันให้เสร็จก่อน disconnect ───────────────
  async shutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    console.log('[Worker] Shutting down gracefully...');
    try {
      if (this._activeBatch) await this._activeBatch;
    } catch {
      // batch อาจ fail ตอน shutdown — ไม่เป็นไร ไป disconnect ต่อ
    }
    try {
      await this.consumer.disconnect();
      await this.producer.disconnect();
      await clickhouse.close();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  }
}

const worker = new ClickHouseKafkaWorker();
worker.start();

process.on('SIGINT',  () => worker.shutdown());
process.on('SIGTERM', () => worker.shutdown());