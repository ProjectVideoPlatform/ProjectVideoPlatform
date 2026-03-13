const Redis = require('ioredis');
const logger = require('../utils/logger');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

class RedisClient {
  constructor() {
    this.publisher = null;
    this.subscriber = null;
    this.isConnected = false;
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
      console.log('Redis publisher connected');
    });

    this.publisher.on('error', (err) => {
      logger.error('Redis publisher error:', err);
      console.error('Redis publisher error:', err);
    });

    this.subscriber.on('connect', () => {
      logger.info('Redis subscriber connected');
      console.log('Redis subscriber connected');
    });

    this.subscriber.on('error', (err) => {
      logger.error('Redis subscriber error:', err);
      console.error('Redis subscriber error:', err);
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

  async setex(key, seconds, value) {
    if (!this.isConnected) await this.connect();
    return this.publisher.setex(key, seconds, value);
  }

  pipeline() {
    if (!this.publisher) {
      throw new Error('Redis not connected');
    }
    return this.publisher.pipeline();
  }

  // ---------- PUB/SUB ----------

  async publish(channel, message) {
    if (!this.isConnected) await this.connect();
    return this.publisher.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel, handler) {
    if (!this.isConnected) await this.connect();

    await this.subscriber.subscribe(channel);

    this.subscriber.on('message', (ch, msg) => {
      if (ch === channel) {
        handler(JSON.parse(msg));
      }
    });
  }

  // ---------- DISCONNECT ----------

  async disconnect() {
    if (this.publisher) await this.publisher.quit();
    if (this.subscriber) await this.subscriber.quit();
    this.isConnected = false;
  }
}

module.exports = new RedisClient();