const amqp = require('amqplib');
const config = require('../../config/rabbitmq');

let connection;
let channel;

async function getChannel() {
  if (channel) return channel;

  connection = await amqp.connect(config.url);
  channel = await connection.createChannel();

  return channel;
}

module.exports = { getChannel };
