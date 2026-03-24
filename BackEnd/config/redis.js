const Redis = require('ioredis');
const logger = require('../utils/logger');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

class RedisClient {
  constructor() {
    this.publisher = null;
    this.subscriber = null;
    this.isConnected = false;
    
    // ✅ เพิ่ม Map สำหรับเก็บ Handler ของแต่ละ Channel ป้องกัน Event ซ้ำซ้อน
    this.messageHandlers = new Map(); 
  }

  getOptions() {
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB || 0,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3
    };
  }

  async connect() {
    if (this.publisher) return this.publisher;

    const options = this.getOptions();

    this.publisher = new Redis(options);
    this.subscriber = new Redis(options);

    this.publisher.on('connect', () => {
      this.isConnected = true;
      logger.info('Redis publisher connected');
    });

    this.publisher.on('error', (err) => {
      logger.error('Redis publisher error:', err);
    });

    this.subscriber.on('connect', () => {
      logger.info('Redis subscriber connected');
    });

    this.subscriber.on('error', (err) => {
      logger.error('Redis subscriber error:', err);
    });

    // ✅ ย้ายการดักฟัง 'message' มาไว้ตรงนี้ (ประกาศแค่ครั้งเดียวพอ)
    this.subscriber.on('message', (channel, message) => {
      const handler = this.messageHandlers.get(channel);
      if (handler) {
        try {
          // ลอง Parse JSON ดูก่อนส่งให้ Handler
          const parsedMessage = JSON.parse(message);
          handler(parsedMessage);
        } catch (e) {
          // ถ้า Parse พลาด (เช่นเป็น String ธรรมดา) ก็ส่งไปตรงๆ
          handler(message);
        }
      }
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 5000);

      this.publisher.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    return this.publisher;
  }

  // ---------- BASIC COMMANDS ----------
  // (Method เดิมของคุณใช้ได้ดีแล้ว คงไว้ได้เลย)

  async get(key) {
    if (!this.isConnected) await this.connect();
    return this.publisher.get(key);
  }

  async set(key, value, options = {}) {
    if (!this.isConnected) await this.connect();
    if (options.EX) {
      return this.publisher.set(key, value, 'EX', options.EX);
    }
    return this.publisher.set(key, value);
  }

  async del(key) {
    if (!this.isConnected) await this.connect();
    return this.publisher.del(key);
  }

  async expire(key, seconds) {
    if (!this.isConnected) await this.connect();
    return this.publisher.expire(key, seconds);
  }

  // ---------- LIST COMMANDS (เพิ่มใหม่สำหรับทำ Queue/Cache) ----------

  async rPush(key, value) {
    if (!this.isConnected) await this.connect();
    // ถ้า Value เป็น Object ให้แปลงเป็น String ก่อน
    const data = typeof value === 'string' ? value : JSON.stringify(value);
    return this.publisher.rpush(key, data);
  }

  async lRange(key, start, stop) {
    if (!this.isConnected) await this.connect();
    return this.publisher.lrange(key, start, stop);
  }

  // ---------- PUB/SUB ----------

  async publish(channel, message) {
    if (!this.isConnected) await this.connect();
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    return this.publisher.publish(channel, data);
  }

  async subscribe(channel, handler) {
    if (!this.isConnected) await this.connect();
    
    // ✅ ลงทะเบียน Handler ไว้ใน Map แทนการ .on('message') ซ้ำๆ
    this.messageHandlers.set(channel, handler);
    
    // สั่งให้ ioredis Subscribe Channel นี้
    return this.subscriber.subscribe(channel);
  }

  // ---------- DISCONNECT ----------

  async disconnect() {
    this.messageHandlers.clear();
    if (this.publisher) await this.publisher.quit();
    if (this.subscriber) await this.subscriber.quit();
    this.isConnected = false;
  }
}

module.exports = new RedisClient();