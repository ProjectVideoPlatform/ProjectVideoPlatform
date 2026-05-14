const mongoose = require('mongoose');
const ElasticsearchService = require('../services/ElasticsearchService');

const ES_INDEX_NAME = 'purchases';

// Elasticsearch mapping for purchases index
const ES_MAPPING = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 1
  },
  mappings: {
    properties: {
      userId: { type: 'keyword' },
      videoId: { type: 'keyword' },
      amount: { type: 'float' },
      currency: { type: 'keyword' },
      paymentMethod: { type: 'keyword' },
      status: { type: 'keyword' },
      purchaseDate: { type: 'date' },
      expiresAt: { type: 'date' },
      processedAt: { type: 'date' },
      refundedAt: { type: 'date' },
      transactionId: { type: 'keyword' },
      bulkId: { type: 'keyword' },
      accessCount: { type: 'integer' },
      watchDuration: { type: 'long' },
      completionRate: { type: 'float' },
      paymentMethod: { type: 'keyword' },
      originalPrice: { type: 'float' },
      lastAccessedAt: { type: 'date' },
      createdAt: { type: 'date' },
      updatedAt: { type: 'date' }
    }
  }
};

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
    enum: ['kplus', 'credit_card', 'promptpay', 'truewallet', 'bank_transfer', 'cash','card'],
    required: true
  },
  
  // Transaction tracking
  transactionId: { 
    type: String, 
    index: true, 
    sparse: true,
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
    enum: ['pending', 'completed', 'failed', 'refunded', 'processing', 'cancelled','refund_pending'],
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

// ===== ELASTICSEARCH HOOKS =====
// Index to Elasticsearch after save
purchaseSchema.post('save', async function(doc) {
  try {
    await ElasticsearchService.indexDocument(
      ES_INDEX_NAME,
      doc._id.toString(),
      {
        userId: doc.userId.toString(),
        videoId: doc.videoId.toString(),
        amount: doc.amount,
        currency: doc.currency,
        paymentMethod: doc.paymentMethod,
        status: doc.status,
        purchaseDate: doc.purchaseDate,
        expiresAt: doc.expiresAt,
        processedAt: doc.processedAt,
        refundedAt: doc.refundedAt,
        transactionId: doc.transactionId,
        bulkId: doc.bulkId,
        accessCount: doc.accessCount,
        watchDuration: doc.watchDuration,
        completionRate: doc.completionRate,
        lastAccessedAt: doc.lastAccessedAt,
        originalPrice: doc.originalPrice,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
      }
    );
  } catch (error) {
    console.error('❌ Error indexing purchase to ES:', error.message);
    // Don't throw - prevent blocking MongoDB save
  }
});

// Update in Elasticsearch after findOneAndUpdate
purchaseSchema.post('findOneAndUpdate', async function(doc) {
  try {
    if (doc && doc._id) {
      const updateData = {
        status: doc.status,
        processedAt: doc.processedAt,
        refundedAt: doc.refundedAt,
        accessCount: doc.accessCount,
        watchDuration: doc.watchDuration,
        completionRate: doc.completionRate,
        lastAccessedAt: doc.lastAccessedAt,
        updatedAt: doc.updatedAt
      };

      await ElasticsearchService.updateDocument(
        ES_INDEX_NAME,
        doc._id.toString(),
        updateData
      );
    }
  } catch (error) {
    console.error('❌ Error updating purchase in ES:', error.message);
  }
});

// Delete from Elasticsearch before deleteOne
purchaseSchema.pre('deleteOne', async function() {
  try {
    const doc = this.getFilter();
    if (doc._id) {
      await ElasticsearchService.deleteDocument(
        ES_INDEX_NAME,
        doc._id.toString()
      );
    }
  } catch (error) {
    console.error('❌ Error deleting purchase from ES:', error.message);
  }
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

// ===== STATIC METHODS FOR ELASTICSEARCH =====
purchaseSchema.statics.initializeESIndex = async function() {
  try {
    await ElasticsearchService.createIndex(ES_INDEX_NAME, ES_MAPPING);
  } catch (error) {
    console.error('❌ Failed to initialize ES index:', error.message);
  }
};

// Search purchases with advanced filters
purchaseSchema.statics.searchPurchases = async function(filters = {}, options = {}) {
  const {
    page = 1,
    limit = 20,
    sortBy = 'purchaseDate',
    order = 'desc'
  } = options;

  const from = (page - 1) * limit;
  const esFilters = [];

  // Apply filters
  if (filters.userId) {
    esFilters.push({ term: { userId: filters.userId.toString() } });
  }

  if (filters.videoId) {
    esFilters.push({ term: { videoId: filters.videoId.toString() } });
  }

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      esFilters.push({ terms: { status: filters.status } });
    } else {
      esFilters.push({ term: { status: filters.status } });
    }
  }

  if (filters.paymentMethod) {
    esFilters.push({ term: { paymentMethod: filters.paymentMethod } });
  }

  if (filters.currency) {
    esFilters.push({ term: { currency: filters.currency } });
  }

  if (filters.dateRange) {
    esFilters.push({
      range: {
        purchaseDate: {
          gte: filters.dateRange.from,
          lte: filters.dateRange.to
        }
      }
    });
  }

  if (filters.amountRange) {
    esFilters.push({
      range: {
        amount: {
          gte: filters.amountRange.min,
          lte: filters.amountRange.max
        }
      }
    });
  }

  const esQuery = {
    size: limit,
    from,
    sort: [{ [sortBy]: order }],
    query: {
      bool: {
        filter: esFilters.length > 0 ? esFilters : undefined,
        must: [{ match_all: {} }]
      }
    }
  };

  try {
    const response = await ElasticsearchService.searchDocuments(ES_INDEX_NAME, esQuery);
    
    return {
      data: response.hits.hits.map(hit => ({
        _id: hit._id,
        ...hit._source
      })),
      total: response.hits.total.value,
      page,
      limit,
      pages: Math.ceil(response.hits.total.value / limit)
    };
  } catch (error) {
    console.error('❌ Error searching purchases:', error.message);
    throw error;
  }
};

// Get revenue analytics
purchaseSchema.statics.getRevenueAnalytics = async function(filters = {}) {
  const esFilters = [];
  
  if (filters.status) {
    esFilters.push({ term: { status: filters.status || 'completed' } });
  } else {
    esFilters.push({ term: { status: 'completed' } });
  }

  if (filters.dateRange) {
    esFilters.push({
      range: {
        purchaseDate: {
          gte: filters.dateRange.from,
          lte: filters.dateRange.to
        }
      }
    });
  }

  const esQuery = {
    size: 0,
    query: {
      bool: { filter: esFilters }
    },
    aggs: {
      total_revenue: { sum: { field: 'amount' } },
      by_currency: {
        terms: { field: 'currency', size: 10 }
      },
      by_payment_method: {
        terms: { field: 'paymentMethod', size: 10 }
      },
      by_video: {
        terms: { field: 'videoId', size: 100 }
      },
      daily_revenue: {
        date_histogram: {
          field: 'purchaseDate',
          calendar_interval: 'day'
        },
        aggs: {
          daily_sum: { sum: { field: 'amount' } }
        }
      }
    }
  };

  try {
    const response = await ElasticsearchService.searchDocuments(ES_INDEX_NAME, esQuery);
    
    return {
      totalRevenue: response.aggregations.total_revenue.value,
      byCurrency: response.aggregations.by_currency.buckets,
      byPaymentMethod: response.aggregations.by_payment_method.buckets,
      byVideo: response.aggregations.by_video.buckets,
      dailyRevenue: response.aggregations.daily_revenue.buckets
    };
  } catch (error) {
    console.error('❌ Error getting revenue analytics:', error.message);
    throw error;
  }
};

// Bulk sync purchases to Elasticsearch
purchaseSchema.statics.syncToElasticsearch = async function() {
  try {
    const purchases = await this.find().lean();
    await ElasticsearchService.bulkIndex(ES_INDEX_NAME, purchases);
    console.log(`✅ Synced ${purchases.length} purchases to Elasticsearch`);
  } catch (error) {
    console.error('❌ Error syncing purchases to ES:', error.message);
    throw error;
  }
};

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