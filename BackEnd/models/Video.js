const mongoose = require('mongoose');
const ElasticsearchService = require('../services/ElasticsearchService');

const ES_INDEX_NAME = 'videos';

// Elasticsearch mapping for videos index
const ES_MAPPING = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 1,
    analysis: {
      analyzer: {
        thai_analyzer: {
          type: 'standard' // ใช้ Thai tokenizer ถ้า plugin installed
        }
      }
    }
  },
  mappings: {
    properties: {
      title: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword' },
          thai: { type: 'text', analyzer: 'thai_analyzer' }
        }
      },
      description: {
        type: 'text',
        analyzer: 'thai_analyzer'
      },
      tags: {
        type: 'keyword'
      },
      accessType: {
        type: 'keyword'
      },
      price: {
        type: 'float'
      },
      duration: {
        type: 'integer'
      },
      fileSize: {
        type: 'long'
      },
      uploadStatus: {
        type: 'keyword'
      },
      isActive: {
        type: 'boolean'
      },
      createdAt: {
        type: 'date'
      },
      updatedAt: {
        type: 'date'
      },
      thumbnailPath: {
        type: 'keyword'
      }
    }
  }
};

const videoSchema = new mongoose.Schema({
  id: { 
    type: String, 
    required: true, 
    unique: true 
  },
  title: { 
    type: String, 
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  originalFileName: String,
  uploadStatus: {
    type: String,
    enum: ['uploading', 'uploaded', 'processing', 'completed', 'failed'],
    default: 'uploading'
  },
  mediaConvertJobId: String,
  hlsManifestPath: String, // path ใน S3 ของ master.m3u8
  thumbnailPath: String,
  duration: Number, // duration in seconds
  fileSize: Number, // file size in bytes
  price: { 
    type: Number, 
    default: 0,
    min: 0
  },
  accessType: {
    type: String,
    enum: ['free', 'paid', 'subscription_only'],
    default: 'free',
    index: true // ทำ Index ไว้เพราะต้องใช้ Filter บ่อย
  },
  tags: [String],
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Update the updatedAt field before saving
videoSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// ===== ELASTICSEARCH HOOKS =====
// Index to Elasticsearch after save
videoSchema.post('save', async function(doc) {
  try {
    await ElasticsearchService.indexDocument(
      ES_INDEX_NAME,
      doc._id.toString(),
      {
        title: doc.title,
        description: doc.description,
        tags: doc.tags,
        accessType: doc.accessType,
        price: doc.price,
        duration: doc.duration,
        fileSize: doc.fileSize,
        uploadStatus: doc.uploadStatus,
        isActive: doc.isActive,
        thumbnailPath: doc.thumbnailPath,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
      }
    );
  } catch (error) {
    console.error('❌ Error indexing video to ES:', error.message);
    // Don't throw - prevent blocking MongoDB save
  }
});

// Update in Elasticsearch after findOneAndUpdate
videoSchema.post('findOneAndUpdate', async function() {
  try {
    const doc = this.getUpdate();
    if (doc && this.getOptions()._id) {
      const updateData = {};
      if (doc.title) updateData.title = doc.title;
      if (doc.description) updateData.description = doc.description;
      if (doc.tags) updateData.tags = doc.tags;
      if (doc.accessType) updateData.accessType = doc.accessType;
      if (doc.price !== undefined) updateData.price = doc.price;
      if (doc.uploadStatus) updateData.uploadStatus = doc.uploadStatus;
      if (doc.isActive !== undefined) updateData.isActive = doc.isActive;
      if (doc.updatedAt) updateData.updatedAt = doc.updatedAt;

      if (Object.keys(updateData).length > 0) {
        await ElasticsearchService.updateDocument(
          ES_INDEX_NAME,
          this.getOptions()._id.toString(),
          updateData
        );
      }
    }
  } catch (error) {
    console.error('❌ Error updating video in ES:', error.message);
  }
});

// Delete from Elasticsearch before deleteOne
videoSchema.pre('deleteOne', async function() {
  try {
    const doc = this.getFilter();
    if (doc._id) {
      await ElasticsearchService.deleteDocument(
        ES_INDEX_NAME,
        doc._id.toString()
      );
    }
  } catch (error) {
    console.error('❌ Error deleting video from ES:', error.message);
  }
});

// ===== STATIC METHODS =====
videoSchema.statics.initializeESIndex = async function() {
  try {
    await ElasticsearchService.createIndex(ES_INDEX_NAME, ES_MAPPING);
  } catch (error) {
    console.error('❌ Failed to initialize ES index:', error.message);
  }
};

// Search videos with Elasticsearch
videoSchema.statics.searchVideos = async function(query, options = {}) {
  const {
    page = 1,
    limit = 20,
    sortBy = '_score',
    order = 'desc'
  } = options;

  const from = (page - 1) * limit;
  const must = [];
  const filter = [];

  // Text search
  if (query.search) {
    must.push({
      multi_match: {
        query: query.search,
        fields: ['title^2', 'description', 'tags']
      }
    });
  }

  // Filters
  if (query.accessType) {
    filter.push({ term: { accessType: query.accessType } });
  }
  
  if (query.isActive !== undefined) {
    filter.push({ term: { isActive: query.isActive } });
  }

  if (query.uploadStatus) {
    filter.push({ term: { uploadStatus: query.uploadStatus } });
  }

  if (query.priceRange) {
    filter.push({
      range: {
        price: {
          gte: query.priceRange.min,
          lte: query.priceRange.max
        }
      }
    });
  }

  if (query.tags && query.tags.length > 0) {
    filter.push({ terms: { tags: query.tags } });
  }

  const esQuery = {
    size: limit,
    from,
    sort: [{ [sortBy]: order }],
    query: {
      bool: {
        must: must.length > 0 ? must : [{ match_all: {} }],
        filter: filter.length > 0 ? filter : undefined
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
    console.error('❌ Error searching videos:', error.message);
    // Fallback to MongoDB query
    return this.find(query).limit(limit).skip(from).lean();
  }
};

// Bulk sync videos to Elasticsearch
videoSchema.statics.syncToElasticsearch = async function() {
  try {
    const videos = await this.find({ uploadStatus: 'completed' }).lean();
    await ElasticsearchService.bulkIndex(ES_INDEX_NAME, videos);
    console.log(`✅ Synced ${videos.length} videos to Elasticsearch`);
  } catch (error) {
    console.error('❌ Error syncing videos to ES:', error.message);
    throw error;
  }
};

// Index for better query performance
videoSchema.index({ uploadStatus: 1, isActive: 1 });
videoSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Video', videoSchema);