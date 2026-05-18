const express = require('express');
const router = express.Router();
const VideoSearchService = require('../services/Videosearchservice');
const Purchase = require('../models/Purchase'); // ปรับ path ตามโปรเจค
const { authenticateToken } = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────
// GET /api/search
// Full-text search + faceted filters
// ─────────────────────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    let {
      search,
      category,
      accessType,
      tags,          // comma-separated: "javascript,react"
      minPrice,
      maxPrice,
      minDuration,
      maxDuration,
      sort = 'createdAt',
      order = 'desc',
      page = 1,
      limit = 10
    } = req.query;

    // ── Sanitize ──────────────────────────────────────────────
    page  = Math.max(parseInt(page) || 1, 1);
    limit = Math.min(Math.max(parseInt(limit) || 10, 1), 50);

    const tagsArray = tags
      ? tags.split(',').map(t => t.trim()).filter(Boolean)
      : undefined;

    // ── Search ────────────────────────────────────────────────
    const results = await VideoSearchService.searchVideos({
      search,
      tags: tagsArray,
      accessType,
      category,
      minPrice: minPrice ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
      minDuration: minDuration ? parseInt(minDuration) : undefined,
      maxDuration: maxDuration ? parseInt(maxDuration) : undefined,
      sortBy: sort,
      order,
      page,
      limit
    });

    // ── Enrich with purchase status ───────────────────────────
    const purchasedVideoIds = await Purchase.find({
      userId: req.user._id,
      status: 'completed'
    }).distinct('videoId');

    const purchasedSet = new Set(purchasedVideoIds.map(id => id.toString()));

    const videos = results.data.map(video => {
      const isPurchased = purchasedSet.has(video._id?.toString());
      const canPlay =
        req.user.role === 'admin' ||
        video.accessType === 'free' ||
        isPurchased;

      return {
        ...video,
        purchased: isPurchased,
        canPlay
      };
    });

    res.json({
      videos,
      pagination: {
        page: results.page,
        limit: results.limit,
        total: results.total,
        pages: results.pages
      },
      // ✅ Facets สำหรับแสดง filter sidebar พร้อมจำนวน
      facets: results.facets
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/search/autocomplete?q=จาวา
// Real-time autocomplete suggestions
// ─────────────────────────────────────────────────────────────
router.get('/autocomplete', authenticateToken, async (req, res) => {
  try {
    const { q, size = 8 } = req.query;

    if (!q || q.trim().length < 1) {
      return res.json({ suggestions: [] });
    }

    const suggestions = await VideoSearchService.autocomplete(
      q.trim(),
      Math.min(parseInt(size) || 8, 20)
    );

    res.json({ suggestions });
  } catch (error) {
    console.error('Autocomplete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/search/facets
// ดึง filter options พร้อม count (สำหรับ sidebar)
// ─────────────────────────────────────────────────────────────
router.get('/facets', authenticateToken, async (req, res) => {
  try {
    const { category } = req.query;
    const facets = await VideoSearchService.getFacets({ category });
    res.json({ facets });
  } catch (error) {
    console.error('Facets error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;