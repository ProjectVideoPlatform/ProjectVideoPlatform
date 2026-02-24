const amqp = require('amqplib');
const { createClient } = require('@clickhouse/client');
const config = require('../config/rabbitmq');
const QUEUES = require('../services/rabbitmq/queues');

const clickhouse = createClient({
    host: 'http://clickhouse_db:8123',
    username: 'default',
    password: '',
    database: 'default',
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
        this.isFlushing = false;
    }

    async start() {
        try {
            const connection = await amqp.connect(config.url);
            const ch = await connection.createChannel();
            
            // วิธีที่ 1: ลบ queue เดิมทิ้งแล้วสร้างใหม่ (ระวัง: ข้อมูลอาจหาย)
            // await ch.deleteQueue(QUEUES.VIDEO_LOGS);
            
            // วิธีที่ 2: ตรวจสอบ queue เดิมก่อนสร้าง
            try {
                // ลอง check queue ว่ามีอยู่แล้วหรือไม่
                const queueInfo = await ch.checkQueue(QUEUES.VIDEO_LOGS);
                console.log(`Queue ${QUEUES.VIDEO_LOGS} exists with ${queueInfo.messageCount} messages`);
                
                // ใช้ queue ที่มีอยู่แล้วโดยไม่ต้อง assert ใหม่
                // หรือถ้าต้องการ assert ให้ใช้ arguments เดิม
                await ch.assertQueue(QUEUES.VIDEO_LOGS, {
                    durable: true,
                     arguments: {
                               'x-dead-letter-exchange': QUEUES.DLX_EXCHANGE,
                               'x-dead-letter-routing-key': QUEUES.DLX_ANALYTICS_ROUTING_KEY
                           }
                });
            } catch (err) {
                // ถ้า queue ไม่มี ให้สร้างใหม่
                if (err.code === 404) {
                    console.log(`Queue ${QUEUES.VIDEO_LOGS} not found, creating new...`);
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
            
            ch.prefetch(this.BATCH_LIMIT);
            console.log(`📊 ClickHouse Analytics Worker started`);

            ch.consume(QUEUES.VIDEO_LOGS, (msg) => {
                if (!msg) return;

                try {
                    const data = JSON.parse(msg.content.toString());
                    
                    const event = {
                        video_id: data.videoId,
                        user_id: data.userId,
                        watch_duration_seconds: data.duration || 0,
                        device_type: data.device || 'desktop',
                        event_time: new Date().toISOString().slice(0, 19).replace('T', ' '),
                        country_code: data.country || 'TH'
                    };

                    this.logBuffer.push(event);
                    this.messageBuffer.push(msg);

                    if (this.logBuffer.length >= this.BATCH_LIMIT) {
                        this.flush(ch);
                    }
                } catch (parseError) {
                    console.error('❌ Failed to parse message:', parseError);
                    ch.nack(msg, false, false);
                }
            }, { noAck: false });

            setInterval(() => this.flush(ch), this.FLUSH_INTERVAL);

            connection.on('close', () => {
                console.log('RabbitMQ connection closed');
                setTimeout(() => this.start(), 5000); // ลอง reconnect
            });

        } catch (error) {
            console.error('[ClickHouseWorker] Startup Error:', error);
            setTimeout(() => this.start(), 5000); // ลอง reconnect
        }
    }

    async flush(ch) {
        if (this.isFlushing || this.logBuffer.length === 0) return;

        this.isFlushing = true;
        const dataToInsert = [...this.logBuffer];
        const msgsToAck = [...this.messageBuffer];
        
        this.logBuffer = [];
        this.messageBuffer = [];

        try {
            await clickhouse.insert({
                table: 'video_watch_events',
                values: dataToInsert,
                format: 'JSONEachRow',
            });
            
            msgsToAck.forEach(m => {
                try {
                    ch.ack(m);
                } catch (ackError) {
                    console.error('Failed to ack message:', ackError);
                }
            });
            
            console.log(`✅ Flushed ${dataToInsert.length} logs to ClickHouse`);
        } catch (err) {
            console.error('❌ ClickHouse Flush Error:', err);
            
            // requeue messages
            msgsToAck.forEach(m => {
                try {
                    ch.nack(m, false, true);
                } catch (nackError) {
                    console.error('Failed to nack message:', nackError);
                }
            });
        } finally {
            this.isFlushing = false;
        }
    }

    async shutdown() {
        console.log('Shutting down ClickHouseWorker...');
        if (this.logBuffer.length > 0 && this.channel) {
            await this.flush(this.channel);
        }
        process.exit(0);
    }
}

const worker = new ClickHouseWorker();
worker.start();

process.on('SIGINT', () => worker.shutdown());
process.on('SIGTERM', () => worker.shutdown());

module.exports = ClickHouseWorker;