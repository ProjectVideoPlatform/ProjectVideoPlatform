'use strict';

const amqp = require('amqplib');
const { createClient } = require('@clickhouse/client');
const config = require('../config/rabbitmq');
const QUEUES = require('../services/rabbitmq/queues');

// ── ClickHouse client (singleton) ──────────────────────
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL || 'http://clickhouse_db:8123',
  username: process.env.CLICKHOUSE_USER || 'app_user',
  password: process.env.CLICKHOUSE_PASS || 'strong_password',
  database: process.env.CLICKHOUSE_DB || 'app_db',
  clickhouse_settings: {
    async_insert: 1,
    wait_for_async_insert: 0, // fire-and-forget async insert
  },
  compression: { request: true },
  request_timeout: 10_000,
  keep_alive: { enabled: true },
});

// ── helpers ────────────────────────────────────────────
function toClickhouseTimestamp(raw) {
  // รับได้ทั้ง ISO string, unix ms, undefined
  const d = raw ? new Date(raw) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// แทนที่ mapToRow เดิม
function mapToRow(data) {
  const VALID_TYPES = new Set([
    'play', 'watch', 'pause', 'seek', 'completed', 'close', 'error',
  ]);

  const eventType = String(data.eventType || 'unknown');

  // กรอง event type ที่ไม่รู้จัก → throw ให้ caller ส่ง DLQ
  if (!VALID_TYPES.has(eventType)) {
    throw new Error(`Invalid eventType: "${eventType}"`);
  }

  return {
    video_id:               String(data.videoId  || ''),
    user_id:                String(data.userId   || 'anonymous'),
    session_id:             String(data.sessionId || ''),
    event_type:             eventType,

    // FIX: อ่าน duration ถูก field — VideoTracker ส่งมาเป็น "duration" ไม่ใช่ "watch_duration_seconds"
    watch_duration_seconds: Math.max(0, Math.round(Number(data.duration || 0))),
    total_watch_seconds:    Math.max(0, Math.round(Number(data.totalWatchTime || 0))),
    current_time_seconds:   Math.max(0, Math.round(Number(data.currentTime || 0))),

    device_type:            String(data.device   || 'desktop'),
    country_code:           String(data.country  || 'TH'),
    event_time:             toClickhouseTimestamp(data.timestamp || data.receivedAt),
  };
}

// ── worker ─────────────────────────────────────────────
class ClickHouseWorker {
  constructor() {
    this.BATCH_LIMIT      = Number(process.env.CH_BATCH_LIMIT)    || 500;
    this.FLUSH_INTERVAL   = Number(process.env.CH_FLUSH_INTERVAL) || 5_000;
    this.MIN_FLUSH_SIZE   = Number(process.env.CH_MIN_FLUSH)      || 10;
    this.MAX_RETRIES      = 3;

    this.rowBuffer  = [];  // mapped rows รอ insert
    this.msgBuffer  = [];  // amqp messages รอ ack/nack (1 ต่อ 1 กับ rowBuffer)
    this.channel    = null;
    this.intervalId = null;
    this.lastFlush  = Date.now();
    this.stats      = { received: 0, inserted: 0, failed: 0, flushes: 0 };

    // FIX: ใช้ Promise เป็น mutex แทน boolean — ปลอดภัยใน async/await
    this._flushPromise = null;
  }

  // ── lifecycle ─────────────────────────────────────────

  async start() {
    try {
      await this._testConnection();

      const connection = await amqp.connect(config.url);
      this.setupConnectionHandlers(connection);

      this.channel = await connection.createChannel();
      await this.channel.prefetch(this.BATCH_LIMIT * 2);
      await this._setupQueue(this.channel);
      await this._startConsuming(this.channel);
      this._startIntervalFlush();

      console.log('[ClickHouseWorker] started', {
        batchLimit: this.BATCH_LIMIT,
        minFlush: this.MIN_FLUSH_SIZE,
        flushInterval: this.FLUSH_INTERVAL,
      });

      setInterval(() => {
        console.log('[stats]', {
          buffer: this.rowBuffer.length,
          ...this.stats,
        });
      }, 30_000);

    } catch (err) {
      console.error('[ClickHouseWorker] startup failed, retry in 5s:', err.message);
      setTimeout(() => this.start(), 5_000);
    }
  }

  async shutdown() {
    console.log('[ClickHouseWorker] shutting down...');

    // FIX: หยุด interval ก่อน — ป้องกัน flush ซ้อนตอน shutdown
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // flush สิ่งที่เหลืออยู่
    if (this.rowBuffer.length > 0 && this.channel) {
      await this._flush();
    }

    if (this.channel) {
      await this.channel.close().catch(() => {});
    }

    console.log('[ClickHouseWorker] final stats:', this.stats);
    process.exit(0);
  }

  // ── queue setup ───────────────────────────────────────

  async _testConnection() {
    await clickhouse.query({ query: 'SELECT 1', format: 'JSONEachRow' }).then(r => r.json());
    console.log('[ClickHouseWorker] ClickHouse connected');
  }

  async _setupQueue(ch) {
    const queueArgs = {
      durable: true,
      arguments: {
        'x-queue-mode': 'lazy',
        'x-dead-letter-exchange': QUEUES.DLX_EXCHANGE,
        'x-dead-letter-routing-key': QUEUES.DLX_ANALYTICS_ROUTING_KEY,
      },
    };

    try {
      await ch.checkQueue(QUEUES.VIDEO_LOGS);
    } catch (err) {
      if (err.code !== 404) throw err;
      // queue ยังไม่มี → สร้างใหม่
    }

    await ch.assertQueue(QUEUES.VIDEO_LOGS, queueArgs);
    console.log('[ClickHouseWorker] queue ready:', QUEUES.VIDEO_LOGS);
  }

  // ── consuming ─────────────────────────────────────────

  async _startConsuming(ch) {
    await ch.consume(QUEUES.VIDEO_LOGS, async (msg) => {
      if (!msg) return;

      let payload;
      try {
        payload = JSON.parse(msg.content.toString());
      } catch {
        // JSON เสีย → ส่ง DLQ ทันที ไม่ requeue
        console.error('[consumer] invalid JSON, sending to DLQ');
        ch.nack(msg, false, false);
        return;
      }

      // normalise: route ส่งมาเป็น array เสมอ
      // แต่ยังรองรับ legacy single-object ด้วย
      const items = Array.isArray(payload) ? payload : [payload];

      // FIX: map rows ทั้งหมดก่อน แล้วค่อย push พร้อมกัน
      // → ack/nack ต่อ 1 AMQP message ถูกต้อง
      const rows = [];
      for (const item of items) {
        try {
          rows.push(mapToRow(item));
        } catch (err) {
          console.error('[consumer] mapToRow failed:', err.message, item);
          // skip item ที่ map ไม่ได้ แต่ไม่ทิ้ง message ทั้งก้อน
        }
      }

      if (rows.length === 0) {
        // ทุก item ใน message นี้ map ไม่ได้ → DLQ
        ch.nack(msg, false, false);
        return;
      }

      // push rows + 1 msg reference (ไม่ใช่ rows.length references)
      for (const row of rows) {
        this.rowBuffer.push(row);
      }
      this.msgBuffer.push(msg); // 1 msg ต่อ 1 AMQP message เสมอ
      this.stats.received += rows.length;

      if (this.rowBuffer.length >= this.BATCH_LIMIT) {
        // ไม่ต้อง await — flush จะรันใน background ผ่าน mutex
        this._triggerFlush();
      }
    }, { noAck: false });
  }

  // ── flush ─────────────────────────────────────────────

  _startIntervalFlush() {
    this.intervalId = setInterval(() => {
      if (this.rowBuffer.length >= this.MIN_FLUSH_SIZE) {
        this._triggerFlush();
      }
    }, this.FLUSH_INTERVAL);
  }

  // FIX: mutex ผ่าน Promise chain — ป้องกัน concurrent flush ใน async context
  _triggerFlush() {
    if (this._flushPromise) return; // กำลัง flush อยู่ → skip
    this._flushPromise = this._flush().finally(() => {
      this._flushPromise = null;
    });
  }

  async _flush() {
    if (this.rowBuffer.length === 0) return;

    // snapshot + clear atomically (single-threaded JS event loop)
    const rows = this.rowBuffer.splice(0);
    const msgs = this.msgBuffer.splice(0);
    this.lastFlush = Date.now();

    let retries = 0;
    while (retries < this.MAX_RETRIES) {
      try {
        await clickhouse.insert({
          table: 'video_watch_events',
          values: rows,
          format: 'JSONEachRow',
        });

        // ack ทุก message ใน batch นี้
        for (const msg of msgs) {
          try { this.channel.ack(msg); } catch { /* channel อาจปิดแล้ว */ }
        }

        this.stats.inserted += rows.length;
        this.stats.flushes++;
        console.log(`[flush #${this.stats.flushes}] inserted ${rows.length} rows`);
        return;

      } catch (err) {
        retries++;
        console.error(`[flush] attempt ${retries}/${this.MAX_RETRIES} failed:`, err.message);

        if (retries < this.MAX_RETRIES) {
          // exponential backoff: 1s, 2s, 4s
          await new Promise(r => setTimeout(r, 1_000 * 2 ** (retries - 1)));
        }
      }
    }

    // หมด retry → DLQ (requeue=false)
    // FIX: ไม่ requeue ถ้า ClickHouse reject ซ้ำ — ป้องกัน infinite loop
    console.error(`[flush] giving up on ${rows.length} rows after ${this.MAX_RETRIES} retries → DLQ`);
    this.stats.failed += rows.length;

    for (const msg of msgs) {
      try { this.channel.nack(msg, false, false); } catch { /* channel อาจปิดแล้ว */ }
    }
  }

  // ── connection handlers ───────────────────────────────

  setupConnectionHandlers(connection) {
    connection.on('close', () => {
      console.warn('[ClickHouseWorker] RabbitMQ connection closed, reconnecting in 5s...');
      this.channel = null;
      setTimeout(() => this.start(), 5_000);
    });
    connection.on('error', (err) => {
      console.error('[ClickHouseWorker] RabbitMQ connection error:', err.message);
    });
  }
}

// ── entry point ────────────────────────────────────────
const worker = new ClickHouseWorker();
worker.start();

process.on('SIGINT',  () => worker.shutdown());
process.on('SIGTERM', () => worker.shutdown());

module.exports = ClickHouseWorker;