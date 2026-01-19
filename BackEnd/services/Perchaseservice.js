
// services/purchaseService.js
const mongoose = require('mongoose');
const User = require('../models/User');
const Video = require('../models/Video');
const Purchase = require('../models/Purchase');

class PurchaseService {

  /* =======================
     SINGLE PURCHASE
  ======================= */
  async purchaseVideo(userId, videoId, paymentData) {
    const session = await mongoose.startSession();

    try {
      await session.startTransaction();

      // 1. Validate user + video
      const [user, video] = await Promise.all([
        User.findById(userId).session(session),
        Video.findOne({ _id: videoId, isActive: true }).session(session)
      ]);

      if (!user) throw new Error('User not found');
      if (!video) throw new Error('Video not found or inactive');

      // 2. Create purchase (rely on UNIQUE INDEX)
      let purchase;
      try {
        [purchase] = await Purchase.create([{
          userId,
          videoId,
          amount: video.price,
          currency: 'THB',
          paymentMethod: paymentData.paymentMethod,
          transactionId: `${paymentData.transactionId}:${videoId}`,
          status: 'completed',
          purchaseDate: new Date(),
          expiresAt: paymentData.expiresAt || null
        }], { session });
      } catch (err) {
        if (err.code === 11000) {
          throw new Error('Duplicate purchase');
        }
        throw err;
      }

      // 3. Grant entitlement (atomic)
      await User.updateOne(
        { _id: userId },
        {
          $addToSet: { purchasedVideos: videoId },
          $set: { updatedAt: new Date() }
        },
        { session }
      );

      await session.commitTransaction();
      return { success: true, purchase };

    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  /* =======================
     BULK PURCHASE
  ======================= */
  async bulkPurchaseVideos(userId, videoIds, paymentData) {
    const session = await mongoose.startSession();

    // sanitize input
    videoIds = [...new Set(videoIds.map(id => id.toString()))];

    try {
      await session.startTransaction();

      // 1. Validate user
      const user = await User.findById(userId).session(session);
      if (!user) throw new Error('User not found');

      // 2. Load all data ONCE
      const [videos, existingPurchases] = await Promise.all([
        Video.find({ _id: { $in: videoIds }, isActive: true }).session(session),
        Purchase.find({
          userId,
          videoId: { $in: videoIds },
          status: 'completed'
        }).session(session)
      ]);

      if (videos.length !== videoIds.length) {
        throw new Error('Some videos not found or inactive');
      }

      // 3. Loop in memory
      const purchasedSet = new Set(
        existingPurchases.map(p => p.videoId.toString())
      );

      const purchases = [];
      const grantVideoIds = [];
      let totalAmount = 0;

      for (const video of videos) {
        const vid = video._id.toString();

        if (!purchasedSet.has(vid)) {
          purchases.push({
            userId,
            videoId: video._id,
            amount: video.price,
            currency: 'THB',
            paymentMethod: paymentData.paymentMethod,
            transactionId: `${paymentData.transactionId}:${vid}`,
            status: 'completed',
            purchaseDate: new Date()
          });

          grantVideoIds.push(video._id);
          totalAmount += video.price;
        }
      }

      if (purchases.length === 0) {
        throw new Error('No new videos to purchase');
      }

      // 4. Insert all purchases
      try {
        await Purchase.insertMany(purchases, { session });
      } catch (err) {
        if (err.code === 11000) {
          throw new Error('Duplicate purchase detected');
        }
        throw err;
      }

      // 5. Grant entitlements
      await User.updateOne(
        { _id: userId },
        {
          $addToSet: { purchasedVideos: { $each: grantVideoIds } },
          $set: { updatedAt: new Date() }
        },
        { session }
      );

      await session.commitTransaction();

      return {
        success: true,
        purchaseCount: purchases.length,
        totalAmount
      };

    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }
}

module.exports = new PurchaseService();
