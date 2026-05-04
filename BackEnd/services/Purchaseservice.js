'use strict';

// services/PurchaseService.js
//
// Flow:
//   purchaseVideo(userId, videoId, { currency })            → authorize → return { requiresAction, clientSecret, intentId }
//   purchaseVideo(userId, videoId, { paymentIntentId })     → capture  → return { success, purchase, payment }
//
//   bulkPurchaseVideos(userId, videoIds, { currency })          → authorize
//   bulkPurchaseVideos(userId, videoIds, { paymentIntentId })   → capture + save

const mongoose = require('mongoose');
const Purchase = require('../models/Purchase');
const Video    = require('../models/Video');
const User     = require('../models/User');
const PaymentService = require('./PaymentService');
const logger   = require('../utils/logger');
const { generateIdempotencyKey } = require('../utils/idempotency');

class PurchaseService {

  // ──────────────────────────────────────────────────────────────────────────
  // purchaseVideo
  // ──────────────────────────────────────────────────────────────────────────
  async purchaseVideo(userId, videoId, paymentData = {}) {
    const { paymentIntentId, currency = 'thb' } = paymentData;

    // ════════════════════════════════════════════════════════════════════
    // STEP 1: ไม่มี intentId → authorize อายัดวงเงิน, ส่ง clientSecret
    // ════════════════════════════════════════════════════════════════════
    if (!paymentIntentId) {
      const video = await Video.findOne({ _id: videoId, isActive: true });
      if (!video)                       throw new Error('Video not found or inactive');
      if (video.accessType === 'free')  throw new Error('This video is free, no purchase needed');

      // เช็ค existing ก่อน authorize (ประหยัด Stripe call)
      const existing = await Purchase.findOne({
        userId, videoId, status: 'completed',
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
      });
      if (existing) {
        return { success: true, purchase: existing, alreadyOwned: true };
      }

      // Authorize — อายัดวงเงิน ยังไม่ตัดเงิน
      const authResult = await PaymentService.authorize({
        amount:     video.price,
        currency:   currency.toLowerCase(),
        customerId: userId,
        metadata: {
          videoId:    videoId.toString(),
          videoTitle: video.title,
          userId:     userId.toString()
        }
      });

      logger.info(`Payment authorized for video ${videoId}`, {
        userId, intentId: authResult.intentId, amount: video.price
      });

      return {
        success:        false,
        requiresAction: true,
        clientSecret:   authResult.clientSecret,
        intentId:       authResult.intentId,
        amount:         video.price,
        currency:       currency.toUpperCase(),
        message:        'Please confirm payment on client'
      };
    }

    // ════════════════════════════════════════════════════════════════════
    // STEP 2: มี intentId → verify + capture + บันทึก DB
    // ════════════════════════════════════════════════════════════════════
    const session = await mongoose.startSession();

    try {
      await session.startTransaction();

      const video = await Video.findOne({ _id: videoId, isActive: true }).session(session);
      if (!video) throw new Error('Video not found or inactive');

      // ป้องกัน race condition — เช็คซ้ำใน transaction
      const existing = await Purchase.findOne({
        userId, videoId, status: 'completed',
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
      }).session(session);

      if (existing) {
        await session.abortTransaction();
        return { success: true, purchase: existing, alreadyOwned: true };
      }

      // Verify intent เป็นของ user/video นี้จริง
      const intent = await PaymentService.retrieveIntent(paymentIntentId);

      if (intent.metadata.userId !== userId.toString()) {
        await session.abortTransaction();
        throw new Error('PaymentIntent does not belong to this user');
      }
      if (intent.metadata.videoId !== videoId.toString()) {
        await session.abortTransaction();
        throw new Error('PaymentIntent does not match this video');
      }

      // Capture — ตัดเงินจริง
      const captureResult = await PaymentService.capture(paymentIntentId);

      // บันทึก Purchase
      const purchase = new Purchase({
        userId,
        videoId,
        amount:               video.price,
        currency:             (currency || 'THB').toUpperCase(),
        paymentMethod:        captureResult.method,
        transactionId:        captureResult.id,
        gatewayTransactionId: captureResult.gatewayId,
        status:               'completed',
        purchaseDate:         new Date(),
        expiresAt:            video.accessDuration
          ? new Date(Date.now() + video.accessDuration)
          : null,
        metadata: {
          gateway:    captureResult.gateway,
          capturedAt: captureResult.capturedAt
        }
      });

      await purchase.save({ session });

      await User.updateOne(
        { _id: userId },
        {
          $addToSet: { purchasedVideos: videoId },
          $inc:      { totalSpent: video.price },
          $set:      { updatedAt: new Date() }
        },
        { session }
      );

      await Video.updateOne(
        { _id: videoId },
        { $inc: { purchaseCount: 1 } },
        { session }
      );

      await session.commitTransaction();

      logger.info(`Purchase completed: ${purchase._id}`, {
        userId, videoId, amount: video.price, transactionId: captureResult.id
      });

      await this.afterPurchaseActions(userId, videoId, purchase);

      return {
        success:  true,
        purchase,
        payment: {
          id:      captureResult.id,
          gateway: captureResult.gateway,
          status:  'completed'
        }
      };

    } catch (error) {
      await session.abortTransaction();

      logger.error(`Purchase (capture) failed: ${error.message}`, { userId, videoId });

      // Compensating refund ถ้า capture สำเร็จแต่ DB fail
      // (ตรวจจากว่า intent ถูก captured แล้วหรือยัง)
      try {
        await PaymentService.refundIfNeeded({
          transactionId: paymentIntentId,
          reason:        `Purchase rollback: ${error.message}`
        });
      } catch (refundError) {
        logger.error('Compensating refund failed:', refundError);
      }

      throw new Error(`Purchase failed: ${error.message}`);
    } finally {
      session.endSession();
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // bulkPurchaseVideos
  // ──────────────────────────────────────────────────────────────────────────
  async bulkPurchaseVideos(userId, videoIds, paymentData = {}) {
    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      throw new Error('Invalid videoIds array');
    }
    if (videoIds.length > 1000) {
      throw new Error('Maximum 1000 videos per bulk purchase');
    }

    const { paymentIntentId, currency = 'thb' } = paymentData;
    const BATCH_SIZE = 100;

    // ════════════════════════════════════════════════════════════════════
    // STEP 1: ไม่มี intentId → คำนวณราคา + authorize
    // ════════════════════════════════════════════════════════════════════
    if (!paymentIntentId) {
      const videos = await Video.find({
        _id:        { $in: videoIds },
        isActive:   true,
        accessType: 'paid'
      });

      if (videos.length === 0) throw new Error('No active paid videos found');

      const existingPurchases = await Purchase.find({
        userId,
        videoId: { $in: videoIds },
        status:  'completed',
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
      });

      const existingSet      = new Set(existingPurchases.map(p => p.videoId.toString()));
      const videosToPurchase = videos.filter(v => !existingSet.has(v._id.toString()));

      if (videosToPurchase.length === 0) {
        return {
          success:      true,
          alreadyOwned: true,
          message:      'All videos already purchased'
        };
      }

      const totalAmount = videosToPurchase.reduce((sum, v) => sum + v.price, 0);

      const authResult = await PaymentService.authorize({
        amount:     totalAmount,
        currency:   currency.toLowerCase(),
        customerId: userId,
        metadata: {
          userId:     userId.toString(),
          videoCount: videosToPurchase.length.toString(),
          videoIds:   videosToPurchase.map(v => v._id.toString()).join(',')
        }
      });

      logger.info(`Bulk payment authorized`, {
        userId, intentId: authResult.intentId,
        videoCount: videosToPurchase.length, totalAmount
      });

      return {
        success:        false,
        requiresAction: true,
        clientSecret:   authResult.clientSecret,
        intentId:       authResult.intentId,
        totalAmount,
        videoCount:     videosToPurchase.length,
        currency:       currency.toUpperCase(),
        message:        'Please confirm payment on client'
      };
    }

    // ════════════════════════════════════════════════════════════════════
    // STEP 2: มี intentId → verify + capture + บันทึก DB
    // ════════════════════════════════════════════════════════════════════
    const idempotencyKey = generateIdempotencyKey(userId, paymentIntentId, videoIds);

    const existing = await this.checkIdempotency(idempotencyKey);
    if (existing) {
      logger.info(`Idempotent bulk request detected: ${idempotencyKey}`);
      return existing;
    }

    // Verify intent เป็นของ user นี้จริง
    const intent = await PaymentService.retrieveIntent(paymentIntentId);
    if (intent.metadata.userId !== userId.toString()) {
      throw new Error('PaymentIntent does not belong to this user');
    }

    const session = await mongoose.startSession();

    try {
      await session.startTransaction();

      await this.createProcessingRecord(idempotencyKey, userId, videoIds, session);

      const videos = await Video.find({
        _id:        { $in: videoIds },
        isActive:   true,
        accessType: 'paid'
      }).session(session);

      if (videos.length === 0) throw new Error('No active paid videos found');

      const existingPurchases = await Purchase.find({
        userId,
        videoId: { $in: videoIds },
        status:  'completed',
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
      }).session(session);

      const existingSet      = new Set(existingPurchases.map(p => p.videoId.toString()));
      const videosToPurchase = videos.filter(v => !existingSet.has(v._id.toString()));

      if (videosToPurchase.length === 0) {
        await session.abortTransaction();
        return {
          success:      true,
          alreadyOwned: true,
          message:      'All videos already purchased',
          bulkId:       idempotencyKey
        };
      }

      const totalAmount = videosToPurchase.reduce((sum, v) => sum + v.price, 0);

      // Capture — ตัดเงินจริง
      const captureResult = await PaymentService.capture(paymentIntentId);

      // บันทึก Purchase ทีละ batch
      const results            = [];
      const successfulVideoIds = [];
      const purchases          = [];

      for (let i = 0; i < videosToPurchase.length; i += BATCH_SIZE) {
        const batch          = videosToPurchase.slice(i, i + BATCH_SIZE);
        const batchPurchases = [];

        for (const video of batch) {
          try {
            const p = new Purchase({
              userId,
              videoId:              video._id,
              bulkId:               idempotencyKey,
              amount:               video.price,
              currency:             (currency || 'THB').toUpperCase(),
              paymentMethod:        captureResult.method,
              transactionId:        `${captureResult.id}:${video._id}`,
              gatewayTransactionId: captureResult.gatewayId,
              status:               'completed',
              purchaseDate:         new Date(),
              expiresAt:            video.accessDuration
                ? new Date(Date.now() + video.accessDuration)
                : null,
              metadata: {
                gateway:    captureResult.gateway,
                capturedAt: captureResult.capturedAt,
                isBulk:     true,
                bulkIndex:  purchases.length + batchPurchases.length
              }
            });

            batchPurchases.push(p);
            successfulVideoIds.push(video._id);
            results.push({ videoId: video._id, status: 'success', amount: video.price });
          } catch (err) {
            results.push({ videoId: video._id, status: 'error', error: err.message });
          }
        }

        if (batchPurchases.length > 0) {
          await Purchase.insertMany(batchPurchases, { session });
          purchases.push(...batchPurchases);
        }
      }

      if (successfulVideoIds.length === 0) {
        throw new Error('No videos were purchased successfully');
      }

      await User.updateOne(
        { _id: userId },
        {
          $addToSet: { purchasedVideos: { $each: successfulVideoIds } },
          $inc:      { totalSpent: totalAmount },
          $set:      { updatedAt: new Date() }
        },
        { session }
      );

      await Video.updateMany(
        { _id: { $in: successfulVideoIds } },
        { $inc: { purchaseCount: 1 } },
        { session }
      );

      await this.updateProcessingRecord(
        idempotencyKey, 'completed',
        { results, totalAmount, purchasedCount: successfulVideoIds.length, paymentId: captureResult.id },
        session
      );

      await session.commitTransaction();

      logger.info(`Bulk purchase completed: ${idempotencyKey}`, {
        userId,
        purchasedCount: successfulVideoIds.length,
        totalAmount
      });

      await this.afterBulkPurchaseActions(userId, successfulVideoIds, purchases);

      return {
        success:           true,
        bulkId:            idempotencyKey,
        totalAmount,
        purchasedCount:    successfulVideoIds.length,
        failedCount:       results.filter(r => r.status === 'error').length,
        alreadyOwnedCount: existingPurchases.length,
        results,
        payment: {
          id:      captureResult.id,
          gateway: captureResult.gateway,
          status:  'completed'
        }
      };

    } catch (error) {
      await session.abortTransaction();
      await this.updateProcessingRecord(idempotencyKey, 'failed', { error: error.message });
      logger.error(`Bulk purchase (capture) failed: ${error.message}`, { userId });

      // Compensating refund
      try {
        await PaymentService.refundIfNeeded({
          transactionId: paymentIntentId,
          reason:        `Bulk purchase rollback: ${error.message}`
        });
      } catch (refundError) {
        logger.error('Bulk compensating refund failed:', refundError);
      }

      throw error;
    } finally {
      session.endSession();
    }
  }

  // ── Webhook handlers ────────────────────────────────────────────────────────

async handlePaymentCompleted(data) {
  const { transactionId, gatewayId, metadata } = data;

  // ✅ เช็คก่อน — ถ้า completed แล้ว webhook มาซ้ำ ไม่ต้องทำอะไร
  const existing = await Purchase.findOne({ 
    transactionId, 
    status: 'completed' 
  });
  if (existing) {
    logger.info('[handlePaymentCompleted] Already completed, skipping', { transactionId });
    return existing;
  }

  // ✅ upsert — ถ้า /confirm save ไปแล้วก็ update, ถ้ายังไม่มี (user ปิด browser) ก็ create
  const purchase = await Purchase.findOneAndUpdate(
    { transactionId },
    {
      status:                       'completed',
      gatewayTransactionId:         gatewayId,
      'metadata.paymentVerifiedAt': new Date(),
      'metadata.webhookData':       data
    },
    { new: true }
  );

  // ✅ ถ้า purchase ไม่มีเลยใน DB (user ปิด browser กลางคัน)
  // webhook เป็นคนสร้าง record แทน
  if (!purchase) {
    logger.warn('[handlePaymentCompleted] Purchase not found, webhook creating record', { transactionId });

    // ดึง metadata จาก Stripe intent เพื่อรู้ว่า videoId / userId คืออะไร
    const intent = await PaymentService.retrieveIntent(transactionId);
    const { userId, videoId } = intent.metadata;

    if (!userId || !videoId) {
      logger.error('[handlePaymentCompleted] Missing metadata in intent', { transactionId });
      return null;
    }

    const newPurchase = await Purchase.create({
      userId,
      videoId,
      transactionId,
      gatewayTransactionId:         gatewayId,
      amount:                       data.amount,
      status:                       'completed',
      'metadata.paymentVerifiedAt': new Date(),
      'metadata.webhookData':       data,
      'metadata.createdByWebhook':  true   // ← flag ไว้ debug
    });

    await this.afterPurchaseActions(userId, videoId, newPurchase);
    return newPurchase;
  }

  await this.afterPurchaseActions(purchase.userId, purchase.videoId, purchase);
  return purchase;
}
  async handlePaymentFailed(data) {
    const { transactionId, reason } = data;

    const purchase = await Purchase.findOneAndUpdate(
      { transactionId, status: { $ne: 'completed' } },
      {
        status:                   'failed',
        'metadata.failureReason': reason,
        'metadata.failedAt':      new Date()
      },
      { new: true }
    );

    if (purchase) {
      logger.warn('[PurchaseService] Payment failed recorded', {
        purchaseId: purchase._id, transactionId, reason
      });
    }

    return purchase;
  }

  async handleRefundProcessed(data) {
    const { transactionId, refundId, amountRefunded } = data;

    const purchase = await Purchase.findOneAndUpdate(
      { transactionId },
      {
        status:                    'refunded',
        refundedAt:                new Date(),
        'metadata.refundId':       refundId,
        'metadata.amountRefunded': amountRefunded
      },
      { new: true }
    );

    if (purchase) {
      await User.updateOne(
        { _id: purchase.userId },
        {
          $pull: { purchasedVideos: purchase.videoId },
          $inc:  { totalSpent: -amountRefunded }
        }
      );

      logger.info('[PurchaseService] Refund processed', {
        purchaseId: purchase._id, transactionId, amountRefunded
      });
    }

    return purchase;
  }

  // ── Idempotency helpers ─────────────────────────────────────────────────────

  async checkIdempotency(idempotencyKey) {
    try {
      const rec = await mongoose.connection.db
        .collection('idempotency_keys')
        .findOne({ _id: idempotencyKey, status: 'completed' });
      return rec ? rec.result : null;
    } catch (err) {
      logger.error('Idempotency check failed:', err);
      return null;
    }
  }

  async createProcessingRecord(idempotencyKey, userId, videoIds, session) {
    try {
      await mongoose.connection.db.collection('idempotency_keys').insertOne(
        {
          _id: idempotencyKey, userId, videoIds,
          status: 'processing', createdAt: new Date(), updatedAt: new Date()
        },
        { session }
      );
    } catch (err) {
      if (err.code !== 11000) throw err; // 11000 = duplicate key (ok)
    }
  }

  async updateProcessingRecord(idempotencyKey, status, data, session = null) {
    await mongoose.connection.db.collection('idempotency_keys').updateOne(
      { _id: idempotencyKey },
      { $set: { status, updatedAt: new Date(), ...data } },
      session ? { session } : {}
    );
  }

  // ── Post-purchase actions ───────────────────────────────────────────────────

  async afterPurchaseActions(userId, videoId, purchase) {
    setImmediate(async () => {
      try {
        await Promise.allSettled([
          this.sendPurchaseNotification(userId, videoId, purchase.amount),
          this.updateAnalytics(videoId),
          this.invalidateUserCache(userId),
          this.sendPurchaseEmail(userId, purchase)
        ]);
      } catch (err) {
        logger.error('Post-purchase actions failed:', err);
      }
    });
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
      } catch (err) {
        logger.error('Bulk post-purchase actions failed:', err);
      }
    });
  }

  // ── Utility methods ─────────────────────────────────────────────────────────

  async getUserPurchases(userId, options = {}) {
    const { limit = 20, page = 1, status, fromDate, toDate } = options;
    const skip  = (page - 1) * limit;
    const query = { userId };

    if (status) query.status = status;
    if (fromDate || toDate) {
      query.purchaseDate = {};
      if (fromDate) query.purchaseDate.$gte = new Date(fromDate);
      if (toDate)   query.purchaseDate.$lte = new Date(toDate);
    }

    const [purchases, total] = await Promise.all([
      Purchase.find(query)
        .populate('videoId', 'title thumbnail duration price accessType')
        .sort({ purchaseDate: -1 })
        .skip(skip)
        .limit(limit),
      Purchase.countDocuments(query)
    ]);

    return {
      purchases,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
    };
  }

  async checkAccess(userId, videoId) {
    const purchase = await Purchase.findOne({
      userId, videoId, status: 'completed',
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
    });

    if (!purchase) return { hasAccess: false };

    return {
      hasAccess:     true,
      purchaseId:    purchase._id,
      purchasedAt:   purchase.purchaseDate,
      expiresAt:     purchase.expiresAt,
      daysRemaining: purchase.expiresAt
        ? Math.ceil((purchase.expiresAt - new Date()) / (1000 * 60 * 60 * 24))
        : null
    };
  }

  async refundPurchase(purchaseId, reason) {
    const session = await mongoose.startSession();

    try {
      await session.startTransaction();

      const purchase = await Purchase.findById(purchaseId).session(session);
      if (!purchase)                        throw new Error('Purchase not found');
      if (purchase.status !== 'completed')  throw new Error('Only completed purchases can be refunded');

      const REFUND_WINDOW = 30 * 24 * 60 * 60 * 1000; // 30 วัน
      if (new Date() - purchase.purchaseDate > REFUND_WINDOW) {
        throw new Error('Refund window has expired');
      }

      const refundResult = await PaymentService.refund({
        transactionId: purchase.transactionId,
        amount:        purchase.amount,
        reason:        reason || 'Customer request'
      });

      if (!refundResult.success) {
        throw new Error(`Refund failed: ${refundResult.reason}`);
      }

      purchase.status           = 'refunded';
      purchase.refundedAt       = new Date();
      purchase.refundReason     = reason;
      purchase.metadata.refund  = refundResult;
      await purchase.save({ session });

      await User.updateOne(
        { _id: purchase.userId },
        {
          $pull: { purchasedVideos: purchase.videoId },
          $inc:  { totalSpent: -purchase.amount },
          $set:  { updatedAt: new Date() }
        },
        { session }
      );

      await session.commitTransaction();
      logger.info(`Refund completed: ${purchaseId}`, { reason, amount: purchase.amount });

      return { success: true, purchase, refund: refundResult };

    } catch (err) {
      await session.abortTransaction();
      logger.error(`Refund failed: ${err.message}`, { purchaseId });
      throw err;
    } finally {
      session.endSession();
    }
  }

  async verifyOwnership(purchaseId, userId) {
    return Purchase.findOne({ _id: purchaseId, userId });
  }

  async getPurchaseStats(userId) {
    const stats = await Purchase.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id:                null,
          totalSpent:         { $sum: '$amount' },
          totalPurchases:     { $sum: 1 },
          completedPurchases: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          refundedPurchases:  { $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0] } },
          averagePurchase:    { $avg: '$amount' }
        }
      }
    ]);

    return stats[0] || {
      totalSpent: 0, totalPurchases: 0,
      completedPurchases: 0, refundedPurchases: 0, averagePurchase: 0
    };
  }

  // ── Notification stubs ──────────────────────────────────────────────────────
  async sendPurchaseNotification(u, v, a)    { logger.info('Purchase notification', { u, v, a }); }
  async sendBulkPurchaseNotification(u, c, a) { logger.info('Bulk purchase notification', { u, c, a }); }
  async updateAnalytics(videoId)             { logger.info('Analytics updated', { videoId }); }
  async updateBulkAnalytics(videoIds)        { logger.info('Bulk analytics updated', { count: videoIds.length }); }
  async invalidateUserCache(userId)          { logger.info('Cache invalidated', { userId }); }
  async sendPurchaseEmail(userId, purchase)  { logger.info('Purchase email sent', { userId, purchaseId: purchase._id }); }
  async sendBulkPurchaseEmail(u, purchases)  { logger.info('Bulk email sent', { u, count: purchases.length }); }
}

module.exports = new PurchaseService();