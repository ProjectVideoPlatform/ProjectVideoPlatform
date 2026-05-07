'use strict';

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
    const { paymentIntentId, currency = 'thb', paymentMethod } = paymentData;

    if (!paymentIntentId) {
      const video = await Video.findOne({ _id: videoId, isActive: true });
      if (!video) throw new Error('Video not found or inactive');
      if (video.accessType === 'free') throw new Error('This video is free');

      const existing = await Purchase.findOne({
        userId, videoId, status: 'completed',
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
      });
      if (existing) return { success: true, purchase: existing, alreadyOwned: true };

      if (paymentMethod === 'promptpay') {
        logger.info(`[PurchaseService] Processing PromptPay purchase for video ${videoId} by user ${userId}`);
        return await this._authorizePromptPay(userId, video, currency);
      }

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

    // STEP 2: มี intentId → verify + capture + บันทึก DB
    const session = await mongoose.startSession();

    try {
      await session.startTransaction();

      const video = await Video.findOne({ _id: videoId, isActive: true }).session(session);
      if (!video) throw new Error('Video not found or inactive');

      const existing = await Purchase.findOne({
        userId, videoId, status: 'completed',
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
      }).session(session);

      if (existing) {
        await session.abortTransaction();
        return { success: true, purchase: existing, alreadyOwned: true };
      }

      const intent = await PaymentService.retrieveIntent(paymentIntentId);

      if (intent.metadata.userId !== userId.toString()) {
        await session.abortTransaction();
        throw new Error('PaymentIntent does not belong to this user');
      }
      if (intent.metadata.videoId !== videoId.toString()) {
        await session.abortTransaction();
        throw new Error('PaymentIntent does not match this video');
      }

      const captureResult = await PaymentService.capture(paymentIntentId);

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
        return { success: true, alreadyOwned: true, message: 'All videos already purchased' };
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

      logger.info('Bulk payment authorized', {
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

    const idempotencyKey = generateIdempotencyKey(userId, paymentIntentId, videoIds);

    const existing = await this.checkIdempotency(idempotencyKey);
    if (existing) {
      logger.info(`Idempotent bulk request detected: ${idempotencyKey}`);
      return existing;
    }

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
        return { success: true, alreadyOwned: true, message: 'All videos already purchased', bulkId: idempotencyKey };
      }

      const totalAmount    = videosToPurchase.reduce((sum, v) => sum + v.price, 0);
      const captureResult  = await PaymentService.capture(paymentIntentId);

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

      if (successfulVideoIds.length === 0) throw new Error('No videos were purchased successfully');

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
        userId, purchasedCount: successfulVideoIds.length, totalAmount
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
        payment: { id: captureResult.id, gateway: captureResult.gateway, status: 'completed' }
      };

    } catch (error) {
      await session.abortTransaction();
      await this.updateProcessingRecord(idempotencyKey, 'failed', { error: error.message });
      logger.error(`Bulk purchase (capture) failed: ${error.message}`, { userId });

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

  // ── Webhook handlers ──────────────────────────────────────────────────────

  async handlePaymentCompleted(data) {
    const { transactionId, gatewayId, metadata } = data;

    const existing = await Purchase.findOne({ transactionId, status: 'completed' });
    if (existing) {
      logger.info('[handlePaymentCompleted] Already completed, skipping', { transactionId });
      return existing;
    }

    const purchase = await Purchase.findOneAndUpdate(
      { transactionId },
      {
        status:                       'completed',
        gatewayTransactionId:         gatewayId,   // ← ch_... จาก webhook
        'metadata.paymentVerifiedAt': new Date(),
        'metadata.webhookData':       data
      },
      { new: true }
    );

    if (!purchase) {
      logger.warn('[handlePaymentCompleted] Purchase not found, webhook creating record', { transactionId });

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
        'metadata.createdByWebhook':  true
      });

      await this.afterPurchaseActions(userId, videoId, newPurchase);
      return newPurchase;
    }

    await this.afterPurchaseActions(purchase.userId, purchase.videoId, purchase);
    return purchase;
  }
