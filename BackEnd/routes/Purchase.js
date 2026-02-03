// routes/purchase.js
const express = require('express');
const router = express.Router();
const purchaseService = require('../services/purchaseService');
const authenticateToken = require('../middleware/auth');
const preventDuplicate = require('../middleware/preventduplicate');
const releaseLock = require('../middleware/releaseLock'); // เพิ่ม middleware นี้

// ✅ 1. Purchase Single Video (สมบูรณ์)
router.post('/:id/purchase', 
  authenticateToken, 
  preventDuplicate('purchase'),  // 🔒 Redis Lock
  releaseLock,                   // 🔓 Auto-release lock
  async (req, res) => {
    try {
      // ✅ MongoDB Transaction อยู่ใน purchaseService แล้ว
      const result = await purchaseService.purchaseVideo(
        req.user._id, 
        req.params.id, 
        req.body
      );
      
      res.json(result);
    } catch (error) {
      // ❌ ไม่ต้องลบ lock ด้วยตัวเอง (releaseLock จัดการแล้ว)
      res.status(400).json({ 
        error: error.message,
        code: error.code || 'PURCHASE_ERROR'
      });
    }
});

// ✅ 2. Bulk Purchase
router.post('/bulk-purchase', 
  authenticateToken, 
  preventDuplicate('bulk'),
  releaseLock,
  async (req, res) => {
    try {
      const result = await purchaseService.bulkPurchaseVideos(
        req.user._id, 
        req.body.videoIds, 
        req.body
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({ 
        error: error.message,
        code: error.code || 'BULK_PURCHASE_ERROR'
      });
    }
});