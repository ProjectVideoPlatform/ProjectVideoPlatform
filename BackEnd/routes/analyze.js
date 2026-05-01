const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const kafkaService        = require('../services/kafkaService');
const { authenticateToken } = require('../middleware/auth'); // ✅ ใช้ JWT

const TOPICS = {
  VIDEO_LOGS:      process.env.KAFKA_TOPIC || 'video-logs',
  USER_ACTIVITIES: 'user-activities',
};
const MAX_BATCH_SIZE = 1000;

function validateEvent(event) {
  const videoId   = event.video_id   ?? event.videoId;
  const eventType = event.event_type ?? event.eventType;
  if (!videoId)                    return 'Missing field: video_id';
  if (!eventType)                  return 'Missing field: event_type';
  if (typeof videoId !== 'string') return 'video_id must be string';
  return null;
}

router.post('/analytics/video', authenticateToken, async (req, res) => {
  try {
    // ✅ ดึงจาก JWT token — น่าเชื่อถือกว่า cookie
    const userId = req.user?.id || req.user?._id || 'anonymous';

    let events = Array.isArray(req.body.events) ? req.body.events : [req.body];
    if (events.length === 0)              return res.status(400).json({ error: 'No events provided' });
    if (events.length > MAX_BATCH_SIZE)   return res.status(400).json({ error: 'Batch too large' });

    // validate + inject userId
    const valid = [];
    for (const event of events) {
      if (!validateEvent(event)) {
        valid.push({
          ...event,
          user_id:  userId,
          userId:   userId,
          event_id: event.event_id || crypto.randomUUID(),
          receivedAt: new Date().toISOString(),
        });
      }
    }

    if (valid.length === 0) return res.status(400).json({ error: 'All events invalid' });

    // ── 1. ClickHouse pipeline (ทุก event) ──────────────────
    await kafkaService.sendBatch(
      TOPICS.VIDEO_LOGS,
      valid.map(e => ({
        key:   String(e.session_id || userId),
        value: JSON.stringify(e),
      }))
    );

    // ── 2. ML pipeline (เฉพาะ completed) ────────────────────
    // watch_chunk ส่งบ่อยมาก แต่ ml-worker ต้องการแค่รู้ว่า
    // user ดูวิดีโออะไรจบ → ใช้ completed อย่างเดียวพอ
    const mlEvents = valid.filter(e =>
      (e.event_type ?? e.eventType) === 'completed'
    );

    if (mlEvents.length > 0 && userId !== 'anonymous') {
      await kafkaService.sendBatch(
        TOPICS.USER_ACTIVITIES,
        mlEvents.map(e => ({
          key:   userId,
          value: JSON.stringify({
            userId:    userId,
            videoId:   String(e.video_id || e.videoId),
            eventType: e.event_type || e.eventType,
            category:  Array.isArray(e.video_category)
                         ? e.video_category
                         : [e.video_category || 'unknown'],
            timestamp: e.receivedAt,
          }),
        }))
      );
          await kafkaService.sendBatch(
        TOPICS.USER_,
        mlEvents.map(e => ({
          key:   userId,
          value: JSON.stringify({
            userId:    userId,
            videoId:   String(e.video_id || e.videoId),
            eventType: e.event_type || e.eventType,
            category:  Array.isArray(e.video_category)
                         ? e.video_category
                         : [e.video_category || 'unknown'],
            timestamp: e.receivedAt,
          }),
        }))
      );
    }

    return res.status(202).json({ queued: valid.length });

  } catch (error) {
    console.error('[analytics] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;