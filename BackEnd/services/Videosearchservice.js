const ElasticsearchService = require('./ElasticsearchService');

const VIDEO_INDEX_NAME = 'videos'; // ✅ เพิ่มตรงนี้
/**
 * Video Search Service
 * ครอบคลุม: Thai search, Typo tolerance, Autocomplete, Faceted search
 */
class VideoSearchService {

  // ─────────────────────────────────────────────────────────────
  // 1. FULL-TEXT SEARCH (Thai + Typo tolerance + Facet filters)
  // ─────────────────────────────────────────────────────────────

  /**
   * ค้นหาวิดีโอแบบเต็มรูปแบบ
   * @param {Object} params
   * @param {string} params.search        - คำค้นหา
   * @param {string[]} params.tags        - filter tags
   * @param {string} params.accessType    - 'free' | 'paid'
   * @param {string} params.category      - category filter
   * @param {number} params.minPrice      - ราคาต่ำสุด
   * @param {number} params.maxPrice      - ราคาสูงสุด
   * @param {number} params.minDuration   - ความยาวต่ำสุด (วินาที)
   * @param {number} params.maxDuration   - ความยาวสูงสุด (วินาที)
   * @param {string} params.sortBy        - createdAt | rating | viewCount | price
   * @param {string} params.order         - asc | desc
   * @param {number} params.page
   * @param {number} params.limit
   */
  static async searchVideos(params = {}) {
    const {
      search,
      tags,
      accessType,
      category,
      minPrice,
      maxPrice,
      minDuration,
      maxDuration,
      sortBy = 'createdAt',
      order = 'desc',
      page = 1,
      limit = 10
    } = params;

    const from = (page - 1) * limit;

    // ── Build filter array ────────────────────────────────────
    const filters = [
      { term: { uploadStatus: 'completed' } },
      { term: { isActive: true } }
    ];

    if (accessType && ['free', 'paid'].includes(accessType)) {
      filters.push({ term: { accessType } });
    }

    if (category) {
      filters.push({ term: { category } });
    }

    if (tags && tags.length > 0) {
      filters.push({ terms: { tags } });
    }

    // Range filters
    const rangeFilters = {};
    if (minPrice !== undefined) rangeFilters.price = { ...rangeFilters.price, gte: minPrice };
    if (maxPrice !== undefined) rangeFilters.price = { ...rangeFilters.price, lte: maxPrice };
    if (minDuration !== undefined) rangeFilters.duration = { ...rangeFilters.duration, gte: minDuration };
    if (maxDuration !== undefined) rangeFilters.duration = { ...rangeFilters.duration, lte: maxDuration };

    if (rangeFilters.price) filters.push({ range: { price: rangeFilters.price } });
    if (rangeFilters.duration) filters.push({ range: { duration: rangeFilters.duration } });

    // ── Build query ───────────────────────────────────────────
    let queryClause;

    if (search && search.trim()) {
      queryClause = {
        multi_match: {
          query: search,
          fields: [
            'title^4',             // title สำคัญที่สุด (boost x4)
            'title.english^3',     // title ภาษาอังกฤษ
            'description^2',       // description รองลงมา
            'description.english',
            'tags^2',
            'instructorName'
          ],
          type: 'best_fields',
          fuzziness: 'AUTO',       // ✅ Typo tolerance อัตโนมัติ
          prefix_length: 1,        // ตัวแรกต้องถูก (ลด false positive)
          operator: 'or'
        }
      };
    } else {
      queryClause = { match_all: {} };
    }

    // ── Sort ──────────────────────────────────────────────────
    const allowedSortFields = {
      createdAt: 'createdAt',
      rating: 'rating',
      viewCount: 'viewCount',
      price: 'price',
      title: 'title.keyword'
    };

    const sortField = allowedSortFields[sortBy] || 'createdAt';
    const sortOrder = order === 'asc' ? 'asc' : 'desc';

    // ถ้า search อยู่ ให้ sort ด้วย _score ก่อน แล้วค่อย fallback
    const sort = search
      ? [{ _score: 'desc' }, { [sortField]: sortOrder }]
      : [{ [sortField]: sortOrder }];

    // ── Aggregations (Faceted search) ─────────────────────────
    const aggs = {
      by_tags: {
        terms: { field: 'tags', size: 20 }
      },
      by_category: {
        terms: { field: 'category', size: 10 }
      },
      by_access_type: {
        terms: { field: 'accessType' }
      },
      price_ranges: {
        range: {
          field: 'price',
          ranges: [
            { key: 'free', to: 1 },
            { key: 'budget', from: 1, to: 300 },
            { key: 'mid', from: 300, to: 1000 },
            { key: 'premium', from: 1000 }
          ]
        }
      },
      duration_ranges: {
        range: {
          field: 'duration',
          ranges: [
            { key: 'short', to: 1800 },        // < 30 นาที
            { key: 'medium', from: 1800, to: 7200 },  // 30 นาที - 2 ชั่วโมง
            { key: 'long', from: 7200 }         // > 2 ชั่วโมง
          ]
        }
      },
      avg_rating: {
        avg: { field: 'rating' }
      }
    };

    // ── Execute ───────────────────────────────────────────────
    const esQuery = {
      from,
      size: limit,
      query: {
        bool: {
          must: queryClause,
          filter: filters
        }
      },
      sort,
      aggs,
      highlight: search ? {
        fields: {
          title: { number_of_fragments: 0 },         // highlight ทั้ง field
          description: { number_of_fragments: 2 }    // เอาแค่ 2 fragment
        },
        pre_tags: ['<mark>'],
        post_tags: ['</mark>']
      } : undefined
    };

    // ลบ undefined keys
    if (!esQuery.highlight) delete esQuery.highlight;

    const response = await ElasticsearchService.searchDocuments(VIDEO_INDEX_NAME, esQuery);

    return this._formatSearchResult(response, page, limit);
  }

