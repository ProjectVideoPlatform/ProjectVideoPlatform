'use strict';

const express = require('express');
const router = express.Router();
const PurchaseService = require('../services/PurchaseService');
const Purchase = require('../models/Purchase');
const Video = require('../models/Video');
const { authenticateToken } = require('../middleware/auth');
const preventDuplicate = require('../middleware/preventduplicate');
const { releaseLockMiddleware } = require('../middleware/releaseLock');
const validateRequest = require('../middleware/validateRequest');
const rateLimiter = require('../middleware/rateLimiter');
const customValidators = require('../utils/customValidators');

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: Authorize — อายัดวงเงิน, ส่ง clientSecret กลับ
// POST /api/purchase/video/:videoId/purchase
// ─────────────────────────────────────────────────────────────────────────────
router.post('/video/:videoId/purchase',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 10 }),
  preventDuplicate('purchase', { ttl: 30 }),
  releaseLockMiddleware,
validateRequest({
  params: { videoId: ['required', 'mongoId'] },
  body: {
    currency:      ['optional', { in: ['THB', 'USD', 'EUR'] }],
    paymentMethod: ['optional', { in: ['card', 'promptpay'] }]  // ← เพิ่ม
  }
}),
  async (req, res, next) => {
    try {
      const { videoId } = req.params;
      const userId = req.user._id;

      const video = await Video.findById(videoId);
      if (!video) {
        return res.status(404).json({ error: 'Video not found' });
      }
      if (video.accessType === 'free') {
        return res.status(400).json({ error: 'This video is free, no purchase needed' });
      }

      const result = await PurchaseService.purchaseVideo(userId, videoId, {
        currency: req.body.currency || 'THB',
        paymentMethod: req.body.paymentMethod || 'card'
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: Confirm — frontend ยืนยันบัตรแล้ว → capture + บันทึก DB
// POST /api/purchase/video/:videoId/confirm
// ─────────────────────────────────────────────────────────────────────────────
router.post('/video/:videoId/confirm',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 10 }),
  preventDuplicate('confirm', { ttl: 60 }),
  releaseLockMiddleware,
 validateRequest({
  params: { videoId: ['required', 'mongoId'] },
  body: {
    currency:      ['optional', { in: ['THB', 'USD', 'EUR'] }],
    paymentMethod: ['optional', { in: ['card', 'promptpay'] }]  // ← เพิ่ม
  }
}),
  async (req, res, next) => {
    try {
      const { videoId } = req.params;
      const userId = req.user._id;

 const result = await PurchaseService.purchaseVideo(userId, videoId, {
  currency:      req.body.currency || 'THB',
  paymentMethod: req.body.paymentMethod        // ← เพิ่ม
});

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Bulk purchase
// POST /api/purchase/videos/bulk-purchase  → authorize
// POST /api/purchase/videos/bulk-confirm   → capture + save
// ─────────────────────────────────────────────────────────────────────────────
router.post('/videos/bulk-purchase',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 5 }),
  preventDuplicate('bulk_purchase', { ttl: 60 }),
  releaseLockMiddleware,
  validateRequest({
    body: {
      videoIds: [
        'required',
        'array',
        { custom: customValidators.isMongoIdArray },
        { custom: customValidators.uniqueVideoIds },
        { custom: customValidators.maxVideoIds(100) }
      ],
      currency: ['optional', { in: ['THB', 'USD', 'EUR'] }]
    }
  }),
  async (req, res, next) => {
    try {
      const { videoIds, currency } = req.body;
      const userId = req.user._id;

      const result = await PurchaseService.bulkPurchaseVideos(userId, videoIds, {
        currency: currency || 'THB'
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

router.post('/videos/bulk-confirm',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 5 }),
  preventDuplicate('bulk_confirm', { ttl: 60 }),
  releaseLockMiddleware,
  validateRequest({
    body: {
      videoIds: [
        'required',
        'array',
        { custom: customValidators.isMongoIdArray },
        { custom: customValidators.uniqueVideoIds },
        { custom: customValidators.maxVideoIds(100) }
      ],
      paymentIntentId: ['required', { custom: customValidators.validPaymentIntentId }]
    }
  }),
  async (req, res, next) => {
    try {
      const { videoIds, paymentIntentId } = req.body;
      const userId = req.user._id;

      const result = await PurchaseService.bulkPurchaseVideos(userId, videoIds, {
        paymentIntentId
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Static routes — ต้องอยู่เหนือ dynamic routes (:id)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/purchase/history
router.get('/history',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 30 }),
  validateRequest({
    query: {
      page:     ['optional', 'integer', { min: 1 }],
      limit:    ['optional', 'integer', { min: 1, max: 100 }],
      status:   ['optional', { in: ['completed', 'pending', 'refunded', 'failed'] }],
      fromDate: ['optional', 'date'],
      toDate:   ['optional', 'date'],
      videoId:  ['optional', 'mongoId']
    }
  }),
  async (req, res, next) => {
    try {
      const userId = req.user._id;
      const { page = 1, limit = 20, status, fromDate, toDate, videoId } = req.query;

      const result = await PurchaseService.getUserPurchases(userId, {
        page:  parseInt(page),
        limit: parseInt(limit),
        status,
        fromDate,
        toDate,
        videoId
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/purchase/stats
router.get('/stats',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 30 }),
  async (req, res, next) => {
    try {
      const stats = await Purchase.aggregate([
        { $match: { userId: req.user._id, status: 'completed' } },
        {
          $group: {
            _id:              null,
            totalSpent:       { $sum: '$amount' },
            totalPurchases:   { $sum: 1 },
            totalAccessCount: { $sum: '$accessCount' }
          }
        }
      ]);

      res.json(stats[0] || { totalSpent: 0, totalPurchases: 0, totalAccessCount: 0 });
    } catch (error) {
      next(error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic routes (:id / :purchaseId) — อยู่หลัง static เสมอ
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/purchase/video/:videoId/access
router.get('/video/:videoId/access',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 30 }),
  validateRequest({
    params: { videoId: ['required', 'mongoId'] }
  }),
  async (req, res, next) => {
    try {
      const accessInfo = await PurchaseService.checkAccess(req.user._id, req.params.videoId);
      res.json({ success: true, data: accessInfo });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/purchase/:purchaseId/refund
router.post(
  '/:purchaseId/refund',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 5 }),
  // FIX 2: ส่ง resourceId = purchaseId → lock key: lock:refund:{userId}:{purchaseId}
  (req, res, next) =>
    preventDuplicate('refund', { ttl: 30, resourceId: req.params.purchaseId })(req, res, next),
  validateRequest({
    params: { purchaseId: ['required', 'mongoId'] },
    body:   { reason: ['required', 'string', { min: 10, max: 500 }] },
  }),
  async (req, res, next) => {
    try {
      const { purchaseId } = req.params;
      const { reason }     = req.body;
      const userId         = req.user._id;
 
      const purchase = await PurchaseService.verifyOwnership(purchaseId, userId);
      if (!purchase) {
        return res.status(404).json({ error: 'Purchase not found' });
      }
 
      const result = await PurchaseService.refundPurchase(purchaseId, reason);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    } finally {
      // FIX 1: release lock หลัง response เสมอ ไม่ว่าจะสำเร็จหรือ error
      req.releaseLock?.();
    }
  }
);
 
router.post('/video/:videoId/promptpay-status',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 30 }),  // poll บ่อย → limit สูงขึ้น
  validateRequest({
    params: { videoId: ['required', 'mongoId'] },
    body:   { paymentIntentId: ['required', { custom: customValidators.validPaymentIntentId }] }
  }),
  async (req, res, next) => {
    try {
      const result = await PurchaseService.checkPromptPayStatus(
        req.user._id,
        req.params.videoId,
        req.body.paymentIntentId
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
// GET /api/purchase/:id/access
router.get('/:id/access',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 30 }),
  async (req, res, next) => {
    try {
      const hasAccess = await Purchase.hasAccess(req.user._id, req.params.id);

      if (!hasAccess) {
        return res.status(403).json({ canAccess: false, message: 'No active purchase found' });
      }

      if (req.query.recordAccess === 'true') {
        await hasAccess.recordAccess();
      }

      res.json({
        canAccess:    true,
        purchaseInfo: hasAccess,
        expiresAt:    hasAccess.expiresAt
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;