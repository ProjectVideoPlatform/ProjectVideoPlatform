const express = require('express');
const router = express.Router();
const PurchaseService = require('../services/Purchaseservice');
const {authenticateToken} = require('../middleware/auth');
const preventDuplicate = require('../middleware/preventduplicate');
const {releaseLockMiddleware} = require('../middleware/releaseLock');
const validateRequest = require('../middleware/validateRequest');
const rateLimiter = require('../middleware/rateLimiter');
const customValidators = require('../utils/customValidators');
// Purchase single video
// routes/purchase.js
// const express = require('express');
// const router = express.Router();
// const PurchaseService = require('../services/PurchaseService');
// const { authenticateToken } = require('../middleware/auth');
// const { createRateLimiter } = require('../middleware/rateLimiter');
// const { createDuplicatePrevention } = require('../middleware/duplicatePrevention');
// const { validateRequest } = require('../middleware/validation');
// const { customValidators } = require('../middleware/validation');
// const { releaseLockMiddleware } = require('../middleware/lockRelease');

// Single video purchase
router.post('/video/:videoId/purchase',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 10 }), // 10 requests per minute per IP
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
        amount: req.body.amount, // Optional - service will use video price
        currency: req.body.currency || 'THB',
        metadata: req.body.metadata || {}
      };
      
      const result = await PurchaseService.purchaseVideo(userId, videoId, paymentData);
      
      // Release lock after successful purchase
      req._purchaseResult = result;
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      next(error);
    } finally {
      await releaseLockMiddleware(req, res);
    }
  }
);

// Bulk video purchase
router.post('/videos/bulk-purchase',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 5 }), // 5 requests per minute
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
        transactionId: transactionId,
        amount: amount, // Optional - service will calculate total
        currency: currency || 'THB',
        metadata: metadata || {}
      };
      
      const result = await PurchaseService.bulkPurchaseVideos(
        userId, 
        videoIds, 
        paymentData
      );
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      next(error);
    } finally {
      await releaseLockMiddleware(req, res);
    }
  }
);

// Get purchase history
router.get('/history',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 30 }),
  validateRequest({
    query: {
      page: ['optional', 'integer', { min: 1 }],
      limit: ['optional', 'integer', { min: 1, max: 100 }],
      status: ['optional', { in: ['completed', 'pending', 'refunded', 'failed'] }],
      fromDate: ['optional', 'date'],
      toDate: ['optional', 'date']
    }
  }),
  async (req, res, next) => {
    try {
      const userId = req.user._id;
      const { 
        page = 1, 
        limit = 20, 
        status, 
        fromDate, 
        toDate 
      } = req.query;
      
      const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        status,
        fromDate,
        toDate
      };
      
      const result = await PurchaseService.getUserPurchases(userId, options);
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      next(error);
    }
  }
);

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
      
      res.json({
        success: true,
        data: accessInfo
      });
      
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
      
      // Verify ownership
      const purchase = await PurchaseService.verifyOwnership(purchaseId, userId);
      if (!purchase) {
        throw new AppError('Purchase not found or not owned by user', 404, 'NOT_FOUND');
      }
      
      const result = await PurchaseService.refundPurchase(purchaseId, reason);
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      next(error);
    } finally {
      await releaseLockMiddleware(req, res);
    }
  }
);

// Check access
router.get('/:id/access',
  authenticateToken,
  async (req, res) => {
    try {
      const Purchase = require('../../../models/Purchase');
      const hasAccess = await Purchase.hasAccess(req.user._id, req.params.id);
      
      if (!hasAccess) {
        return res.status(403).json({
          canAccess: false,
          message: 'No active purchase found'
        });
      }
      
      // Record access if watching
      if (req.query.recordAccess === 'true') {
        await hasAccess.recordAccess(req.query.currentTime || 0);
      }
      
      res.json({
        canAccess: true,
        purchaseInfo: hasAccess,
        expiresAt: hasAccess.expiresAt
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Get user's purchases
router.get('/',
  authenticateToken,
  async (req, res) => {
    try {
      const Purchase = require('../../../models/Purchase');
      const {
        page = 1,
        limit = 20,
        status,
        videoId
      } = req.query;
      
      const query = { userId: req.user._id };
      if (status) query.status = status;
      if (videoId) query.videoId = videoId;
      
      const purchases = await Purchase.find(query)
        .populate('videoId', 'title thumbnail duration price')
        .sort({ purchaseDate: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .lean();
      
      const total = await Purchase.countDocuments(query);
      
      res.json({
        purchases,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

module.exports = router;