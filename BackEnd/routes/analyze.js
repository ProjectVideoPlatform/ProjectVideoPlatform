const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const kafkaService = require('../services/kafkaService');
const { authenticateToken } = require('../middleware/auth');

const TOPICS = { VIDEO_LOGS: process.env.KAFKA_TOPIC || 'video-logs' };
const MAX_BATCH_SIZE = 1000;
function validateEvent(event) {
  const videoId   = event.video_id   ?? event.videoId;
  const eventType = event.event_type ?? event.eventType;

  if (!videoId)   return 'Missing field: video_id';
  if (!eventType) return 'Missing field: event_type';
  if (typeof videoId !== 'string') return 'video_id must be string';
  return null;
}
router.post('/analytics/video', authenticateToken, async (req, res) => {
  try {
    // ✅ ดึงจาก req.user ที่ middleware เตรียมไว้ให้
    // ใช้ _id เพราะมาจาก MongoDB
    const authenticatedUserId = req.user._id;
    console.log(`[analytics] Received ${Array.isArray(req.body.events) ? req.body.events.length : 1} event(s) from user ${authenticatedUserId}`);
    let events = Array.isArray(req.body.events) ? req.body.events : [req.body];

    if (events.length === 0) return res.status(400).json({ error: 'No events provided' });
    if (events.length > MAX_BATCH_SIZE) return res.status(400).json({ error: `Batch too large` });

    const valid = [];
    for (let i = 0; i < events.length; i++) {
      const err = validateEvent(events[i]);
      if (!err) {
        valid.push({
          ...events[i],
          // ✅ บังคับใช้ ID จาก Server (Cookie) เท่านั้น ป้องกันการปลอมแปลง ID
          user_id: authenticatedUserId, 
          userId: authenticatedUserId,
          event_id: events[i].event_id || crypto.randomUUID(),
          receivedAt: new Date().toISOString(),
        });
      }
    }

    // --- ส่วนส่ง Kafka ปกติ ---
    if (valid.length > 0) {
      const kafkaMessages = valid.map(event => ({
        key: event.session_id || authenticatedUserId, 
        value: JSON.stringify(event)
      }));
      await kafkaService.sendBatch(TOPICS.VIDEO_LOGS, kafkaMessages);
    }

    // --- ส่วนส่งไป ML (Python) ---
    const mlRelevantEvents = valid.filter(event => 
      (event.event_type ?? event.eventType) === 'completed' || 
      (event.event_type ?? event.eventType) === 'watch_chunk'
    );

    if (mlRelevantEvents.length > 0) {
      const mlMessages = mlRelevantEvents.map((event) => ({
        key: authenticatedUserId,
        value: JSON.stringify({
          userId: authenticatedUserId,
          videoId: event.video_id || event.videoId,
          eventType: event.event_type || event.eventType,
          // ✅ กันเหนียวเรื่อง Category
          category: Array.isArray(event.category) ? event.category : [event.category || 'unknown'],
          timestamp: event.receivedAt
        })
      }));
      await kafkaService.sendBatch('user-activities', mlMessages);
    }

    return res.status(202).json({ queued: valid.length });

  } catch (error) {
    console.error('[analytics] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;