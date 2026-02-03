const mongoose = require('mongoose');
const Purchase = require('../../models/Purchase');
const Video = require('../../models/Video');
const User = require('../../models/User');
const PaymentService = require('../payment/PaymentService');
const { withTransaction } = require('../../utils/transaction');
const logger = require('../../utils/logger');
const { generateIdempotencyKey } = require('../../utils/idempotency');

class PurchaseService {
  async purchaseVideo(userId, videoId, paymentData) {
    const session = await mongoose.startSession();
    
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
      const existingPurchase = await Purchase.hasAccess(userId, videoId);
      if (existingPurchase) {
        await session.abortTransaction();
        return { 
          success: true, 
          purchase: existingPurchase,
          message: 'Already has access'
        };
      }
      
      // 3. Process payment
      const paymentResult = await PaymentService.processPayment({
        ...paymentData,
        amount: video.price,
        description: `Purchase video: ${video.title}`
      });
      
      if (!paymentResult.success) {
        throw new Error(`Payment failed: ${paymentResult.reason}`);
      }
      
      // 4. Create purchase record
      const purchase = new Purchase({
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
          capturedAt: paymentResult.capturedAt
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
      
      await session.commitTransaction();
      logger.info(`Purchase completed: ${purchase._id}`, { userId, videoId });
      
      // 6. Post-purchase actions (นอก transaction)
      await this.afterPurchaseActions(userId, videoId, purchase);
      
      return { success: true, purchase };
      
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Purchase failed: ${error.message}`, { userId, videoId, error });
      
      // Compensating action
      await PaymentService.refundIfNeeded(paymentData, error);
      
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  async bulkPurchaseVideos(userId, videoIds, paymentData) {
    const BATCH_SIZE = 100;
    const idempotencyKey = generateIdempotencyKey(userId, paymentData.transactionId, videoIds);
    
    // Check idempotency
    const existing = await this.checkIdempotency(idempotencyKey);
    if (existing) return existing;
    
    const session = await mongoose.startSession();
    
    try {
      await session.startTransaction();
      
      // Create processing record
      await this.createProcessingRecord(idempotencyKey, userId, videoIds, session);
      
      // Process in batches
      const results = [];
      const successfulVideoIds = [];
      let totalAmount = 0;
      
      for (let i = 0; i < videoIds.length; i += BATCH_SIZE) {
        const batch = videoIds.slice(i, i + BATCH_SIZE);
        const batchResult = await this.processBatch(
          userId, batch, paymentData, idempotencyKey, session
        );
        
        results.push(...batchResult.results);
        successfulVideoIds.push(...batchResult.successfulVideoIds);
        totalAmount += batchResult.totalAmount;
      }
      
      if (successfulVideoIds.length === 0) {
        throw new Error('No videos were purchased');
      }
      
      // Update processing record
      await this.updateProcessingRecord(
        idempotencyKey, 
        'completed', 
        { results, totalAmount },
        session
      );
      
      // Update user
      if (successfulVideoIds.length > 0) {
        await User.updateOne(
          { _id: userId },
          {
            $addToSet: { purchasedVideos: { $each: successfulVideoIds } },
            $inc: { totalSpent: totalAmount },
            $set: { updatedAt: new Date() }
          },
          { session }
        );
      }
      
      await session.commitTransaction();
      
      return {
        success: true,
        bulkId: idempotencyKey,
        totalAmount,
        purchasedCount: successfulVideoIds.length,
        results
      };
      
    } catch (error) {
      await session.abortTransaction();
      await this.updateProcessingRecord(idempotencyKey, 'failed', { error: error.message });
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  async processBatch(userId, batchVideoIds, paymentData, bulkId, session) {
    const videos = await Video.find({
      _id: { $in: batchVideoIds },
      isActive: true
    }).session(session);
    
    const existingPurchases = await Purchase.find({
      userId,
      videoId: { $in: batchVideoIds },
      status: 'completed'
    }).session(session);
    
    const existingSet = new Set(
      existingPurchases.map(p => p.videoId.toString())
    );
    
    const results = [];
    const successfulVideoIds = [];
    let totalAmount = 0;
    
    for (const video of videos) {
      const videoIdStr = video._id.toString();
      
      if (existingSet.has(videoIdStr)) {
        results.push({ videoId: video._id, status: 'already_purchased' });
        continue;
      }
      
      try {
        const purchase = new Purchase({
          userId,
          videoId: video._id,
          bulkId,
          amount: video.price,
          currency: 'THB',
          paymentMethod: paymentData.paymentMethod,
          transactionId: `${paymentData.transactionId}:${videoIdStr}`,
          status: 'completed',
          purchaseDate: new Date(),
          expiresAt: video.accessDuration ? 
            new Date(Date.now() + video.accessDuration) : null
        });
        
        await purchase.save({ session });
        
        successfulVideoIds.push(video._id);
        totalAmount += video.price;
        results.push({ videoId: video._id, status: 'success', purchaseId: purchase._id });
        
      } catch (error) {
        results.push({ videoId: video._id, status: 'error', error: error.message });
      }
    }
    
    return { results, successfulVideoIds, totalAmount };
  }
  
  async afterPurchaseActions(userId, videoId, purchase) {
    // Implement async actions: notifications, analytics, etc.
    try {
      await Promise.allSettled([
        this.sendPurchaseNotification(userId, videoId),
        this.updateAnalytics(videoId),
        this.invalidateUserCache(userId)
      ]);
    } catch (error) {
      logger.error('After purchase actions failed:', error);
    }
  }
}

module.exports = new PurchaseService();