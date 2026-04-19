const express = require('express');
const router = express.Router();
const crypto = require('crypto'); // ✅ เพิ่ม crypto
const kafkaService = require('../services/kafkaService');

// สมมติว่ามีไฟล์เก็บชื่อ Topic ไว้
const TOPICS = { VIDEO_LOGS: process.env.KAFKA_TOPIC || 'video-logs' };

const MAX_BATCH_SIZE = 1000;
const REQUIRED_FIELDS = ['videoId', 'eventType']; // ตามโค้ดเดิมของคุณ (eventType แบบ camelCase)

function validateEvent(event) {
  for (const field of REQUIRED_FIELDS) {
    if (!event[field]) return `Missing field: ${field}`;
  }
  if (typeof event.videoId !== 'string') return 'videoId must be string';
  return null;
}

router.post('/analytics/video', async (req, res) => {
  try {
    let events = Array.isArray(req.body.events) ? req.body.events : [req.body];

    if (events.length === 0) {
      return res.status(400).json({ error: 'No events provided' });
    }
    if (events.length > MAX_BATCH_SIZE) {
      return res.status(400).json({ error: `Batch too large. Max ${MAX_BATCH_SIZE}` });
    }

    const valid = [];
    const invalid = [];

    for (let i = 0; i < events.length; i++) {
      const err = validateEvent(events[i]);
      if (err) {
        invalid.push({ index: i, error: err });
      } else {
        valid.push({
          ...events[i],
          // ✅ สร้าง event_id ทันที เพื่อรับประกันว่าถ้า Kafka retry ID จะไม่เปลี่ยน
          event_id: events[i].event_id || crypto.randomUUID(),
          receivedAt: new Date().toISOString(),
        });
      }
    }

    if (valid.length > 0) {
      // ✅ แปลงเป็น Format ของ Kafka
      const kafkaMessages = valid.map(event => ({
        // ใช้ sessionId เป็นคีย์หลัก เพื่อให้ event ของ session เดียวกันลง Partition เดียวกัน (รักษาลำดับ)
        key: event.sessionId || event.userId || event.videoId || 'unknown',
        value: JSON.stringify(event)
      }));

      await kafkaService.sendBatch(TOPICS.VIDEO_LOGS, kafkaMessages);
    }

    return res.status(202).json({
      queued: valid.length,
      rejected: invalid.length,
      ...(invalid.length > 0 && { errors: invalid }),
    });

  } catch (error) {
    console.error('[analytics] route error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;