const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  videoId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Video', 
    required: true 
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'THB'
  },
  paymentMethod: String,
  transactionId: String, // ใส่ transaction ID จาก payment gateway
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'completed'
  },
  purchaseDate: { 
    type: Date, 
    default: Date.now 
  },
  expiresAt: Date, // หากต้องการให้วิดีโอหมดอายุ
  accessCount: {
    type: Number,
    default: 0
  },
  lastAccessedAt: Date
});

// Index for better query performance
purchaseSchema.index({ userId: 1, videoId: 1 });
purchaseSchema.index({ userId: 1, purchaseDate: -1 });
purchaseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Static method to check if user has access to video
purchaseSchema.statics.hasAccess = async function(userId, videoId) {
  const purchase = await this.findOne({
    userId,
    videoId,
    status: 'completed',
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ]
  });
  
  return !!purchase;
};

// Method to record access
purchaseSchema.methods.recordAccess = async function() {
  this.accessCount += 1;
  this.lastAccessedAt = new Date();
  await this.save();
};

module.exports = mongoose.model('Purchase', purchaseSchema);