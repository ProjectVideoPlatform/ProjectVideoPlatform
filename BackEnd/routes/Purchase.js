const express = require('express');
const router = express.Router();
const purchaseService = require('../services/purchaseService');
const Video = require('../models/Video');
const Purchase = require('../models/Purchase');
const authenticateToken = require('../middleware/auth');

// ✅ 1. Purchase Single Video
const preventDuplicate = require('../middleware/preventduplicate');

// ใช้ "purchase" เป็น prefix เพื่อแยก lock key
router.post('/:id/purchase', 
  authenticateToken, 
  preventDuplicate('purchase'), // 🔒 ด่านที่ 1: กันกดรัว (Redis)
  async (req, res) => {
    try {
      const result = await purchaseService.purchaseVideo(
        req.user._id, 
        req.params.id, 
        req.body
      );

      // เมื่อสำเร็จ ควรลบ Lock ทันที (optional) หรือปล่อยให้ expire ตามเวลา
      await redisClient.del(req.lockKey);
      
      res.json(result);
    } catch (error) {
      // หากพัง ต้องลบ lock เพื่อให้ user ลองใหม่ได้ทันที
      await redisClient.del(req.lockKey);
      res.status(400).json({ error: error.message });
    }
});

router.post('/bulk-purchase', 
  authenticateToken, 
  preventDuplicate('bulk'), // 🔒 รองรับการ Hash videoIds ในตัว
  async (req, res) => {
    try {
      const result = await purchaseService.bulkPurchaseVideos(
        req.user._id, 
        req.body.videoIds, 
        req.body
      );
      await redisClient.del(req.lockKey);
      res.json(result);
    } catch (error) {
      await redisClient.del(req.lockKey);
      res.status(400).json({ error: error.message });
    }
});
// ✅ 3. Check Access (ใช้ Static Method จาก Model)
router.get('/:id/access', authenticateToken, async (req, res) => {
  try {
    const hasAccess = await Purchase.hasAccess(req.user._id, req.params.id);
    
    if (!hasAccess) {
      return res.status(403).json({ canAccess: false, message: 'No active purchase found' });
    }

    // บันทึกการเข้าดู (ใช้ Method จาก Document)
    await hasAccess.recordAccess(req.query.currentTime || 0);

    res.json({ canAccess: true, purchaseInfo: hasAccess });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;