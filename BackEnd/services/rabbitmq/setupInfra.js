const { getChannel } = require('./connection');
const QUEUES = require('./queues');

async function setupInfra() {
  const ch = await getChannel();

  // DLX
  await ch.assertExchange(QUEUES.DLX_EXCHANGE, 'direct', { durable: true });
  await ch.assertQueue(QUEUES.DLX_QUEUE, { durable: true });
  await ch.bindQueue(
    QUEUES.DLX_QUEUE,
    QUEUES.DLX_EXCHANGE,
    QUEUES.DLX_ROUTING_KEY
  );

  // Retry Queue (delay retry)
  await ch.assertQueue(QUEUES.RETRY_QUEUE, {
    durable: true,
    arguments: {
    'x-dead-letter-exchange': QUEUES.DLX_EXCHANGE,
    'x-dead-letter-routing-key': QUEUES.DLX_ROUTING_KEY,
      'x-message-ttl': 60000
    }
  });

  // Delay Queue (schedule future job)
  await ch.assertQueue(QUEUES.DELAY_QUEUE, {
    durable: true,
    arguments: {
        'x-dead-letter-exchange': QUEUES.DLX_EXCHANGE,
    'x-dead-letter-routing-key': QUEUES.DLX_ROUTING_KEY
    }
  });
  await ch.assertQueue(QUEUES.VIDEO_TRANSCODE, {
  durable: true,
  arguments: {
    'x-dead-letter-exchange': QUEUES.DLX_EXCHANGE,
    'x-dead-letter-routing-key': QUEUES.DLX_ROUTING_KEY
  }
});

await ch.assertQueue(QUEUES.EMAIL_NOTIFY, {
  durable: true,
  arguments: {
    'x-dead-letter-exchange': QUEUES.DLX_EXCHANGE,
    'x-dead-letter-routing-key': QUEUES.DLX_ROUTING_KEY
  }
});
}



module.exports = { setupInfra };
