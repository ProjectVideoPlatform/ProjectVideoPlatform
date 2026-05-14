const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const ElasticsearchService = require('../services/ElasticsearchService');
const Video = require('../models/Video');
const Purchase = require('../models/Purchase');

const router = express.Router();

// ===== PUBLIC ROUTES =====

/**
 * Search Videos with Elasticsearch
 * GET /api/elasticsearch/videos/search
 * 
 * Query params:
 *   - q: search term
 *   - accessType: free|paid|subscription_only
 *   - tags: comma-separated tags
 *   - priceMin: minimum price
 *   - priceMax: maximum price
 *   - page: page number (default 1)
 *   - limit: results per page (default 20)
 *   - sort: createdAt|price|_score
 *   - order: asc|desc
 */
router.get('/videos/search', async (req, res) => {
  try {
    const {
      q = '',
      accessType,
      tags,
      priceMin,
      priceMax,
      page = 1,
      limit = 20,
      sort = '_score',
      order = 'desc'
    } = req.query;

    const query = {};
    
    if (q) query.search = q;
    if (accessType) query.accessType = accessType;
    if (tags) query.tags = tags.split(',').map(t => t.trim());
    
    if (priceMin !== undefined || priceMax !== undefined) {
      query.priceRange = {
        min: priceMin ? parseFloat(priceMin) : 0,
        max: priceMax ? parseFloat(priceMax) : 999999
      };
    }

    const results = await Video.searchVideos(query, {
      page: parseInt(page),
      limit: parseInt(limit),
      sortBy: sort,
      order
    });

    res.json({
      success: true,
      data: results.data,
      pagination: {
        total: results.total,
        page: results.page,
        limit: results.limit,
        pages: results.pages
      }
    });
  } catch (error) {
    console.error('❌ Error searching videos:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Search Purchases (Admin only)
 * GET /api/elasticsearch/purchases/search
 */
router.get('/purchases/search', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      userId,
      videoId,
      status,
      paymentMethod,
      currency,
      dateFrom,
      dateTo,
      amountMin,
      amountMax,
      page = 1,
      limit = 20,
      sort = 'purchaseDate',
      order = 'desc'
    } = req.query;

    const filters = {};
    
    if (userId) filters.userId = userId;
    if (videoId) filters.videoId = videoId;
    if (status) filters.status = status.split(',');
    if (paymentMethod) filters.paymentMethod = paymentMethod;
    if (currency) filters.currency = currency;
    
    if (dateFrom || dateTo) {
      filters.dateRange = {
        from: dateFrom || '2000-01-01',
        to: dateTo || new Date().toISOString()
      };
    }
    
    if (amountMin !== undefined || amountMax !== undefined) {
      filters.amountRange = {
        min: amountMin ? parseFloat(amountMin) : 0,
        max: amountMax ? parseFloat(amountMax) : 999999
      };
    }

    const results = await Purchase.searchPurchases(filters, {
      page: parseInt(page),
      limit: parseInt(limit),
      sortBy: sort,
      order
    });

    res.json({
      success: true,
      data: results.data,
      pagination: {
        total: results.total,
        page: results.page,
        limit: results.limit,
        pages: results.pages
      }
    });
  } catch (error) {
    console.error('❌ Error searching purchases:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ===== ADMIN ROUTES =====

/**
 * Get Revenue Analytics
 * GET /api/elasticsearch/analytics/revenue
 */
router.get('/analytics/revenue', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      status = 'completed',
      dateFrom,
      dateTo
    } = req.query;

    const filters = { status };
    
    if (dateFrom || dateTo) {
      filters.dateRange = {
        from: dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        to: dateTo || new Date().toISOString()
      };
    }

    const analytics = await Purchase.getRevenueAnalytics(filters);

    res.json({
      success: true,
      data: {
        summary: {
          totalRevenue: analytics.totalRevenue,
          currency: 'THB' // default
        },
        breakdown: {
          byCurrency: analytics.byCurrency,
          byPaymentMethod: analytics.byPaymentMethod,
          byVideo: analytics.byVideo
        },
        trends: {
          dailyRevenue: analytics.dailyRevenue
        }
      }
    });
  } catch (error) {
    console.error('❌ Error getting revenue analytics:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Get Index Stats
 * GET /api/elasticsearch/stats/:indexName
 */
router.get('/stats/:indexName', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { indexName } = req.params;

    if (!['videos', 'purchases'].includes(indexName)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid index name. Must be: videos or purchases'
      });
    }

    const stats = await ElasticsearchService.getIndexStats(indexName);

    res.json({
      success: true,
      data: {
        index: indexName,
        documents: stats.primaries.docs.count,
        deleted: stats.primaries.docs.deleted,
        sizeInBytes: stats.primaries.store.size_in_bytes,
        sizeInMB: (stats.primaries.store.size_in_bytes / 1024 / 1024).toFixed(2)
      }
    });
  } catch (error) {
    console.error('❌ Error getting index stats:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Initialize/Recreate Indexes
 * POST /api/elasticsearch/admin/recreate
 */
router.post('/admin/recreate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { models = ['videos', 'purchases'] } = req.body;

    const results = {};

    for (const model of models) {
      try {
        if (model === 'videos') {
          // Delete old index
          await ElasticsearchService.deleteIndex('videos');
          
          // Create new index
          await Video.initializeESIndex();
          
          // Sync data
          await Video.syncToElasticsearch();
          
          results.videos = { status: 'success', message: 'Videos index recreated' };
        } else if (model === 'purchases') {
          // Delete old index
          await ElasticsearchService.deleteIndex('purchases');
          
          // Create new index
          await Purchase.initializeESIndex();
          
          // Sync data
          await Purchase.syncToElasticsearch();
          
          results.purchases = { status: 'success', message: 'Purchases index recreated' };
        }
      } catch (error) {
        results[model] = { status: 'error', error: error.message };
      }
    }

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('❌ Error recreating indexes:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Sync Data to Elasticsearch
 * POST /api/elasticsearch/admin/sync
 */
router.post('/admin/sync', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { models = ['videos', 'purchases'] } = req.body;

    const results = {};

    for (const model of models) {
      try {
        if (model === 'videos') {
          const count = await Video.countDocuments();
          await Video.syncToElasticsearch();
          results.videos = { status: 'success', synced: count };
        } else if (model === 'purchases') {
          const count = await Purchase.countDocuments();
          await Purchase.syncToElasticsearch();
          results.purchases = { status: 'success', synced: count };
        }
      } catch (error) {
        results[model] = { status: 'error', error: error.message };
      }
    }

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('❌ Error syncing data:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Delete Index
 * DELETE /api/elasticsearch/admin/index/:indexName
 */
router.delete('/admin/index/:indexName', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { indexName } = req.params;

    if (!['videos', 'purchases'].includes(indexName)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid index name. Must be: videos or purchases'
      });
    }

    await ElasticsearchService.deleteIndex(indexName);

    res.json({
      success: true,
      message: `Index '${indexName}' deleted successfully`
    });
  } catch (error) {
    console.error('❌ Error deleting index:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router;
