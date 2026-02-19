const { getChannel } = require('../services/rabbitmq/connection');
const QUEUES = require('../services/rabbitmq/queues');

class BaseWorker {
  constructor(queueName, handler) {
    this.queueName = queueName;
    this.handler = handler;
  }

  async start() {
    const ch = await getChannel();
    ch.prefetch(5);

    console.log(`Worker started for ${this.queueName}`);

    ch.consume(this.queueName, async (msg) => {
      if (!msg) return;

      try {
        const data = JSON.parse(msg.content.toString());
        await this.handler(data);

        ch.ack(msg);

      } catch (err) {
        console.error('Worker error:', err.message);
        ch.nack(msg, false, false);
      }
    });
  }
}

module.exports = BaseWorker;
