const mongoose = require('mongoose');
const Purchase = require('../models/Purchase');
const Video = require('../models/Video');
const User = require('../models/User');
const PaymentService = require('./PaymentService');
const logger = require('../utils/logger');
const { generateIdempotencyKey } = require('../utils/idempotency');

class PurchaseService {
  constructor() {
    // Initialize any dependencies
  }

  async purchaseVideo(userId, videoId, paymentData) {
    const session = await mongoose.startSession();
    let purchase = null;
    
    try {
      await session.startTransaction();
      
      // 1. Validate video
      const video = await Video.findOne({ 
        _id: videoId, 
        isActive: true 
      }).session(session);
      
      if (!video) {
        throw new Error('Video not found or inactive');
      }
      
      // 2. Check existing access
      const existingPurchase = await Purchase.findOne({
        userId,
        videoId,
        status: 'completed',
        $or: [
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } }
        ]
      }).session(session);
      
      if (existingPurchase) {
        await session.abortTransaction();
        return { 
          success: true, 
          purchase: existingPurchase,
          message: 'Already has access',
          alreadyOwned: true
        };
      }
      
      // 3. Process payment
      const paymentResult = await PaymentService.processPayment({
        ...paymentData,
        amount: video.price,
        description: `Purchase video: ${video.title}`,
        customerId: userId,
        metadata: { videoId, videoTitle: video.title }
      });
      
      if (!paymentResult.success) {
        throw new Error(`Payment failed: ${paymentResult.reason}`);
      }
      
      // 4. Create purchase record
      purchase = new Purchase({
        userId,
        videoId,
        amount: video.price,
        currency: 'THB',
        paymentMethod: paymentResult.method,
        transactionId: paymentResult.id,
        gatewayTransactionId: paymentResult.gatewayId,
        status: 'completed',
        purchaseDate: new Date(),
        expiresAt: video.accessDuration ? 
          new Date(Date.now() + video.accessDuration) : null,
        metadata: {
          gateway: paymentResult.gateway,
          capturedAt: paymentResult.capturedAt,
          paymentMethod: paymentResult.method,
          rawResponse: paymentResult.rawResponse || {}
        }
      });
      
      await purchase.save({ session });
      
      // 5. Update user
      await User.updateOne(
        { _id: userId },
        {
          $addToSet: { purchasedVideos: videoId },
          $inc: { totalSpent: video.price },
          $set: { updatedAt: new Date() }
        },
        { session }
      );
      
      // 6. Update video purchase count
      await Video.updateOne(
        { _id: videoId },
        { $inc: { purchaseCount: 1 } },
        { session }
      );
      
      await session.commitTransaction();
      
      logger.info(`Purchase completed: ${purchase._id}`, { 
        userId, 
        videoId,
        amount: video.price,
        transactionId: paymentResult.id 
      });
      
      // 7. Post-purchase actions (outside transaction)
      await this.afterPurchaseActions(userId, videoId, purchase);
      
