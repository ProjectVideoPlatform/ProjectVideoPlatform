const { getChannel } = require('./connection');
const QUEUES = require('./queues');

async function setupInfra() {
    const ch = await getChannel();

    // 1. ประกาศ Exchange กลางสำหรับของเสีย
    await ch.assertExchange(QUEUES.DLX_EXCHANGE, 'direct', { durable: true });

    // 2. สร้างถังขยะสำหรับ Email และผูก Key
    await ch.assertQueue(QUEUES.DLX_EMAIL_QUEUE, { durable: true });
    await ch.bindQueue(QUEUES.DLX_EMAIL_QUEUE, QUEUES.DLX_EXCHANGE, QUEUES.DLX_EMAIL_ROUTING_KEY);

    // 3. สร้างถังขยะสำหรับ Analytics และผูก Key (เพิ่มใหม่!)
    await ch.assertQueue(QUEUES.DLX_ANALYTICS_QUEUE, { durable: true });
    await ch.bindQueue(QUEUES.DLX_ANALYTICS_QUEUE, QUEUES.DLX_EXCHANGE, QUEUES.DLX_ANALYTICS_ROUTING_KEY);
     
    await ch.assertQueue(QUEUES.DLX_TRANS_QUEUE, { durable: true });
    await ch.bindQueue(QUEUES.DLX_TRANS_QUEUE, QUEUES.DLX_EXCHANGE, QUEUES.DLX_TRANS_ROUTING_KEY);
    // 4. คิวหลัก: EMAIL_NOTIFY (ส่งไปที่ถังขยะ Email)
    await ch.assertQueue(QUEUES.EMAIL_NOTIFY, {
        durable: true,
        arguments: {
            'x-dead-letter-exchange': QUEUES.DLX_EXCHANGE,
            'x-dead-letter-routing-key': QUEUES.DLX_EMAIL_ROUTING_KEY
        }
    });

    // 5. คิวหลัก: VIDEO_LOGS (ส่งไปที่ถังขยะ Analytics)
    await ch.assertQueue(QUEUES.VIDEO_LOGS, {
        durable: true,
        arguments: {
            'x-queue-mode': 'lazy', // ✅ เปลี่ยนเป็น Lazy Queue
            'x-dead-letter-exchange': QUEUES.DLX_EXCHANGE,
            'x-dead-letter-routing-key': QUEUES.DLX_ANALYTICS_ROUTING_KEY
        }
    });

    console.log("✅ RabbitMQ Infrastructure with Multi-DLQ is ready!");
     await ch.assertQueue(QUEUES.VIDEO_TRANSCODE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': QUEUES.DLX_EXCHANGE,
      'x-dead-letter-routing-key': QUEUES.DLX_TRANS_ROUTING_KEY
    }
  });
}
setupInfra().catch(err => {
    console.error("RabbitMQ setup error:", err);
    process.exit(1);
} );    

module.exports = { setupInfra };