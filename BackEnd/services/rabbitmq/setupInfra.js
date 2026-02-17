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
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': QUEUES.VIDEO_TRANSCODE,
      'x-message-ttl': 60000
    }
  });

  // Delay Queue (schedule future job)
  await ch.assertQueue(QUEUES.DELAY_QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': QUEUES.VIDEO_TRANSCODE
    }
  });
}

module.exports = { setupInfra };
