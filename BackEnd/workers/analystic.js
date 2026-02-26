// workers/clickhouseWorker.js
const amqp = require('amqplib');
const { createClient } = require('@clickhouse/client');
const config = require('../config/rabbitmq');
const QUEUES = require('../services/rabbitmq/queues');

const clickhouse = createClient({
    url: 'http://clickhouse_db:8123',
    username: 'app_user',
    password: 'strong_password',
    database: 'app_db',
    clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 1
    }
});

class ClickHouseWorker {
    constructor() {
        this.logBuffer = [];
        this.messageBuffer = [];
        this.BATCH_LIMIT = 500;
        this.FLUSH_INTERVAL = 5000;
        this.MIN_FLUSH_SIZE = 10;
        this.isFlushing = false;
        this.channel = null;
        this.lastFlushTime = Date.now();
        this.stats = {
            received: 0,
            inserted: 0,
            failed: 0,
            flushes: 0
        };
        
        // ✅ เพิ่ม mutex สำหรับป้องกัน race condition
        this.flushLock = false;
    }

    async start() {
        try {
            await this.testConnection();
            
            const connection = await amqp.connect(config.url);
            this.channel = await connection.createChannel();
            
            await this.setupQueue(this.channel);
            await this.channel.prefetch(this.BATCH_LIMIT * 2);
            
            await this.startConsuming(this.channel);
            this.startIntervalFlush(this.channel);
            this.setupConnectionHandlers(connection);

            console.log(`📊 ClickHouse Analytics Worker started`);
            console.log(`   Batch limit: ${this.BATCH_LIMIT}`);
            console.log(`   Min flush size: ${this.MIN_FLUSH_SIZE}`);
            console.log(`   Flush interval: ${this.FLUSH_INTERVAL}ms`);

            // ✅ แสดงสถิติทุก 30 วินาที
            setInterval(() => {
                console.log(`📈 Stats - Buffer: ${this.logBuffer.length}, Received: ${this.stats.received}, Inserted: ${this.stats.inserted}`);
            }, 30000);

        } catch (error) {
            console.error('[ClickHouseWorker] Startup Error:', error);
            setTimeout(() => this.start(), 5000);
        }
    }

    async testConnection() {
        try {
            const result = await clickhouse.query({
                query: 'SELECT 1',
                format: 'JSONEachRow'
            });
            await result.json();
            console.log('✅ ClickHouse connected');
        } catch (error) {
            console.error('❌ ClickHouse connection failed:', error);
            throw error;
        }
    }

    async setupQueue(ch) {
        try {
            const queueInfo = await ch.checkQueue(QUEUES.VIDEO_LOGS);
            console.log(`📊 Queue ${QUEUES.VIDEO_LOGS} exists with ${queueInfo.messageCount} messages`);
            
            await ch.assertQueue(QUEUES.VIDEO_LOGS, {
                durable: true,
                arguments: {
                    'x-dead-letter-exchange': QUEUES.DLX_EXCHANGE,
                    'x-dead-letter-routing-key': QUEUES.DLX_ANALYTICS_ROUTING_KEY
                }
            });
        } catch (err) {
            if (err.code === 404) {
                console.log(`Creating new queue: ${QUEUES.VIDEO_LOGS}`);
                await ch.assertQueue(QUEUES.VIDEO_LOGS, { 
                    durable: true,
                    arguments: {
                        'x-dead-letter-exchange': QUEUES.DLX_EXCHANGE,
                        'x-dead-letter-routing-key': QUEUES.DLX_ANALYTICS_ROUTING_KEY
                    }
                });
            } else {
                throw err;
            }
        }
    }

// workers/clickhouseWorker.js - ใน startConsuming
async startConsuming(ch) {
    await ch.consume(QUEUES.VIDEO_LOGS, async (msg) => {
        if (!msg) return;

        try {
            const rawContent = msg.content.toString();
            let data;
            
            try {
                data = JSON.parse(rawContent);
            } catch (e) {
                console.error('❌ Invalid JSON:', rawContent);
                ch.nack(msg, false, false);
                return;
            }
            
            console.log('📦 RAW:', JSON.stringify(data, null, 2));
            
            // ✅ ตรวจสอบว่า data เป็น array หรือ object
            if (Array.isArray(data)) {
                console.log('📦 Data is array with', data.length, 'items');
                // ถ้าเป็น array ให้แยกประมวลผลทีละตัว
                for (const item of data) {
                    await this.processSingleMessage(item, msg, ch);
                }
            } else {
                // ถ้าเป็น object เดียว
                await this.processSingleMessage(data, msg, ch);
            }

        } catch (error) {
            console.error('❌ Error:', error);
            ch.nack(msg, false, false);
        }
    }, { noAck: false });
}

// workers/clickhouseWorker.js - ใน processSingleMessage
async processSingleMessage(data, originalMsg, ch) {
    try {
        // ✅ ปัดเศษ currentTime ให้เป็นจำนวนเต็ม
        const currentTime = data.currentTime ? Math.round(data.currentTime) : 0;
        
        // ✅ format timestamp
        let event_time;
        if (data.timestamp) {
            event_time = data.timestamp.replace('T', ' ').replace(/\.\d+Z$/, '');
        } else {
            const now = new Date();
            event_time = now.toISOString().slice(0, 19).replace('T', ' ');
        }
        
        const event = {
            video_id: data.videoId || '',
            user_id: data.userId || 'anonymous',
            watch_duration_seconds: data.duration || 0,
            device_type: data.device || 'desktop',
            event_time: event_time,
            country_code: data.country || 'TH'
            // ✅ ไม่ต้องเก็บ currentTime ใน ClickHouse
        };

        // ✅ log currentTime สำหรับ debug (แต่ไม่ส่งไป ClickHouse)
        console.log(`⏱️ currentTime: ${data.currentTime} -> rounded: ${currentTime}`);

        this.logBuffer.push(event);
        this.messageBuffer.push(originalMsg);
        this.stats.received++;

        console.log('✅ Mapped for ClickHouse:', event);

        const shouldFlush = 
            this.logBuffer.length >= this.BATCH_LIMIT ||
            (this.logBuffer.length >= this.MIN_FLUSH_SIZE && 
             Date.now() - this.lastFlushTime > this.FLUSH_INTERVAL);

        if (shouldFlush) {
            await this.flush(ch);
        }

    } catch (error) {
        console.error('❌ Process error:', error);
        ch.nack(originalMsg, false, true);
    }
}


