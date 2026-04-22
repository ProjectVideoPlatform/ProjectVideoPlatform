const express = require('express');
const router = express.Router();
const crypto = require('crypto'); // ✅ เพิ่ม crypto
const kafkaService = require('../services/kafkaService');

// สมมติว่ามีไฟล์เก็บชื่อ Topic ไว้
const TOPICS = { VIDEO_LOGS: process.env.KAFKA_TOPIC || 'video-logs' };

const MAX_BATCH_SIZE = 1000;
const REQUIRED_FIELDS = ['videoId', 'eventType']; // ตามโค้ดเดิมของคุณ (eventType แบบ camelCase)

// แก้เป็น
function validateEvent(event) {
  const videoId   = event.video_id   ?? event.videoId;
  const eventType = event.event_type ?? event.eventType;

  if (!videoId)   return 'Missing field: video_id';
  if (!eventType) return 'Missing field: event_type';
  if (typeof videoId !== 'string') return 'video_id must be string';
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
       key: event.session_id ?? event.sessionId ?? event.user_id ?? event.userId ?? event.video_id ?? event.videoId ?? 'unknown',
        value: JSON.stringify(event)
      }));

      await kafkaService.sendBatch(TOPICS.VIDEO_LOGS, kafkaMessages);
    }
const mlRelevantEvents = valid.filter(event => 
 (event.event_type ?? event.eventType) === 'completed' || 
(event.event_type ?? event.eventType) === 'watch_chunk'
);

if (mlRelevantEvents.length > 0) {
    
    // ดึงจาก Redis ที่เรา SET ไว้ใน Webhoo
    
 const mlMessages = mlRelevantEvents.map((event) => {
    // 1. ดึงค่า category จาก event (รองรับทั้งชื่อ category และ video_category)
    let categoryData = event.category || event.video_category || 'unknown';
    
    // 2. ตรวจสอบว่าเป็น Array หรือไม่ (จาก log ของคุณมันคือ ["comedy"])
    // ถ้าเป็น Array ให้ดึงตัวแรกออกมา หรือส่งไปทั้ง Array เลยก็ได้
    // ในที่นี้ผมแนะนำให้ส่งเป็น Array ไปเพื่อให้ Python จัดการต่อครับ
    const finalCategory = Array.isArray(categoryData) ? categoryData : [categoryData];

    return {
        key: event.user_id || event.userId || 'anonymous',
        value: JSON.stringify({
            userId: event.user_id || event.userId,
            videoId: event.video_id || event.videoId,
            eventType: event.event_type || event.eventType,
            category: finalCategory, // ✅ ส่งเป็น Array [ "comedy" ]
            timestamp: event.receivedAt
        })
    };
});

    await kafkaService.sendBatch('user-activities', mlMessages);
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
}
);

module.exports = router;