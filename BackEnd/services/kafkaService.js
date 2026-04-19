const { Kafka, Partitioners } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'analytics-api-producer',
  brokers: (process.env.KAFKA_BROKERS || 'kafka:9092').split(','),
});

// ใช้ DefaultPartitioner เพื่อประสิทธิภาพที่ดีที่สุด
const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
});

let isConnected = false;

const kafkaService = {
  connect: async () => {
    if (isConnected) return;
    try {
      await producer.connect();
      isConnected = true;
      console.log('[Kafka] Producer connected successfully');
    } catch (error) {
      console.error('[Kafka] Producer connection failed:', error);
    }
  },

  sendBatch: async (topic, messages) => {
    if (!isConnected) await kafkaService.connect();
    
    try {
      await producer.send({
        topic,
        messages, // messages ต้องเป็น array ของ { key, value }
      });
    } catch (error) {
      console.error(`[Kafka] Failed to send batch to ${topic}:`, error);
      throw error;
    }
  },

  disconnect: async () => {
    if (isConnected) {
      await producer.disconnect();
      isConnected = false;
    }
  }
};

module.exports = kafkaService;