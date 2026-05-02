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
// POST /api/purchases/video/:videoId/purchase
// Body: { currency? }
// Response: { requiresAction: true, clientSecret, intentId, amount }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/video/:videoId/purchase',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 10 }),
  preventDuplicate('purchase', { ttl: 30 }),
  validateRequest({
    params: {
      videoId: ['required', 'mongoId']
    },
    body: {
      currency: ['optional', { in: ['THB', 'USD', 'EUR'] }]
    }
  }),
  async (req, res, next) => {
    try {
      const { videoId } = req.params;
      const userId = req.user._id;

      // เช็ค free video ก่อน (ไม่ต้องเข้า service)
      const video = await Video.findById(videoId);
      if (!video) {
        return res.status(404).json({ error: 'Video not found' });
      }
      if (video.accessType === 'free') {
        return res.status(400).json({ error: 'This video is free, no purchase needed' });
      }

      // ไม่ส่ง paymentIntentId → PurchaseService จะ authorize อายัดวงเงิน
      const result = await PurchaseService.purchaseVideo(userId, videoId, {
        currency: req.body.currency || 'THB'
        // ไม่มี paymentIntentId → trigger authorize step
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    } finally {
      await releaseLockMiddleware(req, res);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: Confirm — frontend ยืนยันบัตรแล้ว → capture + บันทึก DB
// POST /api/purchases/video/:videoId/confirm
// Body: { paymentIntentId }
// Response: { success: true, purchase, payment }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/video/:videoId/confirm',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 10 }),
  preventDuplicate('confirm', { ttl: 60 }),
  validateRequest({
    params: {
      videoId: ['required', 'mongoId']
    },
    body: {
      paymentIntentId: ['required', { custom: customValidators.validPaymentIntentId }]
    }
  }),
  async (req, res, next) => {
    try {
      const { videoId } = req.params;
      const userId = req.user._id;

      // ส่ง paymentIntentId → PurchaseService จะ capture + save
      const result = await PurchaseService.purchaseVideo(userId, videoId, {
        paymentIntentId: req.body.paymentIntentId
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    } finally {
      await releaseLockMiddleware(req, res);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Bulk purchase — authorize + confirm แบบเดียวกัน
// POST /api/purchases/videos/bulk-purchase  → authorize
// POST /api/purchases/videos/bulk-confirm   → capture + save
// ─────────────────────────────────────────────────────────────────────────────
router.post('/videos/bulk-purchase',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 5 }),
  preventDuplicate('bulk_purchase', { ttl: 60 }),
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

      // ไม่ส่ง paymentIntentId → authorize
      const result = await PurchaseService.bulkPurchaseVideos(userId, videoIds, {
        currency: currency || 'THB'
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    } finally {
      await releaseLockMiddleware(req, res);
    }
  }
);

router.post('/videos/bulk-confirm',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 5 }),
  preventDuplicate('bulk_confirm', { ttl: 60 }),
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

      // ส่ง paymentIntentId → capture + save
      const result = await PurchaseService.bulkPurchaseVideos(userId, videoIds, {
        paymentIntentId
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    } finally {
      await releaseLockMiddleware(req, res);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Static routes — ต้องอยู่เหนือ dynamic routes (:id)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/purchases/history
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

// GET /api/purchases/stats
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

// GET /api/purchases/video/:videoId/access
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

// POST /api/purchases/:purchaseId/refund
router.post('/:purchaseId/refund',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 5 }),
  preventDuplicate('refund', { ttl: 30 }),
  validateRequest({
    params: { purchaseId: ['required', 'mongoId'] },
    body:   { reason: ['required', 'string', { min: 10, max: 500 }] }
  }),
  async (req, res, next) => {
    try {
      const { purchaseId } = req.params;
      const { reason } = req.body;
      const userId = req.user._id;

      const purchase = await PurchaseService.verifyOwnership(purchaseId, userId);
      if (!purchase) {
        return res.status(404).json({ error: 'Purchase not found' });
      }

      const result = await PurchaseService.refundPurchase(purchaseId, reason);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    } finally {
      await releaseLockMiddleware(req, res);
    }
  }
);

// GET /api/purchases/:id/access
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