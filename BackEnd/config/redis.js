const Redis = require('ioredis');
const logger = require('../utils/logger');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

class RedisClient {
  constructor() {
    this.publisher = null;
    this.subscriber = null;
    this.isConnected = false;
    this.messageHandlers = new Map();
  }

  getOptions() {
    return {
      host: process.env.REDIS_HOST || 'redis',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || "redispassword123",
      db: process.env.REDIS_DB || 0,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
    };
  }

  async connect() {
    if (this.publisher) return this.publisher;

    const options = this.getOptions();
    this.publisher  = new Redis(options);
    this.subscriber = new Redis(options);

    this.publisher.on('connect', () => {
      this.isConnected = true;
      logger.info('Redis publisher connected');
    });
    this.publisher.on('error', (err) => logger.error('Redis publisher error:', err));

    this.subscriber.on('connect', () => logger.info('Redis subscriber connected'));
    this.subscriber.on('error',   (err) => logger.error('Redis subscriber error:', err));

    this.subscriber.on('message', (channel, message) => {
      const handler = this.messageHandlers.get(channel);
      if (!handler) return;
      try {
        handler(JSON.parse(message));
      } catch {
        handler(message);
      }
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Redis connection timeout')), 5000);
      this.publisher.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    return this.publisher;
  }

  // ---------- BASIC COMMANDS ----------

  async get(key) {
    if (!this.isConnected) await this.connect();
    return this.publisher.get(key);
  }

  // ✅ รับ args แบบ ioredis ตรงๆ เช่น set(key, val, 'EX', 900)
  async set(key, value, ...args) {
    if (!this.isConnected) await this.connect();
    return this.publisher.set(key, value, ...args);
  }

  // ✅ แก้ key → ...keys
  async del(...keys) {
    if (!this.isConnected) await this.connect();
    return this.publisher.del(...keys);
  }

  async incr(key) {
    if (!this.isConnected) await this.connect();
    return this.publisher.incr(key);
  }

  async ttl(key) {
    if (!this.isConnected) await this.connect();
    return this.publisher.ttl(key);
  }

  async mget(...keys) {
    if (!this.isConnected) await this.connect();
    return this.publisher.mget(...keys);
  }

  async expire(key, seconds) {
    if (!this.isConnected) await this.connect();
    return this.publisher.expire(key, seconds);
  }

  // ---------- LIST COMMANDS ----------

  async rPush(key, value) {
    if (!this.isConnected) await this.connect();
    const data = typeof value === 'string' ? value : JSON.stringify(value);
    return this.publisher.rpush(key, data);
  }

  async lRange(key, start, stop) {
    if (!this.isConnected) await this.connect();
    return this.publisher.lrange(key, start, stop);
  }
  // ใน redisClient.js — เพิ่มใต้ lRange

async zRange(key, start, stop, options = {}) {
  if (!this.isConnected) await this.connect();
  // ioredis: zrange key start stop [WITHSCORES] [REV]
  if (options.REV && options.withScores) {
    return this.publisher.zrange(key, start, stop, 'REV', 'WITHSCORES');
  } else if (options.REV) {
    return this.publisher.zrange(key, start, stop, 'REV');
  } else if (options.withScores) {
    return this.publisher.zrange(key, start, stop, 'WITHSCORES');
  }
  return this.publisher.zrange(key, start, stop);
}

async zAdd(key, score, member) {
  if (!this.isConnected) await this.connect();
  return this.publisher.zadd(key, score, member);
}

async zScore(key, member) {
  if (!this.isConnected) await this.connect();
  return this.publisher.zscore(key, member);
}

async zRevRange(key, start, stop) {
  if (!this.isConnected) await this.connect();
  return this.publisher.zrevrange(key, start, stop);
}
  // ---------- PUB/SUB ----------

  async publish(channel, message) {
    if (!this.isConnected) await this.connect();
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    return this.publisher.publish(channel, data);
  }

  async subscribe(channel, handler) {
    if (!this.isConnected) await this.connect();
    this.messageHandlers.set(channel, handler);
    return this.subscriber.subscribe(channel);
  }
 
  // ---------- PIPELINE / MULTI ----------

 pipeline() {
  if (!this.publisher) {
    // ถ้ายังไม่ได้ connect ให้ throw error ที่อ่านง่ายขึ้น 
    // หรือทำการสร้าง instance เฉพาะหน้า (แต่แนะนำให้เรียก connect ให้เสร็จก่อนจะดีกว่า)
    throw new Error('Redis Publisher not initialized. Call connect() first.');
  }
  return this.publisher.pipeline();
}

  multi() {
    return this.publisher.multi();
  }

  // ---------- DISCONNECT ----------

  async disconnect() {
    this.messageHandlers.clear();
    if (this.publisher)  await this.publisher.quit();
    if (this.subscriber) await this.subscriber.quit();
    this.isConnected = false;
  }
}

module.exports = new RedisClient();