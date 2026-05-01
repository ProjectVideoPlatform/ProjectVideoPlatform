// ── analytics route ───────────────────────────────────────────────────────────
const express    = require('express');
const router     = express.Router();
const crypto     = require('crypto');
const kafkaService          = require('../services/kafkaService');
const { authenticateToken } = require('../middleware/auth');

const TOPICS = {
  VIDEO_LOGS:      process.env.KAFKA_TOPIC || 'video-logs',
  USER_ACTIVITIES: 'user-activities',
};
const MAX_BATCH_SIZE = 1000;

// ── validateEvent: return error string หรือ null ──────────────────────────────
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
    const userId = req.user?.id || req.user?._id || 'anonymous';

    let events = Array.isArray(req.body.events) ? req.body.events : [req.body];
    if (events.length === 0)            return res.status(400).json({ error: 'No events provided' });
    if (events.length > MAX_BATCH_SIZE) return res.status(400).json({ error: 'Batch too large' });

    // ── BUG FIX: เดิม `if (!validateEvent(event))` → เอา invalid เข้า ─────────
    // แก้เป็น `if (validationError === null)` → เอาเฉพาะ valid
    const valid   = [];
    const invalid = [];

    for (const event of events) {
      const err = validateEvent(event);
      if (err !== null) {
        invalid.push({ event, reason: err });
        continue;
      }
      valid.push({
        ...event,
        user_id:    userId,
        userId:     userId,
        // event_id: ถ้า client ส่งมาให้ใช้ของเดิม (idempotency key)
        //           ถ้าไม่มีค่อย generate — client ควรส่งมาเพื่อให้ Flink dedup ได้
        event_id:   event.event_id ?? crypto.randomUUID(),
        receivedAt: new Date().toISOString(),
      });
    }

    // แจ้ง caller ว่า event ไหน invalid — ไม่ silent drop
    if (valid.length === 0) {
      return res.status(400).json({
        error:   'All events invalid',
        details: invalid.map(i => i.reason),
      });
    }

    // ── 1. ClickHouse pipeline (ทุก valid event) ──────────────────────────────
    await kafkaService.sendBatch(
      TOPICS.VIDEO_LOGS,
      valid.map(e => ({
        // key = session_id เพื่อให้ events ของ session เดียวกันไป partition เดียวกัน
        // → ordering guarantee ต่อ session
        key:   String(e.session_id || userId),
        value: JSON.stringify(e),
        // headers ช่วย debug / trace ใน Kafka UI โดยไม่ต้อง parse value
        headers: {
          'event-id':   e.event_id,
          'event-type': String(e.event_type ?? e.eventType ?? ''),
          'user-id':    String(userId),
        },
      }))
    );

    // ── 2. ML pipeline (เฉพาะ completed + logged-in user) ────────────────────
    const mlEvents = valid.filter(
      e => (e.event_type ?? e.eventType) === 'completed'
    );

    if (mlEvents.length > 0 && userId !== 'anonymous') {
      await kafkaService.sendBatch(
        TOPICS.USER_ACTIVITIES,
        mlEvents.map(e => ({
          key:   userId,
          value: JSON.stringify({
            userId,
            videoId:   String(e.video_id || e.videoId),
            eventType: e.event_type || e.eventType,
            category:  Array.isArray(e.video_category)
                         ? e.video_category
                         : [e.video_category || 'unknown'],
            timestamp: e.receivedAt,
            event_id:  e.event_id, // ← ส่ง event_id ไปด้วยให้ Flink ใช้ dedup
          }),
          headers: { 'event-id': e.event_id },
        }))
      );
    }

    // แจ้ง partial success ถ้ามี invalid ปนมา
    return res.status(202).json({
      queued:  valid.length,
      ...(invalid.length > 0 && {
        skipped: invalid.length,
        reasons: invalid.map(i => i.reason),
      }),
    });

  } catch (error) {
    console.error('[analytics] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;