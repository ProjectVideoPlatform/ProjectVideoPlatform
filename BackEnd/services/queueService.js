const { getChannel } = require('./rabbitmq/connection');

async function sendToQueue(queueName, data) {
  const ch = await getChannel();


  return ch.sendToQueue(
    queueName,
    Buffer.from(JSON.stringify(data)),
    { persistent: true }
  );
}
const publishToExchange = async (exchangeName, data) => {
  try {
    // สมมติว่าคุณมีตัวแปร channel ที่เชื่อมต่อ RabbitMQ ไว้อยู่แล้วในไฟล์นี้
    // ตรวจสอบหรือสร้าง Exchange แบบ 'fanout' (กระจายให้ทุกคิวที่ผูกไว้)
    await channel.assertExchange(exchangeName, 'fanout', { durable: true });
    
    // โยนข้อมูลเข้า Exchange (ไม่มีชื่อคิวระบุ เพราะ Exchange จะจัดการกระจายเอง)
    channel.publish(exchangeName, '', Buffer.from(JSON.stringify(data)));
    console.log(`[RabbitMQ] Published log to exchange: ${exchangeName}`);
  } catch (error) {
    console.error('[RabbitMQ] Publish error:', error);
  }
};
module.exports = { sendToQueue, publishToExchange };