      return { 
        success: true, 
        purchase,
        payment: {
          id: paymentResult.id,
          gateway: paymentResult.gateway,
          status: 'completed'
        }
      };
      
    } catch (error) {
      await session.abortTransaction();
      
      logger.error(`Purchase failed: ${error.message}`, { 
        userId, 
        videoId, 
        error: error.message,
        stack: error.stack 
      });
      
      // Compensating action - try to refund if payment was successful
      if (purchase) {
        try {
          await PaymentService.refundIfNeeded({
            transactionId: purchase.transactionId,
            amount: purchase.amount,
            reason: `Purchase rollback: ${error.message}`
          });
        } catch (refundError) {
          logger.error('Refund attempt failed:', refundError);
        }
      }
      
      throw new Error(`Purchase failed: ${error.message}`);
    } finally {
      session.endSession();
    }
  }
  
  async bulkPurchaseVideos(userId, videoIds, paymentData) {
    // Validate input
    if (!videoIds || !Array.isArray(videoIds) || videoIds.length === 0) {
      throw new Error('Invalid videoIds array');
    }
    
    if (videoIds.length > 1000) {
      throw new Error('Maximum 1000 videos per bulk purchase');
    }
    
    const BATCH_SIZE = 100;
    const idempotencyKey = generateIdempotencyKey(userId, paymentData.transactionId, videoIds);
    
    // Check idempotency
    const existing = await this.checkIdempotency(idempotencyKey);
    if (existing) {
      logger.info(`Idempotent request detected: ${idempotencyKey}`);
      return existing;
    }
    
    const session = await mongoose.startSession();
    
    try {
      await session.startTransaction();
      
      // Create processing record
      await this.createProcessingRecord(idempotencyKey, userId, videoIds, session);
      
      // Get all videos in one query
      const videos = await Video.find({
        _id: { $in: videoIds },
        isActive: true
      }).session(session);
      
      if (videos.length === 0) {
        throw new Error('No active videos found');
      }
      
      // Create video map
      const videoMap = new Map();
      videos.forEach(video => {
        videoMap.set(video._id.toString(), video);
      });
      
      // Check existing purchases
      const existingPurchases = await Purchase.find({
        userId,
        videoId: { $in: videoIds },
        status: 'completed',
        $or: [
          { expiresAt: null },
          { expiresAt: { $gt: new Date() } }
        ]
      }).session(session);
      
      const existingSet = new Set(
        existingPurchases.map(p => p.videoId.toString())
      );
      
      // Filter out videos to purchase
      const videosToPurchase = videos.filter(video => 
        !existingSet.has(video._id.toString())
      );
      
      if (videosToPurchase.length === 0) {
        await session.abortTransaction();
        return { 
          success: true, 
          message: 'All videos already purchased',
          alreadyOwned: true,
          bulkId: idempotencyKey
        };
      }
      
      // Calculate total amount
      const totalAmount = videosToPurchase.reduce((sum, video) => sum + video.price, 0);
      
      // Process payment for total amount
      const paymentResult = await PaymentService.processPayment({
        ...paymentData,
        amount: totalAmount,
        description: `Bulk purchase: ${videosToPurchase.length} videos`,
        customerId: userId,
        metadata: { 
          videoCount: videosToPurchase.length,
          videoIds: videosToPurchase.map(v => v._id)
        }
      });
      
      if (!paymentResult.success) {
        throw new Error(`Bulk payment failed: ${paymentResult.reason}`);
      }
      
      // Create purchases in batches
      const results = [];
      const successfulVideoIds = [];
      const purchases = [];
      
      for (let i = 0; i < videosToPurchase.length; i += BATCH_SIZE) {
        const batch = videosToPurchase.slice(i, i + BATCH_SIZE);
        const batchPurchases = [];
        
        for (const video of batch) {
          try {
            const purchase = new Purchase({
              userId,
              videoId: video._id,
              bulkId: idempotencyKey,
              amount: video.price,
              currency: 'THB',
              paymentMethod: paymentResult.method,
              transactionId: `${paymentResult.id}:${video._id.toString()}`,
              gatewayTransactionId: paymentResult.gatewayId,
              status: 'completed',
              purchaseDate: new Date(),
              expiresAt: video.accessDuration ? 
                new Date(Date.now() + video.accessDuration) : null,
              metadata: {
                gateway: paymentResult.gateway,
                capturedAt: paymentResult.capturedAt,
                isBulk: true,
                bulkIndex: purchases.length + batchPurchases.length
              }
            });
            
            batchPurchases.push(purchase);
            successfulVideoIds.push(video._id);
            results.push({ 
              videoId: video._id, 
              status: 'success', 
              amount: video.price 
            });
            
          } catch (error) {
            results.push({ 
              videoId: video._id, 
              status: 'error', 
              error: error.message 
            });
          }
        }
        
        // Save batch
        if (batchPurchases.length > 0) {
          await Purchase.insertMany(batchPurchases, { session });
          purchases.push(...batchPurchases);
        }
      }
      
      if (successfulVideoIds.length === 0) {
        throw new Error('No videos were purchased successfully');
      }
      
      // Update user
      await User.updateOne(
        { _id: userId },
        {
          $addToSet: { purchasedVideos: { $each: successfulVideoIds } },
          $inc: { totalSpent: totalAmount },
          $set: { updatedAt: new Date() }
        },
        { session }
      );
      
      // Update video purchase counts
      await Video.updateMany(
        { _id: { $in: successfulVideoIds } },
        { $inc: { purchaseCount: 1 } },
        { session }
      );
      
      // Update processing record
      await this.updateProcessingRecord(
        idempotencyKey, 
        'completed', 
        { 
          results, 
          totalAmount,
          purchasedCount: successfulVideoIds.length,
          paymentId: paymentResult.id
        },
        session
      );
      
      await session.commitTransaction();
      
      logger.info(`Bulk purchase completed: ${idempotencyKey}`, {
        userId,
        totalVideos: videoIds.length,
        purchasedCount: successfulVideoIds.length,
        totalAmount
      });
      
      // Post-purchase actions
      await this.afterBulkPurchaseActions(userId, successfulVideoIds, purchases);
      
      return {
        success: true,
        bulkId: idempotencyKey,
        totalAmount,
        purchasedCount: successfulVideoIds.length,
        failedCount: results.filter(r => r.status === 'error').length,
        alreadyOwnedCount: existingPurchases.length,
        results,
        payment: {
          id: paymentResult.id,
          gateway: paymentResult.gateway,
          status: 'completed'
        }
      };
      
    } catch (error) {
      await session.abortTransaction();
      
      // Update processing record as failed
      await this.updateProcessingRecord(
        idempotencyKey, 
        'failed', 
        { error: error.message }
      );
      
      logger.error(`Bulk purchase failed: ${error.message}`, {
        userId,
        videoIdsCount: videoIds.length,
        error: error.message
      });
      
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  async checkIdempotency(idempotencyKey) {
    try {
      // Check in a dedicated collection or in purchase records
      const existingRecord = await mongoose.connection.db.collection('idempotency_keys')
        .findOne({ _id: idempotencyKey, status: 'completed' });
      
      if (existingRecord) {
        return existingRecord.result;
      }
      return null;
    } catch (error) {
      logger.error('Idempotency check failed:', error);
      return null;
    }
  }
  
  async createProcessingRecord(idempotencyKey, userId, videoIds, session) {
    try {
      await mongoose.connection.db.collection('idempotency_keys').insertOne({
        _id: idempotencyKey,
        userId,
        videoIds,
        status: 'processing',
        createdAt: new Date(),
        updatedAt: new Date()
      }, { session });
    } catch (error) {
      // If duplicate key error, it's okay - idempotency is working
      if (error.code !== 11000) {
        throw error;
      }
    }
  }
  
  async updateProcessingRecord(idempotencyKey, status, data, session = null) {
    const updateDoc = {
      status,
      updatedAt: new Date(),
      ...data
    };
    
    const options = session ? { session } : {};
    
    await mongoose.connection.db.collection('idempotency_keys').updateOne(
      { _id: idempotencyKey },
      { $set: updateDoc },
      options
    );
  }
  
  async afterPurchaseActions(userId, videoId, purchase) {
    try {
      // Execute async actions in parallel, don't block response
      setImmediate(async () => {
        try {
          await Promise.allSettled([
            this.sendPurchaseNotification(userId, videoId, purchase.amount),
            this.updateAnalytics(videoId),
            this.invalidateUserCache(userId),
            this.sendPurchaseEmail(userId, purchase)
          ]);
          
          logger.info('Post-purchase actions completed', { userId, videoId });
        } catch (error) {
          logger.error('Post-purchase actions failed:', error);
        }
      });
    } catch (error) {
      logger.error('Failed to schedule post-purchase actions:', error);
    }
  }
  
  async afterBulkPurchaseActions(userId, videoIds, purchases) {
    setImmediate(async () => {
      try {
        const totalAmount = purchases.reduce((sum, p) => sum + p.amount, 0);
        
        await Promise.allSettled([
          this.sendBulkPurchaseNotification(userId, videoIds.length, totalAmount),
          this.updateBulkAnalytics(videoIds),
          this.invalidateUserCache(userId),
          this.sendBulkPurchaseEmail(userId, purchases)
        ]);
        
        logger.info('Bulk post-purchase actions completed', { 
          userId, 
          videoCount: videoIds.length 
        });
      } catch (error) {
        logger.error('Bulk post-purchase actions failed:', error);
      }
    });
  }
  
  // Mock implementations for notification methods
  async sendPurchaseNotification(userId, videoId, amount) {
    logger.info('Sending purchase notification', { userId, videoId, amount });
    // Implement actual notification logic
  }
  
  async sendBulkPurchaseNotification(userId, videoCount, totalAmount) {
    logger.info('Sending bulk purchase notification', { userId, videoCount, totalAmount });
    // Implement actual notification logic
  }
  
  async updateAnalytics(videoId) {
    logger.info('Updating analytics', { videoId });
    // Implement analytics update
  }
  
  async updateBulkAnalytics(videoIds) {
    logger.info('Updating bulk analytics', { videoCount: videoIds.length });
    // Implement bulk analytics
  }
  
  async invalidateUserCache(userId) {
    logger.info('Invalidating user cache', { userId });
    // Implement cache invalidation
  }
  
  async sendPurchaseEmail(userId, purchase) {
    logger.info('Sending purchase email', { userId, purchaseId: purchase._id });
    // Implement email sending
  }
  
  async sendBulkPurchaseEmail(userId, purchases) {
    logger.info('Sending bulk purchase email', { userId, purchaseCount: purchases.length });
    // Implement bulk email sending
  }
  
  // Additional utility methods
  
  async getUserPurchases(userId, options = {}) {
    const { limit = 20, page = 1, status, fromDate, toDate } = options;
    const skip = (page - 1) * limit;
    
    const query = { userId };
    
    if (status) query.status = status;
    if (fromDate || toDate) {
      query.purchaseDate = {};
      if (fromDate) query.purchaseDate.$gte = new Date(fromDate);
      if (toDate) query.purchaseDate.$lte = new Date(toDate);
    }
    
    const purchases = await Purchase.find(query)
      .populate('videoId', 'title thumbnail duration price')
      .sort({ purchaseDate: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await Purchase.countDocuments(query);
    
    return {
      purchases,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }
  
  async checkAccess(userId, videoId) {
    const purchase = await Purchase.findOne({
      userId,
      videoId,
      status: 'completed',
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } }
      ]
    });
    
    return purchase ? {
      hasAccess: true,
      purchaseId: purchase._id,
      purchasedAt: purchase.purchaseDate,
      expiresAt: purchase.expiresAt,
      daysRemaining: purchase.expiresAt ? 
        Math.ceil((purchase.expiresAt - new Date()) / (1000 * 60 * 60 * 24)) : null
    } : {
      hasAccess: false
    };
  }
  
  async refundPurchase(purchaseId, reason) {
    const session = await mongoose.startSession();
    
    try {
      await session.startTransaction();
      
      const purchase = await Purchase.findById(purchaseId).session(session);
      if (!purchase) {
        throw new Error('Purchase not found');
      }
      
      if (purchase.status !== 'completed') {
        throw new Error('Only completed purchases can be refunded');
      }
      
      // Check if purchase is within refund window (e.g., 30 days)
      const refundWindow = 30 * 24 * 60 * 60 * 1000; // 30 days
      if (new Date() - purchase.purchaseDate > refundWindow) {
        throw new Error('Refund window has expired');
      }
      
      // Process refund
      const refundResult = await PaymentService.refund({
        transactionId: purchase.transactionId,
        amount: purchase.amount,
        reason: reason || 'Customer request'
      });
      
      if (!refundResult.success) {
        throw new Error(`Refund failed: ${refundResult.reason}`);
      }
      
      // Update purchase
      purchase.status = 'refunded';
      purchase.refundedAt = new Date();
      purchase.refundReason = reason;
      purchase.metadata.refund = refundResult;
      await purchase.save({ session });
      
      // Update user
      await User.updateOne(
        { _id: purchase.userId },
        {
          $pull: { purchasedVideos: purchase.videoId },
          $inc: { totalSpent: -purchase.amount },
          $set: { updatedAt: new Date() }
        },
        { session }
      );
      
      await session.commitTransaction();
      
      logger.info(`Refund completed: ${purchaseId}`, { 
        reason, 
        amount: purchase.amount 
      });
      
      return { 
        success: true, 
        purchase,
        refund: refundResult 
      };
      
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Refund failed: ${error.message}`, { purchaseId, error });
      throw error;
    } finally {
      session.endSession();
    }
  }
  async verifyOwnership(purchaseId, userId) {
    return Purchase.findOne({
      _id: purchaseId,
      userId
    });
  }
  
  // Method สำหรับ webhook จาก payment gateway
  async handlePaymentWebhook(payload, signature) {
    try {
      // Verify signature
      const isValid = await this.verifyWebhookSignature(payload, signature);
      if (!isValid) {
        throw new Error('Invalid webhook signature');
      }
      
      const { event, data } = payload;
      
      switch (event) {
        case 'payment.completed':
          return await this.handlePaymentCompleted(data);
        case 'payment.failed':
          return await this.handlePaymentFailed(data);
        case 'refund.processed':
          return await this.handleRefundProcessed(data);
        default:
          console.log(`Unhandled webhook event: ${event}`);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Webhook handling error:', error);
      throw error;
    }
  }
  
  async handlePaymentCompleted(data) {
    const { transactionId, amount, gatewayId, metadata } = data;
    
    // Update purchase status
    const purchase = await Purchase.findOneAndUpdate(
      { transactionId },
      {
        status: 'completed',
        gatewayTransactionId: gatewayId,
        'metadata.paymentVerifiedAt': new Date(),
        'metadata.webhookData': data
      },
      { new: true }
    );
    
    if (purchase) {
      // Trigger post-purchase actions
      await this.afterPurchaseActions(
        purchase.userId, 
        purchase.videoId, 
        purchase
      );
    }
    
    return purchase;
  }
  
  // เพิ่ม method สำหรับ monitoring
  async getPurchaseStats(userId) {
    const stats = await Purchase.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          totalSpent: { $sum: '$amount' },
          totalPurchases: { $sum: 1 },
          completedPurchases: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          refundedPurchases: {
            $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0] }
          },
          averagePurchase: { $avg: '$amount' }
        }
      }
    ]);
    
    return stats[0] || {
      totalSpent: 0,
      totalPurchases: 0,
      completedPurchases: 0,
      refundedPurchases: 0,
      averagePurchase: 0
    };
  }
}

module.exports = new PurchaseService();