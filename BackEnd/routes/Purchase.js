const express = require('express');
const router = express.Router();
const PurchaseService = require('../../../services/purchase/PurchaseService');
const authenticateToken = require('../../../middleware/auth');
const preventDuplicate = require('../../../middleware/preventDuplicate');
const { releaseLockMiddleware } = require('../../../middleware/releaseLock');
const validateRequest = require('../../../middleware/validateRequest');
const rateLimiter = require('../../../middleware/rateLimiter');

// Purchase single video
router.post('/:id/purchase',
  authenticateToken,
  rateLimiter({ windowMs: 60000, max: 10 }), // 10 requests per minute
  preventDuplicate('purchase', { ttl: 30 }),
  validateRequest({
    body: ['paymentMethod', 'transactionId']
  }),
  releaseLockMiddleware,
  async (req, res) => {
    try {
      const result = await PurchaseService.purchaseVideo(
        req.user._id,
        req.params.id,
        req.body
      );
      
      res.json(result);
    } catch (error) {
      res.status(error.status || 400).json({
        error: error.message,
        code: error.code || 'PURCHASE_ERROR'
      });
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