  // ─────────────────────────────────────────────────────────────
  // 2. AUTOCOMPLETE
  // ─────────────────────────────────────────────────────────────

  /**
   * Autocomplete สำหรับ search box
   * @param {string} query - คำที่พิมพ์อยู่
   * @param {number} size  - จำนวน suggestion (default 8)
   */
  static async autocomplete(query, size = 8) {
    if (!query || query.trim().length < 1) return [];

    const esQuery = {
      size,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query,
                fields: [
                  'title.autocomplete',      // ✅ search_as_you_type
                  'title.autocomplete._2gram',
                  'title.autocomplete._3gram',
                  'tags'
                ],
                type: 'bool_prefix'          // ← เหมาะกับ search_as_you_type
              }
            }
          ],
          filter: [
            { term: { uploadStatus: 'completed' } },
            { term: { isActive: true } }
          ]
        }
      },
      // เอาแค่ field ที่ต้องการ ลด bandwidth
      _source: ['title', 'tags', 'category', 'thumbnailPath', 'accessType']
    };

    const response = await ElasticsearchService.searchDocuments(VIDEO_INDEX_NAME, esQuery);

    return response.hits.hits.map(hit => ({
      id: hit._id,
      title: hit._source.title,
      tags: hit._source.tags,
      category: hit._source.category,
      thumbnailPath: hit._source.thumbnailPath,
      accessType: hit._source.accessType,
      score: hit._score
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // 3. FACETED SEARCH — ดึง filter options + จำนวน
  // ─────────────────────────────────────────────────────────────

  /**
   * ดึง facet counts สำหรับ sidebar filter
   * เรียกแยกเพื่อ cache ได้ หรือเรียกรวมกับ searchVideos ก็ได้
   */
  static async getFacets(filters = {}) {
    const must_filter = [
      { term: { uploadStatus: 'completed' } },
      { term: { isActive: true } }
    ];

    if (filters.category) must_filter.push({ term: { category: filters.category } });

    const esQuery = {
      size: 0,  // ← ไม่ต้องการ hits เอาแค่ aggs
      query: { bool: { filter: must_filter } },
      aggs: {
        tags: { terms: { field: 'tags', size: 30 } },
        categories: { terms: { field: 'category', size: 20 } },
        access_types: { terms: { field: 'accessType' } },
        price_stats: { stats: { field: 'price' } },
        duration_ranges: {
          range: {
            field: 'duration',
            ranges: [
              { key: 'short', to: 1800 },
              { key: 'medium', from: 1800, to: 7200 },
              { key: 'long', from: 7200 }
            ]
          }
        }
      }
    };

    const response = await ElasticsearchService.searchDocuments(VIDEO_INDEX_NAME, esQuery);
    const aggs = response.aggregations;

    return {
      tags: aggs.tags.buckets.map(b => ({ value: b.key, count: b.doc_count })),
      categories: aggs.categories.buckets.map(b => ({ value: b.key, count: b.doc_count })),
      accessTypes: aggs.access_types.buckets.map(b => ({ value: b.key, count: b.doc_count })),
      priceStats: aggs.price_stats,
      durationRanges: aggs.duration_ranges.buckets.map(b => ({
        key: b.key,
        count: b.doc_count
      }))
    };
  }

  // ─────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────

  static _formatSearchResult(response, page, limit) {
    const hits = response.hits;
    const total = hits.total.value;

    const data = hits.hits.map(hit => ({
      _id: hit._id,
      ...hit._source,
      // ✅ Highlight ถ้ามี (แสดงคำที่ตรงใน title/description)
      highlight: hit.highlight || null,
      score: hit._score
    }));

    // ✅ Facet aggregations
    const facets = response.aggregations
      ? {
          tags: response.aggregations.by_tags?.buckets.map(b => ({
            value: b.key,
            count: b.doc_count
          })),
          categories: response.aggregations.by_category?.buckets.map(b => ({
            value: b.key,
            count: b.doc_count
          })),
          accessTypes: response.aggregations.by_access_type?.buckets.map(b => ({
            value: b.key,
            count: b.doc_count
          })),
          priceRanges: response.aggregations.price_ranges?.buckets.map(b => ({
            key: b.key,
            count: b.doc_count
          })),
          durationRanges: response.aggregations.duration_ranges?.buckets.map(b => ({
            key: b.key,
            count: b.doc_count
          })),
          avgRating: response.aggregations.avg_rating?.value
        }
      : null;

    return {
      data,
      facets,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    };
  }
}

module.exports = VideoSearchService;