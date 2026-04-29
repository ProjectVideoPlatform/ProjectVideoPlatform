// recommendation.service.js
'use strict';

const { Pinecone } = require('@pinecone-database/pinecone');
const redisClient  = require('../config/redis');
const Video        = require('../models/Video');
const WatchHistory = require('../models/WatchHistory');

const pc    = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index('video-catalog');

const PINECONE_FETCH_LIMIT = 50;
const SEED_LIMIT           = 10;

function averageVectors(vectors) {
  if (!vectors.length) return null;
  const dim    = vectors[0].length;
  const result = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) result[i] += vec[i];
  }
  return result.map(v => v / vectors.length);
}

// ── get user vector (cache first) ────────────────────────
async function getUserVector(userId) {
  // 1. ลองดึงจาก Redis cache ก่อน (pre-computed)
  const cached = await redisClient.get(`user:vector:${userId}`);
  if (cached) {
    console.log(`[recommendation] cache hit: user_vector ${userId}`);
    return JSON.parse(cached);
  }

  // 2. cache miss → คำนวณ real-time (fallback)
  console.log(`[recommendation] cache miss: computing real-time ${userId}`);
  const history = await WatchHistory.find(
    { userId },
    { videoId: 1, _id: 0 }
  )
    .sort({ watchedAt: -1 })
    .limit(SEED_LIMIT)
    .lean();

  if (!history.length) return null;

  const seedIds       = history.map(h => h.videoId);
  const fetchResponse = await index.fetch(seedIds);
  const records       = fetchResponse.records ?? {};
  const vectors       = seedIds.map(id => records[id]?.values).filter(Boolean);

  if (!vectors.length) return null;

  const userVector = averageVectors(vectors);

  // เก็บ cache ไว้ 2 ชั่วโมง
  await redisClient.set(
    `user:vector:${userId}`,
    JSON.stringify(userVector),
    { EX: 60 * 60 * 2 }
  );

  return userVector;
}

// ─── Trending ─────────────────────────────────────────────
async function getTrendingVideos(limit = 12) {
  try {
    const trendingIds = await redisClient.lRange('global:trending:videos', 0, limit - 1);

    if (!trendingIds?.length) {
      return Video.find({ uploadStatus: 'completed' })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    }

    const videos = await Video.find({
      id: { $in: trendingIds }, uploadStatus: 'completed',
    }).lean();

    const orderMap = Object.fromEntries(trendingIds.map((id, i) => [id, i]));
    return videos.sort((a, b) => (orderMap[a.id] ?? 99) - (orderMap[b.id] ?? 99));

  } catch (err) {
    console.error('[recommendation] trending error:', err);
    return [];
  }
}

// ─── Personalized ─────────────────────────────────────────
async function getRecommendedVideos(userId, limit = 12) {
  try {
    // 1. watched set สำหรับ filter (Redis + MongoDB)
    const [watchedIds, fullHistory] = await Promise.all([
      redisClient.zRange(`user:watched:${userId}`, 0, -1, { REV: true }),
      WatchHistory.find({ userId }, { videoId: 1, _id: 0 }).lean(),
    ]);

    const watchedSet = new Set([
      ...watchedIds,
      ...fullHistory.map(h => h.videoId),
    ]);

    if (!watchedSet.size) {
      return { videos: await getTrendingVideos(limit), source: 'trending_cold_start' };
    }

    // 2. ดึง user vector (cache → real-time fallback)
    const userVector = await getUserVector(userId);

    if (!userVector) {
      return { videos: await getTrendingVideos(limit), source: 'trending_no_vector' };
    }

    // 3. query Pinecone ด้วย user vector
    const topK = Math.min(limit + watchedSet.size, PINECONE_FETCH_LIMIT);
    const queryResponse = await index.query({
      vector:          userVector,
      topK,
      includeMetadata: true,
      namespace:  '_default_'  
    });

    if (!queryResponse.matches?.length) {
      return { videos: await getTrendingVideos(limit), source: 'trending_no_matches' };
    }

    // 4. กรองที่เคยดูแล้วออก
    const recommendedIds = [];
    for (const match of queryResponse.matches) {
      if (!watchedSet.has(match.id)) recommendedIds.push(match.id);
      if (recommendedIds.length >= limit) break;
    }

    if (!recommendedIds.length) {
      return { videos: await getTrendingVideos(limit), source: 'trending_all_watched' };
    }

    const videos = await Video.find({
      id: { $in: recommendedIds }, uploadStatus: 'completed',
    }).lean();

    const orderMap = Object.fromEntries(recommendedIds.map((id, i) => [id, i]));
    videos.sort((a, b) => (orderMap[a.id] ?? 99) - (orderMap[b.id] ?? 99));

    return { videos, source: 'personalized' };

  } catch (err) {
    console.error('[recommendation] error:', err);
    return { videos: await getTrendingVideos(limit), source: 'trending_error' };
  }
}

module.exports = { getRecommendedVideos, getTrendingVideos };