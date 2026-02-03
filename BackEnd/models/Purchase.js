const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  videoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', required: true, index: true },
  
  // Payment details
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'THB' },
  paymentMethod: String,
  
  // Transaction tracking
  transactionId: { type: String, index: true, sparse: true },
  gatewayTransactionId: String,
  bulkId: { type: String, index: true, sparse: true }, // For bulk purchases
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded', 'processing'],
    default: 'completed',
    index: true
  },
  
  // Timing
  purchaseDate: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, index: true },
  processedAt: Date,
  
  // Access tracking
  accessCount: { type: Number, default: 0 },
  lastAccessedAt: Date,
  lastTime: { type: Number, default: 0 },
  
  // Metadata
  metadata: mongoose.Schema.Types.Mixed,
  updatedAt: { type: Date, default: Date.now }
});

// Indexes
purchaseSchema.index({ userId: 1, videoId: 1, status: 1, expiresAt: 1 });
purchaseSchema.index({ userId: 1, videoId: 1 }, { 
  unique: true, 
  partialFilterExpression: { status: 'completed' }
});
purchaseSchema.index({ purchaseDate: -1 });
purchaseSchema.index({ expiresAt: 1, status: 1 });
purchaseSchema.index({ bulkId: 1 });
purchaseSchema.index({ transactionId: 1 }, { unique: true, sparse: true });

// Static methods
purchaseSchema.statics.hasAccess = async function(userId, videoId) {
  return this.findOne({
    userId,
    videoId,
    status: 'completed',
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ]
  }).lean();
};

// Instance methods
purchaseSchema.methods.recordAccess = async function(currentTime = 0) {
  const result = await this.constructor.findOneAndUpdate(
    { _id: this._id },
    {
      $inc: { accessCount: 1 },
      $set: {
        lastAccessedAt: new Date(),
        updatedAt: new Date(),
        ...(currentTime && { lastTime: currentTime })
      }
    },
    { new: true }
  );
  
  Object.assign(this, result.toObject());
  return result;
};

module.exports = mongoose.model('Purchase', purchaseSchema);