    startIntervalFlush(ch) {
        setInterval(async () => {
            try {
                // ✅ ใช้ flushLock ป้องกันการ flush ซ้อน
                if (!this.flushLock && this.logBuffer.length >= this.MIN_FLUSH_SIZE) {
                    console.log(`⏰ Interval flush: ${this.logBuffer.length} messages`);
                    await this.flush(ch);
                } else if (this.logBuffer.length > 0) {
                    console.log(`⏳ Buffer has ${this.logBuffer.length} messages (min: ${this.MIN_FLUSH_SIZE})`);
                }
            } catch (error) {
                console.error('Interval flush error:', error);
            }
        }, this.FLUSH_INTERVAL);
    }

    setupConnectionHandlers(connection) {
        connection.on('close', () => {
            console.log('⚠️ RabbitMQ connection closed, reconnecting...');
            setTimeout(() => this.start(), 5000);
        });

        connection.on('error', (err) => {
            console.error('RabbitMQ connection error:', err);
        });
    }

    async flush(ch) {
        // ✅ ใช้ lock ป้องกันการเรียกซ้อน
        if (this.flushLock || this.logBuffer.length === 0) return;
        
        this.flushLock = true;
        this.isFlushing = true;
        this.lastFlushTime = Date.now();
        
        const dataToInsert = [...this.logBuffer];
        const msgsToAck = [...this.messageBuffer];
        
        // clear buffers
        this.logBuffer = [];
        this.messageBuffer = [];

        try {
            console.log(`📝 Inserting ${dataToInsert.length} rows to ClickHouse...`);
            
            if (dataToInsert.length > 0) {
                // ✅ แสดงตัวอย่างข้อมูล
                console.log('📋 Sample:', JSON.stringify(dataToInsert[0], null, 2));
            }
            
            await clickhouse.insert({
                table: 'video_watch_events',
                values: dataToInsert,
                format: 'JSONEachRow',
            });
            
            // ack messages
            for (const msg of msgsToAck) {
                try {
                    ch.ack(msg);
                } catch (ackError) {
                    console.error('Failed to ack message:', ackError);
                }
            }
            
            // ✅ update stats
            this.stats.inserted += dataToInsert.length;
            this.stats.flushes++;
            
            // ✅ log จะต้องแสดงแน่นอน
            console.log(`✅ Flush #${this.stats.flushes}: ${dataToInsert.length} logs to ClickHouse`);
            console.log(`📊 Stats - Received: ${this.stats.received}, Inserted: ${this.stats.inserted}, Failed: ${this.stats.failed}`);
            
            // ✅ log แยกเพื่อความชัดเจน
            console.log('─'.repeat(50));

        } catch (err) {
            console.error('❌ ClickHouse Flush Error:', err);
            console.error('Error details:', {
                code: err.code,
                message: err.message
            });
            
            this.stats.failed += dataToInsert.length;
            
            // nack messages
            for (const msg of msgsToAck) {
                try {
                    ch.nack(msg, false, true);
                } catch (nackError) {
                    console.error('Failed to nack message:', nackError);
                }
            }
        } finally {
            this.isFlushing = false;
            this.flushLock = false;
        }
    }

    async shutdown() {
        console.log('🛑 Shutting down ClickHouseWorker...');
        console.log(`📊 Final stats - Received: ${this.stats.received}, Inserted: ${this.stats.inserted}, Failed: ${this.stats.failed}`);
        
        if (this.logBuffer.length > 0 && this.channel) {
            console.log(`Flushing ${this.logBuffer.length} remaining logs...`);
            await this.flush(this.channel);
        }
        
        if (this.channel) {
            await this.channel.close();
        }
        
        process.exit(0);
    }
}

const worker = new ClickHouseWorker();
worker.start();

process.on('SIGINT', () => worker.shutdown());
process.on('SIGTERM', () => worker.shutdown());

module.exports = ClickHouseWorker;