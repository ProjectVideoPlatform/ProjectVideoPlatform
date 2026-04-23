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

// 🆕 Helper function to sanitize ObjectId
function sanitizeObjectId(value) {
  if (!value) return 'anonymous';
  
  // ถ้าเป็น ObjectId จาก MongoDB
  if (typeof value === 'object' && value !== null) {
    // Mongoose ObjectId หรือ MongoDB ObjectId
    if (value._bsontype === 'ObjectId' || value.toString) {
      return value.toString();
    }
  }
  
  // ถ้าเป็น string อยู่แล้วก็คืนค่าเดิม
  return String(value);
}

router.post('/analytics/video', authenticateToken, async (req, res) => {
  try {
    // ✅ แปลง ObjectId เป็น string ทันทีที่ได้รับ
    const authenticatedUserId = sanitizeObjectId(req.user._id);
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
          // ✅ ใช้ sanitized userId ที่เป็น string แล้ว
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
        key: String(event.session_id || authenticatedUserId), // 🆕 บังคับเป็น string
        value: JSON.stringify(event) // event มี user_id เป็น string แล้ว
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
        key: authenticatedUserId, // 🆕 เป็น string แล้ว
        value: JSON.stringify({
          userId: authenticatedUserId, // 🆕 เป็น string แล้ว
          videoId: String(event.video_id || event.videoId), // 🆕 บังคับเป็น string
          eventType: event.event_type || event.eventType,
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