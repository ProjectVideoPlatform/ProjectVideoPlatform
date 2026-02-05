const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { generatePresignedUploadUrl, validateVideoFile, validateFileSize } = require('../services/s3Upload');
const { createMediaConvertJob } = require('../services/mediaConvert');
const { generateSignedCookies, setCookiesInResponse } = require('../services/cloudfront');
const { config } = require('../config/aws');
const Video = require('../models/Video');
const Purchase = require('../models/Purchase');
const escapeStringRegexp = require('escape-string-regexp');
  const https = require('https');
const router = express.Router();
router.get('/video-progress', authenticateToken, async (req, res) => {
  try {
    console.log("kuy  เอ้ย fetching video progress");
    const { videoId } = req.query;

    if (!videoId) {
      return res.status(400).json({ error: "videoId is required" });
    }

    console.log("Fetching video progress for videoId:", videoId);

    const purchase = await Purchase.findOne({
      userId: req.user._id,
      videoId: videoId
    });

    return res.json({
      lastTime: purchase?.lastTime || 0
    });

  } catch (err) {
    console.error("Error fetching progress", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST - บันทึก progress
router.post('/video-progress', authenticateToken, async (req, res) => {
  const { videoId, currentTime } = req.body;
  const purchase = await Purchase.findOne({
    userId: req.user._id,
    videoId: videoId
  });
  purchase.lastTime = currentTime;
  await purchase.save();
  res.json({ success: true });
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

    console.log(`Completing upload for video: ${videoId}`);
    
    // Update video status
    video.uploadStatus = 'uploaded';
    video.s3Key = `uploads/${videoId}/original.${video.originalFileName.split('.').pop()}`;
    await video.save();

    // Start MediaConvert job
    const inputS3Path = `s3://${config.uploadsBucket}/${video.s3Key}`;
    const outputS3Path = `s3://${config.hlsOutputBucket}/videos/${videoId}/`;
    
    try {
      video.uploadStatus = 'processing';
      const job = await createMediaConvertJob(inputS3Path, outputS3Path, videoId);
      video.mediaConvertJobId = job.Id;
      await video.save();

      console.log(`MediaConvert job started: ${job.Id} for video: ${videoId}`);

      res.json({
        success: true,
        videoId,
        jobId: job.Id,
        message: 'Upload completed, processing started',
        video: {
          id: videoId,
          title: video.title,
          uploadStatus: video.uploadStatus
        }
      });

    } catch (mcError) {
      console.error('MediaConvert error:', mcError);
      video.uploadStatus = 'failed';
      video.errorMessage = mcError.message;
      await video.save();
      res.status(500).json({ 
        error: 'Failed to start video processing',
        details: mcError.message 
      });
    }

  } catch (error) {
    console.error('Complete upload error:', error);
    res.status(500).json({ error: error.message });
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
      _id: req.params.id,
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
     console.log(cookies);
    res.json({
      success: true,
      manifestUrl: `https://${config.cloudFrontDomain}/videos/${video.id}/original.m3u8`,
      expiresIn,
          videoId: video._id.toString(), // ← เพิ่มบรรทัดนี้
      message: 'Playback access granted',
      cookies: cookies
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
    console.log("SNS endpoint hit");
    console.log("Raw SNS body:", req.body);

    const body = req.body;

    // 1️⃣ Subscription confirmation (สำคัญมาก)
    if (body.Type === "SubscriptionConfirmation") {
      console.log("Confirming SNS subscription...");
      await fetch(body.SubscribeURL);
      return res.json({ confirmed: true });
    }

    // 2️⃣ Notification (event จริง)
    if (body.Type === "Notification") {
      const message = JSON.parse(body.Message);

      const detailType = message["detail-type"];
      const detail = message.detail;

      console.log("detail-type:", detailType);
      console.log("detail:", detail);

      if (detailType === "MediaConvert Job State Change") {
        const status = detail.status;
        const videoId = detail.userMetadata?.VideoId;

        console.log(
          `Job ${detail.jobId} status=${status}, videoId=${videoId}`
        );

        if (!videoId) {
          console.log("❌ VideoId missing", detail.userMetadata);
          return res.json({ error: "VideoId missing" });
        }

        const video = await Video.findOne({ id: videoId });
        if (!video) {
          console.log("❌ Video not found:", videoId);
          return res.json({ error: "Video not found" });
        }

        if (status === "COMPLETE") {
          video.uploadStatus = "completed";
          video.thumbnailPath = `videos/${videoId}/thumbnails/`;
        } else if (status === "ERROR") {
          video.uploadStatus = "failed";
        }

        await video.save();
        console.log(`✅ Video ${videoId} updated → ${video.uploadStatus}`);
      }
    }

    res.json({ received: true });
  }
);


// MediaConvert webhook handler
router.post('/mediaconvert/webhook', async (req, res) => {
  try {
    const body = req.body;
    const { detail } = body;

    if (!detail || !detail.userMetadata || !detail.userMetadata.videoId) {
      console.log('Invalid webhook payload');
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    const videoId = detail.userMetadata.videoId;
    const video = await Video.findOne({ id: videoId });

    if (!video) {
      console.error(`Video not found for webhook: ${videoId}`);
      return res.status(404).json({ error: 'Video not found' });
    }

    if (detail.status === 'COMPLETE') {
      video.uploadStatus = 'completed';
      video.hlsManifestPath = `videos/${videoId}/original.m3u8`;
      video.thumbnailPath = `videos/${videoId}/thumbnails/`;

      if (detail.jobDetails && detail.jobDetails.inputDetails) {
        const inputDetail = detail.jobDetails.inputDetails[0];
        if (inputDetail && inputDetail.durationInMs) {
          video.duration = Math.floor(inputDetail.durationInMs / 1000);
        }
      }

      await video.save();
      console.log(`Video ${videoId} processing completed`);

    } else if (detail.status === 'ERROR') {
      video.uploadStatus = 'failed';
      if (detail.errorMessage) {
        video.errorMessage = detail.errorMessage;
      }
      await video.save();
      console.log(`Video ${videoId} processing failed`);
    }

    res.json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

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

module.exports = router;