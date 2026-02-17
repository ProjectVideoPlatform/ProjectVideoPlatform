const { getChannel } = require('./rabbitmq/connection');

async function sendToQueue(queueName, data) {
  const ch = await getChannel();

  await ch.assertQueue(queueName, { durable: true });

  return ch.sendToQueue(
    queueName,
    Buffer.from(JSON.stringify(data)),
    { persistent: true }
  );
}

module.exports = { sendToQueue };
