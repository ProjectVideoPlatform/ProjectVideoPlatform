// ── kafkaService.js ───────────────────────────────────────────────────────────
const { Kafka, Partitioners } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'analytics-api-producer',
  brokers: (process.env.KAFKA_BROKERS || 'kafka:9092').split(','),
});

const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,

  // ── IDEMPOTENT PRODUCER ────────────────────────────────────────────────────
  // idempotent: true  → Kafka ออก PID + sequence number ให้ producer
  //                     ถ้า broker รับ message เดิมซ้ำ (network retry) จะ dedup ให้อัตโนมัติ
  //                     ครอบคลุม: network blip, producer retry
  //                     ไม่ครอบคลุม: application-level replay (ต้องใช้ event_id แยก)
  idempotent: true,

  // idempotent ต้องการ acks: -1 (all replicas confirm) เสมอ
  // ถ้าไม่ set KafkaJS จะ throw ConfigurationException ตอน connect
  acks: -1,

  // retry ระดับ KafkaJS (ต่างจาก retry ใน sendBatch ที่เราทำเอง)
  // KafkaJS จัดการ retriable errors (LeaderNotAvailable, etc.) ให้
  retry: {
    initialRetryTime: 200,
    retries: 5,
  },
});

let _connected = false;
producer.on(producer.events.CONNECT,    () => { _connected = true;  });
producer.on(producer.events.DISCONNECT, () => { _connected = false; });

async function ensureConnected() {
  if (_connected) return;
  try {
    await producer.connect();
    console.log('[Kafka] Producer connected (idempotent=true)');
  } catch (err) {
    console.error('[Kafka] Producer connection failed:', err.message);
    throw err;
  }
}

// ── sendBatch: retry เฉพาะ non-retriable errors ───────────────────────────────
// KafkaJS idempotent mode จัดการ retriable errors เองแล้ว
// retry loop ที่นี่ cover เฉพาะ: disconnect กลางคัน, timeout จาก load spike
const MAX_SEND_RETRIES = 3;

const kafkaService = {
  connect: ensureConnected,

  sendBatch: async (topic, messages) => {
    await ensureConnected();

    let lastErr;
    for (let attempt = 1; attempt <= MAX_SEND_RETRIES; attempt++) {
      try {
        await producer.send({
          topic,
          messages,
          // acks: -1 ถูก set ระดับ producer แล้ว ไม่ต้อง set ซ้ำที่นี่
        });
        return;
      } catch (err) {
        lastErr = err;
        console.error(
          `[Kafka] send attempt ${attempt}/${MAX_SEND_RETRIES} failed:`,
          err.message
        );
        if (attempt < MAX_SEND_RETRIES) {
          await new Promise(r => setTimeout(r, 200 * attempt));
          if (!_connected) await ensureConnected();
        }
      }
    }
    throw lastErr;
  },

  disconnect: async () => {
    if (_connected) await producer.disconnect();
  },
};

module.exports = kafkaService;