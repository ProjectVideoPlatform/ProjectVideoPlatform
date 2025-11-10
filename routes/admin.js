const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { getJobStatus, cancelJob, listJobs } = require('../services/mediaConvert');
const Video = require('../models/Video');
const Purchase = require('../models/Purchase');
const User = require('../models/User');

const router = express.Router();

// Apply admin middleware to all routes
router.use(authenticateToken, requireAdmin);

// Get all videos with detailed status
router.get('/videos', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc' 
    } = req.query;
    
    const skip = (page - 1) * limit;
    let query = {};
    
    if (status) {
      query.uploadStatus = status;
    }
     query.isActive = true; // only active videos
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { id: { $regex: search, $options: 'i' } }
      ];
    }
    
    const sortDirection = sortOrder === 'desc' ? -1 : 1;
    const sortObj = { [sortBy]: sortDirection };
    
    const videos = await Video.find(query)
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Video.countDocuments(query);
    
    // Get purchase counts for each video
    const videoIds = videos.map(v => v._id);
    const purchaseCounts = await Purchase.aggregate([
      { $match: { videoId: { $in: videoIds }, status: 'completed' } },
      { $group: { _id: '$videoId', count: { $sum: 1 } } }
    ]);
    
    const purchaseCountMap = {};
    purchaseCounts.forEach(pc => {
      purchaseCountMap[pc._id.toString()] = pc.count;
    });
    
    const videosWithStats = videos.map(video => ({
      ...video.toObject(),
      purchaseCount: purchaseCountMap[video._id.toString()] || 0
    }));
    
    res.json({
      videos: videosWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Admin get videos error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get video analytics
router.get('/videos/:id/analytics', async (req, res) => {
  try {
    const video = await Video.findOne({ id: req.params.id });
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Get purchase analytics
    const purchases = await Purchase.find({ 
      videoId: video._id,
      status: 'completed' 
    }).sort({ purchaseDate: -1 });

    // Calculate revenue
    const totalRevenue = purchases.reduce((sum, p) => sum + p.amount, 0);
    
    // Get daily purchase stats for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const dailyStats = await Purchase.aggregate([
      {
        $match: {
          videoId: video._id,
          status: 'completed',
          purchaseDate: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$purchaseDate' },
            month: { $month: '$purchaseDate' },
            day: { $dayOfMonth: '$purchaseDate' }
          },
          count: { $sum: 1 },
          revenue: { $sum: '$amount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    res.json({
      video: {
        id: video.id,
        title: video.title,
        uploadStatus: video.uploadStatus,
        createdAt: video.createdAt
      },
      analytics: {
        totalPurchases: purchases.length,
        totalRevenue,
        averagePrice: purchases.length > 0 ? totalRevenue / purchases.length : 0,
        totalAccessCount: purchases.reduce((sum, p) => sum + (p.accessCount || 0), 0),
        dailyStats,
        recentPurchases: purchases.slice(0, 10)
      }
    });
  } catch (error) {
    console.error('Video analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update video details
router.put('/videos/:id', async (req, res) => {
  try {
    const { title, description, price, tags } = req.body;
    console.log('Update video request for ID:', req.params.id, req.body);
       console.log('Title:', title);
        console.log('Description:', description);
          console.log('Price:', price);
          console.log('Tags:', tags);
    const video = await Video.findOne({ id: req.params.id });
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (title) video.title = title;
    if (description !== undefined) video.description = description;
    if (price !== undefined) video.price = parseFloat(price);
    if (tags) video.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());


    await video.save();

    res.json({
      success: true,
      message: 'Video updated successfully',
      video
    });
  } catch (error) {
    console.error('Update video error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete video
router.delete('/videos/:id', async (req, res) => {
  try {
    console.log('Delete video request for ID:', req.params.id);
    const video = await Video.findOne({ id: req.params.id });
    console.log('Found video:', video);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Cancel MediaConvert job if still processing
    if (video.mediaConvertJobId && video.uploadStatus === 'processing') {
      try {
        await cancelJob(video.mediaConvertJobId);
      } catch (cancelError) {
        console.error('Failed to cancel MediaConvert job:', cancelError);
      }
    }

    // Mark as inactive instead of deleting
    video.isActive = false;
    await video.save();

    res.json({
      success: true,
      message: 'Video deleted successfully'
    });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get MediaConvert job status
router.get('/mediaconvert/jobs/:jobId', async (req, res) => {
  try {
    const job = await getJobStatus(req.params.jobId);
    res.json({ job });
  } catch (error) {
    console.error('Get job status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List MediaConvert jobs
router.get('/mediaconvert/jobs', async (req, res) => {
  try {
    const { status, maxResults = 20 } = req.query;
    const jobs = await listJobs(status, parseInt(maxResults));
    res.json({ jobs });
  } catch (error) {
    console.error('List jobs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cancel MediaConvert job
router.post('/mediaconvert/jobs/:jobId/cancel', async (req, res) => {
  try {
    await cancelJob(req.params.jobId);
    
    // Update video status
    const video = await Video.findOne({ mediaConvertJobId: req.params.jobId });
    if (video) {
      video.uploadStatus = 'failed';
      await video.save();
    }

    res.json({
      success: true,
      message: 'Job cancelled successfully'
    });
  } catch (error) {
    console.error('Cancel job error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all users
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, role } = req.query;
    const skip = (page - 1) * limit;
    
    let query = {};
    
    if (search) {
      query.email = { $regex: search, $options: 'i' };
    }
    
    if (role) {
      query.role = role;
    }
    
    const users = await User.find(query)
      .select('-password')
      .populate('purchasedVideos', 'id title price')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await User.countDocuments(query);
    
    // Get purchase stats for each user
    const userIds = users.map(u => u._id);
    const purchaseStats = await Purchase.aggregate([
      { $match: { userId: { $in: userIds }, status: 'completed' } },
      { 
        $group: { 
          _id: '$userId', 
          totalSpent: { $sum: '$amount' },
          totalPurchases: { $sum: 1 }
        } 
      }
    ]);
    
    const statsMap = {};
    purchaseStats.forEach(stat => {
      statsMap[stat._id.toString()] = {
        totalSpent: stat.totalSpent,
        totalPurchases: stat.totalPurchases
      };
    });
    
    const usersWithStats = users.map(user => ({
      ...user.toObject(),
      stats: statsMap[user._id.toString()] || { totalSpent: 0, totalPurchases: 0 }
    }));
    
    res.json({
      users: usersWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get dashboard statistics
router.get('/dashboard/stats', async (req, res) => {
  try {
    const [
      totalVideos,
      totalUsers,
      totalPurchases,
      totalRevenue,
      processingVideos,
      completedVideos,
      failedVideos
    ] = await Promise.all([
      Video.countDocuments({ isActive: true }),
      User.countDocuments(),
      Purchase.countDocuments({ status: 'completed' }),
      Purchase.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Video.countDocuments({ uploadStatus: 'processing' }),
      Video.countDocuments({ uploadStatus: 'completed' }),
      Video.countDocuments({ uploadStatus: 'failed' })
    ]);

    // Get revenue trend for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const revenueTrend = await Purchase.aggregate([
      {
        $match: {
          status: 'completed',
          purchaseDate: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$purchaseDate' },
            month: { $month: '$purchaseDate' },
            day: { $dayOfMonth: '$purchaseDate' }
          },
          revenue: { $sum: '$amount' },
          purchases: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    res.json({
      stats: {
        totalVideos,
        totalUsers,
        totalPurchases,
        totalRevenue: totalRevenue[0]?.total || 0,
        processingVideos,
        completedVideos,
        failedVideos
      },
      trends: {
        revenue: revenueTrend
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all purchases with details
router.get('/purchases', async (req, res) => {
  try {
    const { page = 1, limit = 20, userId, videoId, status } = req.query;
    const skip = (page - 1) * limit;
    
    let query = {};
    
    if (userId) query.userId = userId;
    if (videoId) {
      const video = await Video.findOne({ id: videoId });
      if (video) query.videoId = video._id;
    }
    if (status) query.status = status;
    
    const purchases = await Purchase.find(query)
      .populate('userId', 'email role')
      .populate('videoId', 'id title price')
      .sort({ purchaseDate: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
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
    console.error('Get purchases error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;