const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  // Core references
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    index: true 
  },
  videoId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Video', 
    required: true, 
    index: true 
  },
  
  // Payment details
  amount: { 
    type: Number, 
    required: true, 
    min: 0,
    get: v => Math.round(v * 100) / 100 // 2 decimal places
  },
  currency: { 
    type: String, 
    default: 'THB',
    enum: ['THB', 'USD', 'EUR', 'JPY', 'KRW'],
    uppercase: true
  },
  paymentMethod: {
    type: String,
    enum: ['kplus', 'credit_card', 'promptpay', 'truewallet', 'bank_transfer', 'cash'],
    required: true
  },
  
  // Transaction tracking
  transactionId: { 
    type: String, 
    index: true, 
    sparse: true,
    uppercase: true,
    trim: true
  },
  gatewayTransactionId: {
    type: String,
    sparse: true
  },
  bulkId: { 
    type: String, 
    index: true, 
    sparse: true 
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded', 'processing', 'cancelled'],
    default: 'pending',
    index: true
  },
  statusHistory: [{
    status: String,
    changedAt: { type: Date, default: Date.now },
    reason: String,
    changedBy: { type: String, enum: ['system', 'user', 'admin', 'gateway'] }
  }],
  
  // Timing
  purchaseDate: { 
    type: Date, 
    default: Date.now, 
    index: true 
  },
  expiresAt: { 
    type: Date, 
    index: true 
  },
  processedAt: Date,
  refundedAt: Date,
  cancelledAt: Date,
  
  // Access tracking
  accessCount: { 
    type: Number, 
    default: 0,
    min: 0
  },
  lastAccessedAt: Date,
  lastTime: { 
    type: Number, 
    default: 0,
    min: 0 
  },
  watchDuration: { // Total seconds watched
    type: Number,
    default: 0,
    min: 0
  },
  completionRate: { // Percentage 0-100
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  
  // Pricing info (for historical records)
  originalPrice: Number,
  discountApplied: {
    amount: { type: Number, default: 0 },
    percentage: { type: Number, default: 0, min: 0, max: 100 },
    couponCode: String,
    campaignId: String
  },
  
  // User device info at purchase time
  deviceInfo: {
    userAgent: String,
    ipAddress: String,
    platform: String,
    appVersion: String
  },
  
  // Metadata
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  notes: String, // For admin notes
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true }
});

// ===== COMPOUND INDEXES =====
purchaseSchema.index({ userId: 1, videoId: 1, status: 1, expiresAt: 1 });
purchaseSchema.index({ userId: 1, status: 1, purchaseDate: -1 });
purchaseSchema.index({ videoId: 1, status: 1, purchaseDate: -1 });
purchaseSchema.index({ 
  userId: 1, 
  videoId: 1 
}, { 
  unique: true, 
  partialFilterExpression: { 
    status: { $in: ['completed', 'processing'] } 
  } 
});

// สำหรับค้นหาด้วย transaction
purchaseSchema.index({ transactionId: 1 }, { 
  unique: true, 
  sparse: true 
});

// สำหรับการ expire access
purchaseSchema.index({ 
  expiresAt: 1, 
  status: 1 
}, { 
  expireAfterSeconds: 0 
});

// สำหรับ bulk purchase analytics
purchaseSchema.index({ bulkId: 1, status: 1 });

// สำหรับ revenue reporting
purchaseSchema.index({ 
  status: 1, 
  purchaseDate: 1, 
  currency: 1 
});

// ===== STATIC METHODS =====
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

purchaseSchema.statics.getUserActivePurchases = async function(userId, options = {}) {
  const query = {
    userId,
    status: 'completed',
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ]
  };
  
  if (options.videoId) {
    query.videoId = options.videoId;
  }
  
  return this.find(query)
    .populate('videoId', 'title thumbnail duration category')
    .sort({ purchaseDate: -1 })
    .lean();
};

