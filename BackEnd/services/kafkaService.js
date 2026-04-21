const { Kafka, Partitioners } = require('kafkajs');
 
const kafka = new Kafka({
  clientId: 'analytics-api-producer',
  brokers:  (process.env.KAFKA_BROKERS || 'kafka:9092').split(','),
});
 
const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
});
 
// ── FIX #1: ใช้ producer event แทน module-level flag ──────────────────────────
// isConnected flag ไม่รู้ว่า broker drop ไปหรือเปล่า
// producer.events บอก state จริงจาก kafkajs
let _connected = false;
producer.on(producer.events.CONNECT,    () => { _connected = true;  });
producer.on(producer.events.DISCONNECT, () => { _connected = false; });
 
// ── FIX #2: connect() throw แทน silent catch ──────────────────────────────────
// เดิม catch แล้วไม่ throw → sendBatch() เรียก connect() แต่ไม่รู้ว่า fail
async function ensureConnected() {
  if (_connected) return;
  try {
    await producer.connect();
    console.log('[Kafka] Producer connected');
  } catch (err) {
    console.error('[Kafka] Producer connection failed:', err.message);
    throw err; // ให้ caller จัดการ ไม่ swallow
  }
}
 
// ── FIX #3: retry ตอน send fail (network blip) ────────────────────────────────
const MAX_SEND_RETRIES = 3;
 
const kafkaService = {
  connect: ensureConnected,
 
  sendBatch: async (topic, messages) => {
    await ensureConnected();
 
    let lastErr;
    for (let attempt = 1; attempt <= MAX_SEND_RETRIES; attempt++) {
      try {
        await producer.send({ topic, messages });
        return; // success
      } catch (err) {
        lastErr = err;
        console.error(`[Kafka] send attempt ${attempt}/${MAX_SEND_RETRIES} failed:`, err.message);
        if (attempt < MAX_SEND_RETRIES) {
          // exponential backoff: 200ms, 400ms
          await new Promise(r => setTimeout(r, 200 * attempt));
          // reconnect ถ้า disconnect ระหว่าง retry
          if (!_connected) await ensureConnected();
        }
      }
    }
    throw lastErr; // หมด retry แล้วยัง fail → throw ให้ caller
  },
 
  disconnect: async () => {
    if (_connected) {
      await producer.disconnect();
    }
  },
};
 
module.exports = kafkaService;
 