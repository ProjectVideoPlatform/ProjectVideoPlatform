const Redis = require('ioredis');
const logger = require('../utils/logger');
  const path = require('path');
   require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }
  
  async connect() {
    if (this.client) return this.client;
    
    const options = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB || 0,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3
    };
    
    this.client = new Redis(options);
    
    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('Redis connected successfully');
      console.log('Redis connected successfully');
    });
    
    this.client.on('error', (error) => {
      logger.error('Redis error:', error);
      this.isConnected = false;
      console.error('Redis error:', error);
    });
    
    this.client.on('close', () => {
      logger.warn('Redis connection closed');
      this.isConnected = false;
    });
    
    // Wait for connection
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 5000);
      
      this.client.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    
    return this.client;
  }
  
  async get(key) {
    if (!this.isConnected) await this.connect();
    return this.client.get(key);
  }
  
  async set(key, value, options = {}) {
    if (!this.isConnected) await this.connect();
    
    if (options.EX) {
      return this.client.set(key, value, 'EX', options.EX, 'NX');
    }
    
    return this.client.set(key, value);
  }
  
  async del(key) {
    if (!this.isConnected) await this.connect();
    return this.client.del(key);
  }
  
  async setex(key, seconds, value) {
    if (!this.isConnected) await this.connect();
    return this.client.setex(key, seconds, value);
  }
  
  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
    }
  }
  // เพิ่มเข้าไปใน class RedisClient ในไฟล์ config
pipeline() {
  if (!this.client) {
    // กรณีที่ยังไม่ได้ connect แต่อยากใช้ pipeline
    // อาจจะ throw error หรือสั่ง connect ก่อนตามความเหมาะสม
    throw new Error('Redis client not initialized. Call connect() first.');
  }
  return this.client.pipeline();
}
}

module.exports = new RedisClient();