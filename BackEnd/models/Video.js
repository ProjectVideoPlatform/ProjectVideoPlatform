const mongoose = require('mongoose');
const ElasticsearchService = require('../services/ElasticsearchService');

const ES_INDEX_NAME = 'videos';

const ES_MAPPING = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 1,
    analysis: {
      analyzer: {
        // ✅ แก้: standard → custom + thai tokenizer
        thai_analyzer: {
          type: 'custom',
          tokenizer: 'thai',
          filter: ['lowercase', 'thai_stop']
        },
        // ✅ เพิ่ม: สำหรับ autocomplete ภาษาไทย
        thai_autocomplete_analyzer: {
          type: 'custom',
          tokenizer: 'thai',
          filter: ['lowercase', 'thai_stop', 'autocomplete_filter']
        }
      },
      filter: {
        // ✅ เพิ่ม: ตัด stopword ภาษาไทย เช่น "และ", "หรือ", "ที่"
        thai_stop: {
          type: 'stop',
          stopwords: '_thai_'
        },
        // ✅ เพิ่ม: edge_ngram สำหรับ autocomplete
        autocomplete_filter: {
          type: 'edge_ngram',
          min_gram: 1,
          max_gram: 20
        }
      }
    }
  },
  mappings: {
    properties: {
      title: {
        type: 'text',
        analyzer: 'thai_autocomplete_analyzer',  // ✅ แก้: ใช้ thai + autocomplete
        search_analyzer: 'thai_analyzer',         // ✅ เพิ่ม: search ด้วย thai ปกติ
        fields: {
          keyword: { type: 'keyword' },
          // ✅ เพิ่ม: search_as_you_type สำหรับ autocomplete
          autocomplete: { type: 'search_as_you_type' },
          english: { type: 'text', analyzer: 'english' }
        }
      },
      description: {
        type: 'text',
        analyzer: 'thai_analyzer',
        fields: {
          english: { type: 'text', analyzer: 'english' }
        }
      },
      // ── ส่วนที่เหมือนเดิม (ถูกอยู่แล้ว) ──────────────────
      tags: { type: 'keyword' },
      accessType: { type: 'keyword' },
      price: { type: 'float' },
      duration: { type: 'integer' },
      fileSize: { type: 'long' },
      uploadStatus: { type: 'keyword' },
      isActive: { type: 'boolean' },
      createdAt: { type: 'date' },
      updatedAt: { type: 'date' },
      thumbnailPath: { type: 'keyword', index: false }
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
  hlsManifestPath: String,
  thumbnailPath: String,
  duration: Number,
  fileSize: Number,
  price: { 
    type: Number, 
    default: 0,
    min: 0
  },
  accessType: {
    type: String,
    enum: ['free', 'paid', 'subscription_only'],
    default: 'free',
    index: true
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
  }
});

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

// ✅ แก้: เพิ่ม fuzziness + highlight + ครอบคลุมทุก filter
videoSchema.statics.searchVideos = async function(query, options = {}) {
  const {
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    order = 'desc'
  } = options;

  const from = (page - 1) * limit;
  const must = [];
  const filter = [];

  // ✅ แก้: เพิ่ม fuzziness + boost ต่างกันแต่ละ field
  if (query.search) {
    must.push({
      multi_match: {
        query: query.search,
        fields: ['title^4', 'title.english^3', 'description^2', 'tags^2'],
        fuzziness: 'AUTO',      // ✅ typo tolerance
        prefix_length: 1,       // ตัวแรกต้องถูก
        operator: 'or'
      }
    });
  }

  if (query.accessType) filter.push({ term: { accessType: query.accessType } });
  if (query.uploadStatus) filter.push({ term: { uploadStatus: query.uploadStatus } });
  if (query.isActive !== undefined) filter.push({ term: { isActive: query.isActive } });
  if (query.tags?.length > 0) filter.push({ terms: { tags: query.tags } });
  if (query.priceRange) {
    filter.push({ range: { price: { gte: query.priceRange.min, lte: query.priceRange.max } } });
  }

  // ✅ แก้: ถ้ามี search ให้ sort ด้วย _score ก่อน
  const sort = query.search
    ? [{ _score: 'desc' }, { [sortBy]: order }]
    : [{ [sortBy]: order }];

  const esQuery = {
    size: limit,
    from,
    sort,
    query: {
      bool: {
        must: must.length > 0 ? must : [{ match_all: {} }],
        filter: filter.length > 0 ? filter : undefined
      }
    },
    // ✅ เพิ่ม: highlight คำที่ตรง
    ...(query.search && {
      highlight: {
        fields: {
          title: { number_of_fragments: 0 },
          description: { number_of_fragments: 2 }
        },
        pre_tags: ['<mark>'],
        post_tags: ['</mark>']
      }
    })
  };

  try {
    const response = await ElasticsearchService.searchDocuments(ES_INDEX_NAME, esQuery);
    return {
      data: response.hits.hits.map(hit => ({
        _id: hit._id,
        ...hit._source,
        score: hit._score,
        highlight: hit.highlight || null
      })),
      total: response.hits.total.value,
      page,
      limit,
      pages: Math.ceil(response.hits.total.value / limit)
    };
  } catch (error) {
    console.error('❌ Error searching videos:', error.message);
    // Fallback to MongoDB
    return this.find({ uploadStatus: 'completed', isActive: true })
      .limit(limit).skip(from).lean();
  }
};

// ✅ แก้: ใช้ match_phrase_prefix + search_as_you_type แทน match ธรรมดา
videoSchema.statics.searchAutocomplete = async function(prefix, limit = 8) {
  try {
    const esQuery = {
      size: limit,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: prefix,
                fields: [
                  'title.autocomplete',
                  'title.autocomplete._2gram',
                  'title.autocomplete._3gram'
                ],
                type: 'bool_prefix'   // ✅ เหมาะกับ search_as_you_type
              }
            }
          ],
          filter: [
            { term: { uploadStatus: 'completed' } },
            { term: { isActive: true } }
          ]
        }
      },
      _source: ['title', 'tags', 'accessType', 'thumbnailPath']
    };

    const response = await ElasticsearchService.searchDocuments(ES_INDEX_NAME, esQuery);
    return response.hits.hits.map(hit => ({
      id: hit._id,
      title: hit._source.title,
      tags: hit._source.tags,
      accessType: hit._source.accessType,
      thumbnailPath: hit._source.thumbnailPath
    }));
  } catch (error) {
    console.error('❌ Autocomplete error:', error.message);
    return [];
  }
};

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

videoSchema.index({ uploadStatus: 1, isActive: 1 });
videoSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Video', videoSchema);