async verifyOwnership(purchaseId, userId) {
  return Purchase.findOne({ _id: purchaseId, userId });
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
 
  let newStatus = 'refunded';
  try {
    const intent = await PaymentService.retrieveIntent(transactionId);
    if (intent.payment_method_types?.includes('promptpay')) {
      newStatus = 'refund_pending';
    }
  } catch (e) {
    logger.warn('[handleRefundProcessed] Could not retrieve intent, defaulting to refunded', { transactionId });
  }
 
  // FIX: guard ไม่ให้ overwrite status ที่ดีกว่า
  // ถ้า refund.updated มาก่อน charge.refunded → status เป็น 'refunded' แล้ว
  // charge.refunded ที่มาทีหลังต้องไม่ย้อน status กลับเป็น refund_pending
  const OVERWRITABLE = ['completed', 'refund_pending'];
  if (newStatus === 'refund_pending') {
    // PromptPay: overwrite ได้แค่จาก completed เท่านั้น
    // ถ้าเป็น refunded อยู่แล้ว (refund.updated มาก่อน) → skip
    OVERWRITABLE.splice(OVERWRITABLE.indexOf('refund_pending'), 1);
  }
 
  const purchase = await Purchase.findOneAndUpdate(
    {
      transactionId,
      status: { $in: OVERWRITABLE }   // ← guard: ไม่ overwrite refunded
    },
    {
      status:                    newStatus,
      refundedAt:                new Date(),
      'metadata.refundId':       refundId,
      'metadata.amountRefunded': amountRefunded,
    },
    { new: true }
  );
 
  if (!purchase) {
    // idempotent hit — refunded ไปแล้ว หรือ transactionId ไม่ตรง
    logger.info('[PurchaseService] handleRefundProcessed skipped (already refunded or not found)', {
      transactionId,
      newStatus,
    });
    return null;
  }
 
  if (newStatus === 'refunded') {
    // Card: deduct ทันที
    await User.updateOne(
      { _id: purchase.userId },
      {
        $pull: { purchasedVideos: purchase.videoId },
        $inc:  { totalSpent: -amountRefunded },
      }
    );
  }
 
  logger.info('[PurchaseService] Refund processed', {
    purchaseId:     purchase._id,
    userId:         purchase.userId,
    transactionId,
    amountRefunded,
    newStatus,
  });
 
  return purchase;
}
 
  // PromptPay refund pending → succeeded (เงินเข้าบัญชี user แล้ว)
  async handleRefundSucceeded({ refundId, chargeId, amount }) {
  // FIX: guard idempotent — update ได้แค่ถ้า status เป็น refund_pending เท่านั้น
  // ถ้า webhook ยิงซ้ำ (Stripe retry) หรือมาผิดลำดับ → findOneAndUpdate return null → skip
  const purchase = await Purchase.findOneAndUpdate(
    {
      'metadata.refundId': refundId,
      status: 'refund_pending'         // ← guard: ทำได้แค่ครั้งเดียว
    },
    {
      status:                       'refunded',
      'metadata.refundCompletedAt': new Date(),
    },
    { new: true }
  );
 
  if (!purchase) {
    // idempotent hit — refunded ไปแล้ว หรือ refundId ไม่ตรง
    logger.info('[PurchaseService] handleRefundSucceeded skipped (already refunded or not found)', {
      refundId,
    });
    return null;
  }
 
  // deduct สิทธิ์ — ทำแค่ครั้งเดียวเพราะ guard ข้างบนกัน double deduct แล้ว
  await User.updateOne(
    { _id: purchase.userId },
    {
      $pull: { purchasedVideos: purchase.videoId },
      $inc:  { totalSpent: -amount },
    }
  );
 
  logger.info('[PurchaseService] PromptPay refund completed (money returned)', {
    purchaseId: purchase._id,
    userId:     purchase.userId,
    refundId,
    amount,
  });
 
  return purchase;
}
 