purchaseSchema.statics.updateStatus = async function(purchaseId, newStatus, reason = '', changedBy = 'system') {
  return this.findByIdAndUpdate(
    purchaseId,
    {
      $set: { status: newStatus },
      $push: {
        statusHistory: {
          status: newStatus,
          reason,
          changedAt: new Date(),
          changedBy
        }
      },
      ...(newStatus === 'refunded' && { refundedAt: new Date() }),
      ...(newStatus === 'cancelled' && { cancelledAt: new Date() })
    },
    { new: true }
  );
};

purchaseSchema.statics.findByTransaction = async function(transactionId) {
  return this.findOne({ 
    $or: [
      { transactionId },
      { gatewayTransactionId: transactionId }
    ]
  }).populate('userId videoId');
};

// ===== INSTANCE METHODS =====
purchaseSchema.methods.recordAccess = async function(currentTime = 0, duration = 0) {
  const updateData = {
    $inc: { 
      accessCount: 1,
      ...(duration && { watchDuration: duration })
    },
    $set: {
      lastAccessedAt: new Date(),
      ...(currentTime && { lastTime: currentTime })
    }
  };
  
  // Calculate completion rate if video duration is available
  if (this.videoId?.duration && duration) {
    const completionPercentage = Math.min(100, (duration / this.videoId.duration) * 100);
    if (completionPercentage > this.completionRate) {
      updateData.$set.completionRate = Math.round(completionPercentage);
    }
  }
  
  const result = await this.constructor.findOneAndUpdate(
    { _id: this._id },
    updateData,
    { new: true }
  );
  
  Object.assign(this, result.toObject());
  return result;
};

purchaseSchema.methods.isExpired = function() {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
};

purchaseSchema.methods.getRemainingTime = function() {
  if (!this.expiresAt) return Infinity;
  const remaining = this.expiresAt.getTime() - Date.now();
  return remaining > 0 ? remaining : 0;
};

purchaseSchema.methods.formatForClient = function() {
  const obj = this.toObject();
  
  return {
    purchaseId: obj._id,
    videoId: obj.videoId,
    amount: obj.amount,
    currency: obj.currency,
    status: obj.status,
    purchasedAt: obj.purchaseDate,
    expiresAt: obj.expiresAt,
    accessCount: obj.accessCount,
    lastAccessedAt: obj.lastAccessedAt,
    isExpired: this.isExpired(),
    remainingTime: this.getRemainingTime(),
    completionRate: obj.completionRate
  };
};

// ===== MIDDLEWARE =====
purchaseSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    this.statusHistory = this.statusHistory || [];
    this.statusHistory.push({
      status: this.status,
      changedAt: new Date(),
      changedBy: 'system',
      reason: 'Status changed on save'
    });
  }
  
  // Auto-update expiry based on video access duration
  if (this.isModified('status') && this.status === 'completed' && !this.expiresAt) {
    // You might want to populate videoId here if needed
    // Or handle this in the service layer
  }
  
  next();
});

purchaseSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  
  if (update.$set && update.$set.status) {
    update.$push = update.$push || {};
    update.$push.statusHistory = {
      status: update.$set.status,
      changedAt: new Date(),
      changedBy: 'system',
      reason: 'Status updated via findOneAndUpdate'
    };
  }
  
  next();
});

// ===== VIRTUAL FIELDS =====
purchaseSchema.virtual('isActive').get(function() {
  return this.status === 'completed' && !this.isExpired();
});

purchaseSchema.virtual('daysSincePurchase').get(function() {
  return Math.floor((Date.now() - this.purchaseDate.getTime()) / (1000 * 60 * 60 * 24));
});

purchaseSchema.virtual('totalWatchedHours').get(function() {
  return Math.round((this.watchDuration || 0) / 3600 * 100) / 100;
});

// ===== QUERY HELPERS =====
purchaseSchema.query.active = function() {
  return this.where({
    status: 'completed',
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ]
  });
};

purchaseSchema.query.recent = function(days = 30) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return this.where('purchaseDate').gte(date);
};

purchaseSchema.query.byUser = function(userId) {
  return this.where({ userId });
};

purchaseSchema.query.byVideo = function(videoId) {
  return this.where({ videoId });
};

// ===== EXPORT =====
module.exports = mongoose.model('Purchase', purchaseSchema);