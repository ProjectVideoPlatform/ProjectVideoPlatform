// setupInfra.js
const { getChannel } = require('./connection');
const QUEUES = require('./queues');

async function setupInfra() {
    const ch = await getChannel();

    // 1. DLX Exchange
    await ch.assertExchange(QUEUES.DLX_EXCHANGE, 'direct', { durable: true });

    // 2. DLQ — Email
    await ch.assertQueue(QUEUES.DLX_EMAIL_QUEUE, { durable: true });
    await ch.bindQueue(QUEUES.DLX_EMAIL_QUEUE, QUEUES.DLX_EXCHANGE, QUEUES.DLX_EMAIL_ROUTING_KEY);

    // 3. DLQ — Analytics
    await ch.assertQueue(QUEUES.DLX_ANALYTICS_QUEUE, { durable: true });
    await ch.bindQueue(QUEUES.DLX_ANALYTICS_QUEUE, QUEUES.DLX_EXCHANGE, QUEUES.DLX_ANALYTICS_ROUTING_KEY);

    // 4. DLQ — Transcode
    await ch.assertQueue(QUEUES.DLX_TRANS_QUEUE, { durable: true });
    await ch.bindQueue(QUEUES.DLX_TRANS_QUEUE, QUEUES.DLX_EXCHANGE, QUEUES.DLX_TRANS_ROUTING_KEY);

    // 5. DLQ — Embedding ✅ เพิ่ม
    await ch.assertQueue(QUEUES.DLX_EMBEDDING_QUEUE, { durable: true });
    await ch.bindQueue(QUEUES.DLX_EMBEDDING_QUEUE, QUEUES.DLX_EXCHANGE, QUEUES.DLX_EMBEDDING_ROUTING_KEY);

    // 6. Main queue — EMAIL_NOTIFY
    await ch.assertQueue(QUEUES.EMAIL_NOTIFY, {
        durable: true,
        arguments: {
            'x-dead-letter-exchange':    QUEUES.DLX_EXCHANGE,
            'x-dead-letter-routing-key': QUEUES.DLX_EMAIL_ROUTING_KEY
        }
    });

    // 7. Main queue — VIDEO_LOGS
    await ch.assertQueue(QUEUES.VIDEO_LOGS, {
        durable: true,
        arguments: {
            'x-queue-mode':              'lazy',
            'x-dead-letter-exchange':    QUEUES.DLX_EXCHANGE,
            'x-dead-letter-routing-key': QUEUES.DLX_ANALYTICS_ROUTING_KEY
        }
    });

    // 8. Main queue — VIDEO_TRANSCODE
    await ch.assertQueue(QUEUES.VIDEO_TRANSCODE, {
        durable: true,
        arguments: {
            'x-dead-letter-exchange':    QUEUES.DLX_EXCHANGE,
            'x-dead-letter-routing-key': QUEUES.DLX_TRANS_ROUTING_KEY
        }
    });

    // 9. Main queue — VIDEO_INDEX ✅ แก้ typo QUEUEX.DLX → QUEUES
    await ch.assertQueue(QUEUES.VIDEO_INDEX, {
        durable: true,
        arguments: {
            'x-dead-letter-exchange':    QUEUES.DLX_EXCHANGE,
            'x-dead-letter-routing-key': QUEUES.DLX_EMBEDDING_ROUTING_KEY
        }
    });

    console.log("✅ RabbitMQ Infrastructure ready!");
}

setupInfra().catch(err => {
    console.error("RabbitMQ setup error:", err);
    process.exit(1);
});

module.exports = { setupInfra };