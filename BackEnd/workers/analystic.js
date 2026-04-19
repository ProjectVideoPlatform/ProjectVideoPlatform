'use strict';

const { Kafka } = require('kafkajs');
const { createClient } = require('@clickhouse/client');
const crypto = require('crypto'); // เปลี่ยนจาก randomUUID เป็นใช้งาน crypto แบบเต็ม
const redisClient = require('../config/redis');

const clickhouse = createClient({
  url:     'http://clickhouse:8123',
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
  const newIds = new Set();
  results.forEach(([err, result], index) => {
    if (!err && result === 'OK') newIds.add(eventIds[index]);
  });
  return newIds;
}

function validateMessage(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Payload is not JSON object');
  // สังเกตว่าฝั่ง Express ส่งมาเป็น eventType (camelCase) ต้อง map ให้ดี
  if (!payload.videoId || (!payload.eventType && !payload.event_type)) {
    throw new Error('Missing required fields');
  }
  return true;
}

function toClickhouseTimestamp(raw) {
  return new Date(raw || Date.now()).toISOString().replace('T', ' ').substring(0, 19);
}

// 👉 อย่าลืมใส่บรรทัดนี้ไว้บนสุดของไฟล์ (ถ้ายังไม่มี)


function mapToRow(data) {
  // 1. ดัก Type ให้ถูกต้อง (รองรับทั้ง key แบบใหม่และแบบเก่า)
  const VALID_TYPES = new Set([
    'play', 'watch', 'pause', 'seek', 'completed', 'close', 'error',
  ]);
  const eventType = String(data.eventType || data.event_type || 'unknown');

  if (!VALID_TYPES.has(eventType)) {
    throw new Error(`Invalid eventType: "${eventType}"`);
  }

  // 2. ต้องประกาศตัวแปร fallbackId ก่อน return เสมอ (ไม่งั้น Error)
  const fallbackId = crypto
    .createHash('md5')
    .update(`${data.videoId || data.video_id || ''}_${data.userId || data.user_id || ''}_${eventType}_${data.currentTime || data.current_time_seconds || 0}_${data.timestamp || data.event_time || Date.now()}`)
    .digest('hex');

  // 3. Return ค่าโดยดักจับ (Fallback) ทั้งชื่อตัวแปรเก่าและใหม่
  return {
    event_id:               String(data.eventId || data.event_id || fallbackId),
    video_id:               String(data.videoId || data.video_id || ''),
    user_id:                String(data.userId  || data.user_id  || 'anonymous'),
    session_id:             String(data.sessionId || data.session_id || ''),
    event_type:             eventType,

    // รองรับทั้ง data.duration (ใหม่) และ data.watch_duration_seconds (เก่า)
    watch_duration_seconds: Math.max(0, Math.round(Number(data.duration || data.watch_duration_seconds || 0))),
    total_watch_seconds:    Math.max(0, Math.round(Number(data.totalWatchTime || data.total_watch_seconds || 0))),
    current_time_seconds:   Math.max(0, Math.round(Number(data.currentTime || data.current_time_seconds || 0))),

    device_type:            String(data.device  || data.device_type || 'unknown'),
    country_code:           String(data.country || data.country_code || 'unknown'),
    event_time:             toClickhouseTimestamp(data.timestamp || data.event_time || data.receivedAt),
  };
}
class ClickHouseKafkaWorker {
  constructor() {
    this.MAX_RETRIES  = 3;
    this.BATCH_SIZE   = parseInt(process.env.BATCH_SIZE || '1000', 10);
    this.TOPIC        = process.env.KAFKA_TOPIC     || 'video-logs';
    this.DLQ_TOPIC    = process.env.KAFKA_DLQ_TOPIC || 'video-logs-dlq';
    this.isShuttingDown = false;

    this.kafka = new Kafka({
      clientId: 'clickhouse-ingester',
      brokers: (process.env.KAFKA_BROKERS || 'kafka:9092').split(','),
      retry: { initialRetryTime: 100, retries: 8 },
    });

    this.consumer = this.kafka.consumer({ groupId: 'clickhouse-worker-group', sessionTimeout: 30000 });
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
        autoCommit: false,
        eachBatchAutoResolve: false,
        eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isStale }) => {
          if (this.isShuttingDown || isStale()) return;
          await this._processBatch(batch, resolveOffset, heartbeat, commitOffsetsIfNecessary);
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

      const lastMessage = chunk[chunk.length - 1];
      resolveOffset(lastMessage.offset);
      await commitOffsetsIfNecessary();
      await heartbeat();
    }
  }

  async _processChunk(chunk, heartbeat) {
    const candidateRows  = [];  
    const failedMessages = [];

    // 1. Parse + Validate
    for (const msg of chunk) {
      try {
        const rawValue = msg.value?.toString();
        if (!rawValue) throw new Error('Empty message value');
        const payload = JSON.parse(rawValue);
        const items = Array.isArray(payload) ? payload : [payload];

        for (const item of items) {
          validateMessage(item);
          candidateRows.push({ row: mapToRow(item), msg });
        }
      } catch (err) {
        failedMessages.push({
          key: msg.key || Buffer.from('validation-error'),
          value: msg.value || Buffer.from(''),
          headers: { error: err.message, originalOffset: String(msg.offset) },
        });
      }
    }

    // 2. ✅ Redis Dedupe (มี Try-Catch ป้องกันระบบพัง)
    const eventIds = candidateRows.map(({ row }) => row.event_id);
    let newEventIds = new Set(eventIds); // ค่าเริ่มต้น: ยอมให้ผ่านหมดถ้า Redis ตาย
    
    try {
      newEventIds = await filterNewEvents(eventIds);
    } catch (redisErr) {
      console.error(`[Worker] Redis Dedupe Error: ${redisErr.message}. Bypassing dedupe.`);
    }

    const rowsToInsert = candidateRows.filter(({ row }) => newEventIds.has(row.event_id));

    // 3. Insert เข้า ClickHouse
    if (rowsToInsert.length > 0) {
      let retries = 0, success = false;
      const insertData = rowsToInsert.map(({ row }) => row);

      while (retries < this.MAX_RETRIES && !success) {
        try {
          await clickhouse.insert({
            table: 'video_watch_events',
            values: insertData,
            format: 'JSONEachRow',
          });
          success = true;
        } catch (err) {
          retries++;
          if (retries < this.MAX_RETRIES) {
            await heartbeat();
            await new Promise(r => setTimeout(r, 1000 * 2 ** (retries - 1)));
          }
        }
      }

      // ✅ FIX: ถ้า Insert พังทั้งหมด ให้โยนลง DLQ เฉพาะตัวที่เราพยายาม Insert (ไม่รวมตัวที่ซ้ำ)
      if (!success) {
        console.error(`[Worker] FATAL: Insert failed. Sending to DLQ.`);
        for (const { msg } of rowsToInsert) {
          failedMessages.push({
            key: msg.key || Buffer.from('db-error'),
            value: msg.value,
            headers: { error: 'ClickHouse Insert Failed', originalOffset: String(msg.offset) },
          });
        }
      }
    }

    // 4. DLQ
    if (failedMessages.length > 0) {
      try {
        await this.producer.send({ topic: this.DLQ_TOPIC, messages: failedMessages });
      } catch (dlqErr) {
        console.error(`[Worker] CRITICAL: DLQ send failed!`, dlqErr.message);
      }
    }
  }

  async shutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    try {
      await this.consumer.disconnect();
      await this.producer.disconnect();
      await clickhouse.close();
      process.exit(0);
    } catch (err) {
      process.exit(1);
    }
  }
}

const worker = new ClickHouseKafkaWorker();
worker.start();

process.on('SIGINT',  () => worker.shutdown());
process.on('SIGTERM', () => worker.shutdown());