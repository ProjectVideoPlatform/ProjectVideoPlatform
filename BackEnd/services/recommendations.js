'use strict';

// recommendation.service.js
//
//  เพิ่ม 2 feature จาก Flink:
//
//  1. Category Boost (user:boost:{userId})
//     Flink เขียน key นี้เมื่อ user ดู category เดียวกัน ≥ 3 เรื่องใน session
//     → Pinecone results ที่ match category นั้น ขึ้นก่อน
//
//  2. Co-watch Counter (co_watch:{videoId})
//     Flink เขียน sorted set นี้เมื่อ user ดู video A จบแล้วดู video B ต่อใน session
//     → แสดงเป็น "คนที่ดูเรื่องนี้จบ มักดูต่อด้วย..."

const { Pinecone } = require('@pinecone-database/pinecone');
const redisClient  = require('../config/redis');
const Video        = require('../models/Video');
const WatchHistory = require('../models/WatchHistory');

const pc    = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index('video-catalog');

const PINECONE_FETCH_LIMIT = 50;
const SEED_LIMIT           = 10;
const COWATCH_LIMIT        = 10; // แสดง co-watch สูงสุด 10 เรื่อง

function averageVectors(vectors) {
  if (!vectors.length) return null;
  const dim    = vectors[0].length;
  const result = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) result[i] += vec[i];
  }
  return result.map(v => v / vectors.length);
}

// ── get user vector (cache first) ─────────────────────────────────────────────
async function getUserVector(userId) {
  const cached = await redisClient.get(`user:vector:${userId}`);
  if (cached) {
    console.log(`[recommendation] cache hit: user_vector ${userId}`);
    return JSON.parse(cached);
  }

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

  await redisClient.set(
    `user:vector:${userId}`,
    JSON.stringify(userVector),
    { EX: 60 * 60 * 2 }
  );

  return userVector;
}

// ── Trending ──────────────────────────────────────────────────────────────────
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

// ── NEW: Co-watch ─────────────────────────────────────────────────────────────
//
//  ดึง video ids ที่คนมักดูต่อหลังจากดู videoId นี้จบ
//  Flink เขียน ZADD co_watch:{videoId} {score} {nextVideoId}
//  เรียงจาก score สูงสุด (ZREVRANGE)
//
async function getCoWatchVideos(videoId, limit = COWATCH_LIMIT) {
  try {
    // ZREVRANGE → ได้ array ของ videoId เรียงจาก score มากไปน้อย
    const coWatchIds = await redisClient.zRange(
      `co_watch:${videoId}`,
      0,
      limit - 1,
      { REV: true }  // score สูงสุดก่อน
    );

    if (!coWatchIds?.length) return [];

    const videos = await Video.find({
      id: { $in: coWatchIds }, uploadStatus: 'completed',
    }).lean();

    // เรียงตาม co-watch score (ตาม order ที่ Redis ส่งมา)
    const orderMap = Object.fromEntries(coWatchIds.map((id, i) => [id, i]));
    return videos.sort((a, b) => (orderMap[a.id] ?? 99) - (orderMap[b.id] ?? 99));

  } catch (err) {
    console.error('[recommendation] co-watch error:', err);
    return [];
  }
}

// ── NEW: apply category boost ──────────────────────────────────────────────────
//
//  Flink เขียน user:boost:{userId} = category (string) เมื่อดู category เดียวกัน ≥ 3 เรื่อง
//  ถ้ามี boost → เรียง videos ที่ match category นั้นขึ้นก่อน
//  ถ้า video ไม่มี category field → ถือว่าไม่ match (ไม่ขึ้นก่อน แต่ไม่ตัดทิ้ง)
//
function applyBoost(videos, boostCategory) {
  if (!boostCategory) return videos;

  const boosted   = [];
  const remaining = [];

  for (const v of videos) {
    const cat = v.category ?? v.videoCategory ?? '';
    const match = Array.isArray(cat)
      ? cat.includes(boostCategory)
      : cat === boostCategory;

    if (match) boosted.push(v);
    else remaining.push(v);
  }

  return [...boosted, ...remaining];
}

// ── Personalized ──────────────────────────────────────────────────────────────
async function getRecommendedVideos(userId, limit = 12) {
  try {
    // 1. watched set สำหรับ filter
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

    // 2. ดึง user vector + category boost พร้อมกัน
    const [userVector, boostCategory] = await Promise.all([
      getUserVector(userId),
      redisClient.get(`user:boost:${userId}`), // Flink เขียนไว้ — null ถ้าไม่มี
    ]);

    if (boostCategory) {
      console.log(`[recommendation] boost active: ${userId} → ${boostCategory}`);
    }

    if (!userVector) {
      return { videos: await getTrendingVideos(limit), source: 'trending_no_vector' };
    }

    // 3. query Pinecone
    const topK = Math.min(limit + watchedSet.size, PINECONE_FETCH_LIMIT);
    const queryResponse = await index.query({
      vector:          userVector,
      topK,
      includeMetadata: true
    });

    if (!queryResponse.matches?.length) {
      return { videos: await getTrendingVideos(limit), source: 'trending_no_matches' };
    }

    // 4. filter ที่เคยดูแล้ว
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

    // 5. apply boost — เรียง category ที่ Flink detect ขึ้นก่อน
    const boostedVideos = applyBoost(videos, boostCategory);

    return {
      videos:         boostedVideos,
      source:         'personalized',
      boostCategory:  boostCategory || null, // ส่งให้ frontend รู้ว่า boost ทำงานอยู่
    };

  } catch (err) {
    console.error('[recommendation] error:', err);
    return { videos: await getTrendingVideos(limit), source: 'trending_error' };
  }
}

module.exports = { getRecommendedVideos, getTrendingVideos, getCoWatchVideos };