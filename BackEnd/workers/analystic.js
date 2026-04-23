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

function sanitizeObjectId(value) {
  if (!value) return '';
  if (typeof value === 'object' && value !== null) {
    if (value._bsontype === 'ObjectId' || value.toString) {
      return value.toString();
    }
    if (value.constructor && value.constructor.name === 'ObjectId') {
      return value.toString();
    }
  }
  return String(value);
}

function validateMessage(payload) {
  const vId   = payload.video_id  ?? payload.videoId;
  const eType = payload.event_type ?? payload.eventType;
  if (!vId || !eType) {
    throw new Error('Missing required fields: video_id or event_type');
  }
  return true;
}

function toClickhouseTimestamp(raw) {
  return new Date(raw || Date.now()).toISOString().replace('T', ' ').substring(0, 19);
}

function mapToRow(data) {
  const VALID_TYPES = new Set([
    'play', 'watch', 'watch_chunk', 'pause', 'seek',
    'completed', 'close', 'error', 'buffer_start', 'buffer_end',
    'resume', 'tab_hide', 'tab_show',
  ]);

  const eventType = String(data.eventType || data.event_type || 'unknown');
  if (!VALID_TYPES.has(eventType)) {
    throw new Error(`Invalid eventType: "${eventType}"`);
  }

  const videoId   = sanitizeObjectId(data.videoId   || data.video_id   || '');
  const userId    = sanitizeObjectId(data.userId    || data.user_id    || 'anonymous');
  const sessionId = sanitizeObjectId(data.sessionId || data.session_id || '');

  const fallbackId = crypto
    .createHash('md5')
    .update([
      videoId, userId, sessionId, eventType,
      data.currentTime || data.current_time_seconds || 0,
      data.timestamp   || data.event_time           || Date.now(),
    ].join('_'))
    .digest('hex');

  return {
    event_id:   String(data.eventId || data.event_id || fallbackId),
    video_id:   videoId,
    user_id:    userId,
    session_id: sessionId,
    event_type: eventType,

    // ✅ FIX: เพิ่ม category
    category: String(data.category || data.video_category || 'unknown'),

    watch_duration_seconds: Math.max(0, Math.round(Number(data.duration              || data.watch_duration_seconds || 0))),
    total_watch_seconds:    Math.max(0, Math.round(Number(data.totalWatchTime         || data.total_watch_seconds    || 0))),
    current_time_seconds:   Math.max(0, Math.round(Number(data.currentTime           || data.current_time_seconds   || 0))),
    chunk_start_seconds:    Math.max(0, Math.round(Number(data.chunk_start_seconds   || 0))),
    chunk_end_seconds:      Math.max(0, Math.round(Number(data.chunk_end_seconds     || 0))),
    max_progress_seconds:   Math.max(0, Math.round(Number(data.max_progress_seconds  || 0))),

    device_type:  String(data.device  || data.device_type  || 'unknown'),
    country_code: String(data.country || data.country_code || 'unknown'),
    event_time:   toClickhouseTimestamp(data.timestamp || data.event_time || data.receivedAt),
  };
}

function extractItems(payload) {
  if (Array.isArray(payload))         return payload;
  if (Array.isArray(payload?.events)) return payload.events;
  return [payload];
}

// ✅ FIX: return object เสมอ ไม่ parse สองรอบ
function sanitizePayload(rawValue) {
  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err.message}`);
  }

  function deepSanitize(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (obj._bsontype === 'ObjectId' ||
        (obj.constructor && obj.constructor.name === 'ObjectId')) {
      return obj.toString();
    }
    if (Array.isArray(obj)) return obj.map(deepSanitize);
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = deepSanitize(value);
    }
    return sanitized;
  }

  return deepSanitize(parsed);
}

class ClickHouseKafkaWorker {
  constructor() {
    this.MAX_RETRIES    = 3;
    this.BATCH_SIZE     = parseInt(process.env.BATCH_SIZE     || '1000', 10);
    this.TOPIC          = process.env.KAFKA_TOPIC             || 'video-logs';
    this.DLQ_TOPIC      = process.env.KAFKA_DLQ_TOPIC         || 'video-logs-dlq';
    this.isShuttingDown = false;
    this._activeBatch   = null;

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
      // ✅ FIX: เช็ค isOpen ก่อน connect ป้องกัน crash ถ้า connect แล้ว
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
      console.log('[Worker] Redis ready for dedupe');

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

  async _processBatch(batch, resolveOffset, heartbeat, commitOffsetsIfNecessary) {
    const messages = batch.messages;
    for (let i = 0; i < messages.length; i += this.BATCH_SIZE) {
      if (this.isShuttingDown) break;
      const chunk = messages.slice(i, i + this.BATCH_SIZE);
      await this._processChunk(chunk, heartbeat);
      resolveOffset(chunk[chunk.length - 1].offset);
      await heartbeat();
    }
    await commitOffsetsIfNecessary();
  }

  async _processChunk(chunk, heartbeat) {
    const candidateRows  = [];
    const failedMessages = [];

    for (const msg of chunk) {
      try {
        const rawValue = msg.value?.toString();
        if (!rawValue) throw new Error('Empty message value');

        // ✅ FIX: sanitizePayload return object เลย ไม่ต้อง parse อีกรอบ
        const payload = sanitizePayload(rawValue);
        const items   = extractItems(payload);

        for (const item of items) {
          validateMessage(item);
          candidateRows.push({ row: mapToRow(item), msg });
        }
      } catch (err) {
        console.error(`[Worker] Message processing error: ${err.message}`);
        failedMessages.push({
          key:     msg.key   || Buffer.from('validation-error'),
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
      let retries    = 0;
      let success    = false;
      const insertData = rowsToInsert.map(({ row }) => row);

      while (retries < this.MAX_RETRIES && !success) {
        try {
          await clickhouse.insert({
            table:  'video_watch_events',
            values: insertData,
            format: 'JSONEachRow',
          });
          success = true;
          console.log(`[Worker] Inserted ${insertData.length} events successfully`);
        } catch (err) {
          retries++;
          console.error(`[Worker] Insert attempt ${retries} failed: ${err.message}`);
          if (retries < this.MAX_RETRIES) {
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
        console.log(`[Worker] Sent ${failedMessages.length} messages to DLQ`);
      } catch (dlqErr) {
        console.error('[Worker] CRITICAL: DLQ send failed!', dlqErr.message);
      }
    }
  }

  async shutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    console.log('[Worker] Shutting down gracefully...');
    try {
      if (this._activeBatch) await this._activeBatch;
    } catch {
      // batch อาจ fail ตอน shutdown
    }
    try {
      await this.consumer.disconnect();
      await this.producer.disconnect();
      await clickhouse.close();
      await redisClient.quit();
      process.exit(0);
    } catch (err) {
      console.error('[Worker] Shutdown error:', err.message);
      process.exit(1);
    }
  }
}

const worker = new ClickHouseKafkaWorker();
worker.start();

process.on('SIGINT',  () => worker.shutdown());
process.on('SIGTERM', () => worker.shutdown());