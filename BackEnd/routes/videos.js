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
// ⚠️ อย่าลืม import โมเดล Video ไว้ด้านบนของไฟล์ด้วยนะครับ (ถ้ายังไม่มี)
// const Video = require('../models/Video'); 

// GET - ดึง progress ปัจจุบัน
router.get('/video-progress', authenticateToken, async (req, res) => {
  try {
    const { videoId } = req.query; // รับ UUID มาจาก Frontend
    if (!videoId) {
      return res.status(400).json({ error: 'videoId is required' });
    }

    // 1️⃣ แปลง UUID ให้เป็น ObjectId ของ Video ก่อน
    // 💡 หมายเหตุ: ถ้าใน Schema Video ของพี่ตั้งชื่อฟิลด์ UUID เป็นอย่างอื่น (เช่น publicId, uuid) ให้แก้ตรง { id: ... } ด้วยนะครับ
    const video = await Video.findOne({ id: videoId }); 
    
    // ถ้าไม่เจอวิดีโอ ก็ถือว่ายังไม่ได้ซื้อ/ไม่มีข้อมูล
    if (!video) {
      return res.json({ lastTime: 0, owned: false });
    }

    // 2️⃣ เอา ObjectId ที่หามาได้ ไปหาใน Purchase ต่อ
    const purchase = await Purchase.findOne({
      userId: req.user._id,
      videoId: video._id, // ✅ ตรงนี้ส่ง ObjectId ถูกต้องตามที่ Mongoose ต้องการแล้ว
    });

    // ถ้าไม่มี purchase record → user ไม่ได้ซื้อ ไม่ต้อง restore progress
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

// POST - บันทึก progress (เฉพาะวิดีโอที่ซื้อแล้ว เท่านั้น)
router.post('/video-progress', authenticateToken, async (req, res) => {
  try {
    const { videoId, currentTime } = req.body; // รับ UUID มาจาก Frontend

    if (!videoId || currentTime == null) {
      return res.status(400).json({ error: 'videoId and currentTime are required' });
    }
    if (typeof currentTime !== 'number' || currentTime < 0) {
      return res.status(400).json({ error: 'currentTime must be a non-negative number' });
    }

    // 1️⃣ แปลง UUID ให้เป็น ObjectId ของ Video ก่อน
    const video = await Video.findOne({ id: videoId });
    if (!video) {
      return res.json({ success: false, reason: 'video_not_found' });
    }

    // 2️⃣ เอา ObjectId ไปเช็คสิทธิ์ใน Purchase
    const purchase = await Purchase.findOne({
      userId: req.user._id,
      videoId: video._id, // ✅ ใช้ ObjectId ในการค้นหา
    });

    if (!purchase) {
      // ไม่ error แต่ silent ignore (free video หรือ admin ไม่มี record)
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
// Get video list (public videos or user's purchased videos)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let { page = 1, limit = 10, search, category } = req.query;

    // ---- Validation (สำคัญ) ----
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
      // allowlist แบบง่าย
      query.tags = { $in: [category] };
    }

    const videos = await Video.find(query)
      .select('id title description price duration thumbnailPath tags createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Video.countDocuments(query);

    const purchasedVideoIds = await Purchase.find({
      userId: req.user._id,
      status: 'completed'
    }).distinct('videoId');

    const videosWithPurchaseStatus = videos.map(video => ({
      ...video.toObject(),
      uploadStatus: 'completed',
      purchased: purchasedVideoIds.some(id => id.equals(video._id)),
      canPlay:
        req.user.role === 'admin' ||
        purchasedVideoIds.some(id => id.equals(video._id)),
      thumbnailPath: video.thumbnailPath
    }));

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
// routes/videos.js


router.get('/foryou', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;

    const { videos, source, boostCategory } = await getRecommendedVideos(userId);

    res.json({ videos: videos, source, boostCategory   }); // source: 'personalized' | 'trending'
  } catch (error) {
    console.error('[/foryou]', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get single video info
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const video = await Video.findOne({ 
      id: req.params.id,
      isActive: true 
    });
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Check if user has purchased this video
    const purchase = await Purchase.findOne({
      userId: req.user._id,
      videoId: video._id,
      status: 'completed',
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } }
      ]
    });

    const canPlay = !!purchase || req.user.role === 'admin';
    
    res.json({
      video: {
        ...video.toObject(),
        // Hide sensitive info for non-owners
        hlsManifestPath: canPlay ? video.hlsManifestPath : undefined,
        mediaConvertJobId: req.user.role === 'admin' ? video.mediaConvertJobId : undefined
      },
      purchased: !!purchase,
      canPlay,
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

// Step 1: Initialize upload and get presigned URL (Admin only)
router.post('/upload/initialize', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, description, price, tags, fileName, fileSize, contentType } = req.body;
    
    // Validate required fields
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    if (!fileName) {
      return res.status(400).json({ error: 'File name is required' });
    }
    
    if (!fileSize) {
      return res.status(400).json({ error: 'File size is required' });
    }
    
    if (!contentType) {
      return res.status(400).json({ error: 'Content type is required' });
    }

    // Validate file
    validateVideoFile(fileName, contentType);
    validateFileSize(fileSize);
    
    const videoId = uuidv4();
    
    console.log(`Initializing upload for video: ${videoId} - ${title}`);

    // Create video record in database
    const video = new Video({
      id: videoId,
      title,
      description,
      price: parseFloat(price) || 0,
      originalFileName: fileName,
      fileSize: parseInt(fileSize),
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      uploadStatus: 'uploading'
    });

    await video.save();
    console.log(`Video record created: ${videoId}`);

    // Generate presigned URL
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
        uploadStatus: video.uploadStatus
      }
    });

  } catch (error) {
    console.error('Initialize upload error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Step 2: Confirm upload completion and start processing
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

    // ⭐ เปลี่ยนเป็น queued เลย (สำคัญ)
    video.uploadStatus = 'uploaded';

    video.s3Key = `uploads/${videoId}/original.${video.originalFileName.split('.').pop()}`;

    await video.save();

    // ⭐ Job Payload
    const jobData = {
      videoId: video.id,
      title: video.title,
      email: req.user.email,

      inputS3Path: `s3://${config.uploadsBucket}/${video.s3Key}`,
      outputS3Path: `s3://${config.hlsOutputBucket}/videos/${videoId}/`,

      createdAt: new Date().toISOString()
    };

    // ⭐ ส่งเข้า Transcode Queue
    await queueService.sendToQueue(
      QUEUES.VIDEO_TRANSCODE,
      jobData
    );

    console.log(`[Queue] Transcode task queued: ${videoId}`);

    res.json({
      success: true,
      videoId,
      message: 'Upload confirmed. Processing task queued.',
      video: {
        id: videoId,
        title: video.title,
        uploadStatus: 'uploaded'
      }
    });

  } catch (error) {
    console.error('Complete upload error:', error);

    res.status(500).json({
      error: 'Queue failed or server error'
    });
  }
});

// Step 3: Handle upload failure
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
    
    res.json({
      success: true,
      message: 'Upload failure recorded'
    });

  } catch (error) {
    console.error('Record upload failure error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Purchase video
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

    // Check if already purchased
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

    // Create new purchase (in real world, this would go through payment gateway)
    const purchase = new Purchase({
      userId: req.user._id,
      videoId: video._id,
      amount: video.price,
      status: 'completed' // In real world, would be 'pending' until payment succeeds
    });

    await purchase.save();

    // Add to user's purchased videos
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

// Get secure playback URL (generate signed cookies)
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

    // Check permissions
    const canPlay = req.user.role === 'admin' || 
                   await Purchase.hasAccess(req.user._id, video._id);

    if (!canPlay) {
      return res.status(403).json({ error: 'Purchase required to play this video' });
    }

    // Record access if user has purchased
    const purchase = await Purchase.findOne({
      userId: req.user._id,
      videoId: video._id,
      status: 'completed'
    });
    
    if (purchase) {
      await purchase.recordAccess();
    }

    // Generate signed cookies
    const { cookies, expiresIn } = generateSignedCookies(video.id, 15); // 15 minutes

    // Set cookies in response
    setCookiesInResponse(res, cookies);

    res.json({
      success: true,
      manifestUrl: `https://${config.cloudFrontDomain}/videos/${video.id}/original.m3u8`,
      expiresIn,
      videoId: video._id.toString(), // ← เพิ่มบรรทัดนี้
      message: 'Playback access granted'
    });

  } catch (error) {
    console.error('Play error:', error);
    res.status(500).json({ error: error.message });
  }
});




router.post(
  "/mediaconvert/subscribe",
  express.json({ type: "*/*" }),
  async (req, res) => {
    try {
      console.log("--- New Webhook Received ---");
      const body = req.body;
      
      // 1. จัดการเรื่อง Subscription Confirmation
      if (body.Type === "SubscriptionConfirmation") {
        console.log("Confirming SNS subscription...");
        await fetch(body.SubscribeURL);
        return res.json({ confirmed: true });
      }

      // 2. แกะข้อมูล Message
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

      // 3. 🔍 ดึงข้อมูล Video จาก DB มาก่อน
      const video = await Video.findOne({ id: videoId }); 

      if (!video) {
        console.log("❌ Video not found in DB:", videoId);
        return res.status(404).json({ error: "Video not found" });
      }

      console.log(`Job ID: ${jobId} | Status: ${status} | VideoId: ${videoId}`);

      // 4. เตรียมข้อมูลตามสถานะ
      if (status === "COMPLETE") {
        video.uploadStatus = "completed";

        // หา Thumbnail จาก S3
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

      // 🚨 5. [สำคัญมาก] บันทึกการเปลี่ยนแปลงลง DB ให้สำเร็จก่อน!
      await video.save({ writeConcern: { w: 'majority' } });
      console.log(`✅ DB Saved Status: ${video.uploadStatus} for VideoId: ${videoId}`);

      // 6. เมื่อ DB อัปเดตผ่านชัวร์ๆ แล้ว ค่อยกระจายงานให้ระบบอื่นๆ
      if (status === "COMPLETE") {
        // ส่งเข้า Queue เพื่อทำ Index / ML (Embedding)
        await queueService.sendToQueue('video_index', {
          eventType: 'video_ready',
          videoId: videoId,
          title: video.title || '',
          description: video.description || '',
          categories: video.tags || [],
        });
   console.log(video.tags +" Video Tags");
        // แจ้งเตือนหน้าเว็บ
        await broadcast({ videoId, type: "transcode_completed", status: "completed" });
      }

      // ส่ง Email แจ้งเตือน (ทำทั้งตอน Complete และ Error)
      await queueService.sendToQueue(QUEUES.EMAIL_NOTIFY, {
        type: status === "COMPLETE" ? "VIDEO_COMPLETE" : "VIDEO_FAILED",
        videoId: videoId,
        email: video.email || "manaphatg@gmail.com",
        title: video.title
      });

      return res.json({ updated: true, videoId });

    } catch (error) {
      console.error("🔥 Error in Webhook:", error.message);
      // ส่ง 200 เพื่อป้องกัน AWS Retry loop ถล่ม Server
      res.status(200).json({ error: "Processing failed", details: error.message });
    }
  }
);
// MediaConvert webhook handler
// router.post('/mediaconvert/webhook', async (req, res) => {
//   try {
//     const body = req.body;
//     const { detail } = body;

//     if (!detail || !detail.userMetadata || !detail.userMetadata.videoId) {
//       console.log('Invalid webhook payload');
//       return res.status(400).json({ error: 'Invalid webhook payload' });
//     }

//     const videoId = detail.userMetadata.videoId;
//     const video = await Video.findOne({ id: videoId });

//     if (!video) {
//       console.error(`Video not found for webhook: ${videoId}`);
//       return res.status(404).json({ error: 'Video not found' });
//     }

//     if (detail.status === 'COMPLETE') {
//       video.uploadStatus = 'completed';
//       video.hlsManifestPath = `videos/${videoId}/original.m3u8`;
//       video.thumbnailPath = `videos/${videoId}/thumbnails/`;

//       if (detail.jobDetails && detail.jobDetails.inputDetails) {
//         const inputDetail = detail.jobDetails.inputDetails[0];
//         if (inputDetail && inputDetail.durationInMs) {
//           video.duration = Math.floor(inputDetail.durationInMs / 1000);
//         }
//       }

//       await video.save();
//       console.log(`Video ${videoId} processing completed`);

//     } else if (detail.status === 'ERROR') {
//       video.uploadStatus = 'failed';
//       if (detail.errorMessage) {
//         video.errorMessage = detail.errorMessage;
//       }
//       await video.save();
//       console.log(`Video ${videoId} processing failed`);
//     }

//     res.json({ received: true });

//   } catch (error) {
//     console.error('Webhook error:', error);
//     res.status(500).json({ error: error.message });
//   }
// });

// Get user's purchased videos
router.get('/purchased/list', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    const purchases = await Purchase.find({
      userId: req.user._id,
      status: 'completed'
    })
    .populate('videoId', 'id title description thumbnailPath duration price tags')
    .sort({ purchaseDate: -1 })
    .skip(skip)
    .limit(parseInt(limit));
    
    const total = await Purchase.countDocuments({
      userId: req.user._id,
      status: 'completed'
    });
    
    const purchasedVideos = purchases.map(purchase => ({
      ...purchase.videoId.toObject(),
              uploadStatus : "completed",
                 canPlay : true,
      purchaseInfo: {
        purchaseDate: purchase.purchaseDate,
        amount: purchase.amount,
        accessCount: purchase.accessCount,
        lastAccessedAt: purchase.lastAccessedAt
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
/**
 * 🧪 TESTING ONLY: Simulate purchase for a user
 * ใช้สำหรับทดสอบเท่านั้น - ไม่ควรใช้ใน production จริง
 */
router.post('/simulate-purchase/:videoId', authenticateToken, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { userId, paymentMethod = 'cash' } = req.body; // ✅ เพิ่ม default

    // ✅ ตรวจสอบสิทธิ์
    if (req.user.role !== 'admin' && req.user.email !== 'tester@example.com') {
      return res.status(403).json({ 
        error: 'Forbidden - This endpoint is for testing only' 
      });
    }

    // ✅ หา target user
    let targetUser = req.user;
    if (userId && req.user.role === 'admin') {
      const User = require('../models/User');
      targetUser = await User.findById(userId);
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }
    }

    // ✅ หา video
    const video = await Video.findOne({ 
      id: videoId,
      uploadStatus: 'completed',
      isActive: true 
    });
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found or not available' });
    }

    // ✅ ตรวจสอบว่าซื้อไปแล้วหรือยัง
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

    // ✅ สร้าง purchase (ใส่ทุก field ที่ required)
    const purchase = new Purchase({
      userId: targetUser._id,
      videoId: video._id,
      amount: video.price || 0,
      status: 'completed',
      paymentMethod: paymentMethod, // ✅ เพิ่มตรงนี้
      paymentId: `simulate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      purchaseDate: new Date(),
      expiresAt: null,
      accessCount: 0,
      lastAccessedAt: null,
      lastTime: 0
    });

    await purchase.save();

    // ✅ เพิ่ม video เข้าไปใน purchasedVideos ของ user
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
/**
 * 🧪 TESTING ONLY: Bulk purchase simulation
 * ซื้อหลาย video พร้อมกัน
 */
router.post('/simulate-bulk-purchase', authenticateToken, async (req, res) => {
  try {
    const { userId, videoIds, paymentMethod = 'cash' } = req.body; // ✅ เพิ่ม default

    // ✅ ตรวจสอบสิทธิ์
    if (req.user.role !== 'admin' && req.user.email !== 'tester@example.com') {
      return res.status(403).json({ error: 'Forbidden - This endpoint is for testing only' });
    }

    // ✅ หา target user
    let targetUser = req.user;
    if (userId && req.user.role === 'admin') {
      const User = require('../models/User');
      targetUser = await User.findById(userId);
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }
    }

    // ✅ หา videos
    const videos = await Video.find({
      id: { $in: videoIds },
      uploadStatus: 'completed',
      isActive: true
    });

    if (videos.length === 0) {
      return res.status(404).json({ error: 'No valid videos found' });
    }

    const results = {
      success: [],
      failed: []
    };

    for (const video of videos) {
      try {
        // ตรวจสอบว่าซื้อไปแล้วหรือยัง
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

        // ✅ สร้าง purchase (ใส่ paymentMethod)
        const purchase = new Purchase({
          userId: targetUser._id,
          videoId: video._id,
          amount: video.price || 0,
          status: 'completed',
          paymentMethod: paymentMethod, // ✅ เพิ่มตรงนี้
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
/**
 * 🧪 TESTING ONLY: Get all purchases for a user
 */
router.get('/admin/purchases/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const purchases = await Purchase.find({ userId })
      .populate('videoId', 'id title thumbnailPath duration')
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

/**
 * 🧪 TESTING ONLY: Reset purchase (delete purchase)
 */
router.delete('/admin/purchases/:purchaseId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { purchaseId } = req.params;

    const purchase = await Purchase.findByIdAndDelete(purchaseId);

    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    // ลบ video ออกจาก purchasedVideos ของ user
    const User = require('../models/User');
    const user = await User.findById(purchase.userId);
    if (user && user.purchasedVideos) {
      user.purchasedVideos = user.purchasedVideos.filter(
        id => !id.equals(purchase.videoId)
      );
      await user.save();
    }

    res.json({
      success: true,
      message: 'Purchase deleted successfully'
    });

  } catch (error) {
    console.error('Delete purchase error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;