// refund ล้มเหลว → คืน status เป็น completed + แจ้ง admin
async handleRefundFailed({ refundId, chargeId, failureReason }) {
  // FIX: guard — คืน status ได้แค่จาก refund_pending เท่านั้น
  // ถ้า refunded ไปแล้ว (edge case) ไม่ควรย้อนกลับ
  const purchase = await Purchase.findOneAndUpdate(
    {
      'metadata.refundId': refundId,
      status: 'refund_pending'         // ← guard
    },
    {
      status:                         'completed',
      'metadata.refundFailedAt':      new Date(),
      'metadata.refundFailureReason': failureReason,
    },
    { new: true }
  );
 
  if (!purchase) {
    logger.warn('[PurchaseService] handleRefundFailed skipped (not in refund_pending or not found)', {
      refundId,
    });
    return null;
  }
 
  logger.error('[PurchaseService] Refund failed — manual action required', {
    refundId,
    failureReason,
    purchaseId: purchase._id,
    userId:     purchase.userId,
  });
 
  // TODO: แจ้ง admin (email / Slack)
 
  return purchase;
}
  // refund ล้มเหลว → คืน status เป็น completed + แจ้ง admin
  async handleRefundFailed({ refundId, chargeId, failureReason }) {
    const purchase = await Purchase.findOneAndUpdate(
      { 'metadata.refundId': refundId },
      {
        status:                              'completed', // เงินไม่ได้คืนจริง
        'metadata.refundFailedAt':           new Date(),
        'metadata.refundFailureReason':      failureReason
      },
      { new: true }
    );

    logger.error('[PurchaseService] Refund failed — manual action required', {
      refundId, failureReason, purchaseId: purchase?._id
    });

    // TODO: แจ้ง admin (email / Slack)

    return purchase;
  }

  // ── refundPurchase ────────────────────────────────────────────────────────
