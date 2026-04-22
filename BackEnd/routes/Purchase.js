const express = require('express');
const router = express.Router();
const PurchaseService = require('../services/Purchaseservice');
const Purchase = require('../models/Purchase'); // ✅ require ครั้งเดียวข้างบน
// const AppError = require('../utils/AppError');   // ✅ fix: ต้อง import AppError ก่อนใช้
const { authenticateToken } = require('../middleware/auth');
const preventDuplicate = require('../middleware/preventduplicate');
const { releaseLockMiddleware } = require('../middleware/releaseLock');
const validateRequest = require('../middleware/validateRequest');
const rateLimiter = require('../middleware/rateLimiter');
const customValidators = require('../utils/customValidators');

// ─────────────────────────────────────────────
// Purchase single video
// ─────────────────────────────────────────────
router.post('/video/:videoId/purchase',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 10 }),
  preventDuplicate('purchase', { ttl: 30 }),
  validateRequest({
    params: {
      videoId: ['required', 'mongoId', { custom: customValidators.validateVideoPurchase }]
    },
    body: {
      paymentMethod: ['required', { custom: customValidators.validPaymentMethod }],
      transactionId: ['required', { custom: customValidators.validTransactionId }],
      amount: ['optional', { custom: customValidators.validAmount }],
      currency: ['optional', { in: ['THB', 'USD', 'EUR'] }],
      metadata: ['optional', 'object']
    }
  }),
  async (req, res, next) => {
    try {
      const { videoId } = req.params;
      const userId = req.user._id;
      const paymentData = {
        method: req.body.paymentMethod,
        transactionId: req.body.transactionId,
        amount: req.body.amount,
        currency: req.body.currency || 'THB',
        metadata: req.body.metadata || {}
      };

      const result = await PurchaseService.purchaseVideo(userId, videoId, paymentData);
      req._purchaseResult = result;

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    } finally {
      await releaseLockMiddleware(req, res);
    }
  }
);

// ─────────────────────────────────────────────
// Bulk video purchase
// ─────────────────────────────────────────────
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
      paymentMethod: ['required', { custom: customValidators.validPaymentMethod }],
      transactionId: ['required', { custom: customValidators.validTransactionId }],
      amount: ['optional', { custom: customValidators.validAmount }],
      currency: ['optional', { in: ['THB', 'USD', 'EUR'] }],
      metadata: ['optional', 'object']
    }
  }),
  async (req, res, next) => {
    try {
      const { videoIds, paymentMethod, transactionId, amount, currency, metadata } = req.body;
      const userId = req.user._id;

      const paymentData = {
        method: paymentMethod,
        transactionId,
        amount,
        currency: currency || 'THB',
        metadata: metadata || {}
      };

      const result = await PurchaseService.bulkPurchaseVideos(userId, videoIds, paymentData);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    } finally {
      await releaseLockMiddleware(req, res);
    }
  }
);

// ─────────────────────────────────────────────
// ✅ Static routes ต้องอยู่เหนือ dynamic routes (:id)
//    เพื่อป้องกัน Express match /stats หรือ /history เป็น /:id
// ─────────────────────────────────────────────

// Get purchase history (unified — ลบ GET / ที่ซ้ำออก)
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

      const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        status,
        fromDate,
        toDate,
        videoId
      };

      const result = await PurchaseService.getUserPurchases(userId, options);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// Get purchase stats
// ✅ fix: ต้องอยู่เหนือ /:purchaseId/refund และ /:id/access
//    มิฉะนั้น /stats จะถูก match เป็น /:purchaseId หรือ /:id แทน
router.get('/stats',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 30 }),
  async (req, res, next) => {
    try {
      const stats = await Purchase.aggregate([
        { $match: { userId: req.user._id, status: 'completed' } },
        {
          $group: {
            _id: null,
            totalSpent: { $sum: '$amount' },
            totalPurchases: { $sum: 1 },
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

// ─────────────────────────────────────────────
// Dynamic routes (:id / :purchaseId) — อยู่หลัง static เสมอ
// ─────────────────────────────────────────────

// Check video access
router.get('/video/:videoId/access',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 30 }),
  validateRequest({
    params: {
      videoId: ['required', 'mongoId']
    }
  }),
  async (req, res, next) => {
    try {
      const { videoId } = req.params;
      const userId = req.user._id;

      const accessInfo = await PurchaseService.checkAccess(userId, videoId);

      res.json({ success: true, data: accessInfo });
    } catch (error) {
      next(error);
    }
  }
);

// Request refund
router.post('/:purchaseId/refund',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 5 }),
  preventDuplicate('refund', { ttl: 30 }),
  validateRequest({
    params: {
      purchaseId: ['required', 'mongoId']
    },
    body: {
      reason: ['required', 'string', { min: 10, max: 500 }]
    }
  }),
  async (req, res, next) => {
    try {
      const { purchaseId } = req.params;
      const { reason } = req.body;
      const userId = req.user._id;

      // ✅ fix: AppError ถูก import แล้ว จะไม่ crash อีกต่อไป
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

// Check access by purchase ID
// ✅ ลบ route GET / ที่ซ้ำกับ /history ออก และรวม logic มาไว้ที่นี่
router.get('/:id/access',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 30 }),
  async (req, res, next) => {
    try {
      const hasAccess = await Purchase.hasAccess(req.user._id, req.params.id);

      if (!hasAccess) {
        return res.status(403).json({
          canAccess: false,
          message: 'No active purchase found'
        });
      }

      if (req.query.recordAccess === 'true') {
        await hasAccess.recordAccess(req.query.currentTime || 0);
      }

      res.json({
        canAccess: true,
        purchaseInfo: hasAccess,
        expiresAt: hasAccess.expiresAt
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;