const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { generatePresignedUploadUrl, validateVideoFile, validateFileSize } = require('../services/s3Upload');
const queueService = require('../services/queueService');
const { generateSignedCookies, setCookiesInResponse } = require('../services/cloudfront');
const { config,s3 } = require('../config/aws');
const Video = require('../models/Video');
const Purchase = require('../models/Purchase');
const escapeStringRegexp = require('escape-string-regexp');
const { getRecommendedVideos } = require('../services/recommendations'); 
const redisClient = require('../config/redis');
const https = require('https');
const kafkaService = require('../services/kafkaService');
const QUEUES = require('../services/rabbitmq/queues');
const router = express.Router();
const { broadcast } = require('../websocket');

// GET - ดึง progress ปัจจุบัน
router.get('/video-progress', authenticateToken, async (req, res) => {
  try {
    const { videoId } = req.query;
    if (!videoId) {
      return res.status(400).json({ error: 'videoId is required' });
    }

    const video = await Video.findOne({ id: videoId }); 
    
    if (!video) {
      return res.json({ lastTime: 0, owned: false });
    }

    // free video ไม่มี purchase record แต่ดูได้เลย
    if (video.accessType === 'free') {
      return res.json({ lastTime: 0, owned: true });
    }

    const purchase = await Purchase.findOne({
      userId: req.user._id,
      videoId: video._id,
    });

    if (!purchase) {
      return res.json({ lastTime: 0, owned: false });
    }

    return res.json({
      lastTime: purchase.lastTime || 0,
      owned: true,
    });
  } catch (err) {
    console.error('[VideoProgress] GET error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST - บันทึก progress
router.post('/video-progress', authenticateToken, async (req, res) => {
  try {
    const { videoId, currentTime } = req.body;

    if (!videoId || currentTime == null) {
      return res.status(400).json({ error: 'videoId and currentTime are required' });
    }
    if (typeof currentTime !== 'number' || currentTime < 0) {
      return res.status(400).json({ error: 'currentTime must be a non-negative number' });
    }

    const video = await Video.findOne({ id: videoId });
    if (!video) {
      return res.json({ success: false, reason: 'video_not_found' });
    }

    // free video ไม่มี purchase record → silent ignore
    if (video.accessType === 'free') {
      return res.json({ success: false, reason: 'free_video_no_progress' });
    }

    const purchase = await Purchase.findOne({
      userId: req.user._id,
      videoId: video._id,
    });

    if (!purchase) {
      return res.json({ success: false, reason: 'not_purchased' });
    }

    purchase.lastTime = Math.floor(currentTime);
    await purchase.save();

    return res.json({ success: true, lastTime: purchase.lastTime });
  } catch (err) {
    console.error('[VideoProgress] POST error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET / - video list
router.get('/', authenticateToken, async (req, res) => {
  try {
    let { page = 1, limit = 10, search, category, accessType } = req.query;

    page = Math.max(parseInt(page), 1);
    limit = Math.min(Math.max(parseInt(limit), 1), 50);

    const skip = (page - 1) * limit;

    let query = {
      uploadStatus: 'completed',
      isActive: true
    };

    if (search) {
      const safeSearch = escapeStringRegexp(search);
      const searchRegex = new RegExp(safeSearch, 'i');
      query.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { tags: { $in: [searchRegex] } }
      ];
    }

    if (category) {
      query.tags = { $in: [category] };
    }

    // ✅ filter by accessType ถ้าส่งมา
    if (accessType && ['free', 'paid'].includes(accessType)) {
      query.accessType = accessType;
    }

    const videos = await Video.find(query)
      .select('id title description price duration thumbnailPath tags createdAt accessType') // ✅ เพิ่ม accessType
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .read('secondaryPreferred');

    const total = await Video.countDocuments(query);

    const purchasedVideoIds = await Purchase.find({
      userId: req.user._id,
      status: 'completed'
    }).distinct('videoId');

    const videosWithPurchaseStatus = videos.map(video => {
      const isPurchased = purchasedVideoIds.some(id => id.equals(video._id));

      // ✅ canPlay logic ตาม accessType
      const canPlay =
        req.user.role === 'admin' ||
        video.accessType === 'free' ||
        isPurchased;

      return {
        ...video.toObject(),
        uploadStatus: 'completed',
        purchased: isPurchased,
        canPlay,
        thumbnailPath: video.thumbnailPath,
        accessType: video.accessType
      };
    });

    res.json({
      videos: videosWithPurchaseStatus,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get videos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /foryou
// ── /foryou route (แก้แล้ว) ──────────────────────────────────────────────────
// เพิ่ม canPlay + purchased เหมือน GET / เพื่อให้ frontend ใช้ได้เลย
// วางแทน router.get('/foryou', ...) เดิมใน videos.js
router.get('/foryou', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const { videos, source, boostCategory } = await getRecommendedVideos(userId);
    
    // ดึง videoIds ทั้งหมด
    const videoIds = videos.map(v => v._id);
    
    // ดึง purchase status ทีเดียวด้วย $in
    const purchases = await Purchase.find({
      userId: req.user._id,
      status: 'completed',
      videoId: { $in: videoIds }
    }).distinct('videoId');
    
    const purchasedSet = new Set(purchases.map(id => id.toString()));

    const enriched = videos.map(video => ({
      ...video,
      purchased: purchasedSet.has(video._id.toString()),
      canPlay: req.user.role === 'admin' || 
               video.accessType === 'free' || 
               purchasedSet.has(video._id.toString())
    }));

    res.json({ videos: enriched, source, boostCategory });
  } catch (error) {
    console.error('[/foryou]', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});
// GET /:id - single video
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const video = await Video.findOne({ 
      id: req.params.id,
      isActive: true 
    });
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // free video ไม่ต้องเช็ค purchase
    let purchase = null;
    if (video.accessType === 'paid') {
      purchase = await Purchase.findOne({
        userId: req.user._id,
        videoId: video._id,
        status: 'completed',
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } }
        ]
      });
    }

    // ✅ canPlay logic ตาม accessType
    const canPlay =
      req.user.role === 'admin' ||
      video.accessType === 'free' ||
      !!purchase;
    
    res.json({
      video: {
        ...video.toObject(),
        hlsManifestPath: canPlay ? video.hlsManifestPath : undefined,
        mediaConvertJobId: req.user.role === 'admin' ? video.mediaConvertJobId : undefined
      },
      purchased: video.accessType === 'free' ? true : !!purchase,
      canPlay,
      accessType: video.accessType, // ✅ เพิ่ม
      purchaseInfo: purchase ? {
        purchaseDate: purchase.purchaseDate,
        expiresAt: purchase.expiresAt,
        accessCount: purchase.accessCount
      } : null
    });
  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /upload/initialize (Admin only)
router.post('/upload/initialize', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, description, price, tags, fileName, fileSize, contentType, accessType = 'free' } = req.body;
    
    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!fileName) return res.status(400).json({ error: 'File name is required' });
    if (!fileSize) return res.status(400).json({ error: 'File size is required' });
    if (!contentType) return res.status(400).json({ error: 'Content type is required' });

    // ✅ validate accessType
    if (!['free', 'paid'].includes(accessType)) {
      return res.status(400).json({ error: 'accessType must be free or paid' });
    }

    // ✅ paid ต้องมี price > 0
    if (accessType === 'paid' && (!price || parseFloat(price) <= 0)) {
      return res.status(400).json({ error: 'Price is required for paid videos' });
    }

    validateVideoFile(fileName, contentType);
    validateFileSize(fileSize);
    
    const videoId = uuidv4();
    console.log(`Initializing upload for video: ${videoId} - ${title}`);

    const video = new Video({
      id: videoId,
      title,
      description,
      price: accessType === 'paid' ? parseFloat(price) : 0, // ✅ free ราคา 0 เสมอ
      originalFileName: fileName,
      fileSize: parseInt(fileSize),
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      uploadStatus: 'uploading',
      accessType // ✅ เพิ่ม
    });

    await video.save();
    console.log(`Video record created: ${videoId}`);

    const uploadData = await generatePresignedUploadUrl(videoId, fileName, fileSize, contentType);
    
    res.json({
      success: true,
      videoId,
      uploadUrl: uploadData.uploadUrl,
      s3Key: uploadData.s3Key,
      fields: uploadData.fields,
      message: 'Upload initialized successfully',
      video: {
        id: video._id,
        title: video.title,
        uploadStatus: video.uploadStatus,
        accessType: video.accessType // ✅ เพิ่ม
      }
    });

  } catch (error) {
    console.error('Initialize upload error:', error);
    res.status(400).json({ error: error.message });
  }
});

// POST /upload/:videoId/complete
router.post('/upload/:videoId/complete', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { videoId } = req.params;

    const video = await Video.findOne({ id: videoId });

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (video.uploadStatus !== 'uploading') {
      return res.status(400).json({
        error: 'Invalid upload status',
        currentStatus: video.uploadStatus
      });
    }

    video.uploadStatus = 'uploaded';
    video.s3Key = `uploads/${videoId}/original.${video.originalFileName.split('.').pop()}`;
    await video.save();

    const jobData = {
      videoId: video.id,
      title: video.title,
      email: req.user.email,
      inputS3Path: `s3://${config.uploadsBucket}/${video.s3Key}`,
      outputS3Path: `s3://${config.hlsOutputBucket}/videos/${videoId}/`,
      createdAt: new Date().toISOString()
    };

    await queueService.sendToQueue(QUEUES.VIDEO_TRANSCODE, jobData);
    console.log(`[Queue] Transcode task queued: ${videoId}`);

    res.json({
      success: true,
      videoId,
      message: 'Upload confirmed. Processing task queued.',
      video: {
        id: videoId,
        title: video.title,
        uploadStatus: 'uploaded',
        accessType: video.accessType // ✅ เพิ่ม
      }
    });

  } catch (error) {
    console.error('Complete upload error:', error);
    res.status(500).json({ error: 'Queue failed or server error' });
  }
});

// POST /upload/:videoId/failed
router.post('/upload/:videoId/failed', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { error } = req.body;
    
    const video = await Video.findOne({ _id: videoId });
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    console.log(`Upload failed for video: ${videoId} - ${error}`);
    
    video.uploadStatus = 'failed';
    video.errorMessage = error || 'Upload failed';
    await video.save();
    
    res.json({ success: true, message: 'Upload failure recorded' });

  } catch (error) {
    console.error('Record upload failure error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/purchase
router.post('/:id/purchase', authenticateToken, async (req, res) => {
  try {
    const video = await Video.findOne({ 
      _id: req.params.id,
      uploadStatus: 'completed',
      isActive: true 
    });
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found or not available' });
    }

    // ✅ free video ไม่ต้องซื้อ
    if (video.accessType === 'free') {
      return res.status(400).json({ error: 'This video is free, no purchase needed' });
    }

    const existingPurchase = await Purchase.findOne({
      userId: req.user._id,
      videoId: video._id,
      status: 'completed'
    });

    if (existingPurchase) {
      return res.status(400).json({ 
        error: 'Already purchased',
        purchase: existingPurchase 
      });
    }

    const purchase = new Purchase({
      userId: req.user._id,
      videoId: video._id,
      amount: video.price,
      status: 'completed'
    });

    await purchase.save();

    req.user.purchasedVideos.push(video._id);
    await req.user.save();

    res.json({ 
      success: true, 
      message: 'Purchase successful',
      purchase: {
        id: purchase._id,
        amount: purchase.amount,
        purchaseDate: purchase.purchaseDate
      }
    });
  } catch (error) {
    console.error('Purchase error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/play
router.post('/:id/play', authenticateToken, async (req, res) => {
  try {
    const video = await Video.findOne({ 
      id: req.params.id,
      isActive: true 
    });
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (video.uploadStatus !== 'completed') {
      return res.status(400).json({ 
        error: 'Video not ready for playback',
        status: video.uploadStatus 
      });
    }

    // ✅ canPlay logic ตาม accessType
    let canPlay = false;
    if (req.user.role === 'admin') {
      canPlay = true;
    } else if (video.accessType === 'free') {
      canPlay = true;
    } else {
      canPlay = await Purchase.hasAccess(req.user._id, video._id);
    }

    if (!canPlay) {
      return res.status(403).json({ error: 'Purchase required to play this video' });
    }

    // Record access (เฉพาะ paid video ที่มี purchase record)
    if (video.accessType === 'paid') {
      const purchase = await Purchase.findOne({
        userId: req.user._id,
        videoId: video._id,
        status: 'completed'
      });
      if (purchase) {
        await purchase.recordAccess();
      }
    }

    const { cookies, expiresIn } = generateSignedCookies(video.id, 15);
    setCookiesInResponse(res, cookies);

    res.json({
      success: true,
      manifestUrl: `https://${config.cloudFrontDomain}/videos/${video.id}/original.m3u8`,
      expiresIn,
      videoId: video._id.toString(),
      message: 'Playback access granted'
    });

  } catch (error) {
    console.error('Play error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /mediaconvert/subscribe
router.post(
  "/mediaconvert/subscribe",
  express.json({ type: "*/*" }),
  async (req, res) => {
    try {
      console.log("--- New Webhook Received ---");
      const body = req.body;
      
      if (body.Type === "SubscriptionConfirmation") {
        console.log("Confirming SNS subscription...");
        await fetch(body.SubscribeURL);
        return res.json({ confirmed: true });
      }

      let message = body["detail-type"] ? body : (body.Type === "Notification" ? JSON.parse(body.Message) : null);
      
      if (!message || message["detail-type"] !== "MediaConvert Job State Change") {
        return res.json({ received: true, note: "Ignored non-mediaconvert event" });
      }

      const { status, userMetadata, jobId } = message.detail;
      const videoId = userMetadata?.VideoId;

      if (!videoId) {
        console.log("❌ VideoId missing in userMetadata");
        return res.status(400).json({ error: "VideoId missing" });
      }

      const video = await Video.findOne({ id: videoId }); 

      if (!video) {
        console.log("❌ Video not found in DB:", videoId);
        return res.status(404).json({ error: "Video not found" });
      }

      console.log(`Job ID: ${jobId} | Status: ${status} | VideoId: ${videoId}`);

      if (status === "COMPLETE") {
        video.uploadStatus = "completed";

        try {
          const listResult = await s3.listObjectsV2({
            Bucket: process.env.HLS_OUTPUT_BUCKET,
            Prefix: `videos/${videoId}/thumbnails/`,
          }).promise();

          const thumbs = listResult.Contents
            ?.map(o => o.Key)
            .filter(k => k.endsWith('.jpg'))
            .sort();

          if (thumbs && thumbs.length > 0) {
            video.thumbnailPath = thumbs[1] ?? thumbs[0];
            console.log(`Thumbnail set: ${video.thumbnailPath}`);
          }
        } catch (s3Error) {
          console.error("⚠️ S3 Thumbnail Error:", s3Error.message);
        }
      } else if (status === "ERROR") {
        video.uploadStatus = "failed";
        console.log(`📧 Job FAILED for: ${videoId}`);
      }

      await video.save({ writeConcern: { w: 'majority' } });
      console.log(`✅ DB Saved Status: ${video.uploadStatus} for VideoId: ${videoId}`);

      if (status === "COMPLETE") {
        await queueService.sendToQueue('video_index', {
          eventType: 'video_ready',
          videoId: videoId,
          title: video.title || '',
          description: video.description || '',
          categories: video.tags || [],
          accessType: video.accessType // ✅ เพิ่ม
        });
        console.log(video.tags + " Video Tags");
        await broadcast({ videoId, type: "transcode_completed", status: "completed" });
      }

      await queueService.sendToQueue(QUEUES.EMAIL_NOTIFY, {
        type: status === "COMPLETE" ? "VIDEO_COMPLETE" : "VIDEO_FAILED",
        videoId: videoId,
        email: video.email || "manaphatg@gmail.com",
        title: video.title
      });

      return res.json({ updated: true, videoId });

    } catch (error) {
      console.error("🔥 Error in Webhook:", error.message);
      res.status(200).json({ error: "Processing failed", details: error.message });
    }
  }
);

// GET /purchased/list
router.get('/purchased/list', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    const purchases = await Purchase.find({
      userId: req.user._id,
      status: 'completed'
    })
    .populate('videoId', 'id title description thumbnailPath duration price tags accessType') // ✅ เพิ่ม accessType
    .sort({ purchaseDate: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .read('secondaryPreferred'); // ✅
    const total = await Purchase.countDocuments({
      userId: req.user._id,
      status: 'completed'
    });
  const purchasedVideos = purchases.map(purchase => ({
  ...purchase.videoId.toObject(),
  uploadStatus: 'completed',
  canPlay: true,
  purchased: true,              // ✅ เพิ่มบรรทัดนี้
  accessType: purchase.videoId.accessType,
  purchaseInfo: {
    purchaseDate: purchase.purchaseDate,
    amount: purchase.amount,
    accessCount: purchase.accessCount,
    lastAccessedAt: purchase.lastAccessedAt,
    purchaseId: purchase._id
  }
}));
    
    res.json({
      videos: purchasedVideos,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get purchased videos error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /simulate-purchase/:videoId (TESTING ONLY)
router.post('/simulate-purchase/:videoId', authenticateToken, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { userId, paymentMethod = 'cash' } = req.body;

    if (req.user.role !== 'admin' && req.user.email !== 'tester@example.com') {
      return res.status(403).json({ error: 'Forbidden - This endpoint is for testing only' });
    }

    let targetUser = req.user;
    if (userId && req.user.role === 'admin') {
      const User = require('../models/User');
      targetUser = await User.findById(userId);
      if (!targetUser) return res.status(404).json({ error: 'User not found' });
    }

    const video = await Video.findOne({ 
      id: videoId,
      uploadStatus: 'completed',
      isActive: true 
    });
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found or not available' });
    }

    // ✅ ไม่ simulate ซื้อ free video
    if (video.accessType === 'free') {
      return res.status(400).json({ error: 'This video is free, no purchase needed' });
    }

    const existingPurchase = await Purchase.findOne({
      userId: targetUser._id,
      videoId: video._id,
      status: 'completed'
    });

    if (existingPurchase) {
      return res.status(400).json({ 
        error: 'Already purchased',
        purchase: {
          id: existingPurchase._id,
          purchaseDate: existingPurchase.purchaseDate,
          amount: existingPurchase.amount
        }
      });
    }

    const purchase = new Purchase({
      userId: targetUser._id,
      videoId: video._id,
      amount: video.price || 0,
      status: 'completed',
      paymentMethod,
      paymentId: `simulate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      purchaseDate: new Date(),
      expiresAt: null,
      accessCount: 0,
      lastAccessedAt: null,
      lastTime: 0
    });

    await purchase.save();

    if (targetUser.purchasedVideos) {
      if (!targetUser.purchasedVideos.includes(video._id)) {
        targetUser.purchasedVideos.push(video._id);
        await targetUser.save();
      }
    }

    console.log(`[SIMULATE] User ${targetUser.email} purchased video: ${video.title} with method: ${paymentMethod}`);

    res.json({
      success: true,
      message: 'Purchase simulated successfully',
      purchase: {
        id: purchase._id,
        videoId: video.id,
        videoTitle: video.title,
        userId: targetUser._id,
        userEmail: targetUser.email,
        amount: purchase.amount,
        paymentMethod: purchase.paymentMethod,
        purchaseDate: purchase.purchaseDate
      }
    });

  } catch (error) {
    console.error('Simulate purchase error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /simulate-bulk-purchase (TESTING ONLY)
router.post('/simulate-bulk-purchase', authenticateToken, async (req, res) => {
  try {
    const { userId, videoIds, paymentMethod = 'cash' } = req.body;

    if (req.user.role !== 'admin' && req.user.email !== 'tester@example.com') {
      return res.status(403).json({ error: 'Forbidden - This endpoint is for testing only' });
    }

    let targetUser = req.user;
    if (userId && req.user.role === 'admin') {
      const User = require('../models/User');
      targetUser = await User.findById(userId);
      if (!targetUser) return res.status(404).json({ error: 'User not found' });
    }

    const videos = await Video.find({
      id: { $in: videoIds },
      uploadStatus: 'completed',
      isActive: true
    });

    if (videos.length === 0) {
      return res.status(404).json({ error: 'No valid videos found' });
    }

    const results = { success: [], failed: [] };

    for (const video of videos) {
      try {
        // ✅ skip free videos
        if (video.accessType === 'free') {
          results.failed.push({
            videoId: video.id,
            title: video.title,
            reason: 'Free video, no purchase needed'
          });
          continue;
        }

        const existing = await Purchase.findOne({
          userId: targetUser._id,
          videoId: video._id,
          status: 'completed'
        });

        if (existing) {
          results.failed.push({
            videoId: video.id,
            title: video.title,
            reason: 'Already purchased'
          });
          continue;
        }

        const purchase = new Purchase({
          userId: targetUser._id,
          videoId: video._id,
          amount: video.price || 0,
          status: 'completed',
          paymentMethod,
          paymentId: `simulate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          purchaseDate: new Date()
        });

        await purchase.save();

        if (targetUser.purchasedVideos && !targetUser.purchasedVideos.includes(video._id)) {
          targetUser.purchasedVideos.push(video._id);
        }

        results.success.push({
          videoId: video.id,
          title: video.title,
          purchaseId: purchase._id
        });

      } catch (err) {
        results.failed.push({
          videoId: video.id,
          title: video.title,
          reason: err.message
        });
      }
    }

    if (targetUser.purchasedVideos && results.success.length > 0) {
      await targetUser.save();
    }

    res.json({
      success: true,
      message: `Purchased ${results.success.length} videos, failed ${results.failed.length}`,
      results
    });

  } catch (error) {
    console.error('Bulk purchase error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /admin/purchases/:userId (TESTING ONLY)
router.get('/admin/purchases/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const purchases = await Purchase.find({ userId })
      .populate('videoId', 'id title thumbnailPath duration accessType') // ✅ เพิ่ม accessType
      .sort({ purchaseDate: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Purchase.countDocuments({ userId });

    res.json({
      userId,
      purchases: purchases.map(p => ({
        id: p._id,
        videoId: p.videoId?.id,
        videoTitle: p.videoId?.title,
        accessType: p.videoId?.accessType, // ✅ เพิ่ม
        amount: p.amount,
        purchaseDate: p.purchaseDate,
        accessCount: p.accessCount,
        lastAccessedAt: p.lastAccessedAt,
        lastTime: p.lastTime
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get purchases error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /admin/purchases/:purchaseId (TESTING ONLY)
router.delete('/admin/purchases/:purchaseId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { purchaseId } = req.params;

    const purchase = await Purchase.findByIdAndDelete(purchaseId);

    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    const User = require('../models/User');
    const user = await User.findById(purchase.userId);
    if (user && user.purchasedVideos) {
      user.purchasedVideos = user.purchasedVideos.filter(
        id => !id.equals(purchase.videoId)
      );
      await user.save();
    }

    res.json({ success: true, message: 'Purchase deleted successfully' });

  } catch (error) {
    console.error('Delete purchase error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;