async refundPurchase(purchaseId, reason) {
  const session = await mongoose.startSession();
 
  try {
    await session.startTransaction();
 
    const purchase = await Purchase.findById(purchaseId).session(session);
    if (!purchase)                       throw new Error('Purchase not found');
    if (purchase.status !== 'completed') throw new Error('Only completed purchases can be refunded');
 
    const REFUND_WINDOW = 30 * 24 * 60 * 60 * 1000;
    if (new Date() - purchase.purchaseDate > REFUND_WINDOW) {
      throw new Error('Refund window has expired');
    }
 
    let refundResult;
    try {
      refundResult = await PaymentService.refund({
        transactionId: purchase.transactionId,
        chargeId:      purchase.gatewayTransactionId,
        amount:        purchase.amount,
        reason:        reason || 'Customer request',
      });
    } catch (stripeErr) {
      if (stripeErr.message?.includes('already been refunded')) {
        purchase.status       = 'refunded';
        purchase.refundedAt   = purchase.refundedAt ?? new Date();
        purchase.refundReason = reason;
        purchase.markModified('metadata');
        await purchase.save({ session });
 
        await User.updateOne(
          { _id: purchase.userId },
          { $pull: { purchasedVideos: purchase.videoId }, $inc: { totalSpent: -purchase.amount } },
          { session }
        );
 
        await session.commitTransaction();
        logger.warn('Refund already in Stripe, synced DB', { purchaseId });
        return { success: true, purchase, alreadySynced: true };
      }
      throw stripeErr;
    }
 
    if (!refundResult.success) {
      throw new Error(`Refund failed: ${refundResult.reason ?? refundResult.status ?? 'unknown'}`);
    }
 
    purchase.status       = refundResult.isPromptPay ? 'refund_pending' : 'refunded';
    purchase.refundedAt   = new Date();
    purchase.refundReason = reason;
    purchase.metadata.set('refundId',         refundResult.refundId);
    purchase.metadata.set('refundStatus',      refundResult.status);
    purchase.metadata.set('refundInitiatedAt', new Date());
    purchase.markModified('metadata');
    await purchase.save({ session });
 
    if (!refundResult.isPromptPay) {
      await User.updateOne(
        { _id: purchase.userId },
        {
          $pull: { purchasedVideos: purchase.videoId },
          $inc:  { totalSpent: -purchase.amount },
          $set:  { updatedAt: new Date() },
        },
        { session }
      );
    }
 
    await session.commitTransaction();
 
    logger.info('[PurchaseService] Refund initiated', {
      purchaseId,
      userId:        purchase.userId,
      transactionId: purchase.transactionId,
      amountRefunded: purchase.amount,
      newStatus:     purchase.status,
    });
 
    return {
      success: true,
      purchase,
      refund:  refundResult,
      message: refundResult.isPromptPay
        ? 'Refund initiated — funds will be returned in 3-10 business days'
        : 'Refund processed successfully',
    };
 
  } catch (err) {
    await session.abortTransaction();
    logger.error(`Refund failed: ${err.message}`, { purchaseId });
    throw err;
  } finally {
    try {
      session.endSession();
    } catch (sessionErr) {
      logger.warn(`session.endSession error: ${sessionErr.message}`, { purchaseId });
    }
  }
}

  async verifyOwnership(purchaseId, userId) {
    return Purchase.findOne({ _id: purchaseId, userId });
  }

  // ── PromptPay ─────────────────────────────────────────────────────────────
  async _authorizePromptPay(userId, video, currency) {
    logger.info('[PP] calling authorizePromptPay', { amount: video.price, currency });

    try {
      const result = await PaymentService.authorizePromptPay({
        amount:     video.price,
        currency:   currency.toLowerCase(),
        customerId: userId,
        metadata: {
          videoId:    video._id.toString(),
          videoTitle: video.title,
          userId:     userId.toString()
        }
      });

      await Purchase.create({
        userId,
        videoId:       video._id,
        amount:        video.price,
        currency:      currency.toUpperCase(),
        paymentMethod: 'promptpay',
        transactionId: result.intentId,
        status:        'pending'
      });

      return {
        success:        false,
        requiresAction: true,
        qrCodeUrl:      result.qrCodeUrl,
        expiresIn:      result.expiresIn,
        intentId:       result.intentId,
        amount:         video.price,
        currency:       currency.toUpperCase()
      };
    } catch (err) {
      logger.error('[PP] FAILED:', { message: err.message });
      throw err;
    }
  }

  async checkPromptPayStatus(userId, videoId, paymentIntentId) {
    const { succeeded, gatewayId } = await PaymentService.checkPromptPayStatus(paymentIntentId);

    if (!succeeded) return { paid: false };

    const purchase = await Purchase.findOneAndUpdate(
      { transactionId: paymentIntentId, status: 'pending' },
      {
        status:               'completed',
        gatewayTransactionId: gatewayId,
        purchaseDate:         new Date()
      },
      { new: true }
    );

    if (!purchase) {
      const existing = await Purchase.findOne({ transactionId: paymentIntentId, status: 'completed' });
      if (existing) return { paid: true, purchase: existing };
      return { paid: false };
    }

    await User.updateOne(
      { _id: userId },
      { $addToSet: { purchasedVideos: videoId }, $inc: { totalSpent: purchase.amount } }
    );
    await Video.updateOne({ _id: videoId }, { $inc: { purchaseCount: 1 } });
    await this.afterPurchaseActions(userId, videoId, purchase);

    return { paid: true, purchase };
  }

  // ── Idempotency helpers ───────────────────────────────────────────────────

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
      if (err.code !== 11000) throw err;
    }
  }

  async updateProcessingRecord(idempotencyKey, status, data, session = null) {
    await mongoose.connection.db.collection('idempotency_keys').updateOne(
      { _id: idempotencyKey },
      { $set: { status, updatedAt: new Date(), ...data } },
      session ? { session } : {}
    );
  }

  // ── Post-purchase actions ─────────────────────────────────────────────────

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

  // ── Utility methods ───────────────────────────────────────────────────────

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

  // ── Notification stubs ────────────────────────────────────────────────────
  async sendPurchaseNotification(u, v, a)     { logger.info('Purchase notification', { u, v, a }); }
  async sendBulkPurchaseNotification(u, c, a) { logger.info('Bulk purchase notification', { u, c, a }); }
  async updateAnalytics(videoId)              { logger.info('Analytics updated', { videoId }); }
  async updateBulkAnalytics(videoIds)         { logger.info('Bulk analytics updated', { count: videoIds.length }); }
  async invalidateUserCache(userId)           { logger.info('Cache invalidated', { userId }); }
  async sendPurchaseEmail(userId, purchase)   { logger.info('Purchase email sent', { userId, purchaseId: purchase._id }); }
  async sendBulkPurchaseEmail(u, purchases)   { logger.info('Bulk email sent', { u, count: purchases.length }); }
}

module.exports = new PurchaseService();