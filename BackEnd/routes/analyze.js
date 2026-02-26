// routes/analytics.js
const express = require('express');
const router = express.Router();
const queueService = require('../services/queueService');
const QUEUES = require('../services/rabbitmq/queues');

// ✅ Public endpoint - ไม่ต้อง authenticate
router.post('/analytics/video', async (req, res) => {
    try {
        const { events, batch } = req.body;
        
        console.log('📨 Received analytics:', {
            count: events?.length,
            firstEvent: events?.[0]
        });

        if (batch && Array.isArray(events)) {
            for (const event of events) {
                // ✅ ส่งเข้า RabbitMQ
                await queueService.sendToQueue(QUEUES.VIDEO_LOGS, event);
            }
            
            console.log(`✅ Enqueued ${events.length} events`);
            res.status(202).json({ 
                message: 'Analytics received',
                count: events.length 
            });
        } else {
            res.status(400).json({ error: 'Invalid format' });
        }
        
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;