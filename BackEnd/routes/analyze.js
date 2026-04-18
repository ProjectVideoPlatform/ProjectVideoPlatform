const express = require('express');
const router = express.Router();
const amqplib = require('amqplib');
const QUEUES = require('../services/rabbitmq/queues');
const queueService = require('../services/queueService');
// ── constants ──────────────────────────────────────────
const MAX_BATCH_SIZE = 1000; // hard cap per request
const REQUIRED_FIELDS = ['videoId', 'eventType'];

// ── validation ─────────────────────────────────────────
function validateEvent(event) {
  for (const field of REQUIRED_FIELDS) {
    if (!event[field]) return `Missing field: ${field}`;
  }
  if (typeof event.videoId !== 'string') return 'videoId must be string';
  return null;
}

// ── route ──────────────────────────────────────────────
// POST /analytics/video
// Body: { events: [...] }   (batch)
//   or: { ...singleEvent }  (compat)
router.post('/analytics/video', async (req, res) => {
  try {
    // normalise: single event หรือ batch เข้าด้วยกัน
    let events = Array.isArray(req.body.events)
      ? req.body.events
      : [req.body];

    if (events.length === 0) {
      return res.status(400).json({ error: 'No events provided' });
    }

    if (events.length > MAX_BATCH_SIZE) {
      return res.status(400).json({
        error: `Batch too large. Max ${MAX_BATCH_SIZE} events per request`,
      });
    }

    // validate + enrich ทุก event ก่อน queue
    const valid = [];
    const invalid = [];

    for (let i = 0; i < events.length; i++) {
      const err = validateEvent(events[i]);
      if (err) {
        invalid.push({ index: i, error: err });
      } else {
        valid.push({
          ...events[i],
          // server-side timestamp (ไม่เชื่อ client clock)
          receivedAt: new Date().toISOString(),
        });
      }
    }

    // FIX: ส่ง batch เดียวเข้า RabbitMQ แทน loop N ครั้ง
    // → 1 round-trip แทน N round-trips
    if (valid.length > 0) {
      await queueService.sendToQueue(QUEUES.VIDEO_LOGS, valid);
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